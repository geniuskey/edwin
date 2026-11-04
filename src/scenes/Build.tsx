import {getLength} from '@remotion/paths';
import React, {useLayoutEffect, useRef} from 'react';
import {AbsoluteFill, Easing, random, useCurrentFrame} from 'remotion';
import {Avatar, AVATAR_PATHS, monoPalette} from '../Avatar';
import {bodyLineContours, bubbleLineContours} from '../avatarData';
import {clamp, ease, hits, impulse, lerp, ramp, Shake, useSafeId} from '../fx';
import {C, FONT, HEIGHT, WIDTH} from '../theme';

const CX = WIDTH / 2;
const CY = HEIGHT / 2;
const AV = 1000;
const M = 48; // canvas bleed so the camera shake never reveals an edge
const FOCAL = 900;
const FLOOR_Y = 430;
const Z_NEAR = 40;
const Z_FAR = 6400;
const Z_SPAN = Z_FAR - Z_NEAR;
const GRID = 170;

const RISE = 120;
const DRAWN = 150;
const INHALE = 210;
const GAP = 228;
const BEATS = [0, 30, 60, 90, 120, 150, 180, 210];
const SNARE = [120, 135, 150, 165, 180, 187.5, 195, 202.5, 210, 213.75, 217.5, 221.25, 225];
const RINGS_OUT = [0, 30, 60, 90, 120, 135, 150, 165, 180, 187.5, 195, 202.5];
const RINGS_IN = [210, 213.75, 217.5, 221.25, 225];
const FLICKER = [1.9, 0.3, 1.45, 0.5, 1.2, 0.75, 1.3];

const rgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const rgba = (hex: string, a: number) => `rgba(${rgb(hex).join(',')},${clamp(a)})`;
const mix = (a: string, b: string, t: number) => {
  const B = rgb(b);
  return '#' + rgb(a).map((v, i) => Math.round(v + (B[i] - v) * clamp(t)).toString(16).padStart(2, '0')).join('');
};
const mod = (v: number, m: number) => ((v % m) + m) % m;
const inQuad = Easing.in(Easing.quad);

// ---- time tables (pure functions of frame): forward flight, reverse "inhale" flight, particle clock
const fwdSpeed = (f: number) =>
  f > INHALE ? 0 : 6 + 190 * Math.exp(-f / 7) + 320 * Math.pow(clamp((f - RISE) / (INHALE - RISE)), 2.6);
const backSpeed = (f: number) => (f > INHALE ? 60 + 760 * Math.pow(clamp((f - INHALE) / (GAP - INHALE)), 1.5) : 0);
const cumulative = (fn: (f: number) => number) => {
  const out = [0];
  for (let i = 1; i <= 240; i++) out.push(out[i - 1] + fn(i));
  return out;
};
const FWD = cumulative(fwdSpeed);
const BACK = cumulative(backSpeed);
const PCLOCK = cumulative((f) => (f < RISE - 12 ? 0 : 1 + 2.8 * Math.pow(clamp((f - RISE) / (GAP - RISE)), 2)));
const lookup = (t: number[], f: number) => {
  if (f <= 0) return t[0] + (t[1] - t[0]) * f;
  const i = Math.min(Math.floor(f), t.length - 2);
  return t[i] + (t[i + 1] - t[i]) * (f - i);
};

// ---- 3D field: python keywords + dust in an elliptical tunnel around the bust, kept above the floor
type P3 = {x: number; y: number; z0: number};
const tunnel = (seed: string, rMin: number, rMax: number): P3 => {
  for (let k = 0; k < 40; k++) {
    const a = random(`${seed}-a${k}`) * Math.PI * 2;
    const r = rMin + Math.sqrt(random(`${seed}-r${k}`)) * (rMax - rMin);
    const y = Math.sin(a) * r * 0.8;
    if (y < FLOOR_Y - 70) return {x: Math.cos(a) * r * 1.4, y, z0: random(`${seed}-z`) * Z_SPAN};
  }
  return {x: rMin, y: -rMin, z0: 0};
};

