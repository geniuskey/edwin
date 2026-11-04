"""Split edwin.png into vector layers for animation -> src/avatarData.ts (path data + anchor points)."""
import json
from pathlib import Path

import numpy as np
import potrace
from PIL import Image
from scipy import ndimage as ndi

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'edwin.png'
AXIS2 = 387  # character is symmetric about x = 193.5 -> mirror x' = 387 - x
UP = 4

rgb = np.asarray(Image.open(SRC).convert('RGB')).astype(np.float64) / 255
H, W, _ = rgb.shape
mn = rgb.min(-1)
yy, xx = np.mgrid[0:H, 0:W]

# ---------------------------------------------------------------- background
white = mn > 0.92
lab, _ = ndi.label(white)
edge = np.unique(np.r_[lab[0], lab[-1], lab[:, 0], lab[:, -1]])
bg = np.isin(lab, edge[edge > 0])
near = ndi.distance_transform_edt(~bg) <= 2.5
near &= ndi.distance_transform_edt(bg) <= 2.5
alpha = np.where(bg, 0.0, 1.0)
alpha[near] = np.clip(1 - mn[near], 0, 1)
alpha[alpha < 0.03] = 0
color = rgb.copy()
a3 = np.maximum(alpha, 1e-6)[..., None]
color[near] = np.clip((rgb[near] - (1 - alpha[near])[:, None]) / a3[near], 0, 1)

# ---------------------------------------------------------------- bubble interior
wl, _ = ndi.label(white & ~bg)
inside = ndi.binary_fill_holes(wl == wl[250, 376])
bubble = ndi.distance_transform_edt(~inside) <= 10.0
bubble_soft = np.clip(10.5 - ndi.distance_transform_edt(~inside), 0, 1)

# ---------------------------------------------------------------- classes
PALETTE = {
    'line': (0, 0, 0),
    'gray': (102, 102, 102),
    'skin': (252, 220, 198),
    'lens': (219, 219, 219),
    'shirt': (248, 177, 80),
    'blue': (70, 112, 152),
    'yellow': (250, 210, 105),
    'white': (255, 255, 255),
}
names = list(PALETTE)
ID = {n: i for i, n in enumerate(names)}
pal = np.array([PALETTE[n] for n in names], np.float64) / 255
dist = ((color[:, :, None, :] - pal[None, None]) ** 2).sum(-1)
fg = alpha >= 0.5

# anti-aliasing blends can mimic another palette color, so fills are only trusted where they belong
REGION = {
    'gray': (yy < 200) | (yy > 340),
    'lens': (xx > 135) & (xx < 252) & (yy > 176) & (yy < 222),
    'blue': inside,
    'yellow': inside,
    'white': inside,
}
conf = (dist.min(-1) < 0.012) & fg
known = np.where(conf, dist.argmin(-1), -1)
for n, region in REGION.items():
    known[(known == ID[n]) & ~region] = -1
for n in names[1:]:
    lb, k = ndi.label(known == ID[n])
    if k:
        sizes = ndi.sum(np.ones_like(lb), lb, index=np.arange(1, k + 1))
        known[np.isin(lb, np.nonzero(sizes < 25)[0] + 1)] = -1

# remaining pixels: split between black line and the nearest trusted fill
fills = (known > 0)
_, (iy_, ix_) = ndi.distance_transform_edt(~fills, return_indices=True)
near_cls = known[iy_, ix_]
near_col = pal[near_cls]
t = (color * near_col).sum(-1) / np.maximum((near_col ** 2).sum(-1), 1e-6)
cls = known.copy()
unk = fg & (known < 0)
cls[unk] = np.where(t[unk] < 0.5, ID['line'], near_cls[unk])
cls[~fg] = -1

fill = {}
for n in names:
    m = (cls == ID[n]) & conf
    fill[n] = '#%02x%02x%02x' % tuple(int(v * 255 + 0.5) for v in np.median(color[m], 0)) if m.any() else '#000000'

# soft coverage keeps the sub-pixel edge positions encoded by the anti-aliasing
line_soft = alpha * (1 - np.clip(t, 0, 1))


def toward(name: str) -> np.ndarray:
    v = pal[ID[name]] - 1.0
    return np.clip(((color - 1.0) * v).sum(-1) / (v @ v), 0, 1)


