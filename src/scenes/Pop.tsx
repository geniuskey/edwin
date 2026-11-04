import React from 'react';
import {AbsoluteFill, Easing, random, useCurrentFrame} from 'remotion';
import {Avatar, AvatarPalette} from '../Avatar';
import {clamp, ease, impulse, lerp, ramp, RgbSplit, Shake, useSafeId} from '../fx';
import {C, FONT, HEIGHT, WIDTH} from '../theme';
import {MATCH, MatchFrame} from './Finale';

const INK = '#0b0b0d';
const G = 22;
const LAST = 119;
const FLIP = {start: 29, dur: 15, stagger: 2};
const FLIP_END = FLIP.start + 4 * FLIP.stagger + FLIP.dur + 1;
const REEL_START = 60;
const REELS = [
  {stop: 69, dist: 4, dir: 1},
  {stop: 75, dist: 6, dir: -1},
  {stop: 72, dist: 5, dir: 1},
] as const;
const REEL_END = 76;
const ZOOM = {dip: 90, start: 96};
const PITCH = 16;
const CENTER = 4;

type Rect = {x: number; y: number; w: number; h: number};
const grid = (n: number): Rect[] => {
  const w = (WIDTH - G * (n + 1)) / n;
  const h = (HEIGHT - G * (n + 1)) / n;
  return Array.from({length: n * n}, (_, i) => ({x: G + (i % n) * (w + G), y: G + Math.floor(i / n) * (h + G), w, h}));
};
const G2 = grid(2);
const G3 = grid(3);
const CELL = {w: G3[0].w, h: G3[0].h};
const ZEND = (HEIGHT / CELL.h) * 1.012;

type PopPal = {bg: string; dot: string; av: Partial<AvatarPalette>};
const pal = (
  bg: string,
  dot: string,
  hair: string,
  skin: string,
  shirt: string,
  laptop: string,
  logo: readonly [string, string],
): PopPal => ({
  bg,
  dot,
  av: {hair, skin, shirt, laptop, lens: '#ffffff', bubble: '#ffffff', blue: [logo[0], logo[0]], yellow: [logo[1], logo[1]], eye: '#ffffff'},
});

const HERO: PopPal = {bg: C.yellow, dot: '#f2b40a', av: {}};
const PALS: PopPal[] = [
  HERO,
  pal('#19d3f0', '#0aa3cc', '#fff04d', '#ff8cc6', '#ff4040', '#7b3dff', ['#7b3dff', '#ff4fa3']),
  pal('#ff4fa3', '#df1a78', '#2f62ff', '#fff04d', '#19d3f0', '#3b1a8f', ['#2f62ff', '#ff8a1f']),
  pal('#ff8a1f', '#e0600a', '#7b3dff', '#b5f23d', '#ff4fa3', '#2f62ff', ['#7b3dff', '#19d3f0']),
  pal('#7b3dff', '#5c22df', '#ff8a1f', '#fff04d', '#19d3f0', '#ff4fa3', ['#ff4fa3', '#fff04d']),
  pal('#b5f23d', '#82c614', '#e0187a', '#ffb3d9', '#2f62ff', '#7b3dff', ['#2f62ff', '#e0187a']),
  pal('#ff3b3b', '#c81d1d', '#3b1a8f', '#ffd0e0', '#fff04d', '#2f62ff', ['#2f62ff', '#fff04d']),
  pal('#2f62ff', '#1c44d4', '#fff04d', '#ff8cc6', '#ff8a1f', '#19d3f0', ['#ff8a1f', '#fff04d']),
  pal('#fff3d6', '#ff5a6e', '#2f62ff', '#ffd43b', '#ff3b3b', '#3b1a8f', ['#2f62ff', '#ff3b3b']),
];

const stepAt = (t: number) => clamp(Math.floor(t / 15), 0, 7);
const pal2 = (i: number, s: number) => PALS[(i * 2 + s * 5) % 9];
const pal3 = (i: number, s: number) => PALS[(i * 2 + s * 4 + 1) % 9];
const palPost = (i: number, s: number) => (i === CENTER ? HERO : PALS[1 + (((i < CENTER ? i : i - 1) * 3 + s * 5) % 8)]);
const lastStab = (t: number) => Math.floor(t / 15) * 15;
const squashAt = (t: number) => {
  const dt = t - lastStab(t);
  return 0.075 * Math.exp(-dt / 4.5) * Math.cos(dt * 0.6);
};