const WORDS = [
  'def', 'class', 'import', 'lambda', 'yield', 'async', 'await', 'self', 'None', 'True', 'print()', 'return',
  'with', 'for', 'in', 'False', 'try', 'except', 'from', 'as', 'while', 'if', 'elif', 'else', 'pass', 'raise',
  '__init__', '@dataclass', '->', 'len()', 'range()', 'not', 'is', 'nonlocal', 'global', '**kwargs', 'f"{edwin}"',
];
const KEYWORDS = Array.from({length: 58}, (_, i) => ({
  word: WORDS[i % WORDS.length],
  ...tunnel(`kw${i}`, 430, 1450),
  size: 24 + random(`kws${i}`) * 18,
  tone: random(`kwt${i}`),
  bold: random(`kwb${i}`) < 0.3,
}));
const DUST = Array.from({length: 380}, (_, i) => ({
  ...tunnel(`du${i}`, 140, 2600),
  r: 0.6 + random(`dur${i}`) * 1.3,
  tone: random(`dut${i}`),
}));
const SPARKS = Array.from({length: 150}, (_, i) => ({
  a: random(`sa${i}`) * Math.PI * 2,
  r: 560 + random(`sr${i}`) * 520,
  life: 26 + random(`sl${i}`) * 30,
  phase: random(`sp${i}`),
  w: 1.2 + random(`sw${i}`) * 1.8,
  tone: random(`st${i}`),
}));

const streak = (
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  width: number,
  color: string,
  alpha: number,
) => {
  if (alpha <= 0.005) return;
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  g.addColorStop(0, rgba(color, 0));
  g.addColorStop(1, rgba(color, alpha));
  ctx.strokeStyle = g;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
};

const dot = (ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, alpha: number) => {
  if (alpha <= 0.005) return;
  ctx.fillStyle = rgba(color, alpha);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
};

