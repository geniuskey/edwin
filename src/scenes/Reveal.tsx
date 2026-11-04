import {noise2D} from '@remotion/noise';
import React, {useLayoutEffect, useRef} from 'react';
import {AbsoluteFill, random, useCurrentFrame} from 'remotion';
import {anchors, Avatar, AVATAR_PALETTE, AVATAR_PATHS, AvatarPalette, BubbleState, monoPalette} from '../Avatar';
import {clamp, ease, impulse, lerp, ramp, RgbSplit, useSafeId} from '../fx';
import {BEAT, C, FONT, HEIGHT, WIDTH} from '../theme';

type Ease = (t: number) => number;
type Pt = {x: number; y: number};
type Mat = readonly [number, number, number, number, number, number];

const TAU = Math.PI * 2;
const AV = 1000;
const SC = AV / 512;
const CX = WIDTH / 2;
const CY = HEIGHT / 2;
const CIRCLE_R = 430;
// the bust sits left of the art box to leave room for the bubble: keep it centered until the bubble pops
const AXIS_SHIFT = (256 - anchors.axis) * SC;
const TIP = anchors.tailTip;
const PY = anchors.python;
const PYC = {x: (PY.x0 + PY.x1) / 2, y: (PY.y0 + PY.y1) / 2};

const BLEED = 80;
// the world continues past the right edge (fading out) so the whip-out has a soft trailing edge
const TAIL = 900;

const POP = 120;
const LOGO_IN = 132;
const SPARKLE = 150;
const PUSH = 180;
const WHIP = 330;
const END = 359;

// ---------------------------------------------------------------- timing helpers

type Key = readonly [frame: number, value: number, easing?: Ease];
const keys = (f: number, k: readonly Key[]) => {
  if (f <= k[0][0]) return k[0][1];
  for (let i = 1; i < k.length; i++) {
    if (f < k[i][0]) {
      const [f0, v0, e = ease.inOutCubic] = k[i - 1];
      return lerp(v0, k[i][1], e((f - f0) / (k[i][0] - f0)));
    }
  }
  return k[k.length - 1][1];
};

// frames since the latest hit of a periodic cue (Infinity before the first one)
const since = (f: number, period: number, first: number) => (f < first ? Infinity : (f - first) % period);
const kick = (f: number) => Math.exp(-since(f, BEAT, BEAT) / 5);
const clap = (f: number) => since(f, BEAT * 2, BEAT);
const hat = (f: number) => Math.exp(-since(f, BEAT, BEAT / 2) / 4);

const rgbOf = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a: string, b: string, t: number) => {
  const B = rgbOf(b);
  return `rgb(${rgbOf(a)
    .map((v, i) => Math.round(lerp(v, B[i], t)))
    .join(',')})`;
};
const rgba = (h: string, a: number) => `rgba(${rgbOf(h).join(',')},${a})`;

const apply = (m: Mat, p: Pt): Pt => ({x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5]});

// ---------------------------------------------------------------- choreography

const cameraAt = (f: number) => ({
  z: keys(f, [[0, 1], [PUSH - 2, 1.04, ease.snap], [PUSH + 16, 1.4, ease.linear], [PUSH + 26, 1.43], [236, 0.84, ease.linear], [WHIP, 0.86]]),
  x: keys(f, [[PUSH - 2, CX, ease.snap], [PUSH + 16, 1160, ease.linear], [PUSH + 26, 1166], [236, 1281]]),
  y: keys(f, [[PUSH - 2, CY, ease.snap], [PUSH + 16, 640, ease.linear], [PUSH + 26, 644], [236, 552]]),
});

const shakeAt = (f: number) =>
  44 * impulse(f, 0, 8) + 8 * impulse(f, POP, 5) + 12 * impulse(f, PUSH, 6) + 5 * impulse(f, SPARKLE, 4);

// world -> screen: zoom about the focus point, plus noise shake (and a little roll on the drop)
const cameraMatrix = (f: number): Mat => {
  const cam = cameraAt(f);
  const amt = shakeAt(f);
  const sx = noise2D('rv-sx', f * 0.8 + 11.3, 0) * amt;
  const sy = noise2D('rv-sy', 0, f * 0.8 + 4.7) * amt;
  const r = (noise2D('rv-sr', f * 0.8 + 2.1, 3) * 2.5 * impulse(f, 0, 8) * Math.PI) / 180;
  const a = Math.cos(r) * cam.z;
  const b = Math.sin(r) * cam.z;
  return [a, b, -b, a, CX + sx - (a * cam.x - b * cam.y), CY + sy - (b * cam.x + a * cam.y)];
};

const avatarState = (f: number) => {
  const t = Math.max(0, f);
  return {
    scale: (1 + 0.35 * Math.exp(-t / 7) * Math.cos((t * TAU) / 22)) * (1 + 0.018 * kick(f)),
    rot: 5 * Math.exp(-t / 8) * Math.cos((t * TAU) / 26 + 0.5),
    x: AXIS_SHIFT * (1 - ramp(f, POP - 2, POP + 24, ease.inOutCubic)),
    y: Math.sin((f / 240) * TAU) * 6,
  };
};
type AvatarT = ReturnType<typeof avatarState>;

const avatarToWorld = (a: AvatarT, p: Pt): Pt => {
  const dx = (p.x - 256) * SC * a.scale;
  const dy = (p.y - 256) * SC * a.scale;
  const r = (a.rot * Math.PI) / 180;
  return {x: CX + a.x + dx * Math.cos(r) - dy * Math.sin(r), y: CY + a.y + dx * Math.sin(r) + dy * Math.cos(r)};
};

const bubbleAt = (f: number) => ({
  sx: keys(f, [[POP, 0, ease.outCubic], [POP + 7, 1.25], [POP + 14, 0.9], [POP + 21, 1.05], [POP + 28, 0.98], [POP + 34, 1]]),
  sy: keys(f, [[POP, 0, ease.outCubic], [POP + 7, 0.8], [POP + 14, 1.1], [POP + 21, 0.96], [POP + 28, 1.01], [POP + 34, 1]]),
  rot: keys(f, [[POP, -30, ease.outCubic], [POP + 10, 6], [POP + 20, -2.5], [POP + 32, 0]]),
});