// Ben-Day halftone: dots on a 45-degree screen, largest in the bottom-left corner
const dotCache = new Map<string, string>();
const halftone = (w: number, h: number) => {
  const key = `${w.toFixed(1)}x${h.toFixed(1)}`;
  const hit = dotCache.get(key);
  if (hit) return hit;
  const maxR = PITCH * 0.36;
  const parts: string[] = [];
  for (let j = 0; j * (PITCH / 2) <= h + PITCH; j++) {
    const y = j * (PITCH / 2);
    for (let x = (j % 2) * (PITCH / 2); x <= w + PITCH; x += PITCH) {
      const u = (x / w + (1 - y / h)) / 2;
      const r = maxR * clamp(1 - u * 1.15) ** 0.8;
      if (r < 0.7) continue;
      parts.push(`M${(x - r).toFixed(1)} ${y.toFixed(1)}a${r.toFixed(2)} ${r.toFixed(2)} 0 1 0 ${(2 * r).toFixed(2)} 0a${r.toFixed(2)} ${r.toFixed(2)} 0 1 0 ${(-2 * r).toFixed(2)} 0`);
    }
  }
  const d = parts.join('');
  dotCache.set(key, d);
  return d;
};
const dotFlip = (dir: number, w: number, h: number) =>
  `translate(${dir & 1 ? w : 0} ${dir & 2 ? h : 0}) scale(${dir & 1 ? -1 : 1} ${dir & 2 ? -1 : 1})`;

type Framing = {size: number; cx: number; cy: number};
const framing = (w: number, h: number): Framing => {
  const size = (h * 0.95 * 512) / 432;
  return {size, cx: w / 2, cy: h + 2 - ((471 - 256) * size) / 512};
};
const HERO_END: Framing = {
  size: MATCH.size / ZEND,
  cx: CELL.w / 2 + (MATCH.x - WIDTH / 2) / ZEND,
  cy: CELL.h / 2 + (MATCH.y - HEIGHT / 2) / ZEND,
};

const Tile: React.FC<{
  w: number;
  h: number;
  p: PopPal;
  fr?: Framing;
  misreg?: number;
  dots?: number;
  dir?: number;
  squash?: number;
}> = ({w, h, p, fr = framing(w, h), misreg = 1, dots = 1, dir = 0, squash = 0}) => {
  const mx = 0.024 * fr.size * misreg;
  const my = 0.016 * fr.size * misreg;
  const abs: React.CSSProperties = {position: 'absolute', left: 0, top: 0, display: 'block'};
  return (
    <div style={{position: 'absolute', left: 0, top: 0, width: w, height: h, background: p.bg, overflow: 'hidden'}}>
      {dots > 0.01 && (
        <svg width={w} height={h} style={{...abs, opacity: dots}}>
          <path d={halftone(w, h)} fill={p.dot} transform={dotFlip(dir, w, h)} />
        </svg>
      )}
      <div
        style={{
          position: 'absolute',
          left: fr.cx - fr.size / 2,
          top: fr.cy - fr.size / 2,
          width: fr.size,
          height: fr.size,
          transform: squash ? `scale(${1 + squash * 0.6}, ${1 - squash})` : undefined,
          transformOrigin: '50% 92%',
        }}
      >
        {misreg > 0.01 ? (
          <>
            <Avatar size={fr.size} palette={p.av} lines={false} style={{...abs, left: mx, top: my}} />
            <Avatar size={fr.size} palette={p.av} fillOpacity={0} style={abs} />
          </>
        ) : (
          <Avatar size={fr.size} palette={p.av} style={abs} />
        )}
      </div>
    </div>
  );
};

const Cell: React.FC<{r: Rect; children: React.ReactNode; style?: React.CSSProperties}> = ({r, children, style}) => (
  <div style={{position: 'absolute', left: r.x, top: r.y, width: r.w, height: r.h, ...style}}>{children}</div>
);

const dir3 = (i: number) => {
  const col = i % 3;
  const row = Math.floor(i / 3);
  const right = col > 1 || (col === 1 && row !== 1);
  const top = row < 1 || (row === 1 && col !== 1);
  return i === CENTER ? 0 : (right ? 1 : 0) + (top ? 2 : 0);
};
const DIR2 = [2, 3, 0, 1];