const drawFloor = (ctx: CanvasRenderingContext2D, f: number, travel: number, focal: number, cam: number, alpha: number) => {
  if (alpha < 0.01) return;
  const yFar = CY + (FLOOR_Y * focal) / Z_FAR;
  const zMin = (FLOOR_Y * focal) / (HEIGHT - CY + M);
  const beat = hits(f, BEATS, 12) * (0.35 + 0.65 * clamp(f / INHALE));
  const g = ctx.createLinearGradient(0, yFar, 0, HEIGHT + M);
  g.addColorStop(0, 'rgba(70,150,255,0)');
  g.addColorStop(0.3, rgba('#4696ff', 0.1 * alpha));
  g.addColorStop(1, rgba('#5aafff', (0.4 + 0.3 * beat) * alpha));
  ctx.strokeStyle = g;
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  for (let i = -28; i <= 28; i++) {
    ctx.moveTo(CX + (i * GRID * focal) / zMin, HEIGHT + M);
    ctx.lineTo(CX + (i * GRID * focal) / Z_FAR, yFar);
  }
  ctx.stroke();
  for (let n = Math.ceil((travel + zMin) / GRID); n * GRID - travel <= Z_FAR; n++) {
    const y = CY + (FLOOR_Y * focal) / (n * GRID - travel);
    ctx.lineWidth = n % 4 === 0 ? 2.2 : 1;
    ctx.beginPath();
    ctx.moveTo(-M, y);
    ctx.lineTo(WIDTH + M, y);
    ctx.stroke();
  }
  const haze = ctx.createLinearGradient(0, yFar - 70, 0, yFar + 70);
  haze.addColorStop(0, 'rgba(45,226,255,0)');
  haze.addColorStop(0.5, rgba(C.cyan, 0.09 * alpha));
  haze.addColorStop(1, 'rgba(45,226,255,0)');
  ctx.fillStyle = haze;
  ctx.fillRect(-M, yFar - 70, WIDTH + 2 * M, 140);
  // projector pool under the bust
  ctx.save();
  ctx.translate(CX, CY + 425 * cam);
  ctx.scale(1, 0.12);
  const pool = ctx.createRadialGradient(0, 0, 0, 0, 0, 560 * cam);
  pool.addColorStop(0, rgba(C.cyan, (0.32 + 0.25 * beat) * alpha));
  pool.addColorStop(1, 'rgba(45,226,255,0)');
  ctx.fillStyle = pool;
  ctx.beginPath();
  ctx.arc(0, 0, 560 * cam, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
};

// back layer: floor, dust, far keywords, inward sparks (all hidden where the bust occludes them)
// front layer: near keywords only, faded out wherever they would cross the bust
const drawField = (ctx: CanvasRenderingContext2D, f: number, front: boolean, cam: number) => {
  ctx.setTransform(1, 0, 0, 1, M, M);
  ctx.clearRect(-M, -M, WIDTH + 2 * M, HEIGHT + 2 * M);
  const SH = 2.5;
  const fwd = lookup(FWD, f);
  const back = lookup(BACK, f);
  const dz = fwd - lookup(FWD, f - SH) - (back - lookup(BACK, f - SH));
  const warp = clamp((Math.abs(dz) / SH - 14) / 130);
  const focal = FOCAL * cam;
  const appear = ramp(f, 0, 5, ease.outCubic) * (1 + 1.4 * clamp(1 - f / 24));
  const inh = ramp(f, INHALE, GAP);
  const snare = hits(f, SNARE, 4);
  const roll = 0.0015 * f + 0.3 * ease.inCubic(ramp(f, RISE, GAP));
  const cr = Math.cos(roll);
  const sr = Math.sin(roll);
  const project = (x: number, y: number, z: number) => {
    const k = focal / z;
    return {x: CX + (x * cr - y * sr) * k, y: CY + (x * sr + y * cr) * k, k};
  };
  const onScreen = (p: {x: number; y: number}) => p.x > -M && p.x < WIDTH + M && p.y > -M && p.y < HEIGHT + M;

  if (!front) {
    drawFloor(ctx, f, fwd - back, focal, cam, appear * (1 - ease.inCubic(inh)));
    ctx.globalCompositeOperation = 'lighter';
    for (const d of DUST) {
      const z = Z_NEAR + mod(d.z0 - fwd, Z_SPAN) + back;
      const p = project(d.x, d.y, z);
      if (!onScreen(p)) continue;
      const a = clamp((Z_FAR - z) / 2600) * clamp((z - Z_NEAR) / 90) * (0.22 + 0.5 * d.tone) * appear * (1 + snare * warp);
      const t = project(d.x, d.y, Math.max(Z_NEAR, z + dz));
      const col = d.tone > 0.85 ? C.cyan : '#7fb2ff';
      const r = d.r * Math.min(p.k, 2.5);
      if (Math.hypot(p.x - t.x, p.y - t.y) > 1.5) streak(ctx, t.x, t.y, p.x, p.y, Math.max(0.8, r), col, a);
      else dot(ctx, p.x, p.y, r, col, a);
    }

    const density = ramp(f, RISE - 8, RISE + 36, ease.inOutCubic);
    const T = lookup(PCLOCK, f);
    const T0 = lookup(PCLOCK, f - 1.4);
    if (density > 0)
      for (const s of SPARKS) {
        const u = mod(T / s.life + s.phase, 1);
        const u0 = u - (T - T0) / s.life;
        if (u0 < 0) continue;
        const pos = (v: number) => {
          const r = (s.r - (s.r - 170) * v * v) * cam;
          const a = s.a + 0.35 * v * v;
          return [CX + Math.cos(a) * r, CY + Math.sin(a) * r * 0.85];
        };
        const [x1, y1] = pos(u);
        const [x0, y0] = pos(u0);
        const col = s.tone > 0.9 ? C.yellow : s.tone > 0.65 ? '#ffffff' : C.cyan;
        const a = Math.pow(Math.sin(Math.PI * u), 0.6) * density;
        streak(ctx, x0, y0, x1, y1, s.w, col, a * 0.8);
        dot(ctx, x1, y1, s.w * 0.75, col, a);
      }
  } else {
    ctx.globalCompositeOperation = 'lighter';
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const w of KEYWORDS) {
    const z = Z_NEAR + mod(w.z0 - fwd, Z_SPAN) + back;
    if (z < FOCAL !== front) continue;
    const p = project(w.x, w.y, z);
    const size = w.size * p.k;
    if (size < 4 || size > 240 || !onScreen(p)) continue;
    const col = w.tone < 0.6 ? '#3c6fae' : w.tone < 0.9 ? '#5d9de2' : C.cyan;
    const clear = front ? clamp((Math.hypot(p.x - CX, (p.y - CY) * 1.15) - 560 * cam) / 220) : 1;
    const a =
      clamp((Z_FAR - z) / 2200) * clamp((z - 120) / 260) * appear * clear * (0.55 + 0.35 * w.tone + 0.4 * snare * warp);
    if (!front && warp > 0.02) {
      const t = project(w.x, w.y, Math.max(Z_NEAR, z + dz * (1 + 0.5 * warp)));
      streak(ctx, t.x, t.y, p.x, p.y, Math.max(1, size * 0.08), mix(col, '#d8f6ff', warp * 0.6), a * warp);
    }
    ctx.globalAlpha = clamp(a * (1 - 0.85 * warp));
    ctx.fillStyle = col;
    ctx.font = `${w.bold ? 700 : 400} ${size.toFixed(1)}px "${FONT.mono}"`;
    ctx.fillText(w.word, p.x, p.y);
    ctx.globalAlpha = 1;
  }
  ctx.globalCompositeOperation = 'source-over';
};

const Field: React.FC<{f: number; front: boolean; cam: number}> = ({f, front, cam}) => {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (ctx) drawField(ctx, f, front, cam);
  }, [f, front, cam]);
  return (
    <canvas
      ref={ref}
      width={WIDTH + 2 * M}
      height={HEIGHT + 2 * M}
      style={{position: 'absolute', left: -M, top: -M, width: WIDTH + 2 * M, height: HEIGHT + 2 * M}}
    />
  );
};