const bubbleProp = (f: number): false | BubbleState => {
  if (f < POP) return false;
  if (f >= POP + 34) return {};
  const b = bubbleAt(f);
  return {scale: [b.sx, b.sy], rotate: b.rot};
};

const logoAt = (f: number) => {
  const t = ramp(f, LOGO_IN, LOGO_IN + 20);
  const spin = 360 * ease.inOutCubic(ramp(f, PUSH, PUSH + 26));
  return {
    scale: f < LOGO_IN ? 0 : ease.outBack(t) * (1 + 0.07 * kick(f) * ramp(f, SPARKLE, SPARKLE + 8)),
    rotate: lerp(-270, 0, ease.outBack(t)) + spin,
  };
};

const whipX = (f: number) => 34 * ease.outCubic(ramp(f, WHIP, WHIP + 5)) - 2434 * Math.pow(ramp(f, WHIP + 5, END), 3.5);

// ---------------------------------------------------------------- shared bits

const Svg: React.FC<{children: React.ReactNode}> = ({children}) => (
  <svg width={WIDTH} height={HEIGHT} style={{position: 'absolute', left: 0, top: 0, overflow: 'visible'}}>
    {children}
  </svg>
);

const World: React.FC<{m: Mat; children: React.ReactNode}> = ({m, children}) => (
  <AbsoluteFill style={{transformOrigin: '0 0', transform: `matrix(${m.join(',')})`}}>{children}</AbsoluteFill>
);

const AvatarBox: React.FC<{av: AvatarT; shadow?: boolean; children: React.ReactNode}> = ({av, shadow, children}) => (
  <div
    style={{
      position: 'absolute',
      left: CX - AV / 2 + av.x,
      top: CY - AV / 2 + av.y,
      width: AV,
      height: AV,
      transform: `rotate(${av.rot}deg) scale(${av.scale})`,
      filter: shadow ? 'drop-shadow(0 26px 30px rgba(2,8,24,0.5))' : undefined,
    }}
  >
    {children}
  </div>
);

// manga focus lines: thin wedges pointing at the center, outside a clear ellipse
const focusLines = (seed: string, n: number, rx: number, ry: number, wMax: number, spread: number) => {
  let d = '';
  const R = 1700;
  for (let i = 0; i < n; i++) {
    const th = ((i + random(`${seed}a${i}`) * 0.9) / n) * TAU;
    const c = Math.cos(th);
    const s = Math.sin(th);
    const inner = (1 / Math.hypot(c / rx, s / ry)) * (1 + random(`${seed}r${i}`) * spread);
    const ph = ((0.12 + random(`${seed}w${i}`) ** 2) * wMax) / R;
    d += `M${(c * inner).toFixed(1)} ${(s * inner).toFixed(1)}L${(Math.cos(th - ph) * R).toFixed(1)} ${(
      Math.sin(th - ph) * R
    ).toFixed(1)}L${(Math.cos(th + ph) * R).toFixed(1)} ${(Math.sin(th + ph) * R).toFixed(1)}Z`;
  }
  return d;
};

const starPath = (s: number) => `M0 ${-s}Q0 0 ${s} 0Q0 0 0 ${s}Q0 0 ${-s} 0Q0 0 0 ${-s}Z`;

// ---------------------------------------------------------------- background

// full-frame layers overscan so RGB split / shake never expose the frame edge
const Bleed: React.FC<{color: string; opacity?: number}> = ({color, opacity = 1}) =>
  opacity <= 0.002 ? null : (
    <div style={{position: 'absolute', left: -BLEED, top: -BLEED, right: -BLEED, bottom: -BLEED, background: color, opacity}} />
  );

const Background: React.FC<{f: number; m: Mat}> = ({f, m}) => {
  const c = apply(m, {x: CX, y: CY});
  const z = Math.hypot(m[0], m[1]);
  return (
    <Bleed
      color={`radial-gradient(circle ${1250 * z}px at ${c.x + BLEED}px ${c.y + BLEED}px, ${mix('#1d5091', '#2b6cb8', kick(f) * 0.6)} 0%, #163d72 26%, #0e2750 52%, #08152e 76%, #04080f 100%)`}
    />
  );
};

const RAY_N = 24;
const RAY_D = Array.from({length: RAY_N}, (_, i) => {
  const a0 = (i / RAY_N) * TAU;
  const a1 = a0 + (TAU / RAY_N) * 0.5;
  const R = 2400;
  return `M0 0L${(Math.cos(a0) * R).toFixed(1)} ${(Math.sin(a0) * R).toFixed(1)}L${(Math.cos(a1) * R).toFixed(1)} ${(
    Math.sin(a1) * R
  ).toFixed(1)}Z`;
}).join('');

const Sunburst: React.FC<{f: number}> = ({f}) => {
  const id = useSafeId();
  // slow drift plus a snappy 3deg tick on every beat
  const rot = f * 0.06 + Math.floor(f / BEAT) * 3 + 3 * ease.snap(clamp((f % BEAT) / 12));
  const grow = ease.outExpo(ramp(f, 2, 26));
  const op = (0.75 + 0.5 * kick(f)) * ramp(f, 3, 10);
  return (
    <Svg>
      <defs>
        <radialGradient id={id} gradientUnits="userSpaceOnUse" cx={0} cy={0} r={1600}>
          <stop offset="0.2" stopColor="#9fd0ff" stopOpacity={0.17} />
          <stop offset="0.55" stopColor="#9fd0ff" stopOpacity={0.07} />
          <stop offset="1" stopColor="#9fd0ff" stopOpacity={0} />
        </radialGradient>
      </defs>
      <g transform={`translate(${CX} ${CY}) rotate(${rot}) scale(${0.5 + 0.5 * grow})`} opacity={op}>
        <path d={RAY_D} fill={`url(#${id})`} />
      </g>
    </Svg>
  );
};

// ---------------------------------------------------------------- stage: shockwaves + yellow circle

const SHOCKS = [
  {at: 1, color: C.blueHi, r0: 150, r1: 1300, w: 56, dur: 24},
  {at: 4, color: C.white, r0: 130, r1: 1400, w: 74, dur: 22},
  {at: 9, color: C.yellow, r0: 320, r1: 1050, w: 16, dur: 28},
] as const;

const ORBIT_DOTS = 90;