# body = original outside bubble, mirrored character underneath it
src_x = AXIS2 - xx
valid = (src_x >= 0) & (src_x < W)
sx = np.clip(src_x, 0, W - 1)
under = ndi.binary_dilation(bubble, iterations=2) | ((xx >= 255) & (yy >= 330))  # laptop + sleeve are symmetric


def body_of(a: np.ndarray, empty) -> np.ndarray:
    return np.where(under, np.where(valid, a[yy, sx], empty), a)


body_cls = body_of(cls, -1)
body_alpha = body_of(alpha, 0.0)
body_line = body_of(line_soft, 0.0)
gray = body_cls == ID['gray']
body_cls[gray & (yy < 300)] = 100  # hair
body_cls[gray & (yy >= 300)] = 101  # laptop

bub_cls = np.where(bubble & fg, cls, -1)
bub_line = line_soft * bubble_soft
near_blue = ndi.binary_dilation(bub_cls == ID['blue'], iterations=2)
near_yellow = ndi.binary_dilation(bub_cls == ID['yellow'], iterations=2)


# ---------------------------------------------------------------- tracing
def fmt(v: float) -> str:
    s = f'{v / UP:.2f}'.rstrip('0').rstrip('.')
    return '0' if s in ('-0', '') else s


def curves(soft: np.ndarray, sigma: float = 0.0) -> list[str]:
    m = soft.astype(np.float64)
    if sigma:
        m = ndi.gaussian_filter(m, sigma)
    big = ndi.zoom(m, UP, order=3) > 0.5
    plist = potrace.Bitmap(~big).trace(
        turdsize=12,
        turnpolicy=potrace.POTRACE_TURNPOLICY_MINORITY,
        alphamax=1.0,
        opticurve=True,
        opttolerance=0.6,
    )
    out = []
    for c in plist:
        p = c.start_point
        d = [f'M{fmt(p.x)} {fmt(p.y)}']
        for s in c.segments:
            if s.is_corner:
                d.append(f'L{fmt(s.c.x)} {fmt(s.c.y)}L{fmt(s.end_point.x)} {fmt(s.end_point.y)}')
            else:
                d.append(
                    f'C{fmt(s.c1.x)} {fmt(s.c1.y)} {fmt(s.c2.x)} {fmt(s.c2.y)} '
                    f'{fmt(s.end_point.x)} {fmt(s.end_point.y)}'
                )
        d.append('Z')
        out.append(''.join(d))
    return out


def path(soft: np.ndarray, sigma: float = 0.0) -> str:
    return ''.join(curves(soft, sigma))


def under_lines(mask: np.ndarray) -> str:
    # fills are tucked 2px under the outlines, so their own edges never show
    return path(ndi.binary_dilation(mask, iterations=2), sigma=1.0)


def logo_cover(name: str, near: np.ndarray) -> np.ndarray:
    # eye holes are closed here; the eyes are drawn as circles on top
    cover = toward(name) * near
    solid = cover > 0.5
    filled = ndi.binary_fill_holes(solid)
    cover[ndi.binary_dilation(filled & ~solid, iterations=2) & filled] = 1
    return cover


body_line_contours = curves(body_line)
bubble_line_contours = curves(bub_line)

layers = {
    'body': {
        'hair': under_lines(body_cls == 100),
        'skin': under_lines(body_cls == ID['skin']),
        'lens': under_lines(body_cls == ID['lens']),
        'shirt': under_lines(body_cls == ID['shirt']),
        'laptop': under_lines(body_cls == 101),
        'line': ''.join(body_line_contours),
    },
    'bubble': {
        'fill': under_lines(inside),
        'line': ''.join(bubble_line_contours),
    },
    'python': {
        'blue': path(logo_cover('blue', near_blue)),
        'yellow': path(logo_cover('yellow', near_yellow)),
    },
    'silhouette': {
        'all': path(alpha),
        'body': path(body_alpha),
        'bubble': path(bubble_soft * alpha),
    },
}