// ---- line-art pens: mirror Avatar's draw-on stagger so light heads ride the exact stroke tips
const contourSet = (list: readonly string[]) => list.map((d) => ({d, len: getLength(d)})).sort((a, b) => b.len - a.len);
const PEN_SETS = [contourSet(bodyLineContours), contourSet(bubbleLineContours)];
const penProgress = (n: number, i: number, draw: number) => {
  const stagger = n > 1 ? 0.35 : 0;
  const start = n > 1 ? (i / (n - 1)) * stagger : 0;
  return ease.inOutCubic(clamp((draw - start) / (1 - stagger)));
};

const samples = new Map<string, Float32Array>();
const pointAt = (d: string, frac: number) => {
  let t = samples.get(d);
  if (!t) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    el.setAttribute('d', d);
    const total = el.getTotalLength();
    const n = Math.max(2, Math.ceil(total / 2));
    t = new Float32Array((n + 1) * 2);
    for (let i = 0; i <= n; i++) {
      const p = el.getPointAtLength((total * i) / n);
      t[i * 2] = p.x;
      t[i * 2 + 1] = p.y;
    }
    samples.set(d, t);
  }
  const n = t.length / 2 - 1;
  const x = clamp(frac) * n;
  const i = Math.min(Math.floor(x), n - 1);
  const r = x - i;
  return {x: t[i * 2] + (t[i * 2 + 2] - t[i * 2]) * r, y: t[i * 2 + 1] + (t[i * 2 + 3] - t[i * 2 + 1]) * r};
};

const drawAt = (f: number) => Math.pow(ramp(f, 1, DRAWN - 4), 0.8);

const Pens: React.FC<{f: number}> = ({f}) => {
  const draw = drawAt(f);
  if (draw <= 0 || draw >= 1) return null;
  const out: React.ReactNode[] = [];
  PEN_SETS.forEach((set, si) =>
    set.forEach((c, i) => {
      const p = penProgress(set.length, i, draw);
      if (p <= 0.003 || p >= 0.997) return;
      const head = pointAt(c.d, p);
      out.push(
        <g key={`${si}-${i}`}>
          <circle cx={head.x} cy={head.y} r={11} fill={C.cyan} opacity={0.32} />
          <circle cx={head.x} cy={head.y} r={3.6} fill="#ffffff" />
        </g>,
      );
      for (let j = 1; j <= 4; j++) {
        const age = j * 1.6;
        const pj = penProgress(set.length, i, drawAt(f - age));
        if (pj <= 0.003 || pj >= 0.997) continue;
        const o = pointAt(c.d, pj);
        const seed = `${si}-${i}-${Math.floor(f - age)}`;
        const ang = random(`spk${seed}`) * Math.PI * 2;
        const v = 1.6 + 2.2 * random(`spv${seed}`);
        out.push(
          <circle
            key={`${si}-${i}-s${j}`}
            cx={o.x + Math.cos(ang) * v * age}
            cy={o.y + Math.sin(ang) * v * age + 0.25 * age * age}
            r={1.5}
            fill="#ffffff"
            opacity={1 - j / 5}
          />,
        );
      }
    }),
  );
  return <>{out}</>;
};