const Stage: React.FC<{f: number}> = ({f}) => {
  const id = useSafeId();
  const t = f - 2;
  const s = t < 0 ? 0 : (1 - Math.exp(-t / 5.5) * Math.cos(t * 0.36)) * (1 + 0.025 * kick(f));
  const ring = ease.inOutCubic(ramp(f, 8, 44));
  const dots = Math.floor(ease.inOutCubic(ramp(f, 14, 56)) * ORBIT_DOTS);
  const c1 = TAU * (CIRCLE_R + 28);
  const cl = clap(f) / 24;
  return (
    <Svg>
      <defs>
        <radialGradient id={id} cx="0.38" cy="0.32" r="0.8">
          <stop offset="0" stopColor={C.yellowHi} />
          <stop offset="0.55" stopColor={C.yellow} />
          <stop offset="1" stopColor="#f2bd22" />
        </radialGradient>
      </defs>
      {SHOCKS.map((k, i) => {
        const p = (f - k.at) / k.dur;
        if (p < 0 || p > 1) return null;
        return (
          <circle
            key={i}
            cx={CX}
            cy={CY}
            r={lerp(k.r0, k.r1, ease.outQuart(p))}
            fill="none"
            stroke={k.color}
            strokeWidth={k.w * Math.pow(1 - p, 1.3)}
            opacity={Math.pow(1 - p, 0.7)}
          />
        );
      })}
      {cl < 1 && (
        <circle
          cx={CX}
          cy={CY}
          r={CIRCLE_R * lerp(1, 1.34, ease.outCubic(cl))}
          fill="none"
          stroke={C.white}
          strokeWidth={7 * (1 - cl)}
          opacity={0.55 * (1 - cl)}
        />
      )}
      {s > 0 && <circle cx={CX} cy={CY} r={CIRCLE_R * s} fill={`url(#${id})`} />}
      {ring > 0 && (
        <circle
          cx={CX}
          cy={CY}
          r={CIRCLE_R + 28}
          fill="none"
          stroke={C.white}
          strokeOpacity={0.5}
          strokeWidth={3}
          strokeLinecap="round"
          strokeDasharray={`${c1 * ring} ${c1}`}
          transform={`rotate(${-90 + f * 0.15} ${CX} ${CY})`}
        />
      )}
      <g transform={`rotate(${-f * 0.2} ${CX} ${CY})`}>
        {Array.from({length: dots}, (_, i) => {
          const a = (i / ORBIT_DOTS) * TAU;
          return (
            <circle key={i} cx={CX + Math.cos(a) * (CIRCLE_R + 66)} cy={CY + Math.sin(a) * (CIRCLE_R + 66)} r={2.6} fill={C.white} opacity={0.35} />
          );
        })}
      </g>
    </Svg>
  );
};

// ---------------------------------------------------------------- particles (canvas)

type Shape = 'spark' | 'rect' | 'circle' | 'tri' | 'ring' | 'ribbon' | 'star';
type Particle = {
  shape: Shape;
  x: number;
  y: number;
  vx: number;
  vy: number;
  k: number;
  g: number;
  size: number;
  color: string;
  back: string;
  rot: number;
  spin: number;
  flip: number;
  ph: number;
  sway: number;
  life: number;
  delay: number;
  front: boolean;
};

const CONFETTI_COLORS = [C.yellow, C.yellow, C.yellowHi, C.blueHi, C.blue, C.orange, C.orange, C.white, C.hot, C.blueHi];
const SPARK_COLORS = [C.white, C.white, C.yellowHi, C.yellow];

const BURST_O = {x: CX, y: CY - 30};

const BURST: Particle[] = (() => {
  const out: Particle[] = [];
  const r = (s: string) => random(`rv-p-${s}`);
  for (let i = 0; i < 140; i++) {
    const a = r(`sa${i}`) * TAU;
    const sp = 70 + r(`ss${i}`) * 90;
    const o = Math.sqrt(r(`so${i}`)) * 90;
    out.push({
      shape: 'spark',
      x: BURST_O.x + Math.cos(a) * o,
      y: BURST_O.y + Math.sin(a) * o * 0.8,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp * 0.8 - 4,
      k: 0.13 + r(`sk${i}`) * 0.05,
      g: 0.3,
      size: 2.5 + r(`sz${i}`) * 4.5,
      color: SPARK_COLORS[i % SPARK_COLORS.length],
      back: '',
      rot: 0,
      spin: 0,
      flip: 0,
      ph: 0,
      sway: 0,
      life: 16 + r(`sl${i}`) * 22,
      delay: r(`sd${i}`) * 2.5,
      front: r(`sf${i}`) < 0.4,
    });
  }
  for (let i = 0; i < 230; i++) {
    const a = r(`ca${i}`) * TAU;
    const sp = 30 + Math.pow(r(`cs${i}`), 0.7) * 95;
    const o = Math.sqrt(r(`co${i}`)) * 120;
    const front = r(`cf${i}`) < 0.3;
    const pick = r(`ch${i}`);
    const shape: Shape =
      pick < 0.46 ? 'rect' : pick < 0.6 ? 'circle' : pick < 0.74 ? 'tri' : pick < 0.82 ? 'ring' : pick < 0.92 ? 'ribbon' : 'star';
    const color = CONFETTI_COLORS[Math.floor(r(`cc${i}`) * CONFETTI_COLORS.length)];
    out.push({
      shape,
      x: BURST_O.x + Math.cos(a) * o,
      y: BURST_O.y + Math.sin(a) * o * 0.8,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp * 0.82 - 6,
      k: 0.11 + r(`ck${i}`) * 0.035,
      g: 0.3 + r(`cg${i}`) * 0.14,
      size: (12 + r(`cz${i}`) * 13) * (front ? 1.55 : 1),
      color,
      back: mix(color, '#000000', 0.38),
      rot: r(`cr${i}`) * TAU,
      spin: (r(`cp${i}`) - 0.5) * 0.45,
      flip: 0.14 + r(`cl${i}`) * 0.24,
      ph: r(`cq${i}`) * TAU,
      sway: 10 + r(`cw${i}`) * 30,
      life: 48 + r(`ce${i}`) * 40,
      delay: r(`cd${i}`) * 3,
      front,
    });
  }
  return out;
})();