const Grid2: React.FC<{t: number; bounce?: boolean}> = ({t, bounce = true}) => {
  const s = stepAt(t);
  const sq = bounce ? squashAt(t) : 0;
  return (
    <>
      {G2.map((r, i) => (
        <Cell key={i} r={r}>
          <Tile w={r.w} h={r.h} p={pal2(i, s)} dir={DIR2[i]} squash={sq} />
        </Cell>
      ))}
    </>
  );
};

// window onto the frozen 2x2 layout, as seen through one 3x3 cell
const Window2: React.FC<{r: Rect}> = ({r}) => {
  const s = stepAt(FLIP.start - 1);
  return (
    <div style={{position: 'absolute', inset: 0, background: INK, overflow: 'hidden'}}>
      {G2.map((q, i) =>
        q.x < r.x + r.w && q.x + q.w > r.x && q.y < r.y + r.h && q.y + q.h > r.y ? (
          <div key={i} style={{position: 'absolute', left: q.x - r.x, top: q.y - r.y, width: q.w, height: q.h}}>
            <Tile w={q.w} h={q.h} p={pal2(i, s)} dir={DIR2[i]} />
          </div>
        ) : null,
      )}
    </div>
  );
};

const FlipGrid: React.FC<{t: number}> = ({t}) => {
  const s = stepAt(t);
  return (
    <>
      {G3.map((r, i) => {
        const start = FLIP.start + ((i % 3) + Math.floor(i / 3)) * FLIP.stagger;
        const p = ramp(t, start, start + FLIP.dur, ease.outBack);
        const angle = 180 * (1 - p);
        const shade = 0.5 * Math.abs(Math.sin((angle * Math.PI) / 180));
        const face: React.CSSProperties = {position: 'absolute', inset: 0, backfaceVisibility: 'hidden', overflow: 'hidden'};
        return (
          <Cell key={i} r={r} style={{perspective: 1300}}>
            <div style={{position: 'absolute', inset: 0, transformStyle: 'preserve-3d', transform: `rotateY(${angle}deg)`}}>
              <div style={face}>
                <Tile w={r.w} h={r.h} p={pal3(i, s)} dir={dir3(i)} />
                <div style={{position: 'absolute', inset: 0, background: '#000', opacity: shade}} />
              </div>
              <div style={{...face, transform: 'rotateY(180deg)'}}>
                <Window2 r={r} />
                <div style={{position: 'absolute', inset: 0, background: '#000', opacity: shade}} />
              </div>
            </div>
          </Cell>
        );
      })}
    </>
  );
};

const reelEase = Easing.bezier(0.5, 0, 0.25, 1.16);
const reelScroll = (c: number, t: number) => {
  const {stop, dist, dir} = REELS[c];
  return dir * dist * (1 - reelEase(ramp(t, REEL_START, stop)));
};

const Reels: React.FC<{t: number}> = ({t}) => {
  const id = useSafeId();
  const s = stepAt(t);
  const pitch = CELL.h + G;
  return (
    <>
      <svg width={0} height={0} style={{position: 'absolute'}}>
        {[0, 1, 2].map((c) => {
          const v = (reelScroll(c, t + 0.5) - reelScroll(c, t - 0.5)) * pitch;
          return (
            <filter key={c} id={`${id}${c}`} x="-5%" y="-20%" width="110%" height="140%">
              <feGaussianBlur stdDeviation={`0 ${Math.min(70, Math.abs(v) * 0.42)}`} />
            </filter>
          );
        })}
      </svg>
      {[0, 1, 2].map((c) => {
        const sc = reelScroll(c, t);
        const {dist, dir} = REELS[c];
        const s0 = dir * dist;
        const tiles: React.ReactNode[] = [];
        for (let k = Math.floor(sc) - 1; k <= Math.ceil(sc) + 3; k++) {
          const y = (k - sc) * pitch;
          if (y > HEIGHT || y + CELL.h < -G) continue;
          let p: PopPal;
          let dirK = 0;
          if (k >= 0 && k <= 2) {
            p = palPost(k * 3 + c, s);
            dirK = dir3(k * 3 + c);
          } else if (k >= s0 && k <= s0 + 2) {
            p = pal3((k - s0) * 3 + c, 3);
            dirK = dir3((k - s0) * 3 + c);
          } else {
            p = PALS[1 + Math.floor(random(`reel-${c}-${k}`) * 8)];
          }
          tiles.push(
            <div key={k} style={{position: 'absolute', left: 0, top: y, width: CELL.w, height: CELL.h}}>
              <Tile w={CELL.w} h={CELL.h} p={p} dir={dirK} />
            </div>,
          );
        }
        return (
          <div
            key={c}
            style={{position: 'absolute', left: G3[c].x, top: G, width: CELL.w, height: HEIGHT - 2 * G, overflow: 'hidden'}}
          >
            <div style={{position: 'absolute', inset: 0, filter: `url(#${id}${c})`}}>{tiles}</div>
          </div>
        );
      })}
    </>
  );
};