# ---------------------------------------------------------------- anchors
def comp_stats(mask: np.ndarray, min_area: int = 30):
    lb, n = ndi.label(mask)
    res = []
    for i in range(1, n + 1):
        m = lb == i
        area = int(m.sum())
        if area < min_area:
            continue
        ys, xs = np.nonzero(m)
        res.append({'x': float(xs.mean()), 'y': float(ys.mean()), 'r': float(np.sqrt(area / np.pi)), 'area': area,
                    'x0': int(xs.min()), 'x1': int(xs.max()), 'y0': int(ys.min()), 'y1': int(ys.max())})
    return sorted(res, key=lambda r: -r['area'])


lenses = sorted(comp_stats(body_cls == ID['lens'])[:2], key=lambda r: r['x'])
lap_lb, _ = ndi.label(body_cls == 101)
laptop_logo = comp_stats(lap_lb == lap_lb[418, 193])[0]
smile = [c for c in comp_stats(body_cls == ID['line'], 10) if 220 < c['y'] < 270 and c['area'] < 2000][0]
py_mask = (bub_cls == ID['blue']) | (bub_cls == ID['yellow'])
py_y, py_x = np.nonzero(py_mask)
py = {'x': float(py_x.mean()), 'y': float(py_y.mean()), 'x0': int(py_x.min()), 'x1': int(py_x.max()),
      'y0': int(py_y.min()), 'y1': int(py_y.max())}
eyes = comp_stats((wl > 0) & (wl != wl[250, 376]), 10)
iy, ix = np.nonzero(inside)
far = np.argmax((ix - 376) ** 2 + (iy - 324) ** 2)
fy, fx = np.nonzero(fg)


def gradient(mask: np.ndarray) -> list[str]:
    ys, xs = np.nonzero(mask & (dist.min(-1) < 0.04))
    t = xs + ys
    lo, hi = t < np.percentile(t, 15), t > np.percentile(t, 85)
    return ['#%02x%02x%02x' % tuple(int(v * 255 + 0.5) for v in np.median(rgb[ys[s], xs[s]], 0)) for s in (lo, hi)]


anchors = {
    'lensL': lenses[0], 'lensR': lenses[1],
    'smile': smile,
    'laptopLogo': laptop_logo,
    'bubble': {'x': 375.9, 'y': 324.0, 'r': 93.6, 'rInner': 84.5},
    'tailTip': {'x': float(ix[far]), 'y': float(iy[far])},
    'python': py,
    'eyes': eyes,
    'bounds': {'x0': int(fx.min()), 'x1': int(fx.max()), 'y0': int(fy.min()), 'y1': int(fy.max())},
    'axis': AXIS2 / 2,
}
for k in ('lensL', 'lensR', 'smile', 'laptopLogo', 'python'):
    anchors[k] = {kk: round(v, 2) if isinstance(v, float) else v for kk, v in anchors[k].items()}
anchors['eyes'] = [{'x': round(e['x'], 2), 'y': round(e['y'], 2), 'r': round(e['r'] + 0.4, 2)} for e in eyes]

colors = {
    'line': '#0b0b0d',
    'hair': fill['gray'],
    'laptop': '#636363',
    'skin': fill['skin'],
    'lens': fill['lens'],
    'shirt': fill['shirt'],
    'white': '#ffffff',
    'blue': gradient(bub_cls == ID['blue']),
    'yellow': gradient(bub_cls == ID['yellow']),
}

# ---------------------------------------------------------------- write
def ts(v) -> str:
    return json.dumps(v, indent=2)


(ROOT / 'src' / 'avatarData.ts').write_text(
    '// Generated by scripts/prepare_assets.py from edwin.png (512x512 space)\n\n'
    f'export const VIEW = {W};\n\n'
    f'export const colors = {ts(colors)} as const;\n\n'
    f'export const anchors = {ts(anchors)} as const;\n\n'
    f'export const body = {ts(layers["body"])} as const;\n\n'
    f'export const bubble = {ts(layers["bubble"])} as const;\n\n'
    f'export const python = {ts(layers["python"])} as const;\n\n'
    f'export const silhouette = {ts(layers["silhouette"])} as const;\n\n'
    f'export const bodyLineContours: readonly string[] = {ts(body_line_contours)};\n\n'
    f'export const bubbleLineContours: readonly string[] = {ts(bubble_line_contours)};\n',
    encoding='utf-8',
)


print('wrote src/avatarData.ts', {k: {kk: len(vv) for kk, vv in v.items()} for k, v in layers.items()})