// closed-form motion with linear drag k and gravity g
const stateAt = (p: Particle, t: number) => {
  const e = Math.exp(-p.k * t);
  const gk = p.g / p.k;
  return {
    x: p.x + (p.vx / p.k) * (1 - e) + p.sway * Math.sin(t * 0.13 + p.ph) * (1 - e),
    y: p.y + ((p.vy - gk) / p.k) * (1 - e) + gk * t,
    vx: p.vx * e,
    vy: (p.vy - gk) * e + gk,
  };
};

const drawPiece = (ctx: CanvasRenderingContext2D, p: Particle, t: number, alpha: number) => {
  const s = stateAt(p, t);
  const flip = Math.cos(p.ph + p.flip * t);
  const z = p.size;
  const col = flip >= 0 ? p.color : p.back;
  ctx.save();
  ctx.translate(s.x, s.y);
  ctx.rotate(p.rot + p.spin * t + p.spin * 8 * (1 - Math.exp(-0.12 * t)));
  ctx.scale(1, (flip >= 0 ? 1 : -1) * Math.max(0.12, Math.abs(flip)));
  ctx.globalAlpha = alpha;
  ctx.fillStyle = col;
  ctx.strokeStyle = col;
  ctx.lineCap = 'round';
  ctx.beginPath();
  if (p.shape === 'rect') {
    ctx.rect(-z / 2, -z * 0.22, z, z * 0.44);
    ctx.fill();
  } else if (p.shape === 'circle') {
    ctx.arc(0, 0, z * 0.36, 0, TAU);
    ctx.fill();
  } else if (p.shape === 'tri') {
    ctx.moveTo(0, -z * 0.5);
    ctx.lineTo(z * 0.45, z * 0.36);
    ctx.lineTo(-z * 0.45, z * 0.36);
    ctx.closePath();
    ctx.fill();
  } else if (p.shape === 'ring') {
    ctx.lineWidth = z * 0.16;
    ctx.arc(0, 0, z * 0.36, 0, TAU);
    ctx.stroke();
  } else if (p.shape === 'ribbon') {
    ctx.lineWidth = z * 0.2;
    ctx.moveTo(-z * 0.8, 0);
    ctx.quadraticCurveTo(-z * 0.4, -z * 0.45, 0, 0);
    ctx.quadraticCurveTo(z * 0.4, z * 0.45, z * 0.8, 0);
    ctx.stroke();
  } else {
    const q = z * 0.6;
    ctx.moveTo(0, -q);
    ctx.quadraticCurveTo(0, 0, q, 0);
    ctx.quadraticCurveTo(0, 0, 0, q);
    ctx.quadraticCurveTo(0, 0, -q, 0);
    ctx.quadraticCurveTo(0, 0, 0, -q);
    ctx.fill();
  }
  ctx.restore();
};

const drawSpark = (ctx: CanvasRenderingContext2D, p: Particle, t: number, alpha: number) => {
  const s = stateAt(p, t);
  const w = p.size * (0.35 + 0.65 * (1 - t / p.life));
  ctx.lineCap = 'round';
  ctx.strokeStyle = p.color;
  ctx.beginPath();
  ctx.moveTo(s.x, s.y);
  ctx.lineTo(s.x - s.vx * 2.4, s.y - s.vy * 2.4);
  ctx.globalAlpha = alpha * 0.28;
  ctx.lineWidth = w * 3;
  ctx.stroke();
  ctx.globalAlpha = alpha;
  ctx.lineWidth = w;
  ctx.stroke();
};

const drawBurst = (ctx: CanvasRenderingContext2D, f: number, front: boolean) => {
  for (const p of BURST) {
    if (p.front !== front) continue;
    const t = f - p.delay;
    if (t < 0 || t > p.life) continue;
    const s = stateAt(p, t);
    const clear = front ? clamp((Math.hypot(s.x - BURST_O.x, s.y - BURST_O.y) - 300) / 140) : 1;
    const a = clamp((p.life - t) / (p.life * 0.3)) * clear;
    if (a <= 0.01) continue;
    if (p.shape === 'spark') {
      drawSpark(ctx, p, t, a);
      continue;
    }
    const sp = Math.hypot(s.vx, s.vy);
    if (sp > 12) {
      // motion smear trailing the piece while it is still flying fast
      ctx.globalAlpha = a * clamp((sp - 12) / 30) * 0.5;
      ctx.strokeStyle = p.color;
      ctx.lineCap = 'round';
      ctx.lineWidth = p.size * 0.42;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.x - s.vx * 0.9, s.y - s.vy * 0.9);
      ctx.stroke();
    }
    drawPiece(ctx, p, t, a);
  }
};

const drawCore = (ctx: CanvasRenderingContext2D, f: number) => {
  if (f < 2 || f > 30) return;
  const a = 0.6 * Math.exp(-(f - 2) / 5);
  const r = 300 + (f - 2) * 34;
  const g = ctx.createRadialGradient(BURST_O.x, BURST_O.y, 0, BURST_O.x, BURST_O.y, r);
  g.addColorStop(0, `rgba(255,255,255,${a})`);
  g.addColorStop(0.4, `rgba(255,232,115,${0.75 * a})`);
  g.addColorStop(1, 'rgba(255,212,59,0)');
  ctx.globalAlpha = 1;
  ctx.fillStyle = g;
  ctx.fillRect(BURST_O.x - r, BURST_O.y - r, r * 2, r * 2);
};

const AMBIENT = Array.from({length: 56}, (_, i) => ({
  x: random(`rv-ax${i}`) * 2800 - 300,
  y: random(`rv-ay${i}`) * (HEIGHT + 300),
  v: 0.35 + random(`rv-av${i}`) * 1.3,
  s: 3 + Math.pow(random(`rv-as${i}`), 2.2) * 14,
  a: 0.2 + random(`rv-aa${i}`) * 0.45,
  c: [C.white, C.yellowHi, C.blueHi, C.white, C.cyan][i % 5],
}));