const Grid3: React.FC<{t: number; z: number}> = ({t, z}) => {
  const s = stepAt(t);
  const post = t >= REEL_START;
  const hz = ramp(t, 97, 115, ease.inOutCubic);
  const fade = 1 - ramp(t, 95, 108, ease.inOutCubic);
  return (
    <>
      {G3.map((r, i) => {
        if (z > 1.02) {
          const x0 = WIDTH / 2 + (r.x - WIDTH / 2) * z;
          const y0 = HEIGHT / 2 + (r.y - HEIGHT / 2) * z;
          if (x0 > WIDTH || y0 > HEIGHT || x0 + r.w * z < 0 || y0 + r.h * z < 0) return null;
        }
        const hero = i === CENTER && t >= ZOOM.dip;
        const base = framing(r.w, r.h);
        const fr: Framing = hero
          ? {size: lerp(base.size, HERO_END.size, hz), cx: lerp(base.cx, HERO_END.cx, hz), cy: lerp(base.cy, HERO_END.cy, hz)}
          : base;
        return (
          <Cell key={i} r={r}>
            <Tile
              w={r.w}
              h={r.h}
              p={post ? palPost(i, s) : pal3(i, s)}
              dir={dir3(i)}
              fr={fr}
              misreg={hero ? fade : 1}
              dots={hero ? fade : 1}
              squash={hero && t >= 100 ? 0 : squashAt(t)}
            />
          </Cell>
        );
      })}
    </>
  );
};

const BAND_WORDS = ['EDWIN', 'PYTHON', 'HELLO WORLD'];
const BAND = {length: 3800, height: 92, font: 58};
const GUTTER3 = [G3[3].y - G / 2, G3[6].y - G / 2];

type BandSpec = {bg: string; fg: string; dir: 1 | -1; enter: number; y: (t: number) => number; angle: (t: number) => number};
// tapes ride the grid gutters so faces stay readable; the first one hops gutters on the 2x2 -> 3x3 change
const regrid = (t: number) => ramp(t, 28, 40, ease.snap);
const BANDS: BandSpec[] = [
  {bg: INK, fg: C.yellow, dir: -1, enter: 2, y: (t) => lerp(HEIGHT / 2, GUTTER3[0], regrid(t)), angle: (t) => lerp(-4.5, -3, regrid(t))},
  {bg: C.yellow, fg: INK, dir: 1, enter: 30, y: () => GUTTER3[1], angle: () => 3},
];

const Band: React.FC<{t: number; b: BandSpec}> = ({t, b}) => {
  const id = useSafeId();
  const {dir, enter, fg, bg} = b;
  const shiftAt = (u: number) =>
    -dir * (1 - ramp(u, enter, enter + 12, ease.outExpo)) * 2800 + dir * ramp(u, 86, 102, ease.inCubic) * 3600;
  const shift = shiftAt(t);
  if (Math.abs(shift) > 2700) return null;
  const blur = Math.min(90, Math.abs(shiftAt(t + 0.5) - shiftAt(t - 0.5)) * 0.35);
  const travel = dir * (t - enter) * 7;
  const items: React.ReactNode[] = [];
  for (let k = 0; k < 9; k++) {
    BAND_WORDS.forEach((w, j) => {
      items.push(
        <span key={`${k}-${j}`} style={{fontFamily: FONT.display, fontSize: BAND.font, letterSpacing: 3, color: fg, lineHeight: 1}}>
          {w}
        </span>,
        <span
          key={`${k}-${j}d`}
          style={{width: 14, height: 14, borderRadius: '50%', background: fg, display: 'inline-block', flexShrink: 0}}
        />,
      );
    });
  }
  return (
    <div
      style={{
        position: 'absolute',
        left: WIDTH / 2 - BAND.length / 2,
        top: b.y(t) - BAND.height / 2,
        width: BAND.length,
        height: BAND.height,
        transform: `rotate(${b.angle(t)}deg) translateX(${shift}px)`,
        background: bg,
        boxShadow: '0 10px 0 rgba(0,0,0,0.45)',
        overflow: 'hidden',
        filter: blur > 0.5 ? `url(#${id})` : undefined,
      }}
    >
      {blur > 0.5 && (
        <svg width={0} height={0} style={{position: 'absolute'}}>
          <filter id={id} x="-10%" y="-10%" width="120%" height="120%">
            <feGaussianBlur stdDeviation={`${blur} 0`} />
          </filter>
        </svg>
      )}
      <div style={{position: 'absolute', left: 0, right: 0, top: 8, height: 3, background: fg, opacity: 0.9}} />
      <div style={{position: 'absolute', left: 0, right: 0, bottom: 8, height: 3, background: fg, opacity: 0.9}} />
      <div
        style={{
          position: 'absolute',
          left: -2000 + travel,
          top: 0,
          height: BAND.height,
          display: 'flex',
          alignItems: 'center',
          gap: 28,
          whiteSpace: 'nowrap',
          paddingTop: 4,
        }}
      >
        {items}
      </div>
    </div>
  );
};