const Holo: React.FC<{f: number}> = ({f}) => {
  const id = useSafeId();
  const draw = drawAt(f);
  const lit = f >= DRAWN;
  const flick = lit ? (FLICKER[f - DRAWN] ?? 1) : 1;
  const beat = hits(f, BEATS, 9) * (0.35 + 0.65 * clamp(f / INHALE));
  const roll = hits(f, SNARE, 4) * (0.35 + 0.65 * ramp(f, RISE, GAP));
  const build = ease.inCubic(ramp(f, RISE, INHALE));
  const inh = ramp(f, INHALE, GAP, inQuad);
  const g = (0.85 + 0.45 * beat + 1.1 * build + 0.9 * roll + 2.6 * inh) * flick;
  const hot = lit ? mix('#d2f9ff', '#ffffff', Math.max(inh, roll * 0.8)) : mix(C.cyan, '#a9f3ff', draw);
  // neon ignition: only the tube flickers, the dark body stays solid
  const line = flick < 1 ? mix('#0d3b48', hot, flick) : hot;
  const body = ramp(draw, 0.55, 1, ease.inOutCubic);
  return (
    <div
      style={{
        position: 'absolute',
        left: CX - AV / 2,
        top: CY - AV / 2,
        width: AV,
        height: AV,
        transform: `scale(${1 + 0.014 * beat + 0.02 * roll})`,
      }}
    >
      <Avatar
        size={AV}
        draw={draw}
        fillOpacity={0}
        logoStroke={2.5}
        palette={monoPalette(line)}
        under={
          <>
            <defs>
              <pattern id={`${id}scan`} patternUnits="userSpaceOnUse" width={6} height={3.2}>
                <rect width={6} height={1.1} fill={C.cyan} />
              </pattern>
            </defs>
            <path d={AVATAR_PATHS.silhouette.all} fill="#030810" opacity={0.96 * body} />
            <path d={AVATAR_PATHS.silhouette.all} fill={`url(#${id}scan)`} opacity={body * (0.07 + 0.08 * beat + 0.2 * inh)} />
          </>
        }
        style={{
          filter: `drop-shadow(0 0 ${1.5 * g}px ${rgba(C.cyan, 0.9)}) drop-shadow(0 0 ${8 * g}px ${rgba(C.cyan, 0.5)}) drop-shadow(0 0 ${24 * g}px ${rgba(C.cyan, 0.28)})`,
        }}
      >
        <Pens f={f} />
      </Avatar>
    </div>
  );
};

// shockwave rings: crisp bright edge with a faint gradient wake (outgoing on the beat grid, imploding on the 32nds)
type Ring = {r: number; wake: number; o: number; inward: boolean};
const ringStops = ({r, wake, inward}: Ring): [number, number, string][] => {
  const edge = '#e2fcff';
  if (inward) {
    const R = r + wake;
    return [
      [(r - 2) / R, 0, edge],
      [r / R, 1, edge],
      [(r + 2.5) / R, 1, edge],
      [(r + 12) / R, 0.2, C.cyan],
      [1, 0, C.cyan],
    ];
  }
  const R = r + 2;
  return [
    [(r - wake) / R, 0, C.cyan],
    [(r - 12) / R, 0.2, C.cyan],
    [(r - 2.5) / R, 1, edge],
    [r / R, 1, edge],
    [1, 0, edge],
  ];
};

const Rings: React.FC<{f: number}> = ({f}) => {
  const id = useSafeId();
  const rings: Ring[] = RINGS_OUT.filter((t) => f >= t && f < t + 52).map((t) => {
    const age = (f - t) / 52;
    const major = t % 30 === 0;
    const strength = (major ? 1 : 0.55) * (0.3 + 0.7 * clamp(t / 200));
    return {r: 200 + 1020 * ease.outQuart(age), wake: 18 + 200 * age, o: strength * Math.pow(1 - age, 1.5), inward: false};
  });
  if (f < GAP)
    RINGS_IN.filter((t) => f >= t).forEach((t) => {
      const age = clamp((f - t) / 9);
      rings.push({r: 1000 * (1 - ease.inCubic(age)) + 30, wake: 40 + 150 * (1 - age), o: 0.4 + 0.6 * age, inward: true});
    });
  return (
    <svg width={WIDTH} height={HEIGHT} style={{position: 'absolute', left: 0, top: 0, overflow: 'visible'}}>
      <defs>
        {rings.map((r, i) => {
          let last = 0;
          return (
            <radialGradient key={i} id={`${id}${i}`} gradientUnits="userSpaceOnUse" cx={CX} cy={CY} r={r.inward ? r.r + r.wake : r.r + 2}>
              {ringStops(r).map(([o, a, c], k) => {
                last = Math.max(last, clamp(o));
                return <stop key={k} offset={last} stopColor={c} stopOpacity={a} />;
              })}
            </radialGradient>
          );
        })}
      </defs>
      {rings.map((r, i) => (
        <circle key={i} cx={CX} cy={CY} r={r.inward ? r.r + r.wake : r.r + 2} fill={`url(#${id}${i})`} opacity={clamp(r.o)} />
      ))}
    </svg>
  );
};