const drawAmbient = (ctx: CanvasRenderingContext2D, f: number) => {
  const fade = ramp(f, 8, 40);
  if (fade <= 0) return;
  const tw = 0.55 + 0.45 * Math.max(hat(f), kick(f));
  const span = HEIGHT + 300;
  AMBIENT.forEach((p, i) => {
    const y = ((((p.y - p.v * f) % span) + span) % span) - 150;
    const x = p.x + noise2D(`rv-an${i}`, f * 0.008, 0) * 60;
    const g = ctx.createRadialGradient(x, y, 0, x, y, p.s);
    g.addColorStop(0, rgba(p.c, p.a * tw * fade));
    g.addColorStop(0.3, rgba(p.c, p.a * tw * fade * 0.7));
    g.addColorStop(1, rgba(p.c, 0));
    ctx.globalAlpha = 1;
    ctx.fillStyle = g;
    ctx.fillRect(x - p.s, y - p.s, p.s * 2, p.s * 2);
  });
};

const ParticleCanvas: React.FC<{f: number; m: Mat; front: boolean}> = ({f, m, front}) => {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
    if (!front) {
      drawCore(ctx, f);
      drawAmbient(ctx, f);
    }
    if (f < 120) drawBurst(ctx, f, front);
  });
  return <canvas ref={ref} width={WIDTH} height={HEIGHT} style={{position: 'absolute', left: 0, top: 0}} />;
};

// ---------------------------------------------------------------- avatar + python logo

const LogoArt: React.FC<{id: string; rotate: number; scale: number; opacity?: number}> = ({id, rotate, scale, opacity = 1}) => (
  <g transform={`translate(${PYC.x} ${PYC.y}) rotate(${rotate}) scale(${scale}) translate(${-PYC.x} ${-PYC.y})`} opacity={opacity}>
    <path d={AVATAR_PATHS.python.blue} fill={`url(#${id}b)`} fillRule="evenodd" />
    <path d={AVATAR_PATHS.python.yellow} fill={`url(#${id}y)`} fillRule="evenodd" />
    {anchors.eyes.map((e, i) => (
      <circle key={i} cx={e.x} cy={e.y} r={e.r} fill={AVATAR_PALETTE.eye} />
    ))}
  </g>
);

const arcPath = (r: number, a0: number, a1: number) =>
  `M${PYC.x + r * Math.cos(a0)} ${PYC.y + r * Math.sin(a0)}A${r} ${r} 0 0 1 ${PYC.x + r * Math.cos(a1)} ${PYC.y + r * Math.sin(a1)}`;

// logo drawn by us (not by <Avatar>) so it can carry rotational motion-blur ghosts + a spin trail
const LogoLayer: React.FC<{f: number}> = ({f}) => {
  const id = useSafeId();
  const L = logoAt(f);
  if (L.scale < 0.002) return null;
  const b = f >= POP + 34 ? {sx: 1, sy: 1, rot: 0} : bubbleAt(f);
  const vel = Math.abs(L.rotate - logoAt(f - 1).rotate);
  const blur = clamp((vel - 3) / 12);
  const head = (L.rotate * Math.PI) / 180;
  const span = Math.min(4.2, (vel * 5 * Math.PI) / 180);
  return (
    <>
      <defs>
        <linearGradient id={`${id}b`} gradientUnits="userSpaceOnUse" x1={PY.x0} y1={PY.y0} x2={PY.x1} y2={PY.y1}>
          <stop offset="0" stopColor={AVATAR_PALETTE.blue[0]} />
          <stop offset="1" stopColor={AVATAR_PALETTE.blue[1]} />
        </linearGradient>
        <linearGradient id={`${id}y`} gradientUnits="userSpaceOnUse" x1={PY.x0} y1={PY.y0} x2={PY.x1} y2={PY.y1}>
          <stop offset="0" stopColor={AVATAR_PALETTE.yellow[0]} />
          <stop offset="1" stopColor={AVATAR_PALETTE.yellow[1]} />
        </linearGradient>
      </defs>
      <g transform={`translate(${TIP.x} ${TIP.y}) rotate(${b.rot}) scale(${b.sx} ${b.sy}) translate(${-TIP.x} ${-TIP.y})`}>
        {blur > 0 &&
          [C.yellow, C.blueHi].map((col, k) =>
            Array.from({length: 10}, (_, i) => (
              <path
                key={`${col}-${i}`}
                d={arcPath(76, head + k * Math.PI - ((i + 1) * span) / 10, head + k * Math.PI - (i * span) / 10 + 0.01)}
                fill="none"
                stroke={col}
                strokeWidth={6 * (1 - i / 14)}
                strokeLinecap={i === 0 ? 'round' : 'butt'}
                opacity={0.85 * blur * (1 - i / 10)}
              />
            )),
          )}
        {blur > 0 &&
          [6, 5, 4, 3, 2, 1].map((j) => {
            const g = logoAt(f - j * 0.4);
            return <LogoArt key={j} id={id} rotate={g.rotate} scale={g.scale} opacity={0.42 * blur * (1 - j / 7)} />;
          })}
        <LogoArt id={id} rotate={L.rotate} scale={L.scale} />
      </g>
    </>
  );
};

const POP_DASHES = 9;

// rings live behind the avatar so they never cut across the face
const BackRings: React.FC<{f: number; av: AvatarT}> = ({f, av}) => {
  const R = anchors.bubble.r * SC * av.scale;
  const pt = (f - POP - 1) / 18;
  const st = (f - SPARKLE) / 20;
  const pc = avatarToWorld(av, anchors.bubble);
  const sc = avatarToWorld(av, PYC);
  return (
    <>
      {pt >= 0 && pt <= 1 && (
        <circle cx={pc.x} cy={pc.y} r={R * lerp(0.6, 1.9, ease.outExpo(pt))} fill="none" stroke={C.white} strokeWidth={22 * (1 - pt)} opacity={1 - pt * pt} />
      )}
      {st >= 0 &&
        st <= 1 &&
        [C.yellow, C.blueHi].map((col, i) => (
          <circle
            key={col}
            cx={sc.x}
            cy={sc.y}
            r={R * lerp(0.9, 1.7 + i * 0.35, ease.outExpo(st))}
            fill="none"
            stroke={col}
            strokeWidth={14 * (1 - st)}
            opacity={1 - st}
          />
        ))}
    </>
  );
};