const zoomAt = (t: number) => {
  const dip = 1 - 0.05 * ramp(t, ZOOM.dip, ZOOM.start, ease.outCubic);
  const go = ramp(t, ZOOM.start, LAST, Easing.bezier(0.72, 0, 0.22, 1));
  return Math.exp(lerp(Math.log(dip), Math.log(ZEND), go));
};

const cameraAt = (t: number) => {
  const punch = lerp(1.14, 1, ramp(t, 0, 14, ease.outExpo));
  const kick = 1 + 0.03 * (impulse(t, 30, 5) + impulse(t, 60, 5));
  return punch * kick * zoomAt(t);
};

const Stage: React.FC<{t: number}> = ({t}) => {
  const z = cameraAt(t);
  return (
    <AbsoluteFill style={{background: INK, overflow: 'hidden'}}>
      <AbsoluteFill style={{transform: `scale(${z})`, transformOrigin: `${WIDTH / 2}px ${HEIGHT / 2}px`}}>
        {t < FLIP.start ? (
          <Grid2 t={t} />
        ) : t < FLIP_END ? (
          <FlipGrid t={t} />
        ) : t >= REEL_START && t < REEL_END ? (
          <Reels t={t} />
        ) : (
          <Grid3 t={t} z={z} />
        )}
        {BANDS.map((b, i) => (
          <Band key={i} t={t} b={b} />
        ))}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// camera motion blur: average sub-frame renders of the stage (only while the zoom is fast)
const samplesAt = (f: number) => {
  if (f < ZOOM.start || f >= LAST - 1) return 1;
  const edge = Math.abs(Math.log(zoomAt(f + 0.25) / zoomAt(f - 0.25))) * 1100;
  return clamp(Math.ceil(edge / 7), 1, 10);
};

export const Pop: React.FC = () => {
  const f = useCurrentFrame();
  if (f >= LAST) return <MatchFrame />;
  const n = samplesAt(f);
  const hit = impulse(f, 0, 3.5);
  const swish = impulse(f, 30, 4) + impulse(f, 60, 4);
  // impact: two negative frames, then a white flash decaying into the positive image
  const flash = (f >= 2 ? 0.55 * impulse(f, 2, 2.5) : 0) + 0.28 * swish;
  return (
    <AbsoluteFill style={{background: INK}}>
      <AbsoluteFill style={{filter: f < 2 ? 'invert(1)' : undefined}}>
        <RgbSplit amount={18 * hit + 7 * swish}>
        <Shake intensity={20 * hit + 8 * swish} rotate={1.2 * hit} seed="pop">
          {n > 1 ? (
            <AbsoluteFill style={{isolation: 'isolate', background: '#000'}}>
              {Array.from({length: n}, (_, i) => (
                <AbsoluteFill key={i} style={{mixBlendMode: 'plus-lighter', filter: `opacity(${1 / n})`}}>
                  <Stage t={f - 0.25 + (0.5 * (i + 0.5)) / n} />
                </AbsoluteFill>
              ))}
            </AbsoluteFill>
          ) : (
            <Stage t={f} />
          )}
        </Shake>
        </RgbSplit>
      </AbsoluteFill>
      {flash > 0.005 && <AbsoluteFill style={{background: '#fff', opacity: flash}} />}
    </AbsoluteFill>
  );
};