const Orb: React.FC<{size: number; core: string; mid: string; blend?: React.CSSProperties['mixBlendMode']}> = ({
  size,
  core,
  mid,
  blend,
}) => (
  <div
    style={{
      position: 'absolute',
      left: CX - size / 2,
      top: CY - size / 2,
      width: size,
      height: size,
      borderRadius: '50%',
      background: `radial-gradient(circle, ${core} 0%, ${mid} 32%, rgba(0,0,0,0) 68%)`,
      mixBlendMode: blend,
    }}
  />
);

// 228-239: the drop gap, only the compressed energy left at the centre
const Gap: React.FC<{f: number}> = ({f}) => {
  const t = f - GAP;
  const s = (0.78 + 0.22 * Math.cos((t / 6) * Math.PI * 2)) * (1 - 0.86 * inQuad(ramp(f, 232, 239)));
  return (
    <AbsoluteFill style={{background: '#010205'}}>
      <Orb size={150 * s} core={rgba('#b4f6ff', 0.7 * s)} mid={rgba(C.cyan, 0.25 * s)} />
      <div
        style={{
          position: 'absolute',
          left: CX - 200 * s,
          top: CY - 0.75,
          width: 400 * s,
          height: 1.5,
          background: `linear-gradient(90deg, rgba(45,226,255,0), ${rgba(C.cyan, 0.7 * s)}, rgba(45,226,255,0))`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: CX - 4,
          top: CY - 4,
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: '#fff',
          opacity: Math.min(1, 0.2 + s),
          transform: `scale(${0.35 + 0.65 * s})`,
          boxShadow: `0 0 10px 2px ${rgba(C.cyan, 0.9 * s)}`,
        }}
      />
    </AbsoluteFill>
  );
};

export const Build: React.FC = () => {
  const f = useCurrentFrame();
  if (f >= GAP) return <Gap f={f} />;

  const appear = ramp(f, 0, 12, ease.outCubic);
  const build = ramp(f, RISE, INHALE);
  const inh = ramp(f, INHALE, GAP);
  const cam =
    lerp(0.84, 1, ease.outQuart(ramp(f, 0, 60))) * (1 + 0.12 * ease.inCubic(build)) * (1 - 0.2 * ease.inOutCubic(inh));
  const beat = hits(f, BEATS, 10) * (0.35 + 0.65 * clamp(f / INHALE));
  const snare = hits(f, SNARE, 3);
  const shake = 1.2 * build + 7 * build * build + 7 * inh + 3 * snare * build;
  const glowA = 0.14 + 0.16 * beat + 0.12 * snare * build + 0.3 * impulse(f, DRAWN, 6) + 0.28 * ease.inCubic(build) + 0.45 * inh;
  const bloom = ease.inCubic(ramp(f, INHALE + 2, GAP));

  return (
    <AbsoluteFill style={{background: '#020309'}}>
      <AbsoluteFill
        style={{
          opacity: appear,
          background: 'radial-gradient(ellipse 80% 75% at 50% 46%, #0d1d3a 0%, #081227 40%, #040812 75%, #020309 100%)',
        }}
      />
      <Shake intensity={shake} rotate={0.06 * shake} speed={1.7} seed="build">
        <Field f={f} front={false} cam={cam} />
        <AbsoluteFill style={{transform: `scale(${cam})`}}>
          <Orb size={1500} core={rgba(C.cyan, glowA)} mid={rgba('#1d5fd0', glowA * 0.45)} />
          <Rings f={f} />
          <Holo f={f} />
        </AbsoluteFill>
        <Field f={f} front cam={cam} />
        {bloom > 0.01 && (
          <Orb size={600 + 1100 * bloom} core={rgba('#ffffff', 0.95 * bloom)} mid={rgba('#8cf0ff', 0.55 * bloom)} blend="screen" />
        )}
      </Shake>
    </AbsoluteFill>
  );
};