const PopAccents: React.FC<{f: number; av: AvatarT}> = ({f, av}) => {
  const t = (f - POP - 1) / 16;
  if (t < 0 || t > 1) return null;
  const c = avatarToWorld(av, anchors.bubble);
  const R = anchors.bubble.r * SC * av.scale;
  const e = ease.outExpo(t);
  return (
    <g>
      {Array.from({length: POP_DASHES}, (_, i) => {
        const a = lerp(-1.75, 1.9, i / (POP_DASHES - 1));
        const r0 = R * (1.18 + 0.45 * e);
        const r1 = r0 + 70 * (1 - ease.inCubic(t));
        return (
          <line
            key={i}
            x1={c.x + Math.cos(a) * r0}
            y1={c.y + Math.sin(a) * r0}
            x2={c.x + Math.cos(a) * r1}
            y2={c.y + Math.sin(a) * r1}
            stroke={i % 2 ? C.yellow : C.white}
            strokeWidth={10 * (1 - t) + 2}
            strokeLinecap="round"
          />
        );
      })}
    </g>
  );
};

const SPARKS = Array.from({length: 22}, (_, i) => ({
  a: (i / 22) * TAU + (random(`rv-ka${i}`) - 0.5) * 0.3,
  d: 1.25 + random(`rv-kd${i}`) * 1.3,
  s: 16 + random(`rv-ks${i}`) ** 1.5 * 30,
  c: [C.yellow, C.blueHi, C.white, C.yellowHi, '#5aa8f0'][i % 5],
  t0: random(`rv-kt${i}`) * 5,
}));

const SPARK_DOTS = Array.from({length: 30}, (_, i) => ({
  a: random(`rv-da${i}`) * TAU,
  d: 1.4 + random(`rv-dd${i}`) * 1.8,
  r: 3 + random(`rv-dr${i}`) * 4,
  c: [C.yellow, C.blueHi, C.white][i % 3],
}));

const SparkleBurst: React.FC<{f: number; av: AvatarT}> = ({f, av}) => {
  if (f < SPARKLE || f > SPARKLE + 36) return null;
  const c = avatarToWorld(av, PYC);
  const R = anchors.bubble.r * SC;
  const dt = (f - SPARKLE) / 24;
  return (
    <g>
      {dt <= 1 &&
        SPARK_DOTS.map((p, i) => {
          const d = R * lerp(0.7, p.d, ease.outExpo(dt));
          return (
            <circle key={i} cx={c.x + Math.cos(p.a) * d} cy={c.y + Math.sin(p.a) * d} r={p.r * (1 - dt)} fill={p.c} opacity={1 - dt * dt} />
          );
        })}
      {SPARKS.map((s, i) => {
        const t = (f - SPARKLE - s.t0) / 28;
        if (t < 0 || t > 1) return null;
        const d = R * lerp(0.75, s.d, ease.outExpo(t));
        const k = t < 0.16 ? ease.outBack(t / 0.16) : 1 - ease.inCubic((t - 0.16) / 0.84);
        return (
          <g key={i} transform={`translate(${c.x + Math.cos(s.a) * d} ${c.y + Math.sin(s.a) * d}) rotate(${t * 140}) scale(${k})`}>
            <path d={starPath(s.s * 1.9)} fill={s.c} opacity={0.28} />
            <path d={starPath(s.s)} fill={s.c} />
            <circle r={s.s * 0.16} fill={C.white} />
          </g>
        );
      })}
    </g>
  );
};

// ---------------------------------------------------------------- speed lines

const SpeedLines: React.FC<{f: number; m: Mat; av: AvatarT; dark: boolean}> = ({f, m, av, dark}) => {
  if (f >= 3 && f <= 20) {
    const c = apply(m, avatarToWorld(av, {x: anchors.axis, y: 256}));
    const t = ramp(f, 3, 20);
    const o = (1 - ease.inCubic(t)) * (0.7 + 0.3 * random(`rv-slo${f}`));
    return (
      <Svg>
        <path
          d={focusLines(`rv-sl${f}`, 84, 640, 440, 18 * (1 - t * 0.6), 0.5)}
          transform={`translate(${c.x} ${c.y})`}
          fill={dark ? C.ink : C.white}
          opacity={o}
        />
      </Svg>
    );
  }
  if (f >= PUSH && f <= PUSH + 20) {
    const c = apply(m, avatarToWorld(av, anchors.bubble));
    const t = ramp(f, PUSH, PUSH + 20);
    return (
      <Svg>
        <path
          d={focusLines(`rv-pl${f}`, 64, 700, 470, 9, 0.6)}
          transform={`translate(${c.x} ${c.y})`}
          fill={C.white}
          opacity={0.32 * Math.sin(Math.PI * t) * (0.75 + 0.25 * random(`rv-plo${f}`))}
        />
      </Svg>
    );
  }
  return null;
};

// ---------------------------------------------------------------- impact frames (0-2)

const MANGA: Partial<AvatarPalette> = {line: C.ink, hair: C.ink, skin: '#fff', lens: '#fff', shirt: '#fff', laptop: '#fff', eye: '#fff'};
const NEGATIVE: Partial<AvatarPalette> = {line: '#fff', hair: '#fff', skin: C.ink, lens: C.ink, shirt: C.ink, laptop: C.ink, eye: C.ink};

const IMPACT: readonly {bg: string; lines: string; ring: string; pal: Partial<AvatarPalette>; burst?: string; glasses?: string}[] = [
  {bg: '#ffffff', lines: C.ink, ring: C.ink, pal: MANGA},
  {bg: C.yellow, lines: C.ink, ring: C.white, pal: {...monoPalette(C.ink), lens: '#fff'}, burst: C.white, glasses: '#fff'},
  {bg: C.ink, lines: C.yellow, ring: C.yellow, pal: NEGATIVE},
];

// bold glasses drawn over the solid silhouette so it still reads as Edwin
const SilhouetteGlasses: React.FC<{color: string}> = ({color}) => {
  const l = anchors.lensL;
  const r = anchors.lensR;
  return (
    <g fill="none" stroke={color} strokeWidth={6} strokeLinecap="round">
      <circle cx={l.x} cy={l.y} r={l.r + 4} />
      <circle cx={r.x} cy={r.y} r={r.r + 4} />
      <path d={`M${l.x + l.r + 4} ${l.y - 2}Q${(l.x + r.x) / 2} ${l.y - 9} ${r.x - r.r - 4} ${r.y - 2}`} />
      <path d={`M${l.x - l.r - 4} ${l.y - 3}L${l.x - l.r - 24} ${l.y - 10}`} />
      <path d={`M${r.x + r.r + 4} ${r.y - 3}L${r.x + r.r + 24} ${r.y - 10}`} />
    </g>
  );
};

const BURST_D = (() => {
  const n = 18;
  let d = '';
  for (let i = 0; i < n * 2; i++) {
    const a = (i / (n * 2)) * TAU + (random(`rv-b${i}`) - 0.5) * 0.12;
    const r = i % 2 === 0 ? 760 + random(`rv-br${i}`) * 260 : 520 + random(`rv-br${i}`) * 80;
    d += `${i ? 'L' : 'M'}${(Math.cos(a) * r).toFixed(1)} ${(Math.sin(a) * r * 0.8).toFixed(1)}`;
  }
  return d + 'Z';
})();

const ImpactFrame: React.FC<{f: number; m: Mat; av: AvatarT}> = ({f, m, av}) => {
  const id = useSafeId();
  const s = IMPACT[f];
  const c = apply(m, avatarToWorld(av, {x: anchors.axis, y: 256}));
  return (
    <AbsoluteFill>
      <Bleed color={s.bg} />
      <Svg>
        {s.burst && (
          <>
            <defs>
              <pattern id={`${id}p`} width={22} height={22} patternUnits="userSpaceOnUse" patternTransform="rotate(30)">
                <circle cx={11} cy={11} r={5.5} fill={C.ink} />
              </pattern>
              <radialGradient id={`${id}g`} gradientUnits="userSpaceOnUse" cx={c.x} cy={c.y} r={1150}>
                <stop offset="0.4" stopColor="#fff" stopOpacity={0} />
                <stop offset="1" stopColor="#fff" stopOpacity={0.55} />
              </radialGradient>
              <mask id={`${id}m`} maskUnits="userSpaceOnUse" x={-BLEED} y={-BLEED} width={WIDTH + BLEED * 2} height={HEIGHT + BLEED * 2}>
                <rect x={-BLEED} y={-BLEED} width={WIDTH + BLEED * 2} height={HEIGHT + BLEED * 2} fill={`url(#${id}g)`} />
              </mask>
            </defs>
            <rect x={-BLEED} y={-BLEED} width={WIDTH + BLEED * 2} height={HEIGHT + BLEED * 2} fill={`url(#${id}p)`} mask={`url(#${id}m)`} />
          </>
        )}
        <g transform={`translate(${c.x} ${c.y})`}>
          {s.burst && <path d={BURST_D} fill={s.burst} />}
          <path d={focusLines(`rv-imp${f}`, 120, 560, 400, 26, 0.45)} fill={s.lines} />
        </g>
      </Svg>
      <World m={m}>
        <Svg>
          <circle cx={CX} cy={CY} r={[470, 640, 820][f]} fill="none" stroke={s.ring} strokeWidth={[34, 24, 16][f]} />
        </Svg>
        <AvatarBox av={av}>
          <Avatar size={AV} palette={s.pal} bubble={false} style={{display: 'block'}}>
            {s.glasses && <SilhouetteGlasses color={s.glasses} />}
          </Avatar>
        </AvatarBox>
      </World>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- callouts (screen-space HUD)

type Seg = readonly [text: string, color: string];
type CalloutDef = {at: number; anchor: Pt; y: number; accent: string; segs: readonly Seg[]};

const DIM = 'rgba(245,247,251,0.5)';
const PILL_X = 1150;
const FS = 34;
const CH = FS * 0.6;
const PILL_H = 66;
const PAD = 26;
const TYPE_RATE = 2.2;
const rimAt = (deg: number): Pt => ({
  x: anchors.bubble.x + anchors.bubble.r * Math.cos((deg * Math.PI) / 180),
  y: anchors.bubble.y + anchors.bubble.r * Math.sin((deg * Math.PI) / 180),
});

const CALLOUTS: readonly CalloutDef[] = [
  {
    at: 240,
    anchor: anchors.lensR,
    y: 250,
    accent: C.cyan,
    segs: [['edwin', C.white], ['.', DIM], ['glasses', C.cyan], [' = ', C.magenta], ['True', C.orange]],
  },
  {
    at: 270,
    anchor: anchors.laptopLogo,
    y: 915,
    accent: C.orange,
    segs: [['edwin', C.white], ['.', DIM], ['laptop', C.cyan], [' = ', C.magenta], ['"always open"', C.yellow]],
  },
  {
    at: 300,
    anchor: rimAt(5),
    y: 590,
    accent: C.yellow,
    segs: [['edwin', C.white], ['.', DIM], ['speaks', C.cyan], [' = ', C.magenta], ['"Python"', C.yellow]],
  },
];

const Callout: React.FC<{f: number; def: CalloutDef; a: Pt; latest: boolean}> = ({f, def, a, latest}) => {
  const r = f - def.at;
  if (r < 0) return null;
  const text = def.segs.map(([s]) => s).join('');
  const W = (text.length + 1) * CH + PAD * 2;
  const P = {x: PILL_X, y: def.y};
  const E = {x: Math.min(a.x + Math.abs(P.y - a.y), P.x - 40), y: P.y};
  const L = Math.hypot(E.x - a.x, E.y - a.y) + (P.x - E.x);
  const draw = ease.inOutCubic(clamp((r - 2) / 10));
  const dot = ease.outBackBig(clamp(r / 8));
  const rip = clamp(r / 18);
  const open = ease.snap(clamp((r - 10) / 10));
  const typed = Math.max(0, Math.floor((r - 11) * TYPE_RATE));
  const typing = typed < text.length;
  const cursor = typing ? r >= 10 : latest && Math.floor((r - 11 - text.length / TYPE_RATE) / 9) % 2 === 1;
  let left = typed;
  const line = `M${a.x} ${a.y}L${E.x} ${E.y}L${P.x} ${P.y}`;
  return (
    <>
      <Svg>
        <path d={line} fill="none" stroke="rgba(3,8,20,0.5)" strokeWidth={8} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={`${L} ${L + 10}`} strokeDashoffset={L * (1 - draw)} />
        <path d={line} fill="none" stroke={C.white} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={`${L} ${L + 10}`} strokeDashoffset={L * (1 - draw)} />
        {rip < 1 && (
          <circle cx={a.x} cy={a.y} r={lerp(12, 54, ease.outCubic(rip))} fill="none" stroke={def.accent} strokeWidth={4 * (1 - rip)} opacity={1 - rip} />
        )}
        <g transform={`translate(${a.x} ${a.y}) scale(${dot})`}>
          <circle r={14} fill="rgba(3,8,20,0.45)" />
          <circle r={11} fill={C.white} />
          <circle r={5.5} fill={def.accent} />
        </g>
      </Svg>
      {r >= 10 && (
        <div
          style={{
            position: 'absolute',
            left: P.x,
            top: P.y - PILL_H / 2,
            height: PILL_H,
            width: lerp(PILL_H, W, open),
            opacity: clamp((r - 10) / 2),
            borderRadius: PILL_H / 2,
            overflow: 'hidden',
            background: 'linear-gradient(180deg, rgba(24,36,62,0.78), rgba(7,12,26,0.84))',
            backdropFilter: 'blur(14px) saturate(1.5)',
            border: '1.5px solid rgba(255,255,255,0.18)',
            boxShadow: '0 18px 40px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.14)',
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: PAD,
              top: 0,
              height: PILL_H,
              display: 'flex',
              alignItems: 'center',
              fontFamily: FONT.mono,
              fontWeight: 700,
              fontSize: FS,
              whiteSpace: 'pre',
            }}
          >
            {def.segs.map(([s, color], i) => {
              const shown = s.slice(0, Math.max(0, left));
              left -= s.length;
              return shown ? (
                <span key={i} style={{color}}>
                  {shown}
                </span>
              ) : null;
            })}
            {cursor && <span style={{display: 'inline-block', width: CH * 0.92, height: FS * 1.05, background: def.accent, marginLeft: 2}} />}
          </div>
        </div>
      )}
    </>
  );
};

// ---------------------------------------------------------------- whip

const STREAKS = Array.from({length: 28}, (_, i) => ({
  y: 40 + random(`rv-wy${i}`) * (HEIGHT - 80),
  len: 260 + random(`rv-wl${i}`) * 900,
  w: 2 + random(`rv-ww${i}`) * 5,
  x: random(`rv-wx${i}`) * 2200,
  c: [C.white, C.blueHi, C.yellow, C.white, C.cyan][i % 5],
  a: 0.25 + random(`rv-wa${i}`) * 0.5,
  sp: 1.3 + random(`rv-ws${i}`) * 0.9,
}));

const WhipStreaks: React.FC<{f: number}> = ({f}) => {
  if (f < WHIP + 6) return null;
  const d = -whipX(f);
  const o = clamp(Math.abs(whipX(f) - whipX(f - 1)) / 120);
  return (
    <Svg>
      {STREAKS.map((s, i) => {
        const x = WIDTH + s.x - d * s.sp;
        if (x > WIDTH || x + s.len < 0) return null;
        return <rect key={i} x={x} y={s.y} width={s.len} height={s.w} rx={s.w / 2} fill={s.c} opacity={s.a * o} />;
      })}
    </Svg>
  );
};

// ---------------------------------------------------------------- scene

export const Reveal: React.FC = () => {
  const f = useCurrentFrame();
  const blurId = useSafeId();
  const m = cameraMatrix(f);
  const av = avatarState(f);
  const wx = whipX(f);
  const wv = wx - whipX(f - 1);
  const blur = Math.min(170, Math.abs(wv) * 0.5);
  // background flash fades white -> bright blue (not grey) back into the navy
  const bgFlash = f < 3 ? 1 : Math.exp(-(f - 3) / 4.2);
  // big misregistration on the graphic impact frames, lighter once the full-colour hero is revealed
  const rgb =
    f <= 2 ? [24, 20, 16][f] : Math.max(9 * impulse(f, 3, 6), 7 * impulse(f, POP, 4), 9 * impulse(f, PUSH, 5), Math.abs(wv) * 0.07);
  const anchorsOnScreen = CALLOUTS.map((d) => apply(m, avatarToWorld(av, d.anchor)));
  const latest = CALLOUTS.reduce((n, d, i) => (f >= d.at ? i : n), -1);
  const tailMask = f >= WHIP ? `linear-gradient(90deg, #000 ${WIDTH + 120}px, transparent ${WIDTH + TAIL}px)` : undefined;

  return (
    <AbsoluteFill style={{background: C.bg, overflow: 'hidden'}}>
      <svg width="0" height="0" style={{position: 'absolute'}}>
        <filter id={blurId} x="-30%" y="0%" width="160%" height="100%">
          <feGaussianBlur stdDeviation={`${blur} 0`} />
        </filter>
      </svg>
      <AbsoluteFill style={{filter: blur > 0.5 ? `url(#${blurId})` : undefined}}>
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: WIDTH + TAIL,
            height: HEIGHT,
            transform: `translateX(${wx}px)`,
            maskImage: tailMask,
            WebkitMaskImage: tailMask,
          }}
        >
          <RgbSplit amount={rgb} angle={f >= WHIP ? 0 : 16 + Math.min(f, 40) * 12}>
            <Background f={f} m={m} />
            <World m={m}>
              <Sunburst f={f} />
            </World>
            {bgFlash > 0.02 && <Bleed color={mix('#ffffff', '#2a7de1', clamp((1 - bgFlash) * 2))} opacity={Math.pow(bgFlash, 0.75)} />}
            <World m={m}>
              <Stage f={f} />
              <Svg>
                <BackRings f={f} av={av} />
              </Svg>
            </World>
            <ParticleCanvas f={f} m={m} front={false} />
            <World m={m}>
              <AvatarBox av={av} shadow>
                <Avatar size={AV} sticker={6} bubble={bubbleProp(f)} logo={{scale: 0}} style={{display: 'block'}}>
                  {f >= LOGO_IN && <LogoLayer f={f} />}
                </Avatar>
              </AvatarBox>
              <Svg>
                <PopAccents f={f} av={av} />
                <SparkleBurst f={f} av={av} />
              </Svg>
            </World>
            <ParticleCanvas f={f} m={m} front />
            <SpeedLines f={f} m={m} av={av} dark={bgFlash > 0.6} />
            {CALLOUTS.map((d, i) => (
              <Callout key={d.at} f={f} def={d} a={anchorsOnScreen[i]} latest={i === latest} />
            ))}
            {f <= 2 && <ImpactFrame f={f} m={m} av={av} />}
          </RgbSplit>
        </div>
        <WhipStreaks f={f} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
