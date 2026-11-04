import React from 'react';
import {AbsoluteFill, interpolate, random, useCurrentFrame} from 'remotion';
import {Avatar, monoPalette} from '../Avatar';
import {clamp, ease, impulse, lerp, ramp, RgbSplit, Shake, useSafeId} from '../fx';
import {C, FONT, HEIGHT, WIDTH} from '../theme';

// Anton glyph outlines, extracted from the font file: font units, y-down from the cap line, x from the ink's left edge.
// Anton has no kerning pairs among these letters, so tracking below is set by eye on the ink boxes.
const CAP_UNITS = 1760;
const GLYPHS = [
  {w: 727, d: 'M0 1760V0H704V340H358V683H690V1014H358V1417H727V1760Z'},
  {
    w: 866,
    d: 'M0 1760V0H484Q674 0 770 105.5Q866 211 866 414V1238Q866 1488 778.5 1624Q691 1760 472 1760ZM354 1449H415Q512 1449 512 1355V447Q512 359 488.5 333.5Q465 308 393 308H354Z',
  },
  {w: 1404, d: 'M189 1760L0 0H344L441 1111L540 0H868L962 1111L1056 0H1404L1212 1760H790L702 913L618 1760Z'},
  {w: 340, d: 'M0 1760V0H340V1760Z'},
  {w: 864, d: 'M0 1760V0H362L524 843V0H864V1760H520L344 880V1760Z'},
] as const;
const GAPS = [55, 45, 45, 70] as const;

const CAP = 680;
const K = CAP / CAP_UNITS;
const OFFSETS = GLYPHS.map((_, i) => GLYPHS.slice(0, i).reduce((s, g, j) => s + g.w + GAPS[j], 0));
const WORD_W = (OFFSETS[4] + GLYPHS[4].w) * K;
const LEFT = (WIDTH - WORD_W) / 2;
const TOP = (HEIGHT - CAP) / 2;
const MID = TOP + CAP / 2;
const BASE = TOP + CAP;
const SLOTS = GLYPHS.map((g, i) => ({x: LEFT + OFFSETS[i] * K, w: g.w * K, cx: LEFT + (OFFSETS[i] + g.w / 2) * K}));

// cue sheet (local frames)
const SLAM = [30, 45, 60, 75, 90] as const;
const TINT = [C.yellow, C.blue, C.hot, C.cyan, C.magenta] as const;
const APPROACH = 7;
const Z0 = 1 / 3.2;
const RISE = 120;
const HATS = [135, 165, 195] as const;
const KICKS = [150, 180] as const;
const GRADIENT_AT = 150;
const SWEEPS = [
  [150, 1],
  [180, -1],
] as const;
const SPLIT = 210;
const TILE_HITS = [210, 218, 225, 229, 233, 236, 238] as const;

// avatar bust: art bottom (y=471) sits on the frame bottom, art centered horizontally
const SA = 880;
const KA = SA / 512;
const A_LEFT = WIDTH / 2 - 255 * KA;
const A_TOP = HEIGHT - 471 * KA;
const HEAD = {x: A_LEFT + 193.5 * KA, y: A_TOP + 150 * KA};

// REPL prompt: whips in big at frame center, then settles into a caption above the word
const PROMPT_SIZE = 34;
const PROMPT_BIG = 4;
const PROMPT_W = 14 * 0.6 * PROMPT_SIZE;
const PROMPT_C = {x: LEFT + PROMPT_W / 2, y: TOP - 34 - PROMPT_SIZE * 0.36};

const wobble = (t: number, decay: number, period: number) =>
  t < 0 ? 0 : Math.exp(-t / decay) * Math.cos((2 * Math.PI * t) / period);
const bump = (t: number, peak: number) => (t < 0 ? 0 : (t / peak) * Math.exp(1 - t / peak));

type Xf = {x?: number; y?: number; sx?: number; sy?: number; r?: number; px: number; py: number};
const xf = ({x = 0, y = 0, sx = 1, sy = 1, r = 0, px, py}: Xf) =>
  `translate(${px + x} ${py + y}) rotate(${r}) scale(${sx} ${sy}) translate(${-px} ${-py})`;
const place = (i: number) => `translate(${SLOTS[i].x} ${TOP}) scale(${K})`;

const Glyph: React.FC<{
  i: number;
  t?: string;
  fill?: string;
  stroke?: string;
  sw?: number;
  draw?: number;
  opacity?: number;
  style?: React.CSSProperties;
}> = ({i, t = '', fill = 'none', stroke, sw = 0, draw, opacity = 1, style}) => (
  <path
    d={GLYPHS[i].d}
    transform={`${t} ${place(i)}`}
    fill={fill}
    fillRule="evenodd"
    stroke={stroke}
    strokeWidth={stroke ? (draw === undefined ? sw : sw / K) : undefined}
    vectorEffect={stroke && draw === undefined ? 'non-scaling-stroke' : undefined}
    pathLength={draw === undefined ? undefined : 1}
    strokeDasharray={draw === undefined ? undefined : '1 1'}
    strokeDashoffset={draw === undefined ? undefined : 1 - draw}
    opacity={opacity}
    style={style}
  />
);

// arrives from the right at whip speed (~430 px/f), damped with a small overshoot
const whipX = (f: number) => {
  const t = Math.max(0, f);
  return t > 26 ? 0 : 1000 * Math.exp(-t / 2.3) * Math.cos(t * 0.3);
};

const slamPose = (i: number, f: number) => {
  const c = SLAM[i];
  const {cx} = SLOTS[i];
  if (f < c - APPROACH) return null;
  if (f < c) {
    const u = (f - (c - APPROACH)) / APPROACH;
    const s = 1 / (Z0 + (1 - Z0) * u ** 1.6);
    const side = i % 2 ? -1 : 1;
    return {
      t: xf({px: cx, py: MID, y: -80 * (1 - u) ** 2, sx: s, sy: s, r: side * 7 * (1 - u) ** 2}),
      o: clamp((u - 0.1) * 2.2) ** 1.4,
      u,
      age: f - c,
    };
  }
  const t = f - c;
  const s = 1 - 0.075 * wobble(t, 4, 6.4);
  const q = 0.05 * Math.exp(-t / 2.5);
  let x = 0;
  for (let j = i + 1; j < SLAM.length; j++) x -= (18 / (j - i)) * bump(f - SLAM[j], 2);
  return {t: xf({px: cx, py: MID, x, sx: s * (1 + q), sy: s * (1 - q)}), o: 1, u: 1, age: t};
};

// little jumps on the offbeat hats, a wave running E -> N, squash on take-off and landing
const hop = (i: number, f: number) => {
  let y = 0;
  let sq = 0;
  for (const h of HATS) {
    const t = f - (h - 2) - i * 1.5;
    if (t < -3 || t > 16) continue;
    if (t < 0) sq -= 0.035 * Math.sin(((t + 3) / 3) * Math.PI);
    else if (t < 9) {
      const u = t / 9;
      y -= 40 * 4 * u * (1 - u);
      sq += 0.05 * (1 - u);
    } else sq -= 0.045 * Math.sin(((t - 9) / 7) * Math.PI);
  }
  return xf({px: SLOTS[i].cx, py: BASE, y, sx: 1 - sq * 0.6, sy: 1 + sq});
};

type Look = {bg: string; word: string};
const NORMAL: Look = {bg: C.bg, word: C.white};

const trackX = (f: number) =>
  interpolate(
    f,
    [24, 30, 45, 60, 75, 90, 112],
    [SLOTS[0].cx, SLOTS[0].cx, SLOTS[1].cx, SLOTS[2].cx, SLOTS[3].cx, SLOTS[4].cx, WIDTH / 2],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease.inOutCubic},
  );

const camera = (f: number) => {
  const x = whipX(f) + (WIDTH / 2 - trackX(f)) * 0.05 * (1 - ramp(f, 112, 124));
  let y = 0;
  let r = 0;
  let s = 1 + 0.035 * ramp(f, 14, 112, ease.inOutCubic) - 0.025 * ramp(f, 108, 119, ease.inCubic);
  SLAM.forEach((c, i) => {
    const w = wobble(f - c, 3, 7);
    y += 16 * w;
    r += (i % 2 ? -0.5 : 0.5) * w;
    s += 0.022 * impulse(f, c, 4);
  });
  y += 26 * wobble(f - RISE, 4, 9);
  s += 0.05 * impulse(f, RISE, 6) + 0.03 * ramp(f, RISE, SPLIT, ease.inOutCubic);
  KICKS.forEach((k) => (s += 0.012 * impulse(f, k, 5)));
  return {x, y, r, s};
};

// word makes room for the bust: pushed up and slightly back as the avatar rises
const reframe = (f: number) => {
  const p = ease.outBack(ramp(f, 115, 129));
  return {s: lerp(1, 0.9, p), y: lerp(0, -128, p)};
};

const riseY = (f: number) => {
  if (f < 113) return 1200;
  if (f < RISE) {
    const u = (f - 113) / (RISE - 113);
    return 860 * (1 - u * u);
  }
  const t = f - RISE;
  return -40 * Math.exp(-t / 4) * Math.sin(t * 0.55);
};

const Halftone: React.FC<{id: string; color: string; size?: number}> = ({id, color, size = 16}) => (
  <pattern id={id} width={size} height={size} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
    <circle cx={size / 2} cy={size / 2} r={size * 0.26} fill={color} />
  </pattern>
);

const Prompt: React.FC<{f: number}> = ({f}) => {
  const p = ease.inOutCubic(ramp(f, 11, 23));
  const out = ramp(f, 104, 116);
  if (out >= 1) return null;
  const s = lerp(PROMPT_BIG, 1, p);
  const glow = impulse(f, 0, 5);
  return (
    <g
      transform={xf({
        px: PROMPT_C.x,
        py: PROMPT_C.y,
        x: (WIDTH / 2 - PROMPT_C.x) * (1 - p),
        y: (MID - PROMPT_C.y) * (1 - p),
        sx: s,
        sy: s,
      })}
      opacity={1 - out}
    >
      <text
        x={LEFT}
        y={TOP - 34}
        fontFamily={FONT.mono}
        fontSize={PROMPT_SIZE}
        fontWeight={700}
        fill={C.white}
        style={{filter: glow > 0.05 ? `drop-shadow(0 0 ${6 + 10 * glow}px rgba(45,226,255,${glow}))` : undefined}}
      >
        <tspan fill={C.yellow}>{'>>> '}</tspan>
        <tspan>edwin</tspan>
        <tspan fill={C.blueHi}>.name</tspan>
      </text>
    </g>
  );
};

// type-specimen scaffolding: cap line + baseline, ghost slots that the slams land into
const Guides: React.FC<{f: number}> = ({f}) => {
  const o = 1 - ramp(f, 96, 116);
  if (o <= 0) return null;
  const rule = ease.outExpo(ramp(f, 12, 26));
  return (
    <g opacity={o}>
      {[TOP, BASE].map((y) => (
        <line
          key={y}
          x1={WIDTH / 2 - (WIDTH / 2 + 300) * rule}
          x2={WIDTH / 2 + (WIDTH / 2 + 300) * rule}
          y1={y}
          y2={y}
          stroke="rgba(245,247,251,0.22)"
          strokeWidth={1.5}
        />
      ))}
      {GLYPHS.map((_, i) => {
        const d = ease.inOutCubic(ramp(f, 14 + i * 2, 26 + i * 2));
        return d > 0 ? <Glyph key={i} i={i} stroke="rgba(245,247,251,0.34)" sw={2} draw={d} fill={`rgba(245,247,251,${0.03 * d})`} /> : null;
      })}
      {f >= 18 && (
        <text x={LEFT} y={BASE + 66} fontFamily={FONT.mono} fontSize={34} fontWeight={700} fill={C.yellow}>
          {"'EDWIN'"}
        </text>
      )}
      {f >= 22 && (
        <text
          x={LEFT + WORD_W}
          y={BASE + 62}
          textAnchor="end"
          fontFamily={FONT.mono}
          fontSize={22}
          fill="rgba(245,247,251,0.45)"
          letterSpacing={3}
        >
          ANTON / CAP 680
        </text>
      )}
    </g>
  );
};

// receding stack: bg-filled outline copies stepping down toward a vanishing point behind the bust,
// flowing continuously and surging on the kicks
const Echoes: React.FC<{f: number}> = ({f}) => {
  const env = ramp(f, RISE + 1, RISE + 14, ease.outCubic) * (1 - ramp(f, SPLIT - 5, SPLIT));
  if (env <= 0) return null;
  const p = (f - RISE) * 0.05 + KICKS.reduce((a, k) => a + 0.8 * ramp(f, k, k + 12, ease.outCubic), 0);
  const n = 6;
  const colors = [C.yellow, C.blueHi, C.white];
  return (
    <g>
      {Array.from({length: n}, (_, j) => {
        const k = n - 1 - j;
        const d = k + (p % 1);
        const s = 1 - 0.04 * d;
        const o = env * clamp(d * 1.5) * (1 - d / n) ** 0.8;
        const col = colors[(((k - Math.floor(p)) % colors.length) + colors.length) % colors.length];
        return (
          <g key={k} transform={xf({px: WIDTH / 2, py: MID, y: d * 84 * env, sx: s, sy: s})} opacity={o}>
            {GLYPHS.map((_, i) => (
              <Glyph key={i} i={i} stroke={col} sw={5} fill={C.bg} />
            ))}
          </g>
        );
      })}
    </g>
  );
};

const SpeedLines: React.FC<{f: number; color: string}> = ({f, color}) => {
  const t = f - RISE;
  if (t < 0 || t > 12) return null;
  const o = 1 - t / 12;
  const seed = Math.floor(t / 2);
  return (
    <svg width={WIDTH} height={HEIGHT} style={{position: 'absolute', inset: 0}}>
      {Array.from({length: 44}, (_, k) => {
        const a = (k / 44) * Math.PI * 2 + (random(`sl-a-${seed}-${k}`) - 0.5) * 0.12;
        const r0 = 260 + random(`sl-r-${seed}-${k}`) * 260;
        const len = 900 + random(`sl-l-${seed}-${k}`) * 700;
        const w = 4 + random(`sl-w-${seed}-${k}`) * 14;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const x0 = HEAD.x + ca * r0;
        const y0 = HEAD.y + sa * r0;
        const x1 = HEAD.x + ca * (r0 + len);
        const y1 = HEAD.y + sa * (r0 + len);
        return (
          <path
            key={k}
            d={`M${x0} ${y0}L${x1 - sa * w} ${y1 + ca * w}L${x1 + sa * w} ${y1 - ca * w}Z`}
            fill={color}
            opacity={o * 0.8}
          />
        );
      })}
    </svg>
  );
};

const WhipLines: React.FC<{f: number}> = ({f}) => {
  const id = useSafeId();
  if (f > 10) return null;
  const cols = [C.white, C.cyan, C.yellow, C.blueHi];
  return (
    <svg width={WIDTH} height={HEIGHT} style={{position: 'absolute', inset: 0}}>
      <defs>
        {cols.map((c, k) => (
          <linearGradient key={k} id={`${id}${k}`}>
            <stop offset="0" stopColor={c} />
            <stop offset="1" stopColor={c} stopOpacity={0} />
          </linearGradient>
        ))}
      </defs>
      {Array.from({length: 18}, (_, k) => {
        const y = 90 + random(`wl-y-${k}`) * (HEIGHT - 180);
        const len = 400 + random(`wl-l-${k}`) * 1100;
        const v = 240 + random(`wl-v-${k}`) * 300;
        const x = WIDTH * (0.25 + random(`wl-x-${k}`)) - v * f;
        const th = 2 + random(`wl-t-${k}`) * 5;
        const o = (1 - f / 10) ** 1.5 * (0.35 + 0.55 * random(`wl-o-${k}`));
        return <rect key={k} x={x} y={y - th / 2} width={len} height={th} rx={th / 2} fill={`url(#${id}${k % 4})`} opacity={o} />;
      })}
    </svg>
  );
};

const Word: React.FC<{f: number; look: Look; lite: boolean; impact: 'white' | 'yellow' | null}> = ({
  f,
  look,
  lite,
  impact,
}) => {
  const id = useSafeId();
  const rf = reframe(f);
  const ink = impact ? C.ink : look.word;
  const gradient = !lite && !impact && f >= GRADIENT_AT && f < SPLIT;
  const sweep = SWEEPS.find(([at]) => f >= at && f < at + 24);
  const sweepP = sweep ? ease.inOutCubic(ramp(f, sweep[0], sweep[0] + 24)) : 0;
  const sweepX = lerp(LEFT - 400, LEFT + WORD_W + 400, sweep && sweep[1] < 0 ? 1 - sweepP : sweepP);
  const samples = 10;
  const shutter = 0.6;
  const poses = GLYPHS.map((_, i) => slamPose(i, f));
  const hopping = f >= RISE && f < SPLIT;
  const full = poses.map((p, i) => (p ? `${hopping ? hop(i, f) : ''} ${p.t}` : ''));

  return (
    <svg width={WIDTH} height={HEIGHT} style={{position: 'absolute', inset: 0, overflow: 'visible'}}>
      <defs>
        <Halftone id={`${id}ht`} color="rgba(0,0,0,0.22)" />
        <linearGradient id={`${id}py`} gradientUnits="userSpaceOnUse" x1={LEFT} y1={MID} x2={LEFT + WORD_W} y2={MID}>
          <stop offset="0" stopColor={C.blue} />
          <stop offset="0.3" stopColor={C.blueHi} />
          <stop offset="0.5" stopColor="#eef3f7" />
          <stop offset="0.7" stopColor={C.yellowHi} />
          <stop offset="1" stopColor={C.yellow} />
        </linearGradient>
        <linearGradient id={`${id}i`} x1={0} y1={0} x2={0} y2={1}>
          <stop offset="0" stopColor={C.blueHi} />
          <stop offset="1" stopColor={C.yellow} />
        </linearGradient>
        <linearGradient
          id={`${id}sw`}
          gradientUnits="userSpaceOnUse"
          x1={sweepX - 150}
          y1={MID}
          x2={sweepX + 150}
          y2={MID}
          gradientTransform={`rotate(-20 ${sweepX} ${MID})`}
        >
          <stop offset="0" stopColor="#fff" stopOpacity={0} />
          <stop offset="0.5" stopColor="#fff" stopOpacity={0.95} />
          <stop offset="1" stopColor="#fff" stopOpacity={0} />
        </linearGradient>
        {SLAM.map((c, i) => (
          <filter key={i} id={`${id}b${i}`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation={2 + 26 * clamp(1 - (f - (c - APPROACH)) / APPROACH) ** 2.2} />
          </filter>
        ))}
        <clipPath id={`${id}wclip`}>{poses[2] && <path d={GLYPHS[2].d} transform={`${full[2]} ${place(2)}`} />}</clipPath>
        {gradient && (
          <clipPath id={`${id}word`}>
            {GLYPHS.map((g, i) => (
              <path key={i} d={g.d} transform={`${full[i]} ${place(i)}`} />
            ))}
          </clipPath>
        )}
      </defs>
      <g transform={xf({px: WIDTH / 2, py: MID, sx: rf.s, sy: rf.s, y: rf.y})}>
        {!lite && <Guides f={f} />}
        {!lite && <Echoes f={f} />}

        {/* impact columns: full-height color bar + halftone on the hit, retracting fast */}
        {!lite &&
          SLAM.map((c, i) => {
            const t = f - c;
            if (t < 0 || t > 9) return null;
            const pad = 26;
            const k = t < 2 ? 1 : 1 - ease.outCubic(clamp((t - 2) / 7));
            const h = 1500 * k;
            const y = i % 2 === 0 ? MID - 750 : MID + 750 - h;
            return (
              <g key={i}>
                <rect x={SLOTS[i].x - pad} width={SLOTS[i].w + pad * 2} y={y} height={h} fill={TINT[i]} />
                {t < 3 && (
                  <rect x={SLOTS[i].x - pad} width={SLOTS[i].w + pad * 2} y={y} height={h} fill={`url(#${id}ht)`} />
                )}
              </g>
            );
          })}

        {/* shock outlines */}
        {!lite &&
          SLAM.map((c, i) => {
            const t = f - c;
            if (t < 0 || t > 14) return null;
            const s = 1 + 0.5 * ease.outExpo(t / 14);
            return (
              <g key={i} transform={xf({px: SLOTS[i].cx, py: MID, sx: s, sy: s})} opacity={(1 - t / 14) ** 1.5}>
                <Glyph i={i} stroke={TINT[i]} sw={10 * (1 - t / 14) + 1.5} />
              </g>
            );
          })}

        {poses.map((p, i) => {
          if (!p) return null;
          if (p.age < 0) {
            // zoom-blurred approach: sub-frame samples summed additively (camera shutter)
            return (
              <g key={i} style={{isolation: 'isolate'}} filter={`url(#${id}b${i})`}>
                {Array.from({length: samples}, (_, j) => {
                  const ps = slamPose(i, f - (j / samples) * shutter);
                  if (!ps || ps.age >= 0) return null;
                  return (
                    <Glyph
                      key={j}
                      i={i}
                      t={ps.t}
                      fill={look.word}
                      opacity={ps.o / samples}
                      style={{mixBlendMode: 'plus-lighter'}}
                    />
                  );
                })}
              </g>
            );
          }
          const t = p.age;
          if (lite || t >= 12) return <Glyph key={i} i={i} t={full[i]} fill={ink} />;
          if (t < 2) return <Glyph key={i} i={i} t={full[i]} fill={C.ink} />;
          if (i === 1 && t < 9) return <Glyph key={i} i={i} t={full[i]} stroke={look.word} sw={9} />;
          if (i === 2) {
            return (
              <g key={i} clipPath={`url(#${id}wclip)`}>
                <rect x={SLOTS[2].x - 60} y={TOP - 60} width={SLOTS[2].w + 120} height={CAP + 120} fill={C.blue} />
                <g transform={`translate(${SLOTS[2].cx - 193.5 * 3.1} ${MID - 172 * 3.1})`}>
                  <Avatar size={512 * 3.1} bubble={false} />
                </g>
              </g>
            );
          }
          if (i === 3) return <Glyph key={i} i={i} t={full[i]} fill={`url(#${id}i)`} />;
          if (i === 4) {
            const d = 22 * Math.exp(-(t - 2) / 3.5);
            return (
              <g key={i}>
                <Glyph i={i} t={`translate(${-d} ${d * 0.3}) ${full[i]}`} fill={C.cyan} />
                <Glyph i={i} t={`translate(${d} ${-d * 0.3}) ${full[i]}`} fill={C.magenta} />
                <Glyph i={i} t={full[i]} fill={look.word} />
              </g>
            );
          }
          return <Glyph key={i} i={i} t={full[i]} fill={ink} />;
        })}

        {/* python gradient fill + light sweep, clipped to the live letter shapes */}
        {gradient && (
          <g clipPath={`url(#${id}word)`}>
            <rect x={LEFT - 200} y={TOP - 300} width={WORD_W + 400} height={CAP + 600} fill={`url(#${id}py)`} />
            {sweep && (
              <rect x={LEFT - 200} y={TOP - 300} width={WORD_W + 400} height={CAP + 600} fill={`url(#${id}sw)`} />
            )}
          </g>
        )}

        {!lite && <Prompt f={f} />}
      </g>
    </svg>
  );
};

const Bust: React.FC<{f: number; impact: 'white' | 'yellow' | null; lite: boolean}> = ({f, impact, lite}) => {
  const id = useSafeId();
  if (f < 113) return null;
  const y = riseY(f);
  const v = f < RISE ? Math.abs(riseY(f + 0.5) - riseY(f - 0.5)) : 0;
  const blur = lite ? 0 : Math.min(60, v * 0.25);
  const t = f - RISE;
  const sq = t >= 0 ? 0.035 * wobble(t, 3.5, 9) : -0.03 * (1 - y / 860);
  const breathe = KICKS.reduce((a, k) => a + 0.012 * impulse(f, k, 6), 0);
  const silhouette = impact === 'white';
  return (
    <>
      {blur > 0.5 && (
        <svg width="0" height="0" style={{position: 'absolute'}}>
          <filter id={`${id}vb`} x="-10%" y="-40%" width="120%" height="180%">
            <feGaussianBlur stdDeviation={`0 ${blur}`} />
          </filter>
        </svg>
      )}
      <div
        style={{
          position: 'absolute',
          left: A_LEFT,
          top: A_TOP + y,
          width: SA,
          height: SA,
          transformOrigin: `${(193.5 / 512) * 100}% ${(471 / 512) * 100}%`,
          transform: `scale(${1 + breathe + sq * 0.6}, ${1 + breathe - sq})`,
          filter: `${blur > 0.5 ? `url(#${id}vb) ` : ''}drop-shadow(0 0 2px rgba(0,0,0,0.9)) drop-shadow(0 28px 36px rgba(0,0,0,0.55))`,
        }}
      >
        <Avatar
          size={SA}
          sticker={6}
          stickerColor={silhouette ? C.ink : '#fff'}
          palette={silhouette ? monoPalette(C.ink) : undefined}
        />
      </div>
    </>
  );
};

const Shockwave: React.FC<{f: number; color: string}> = ({f, color}) => {
  const t = f - RISE;
  if (t < 0 || t > 26) return null;
  const ring = (delay: number, col: string, w: number) => {
    const u = clamp((t - delay) / 24);
    if (u <= 0 || u >= 1) return null;
    return (
      <circle
        cx={HEAD.x}
        cy={HEAD.y}
        r={90 + 1500 * ease.outExpo(u)}
        fill="none"
        stroke={col}
        strokeWidth={w * (1 - u) ** 2 + 1.5}
        opacity={1 - u}
      />
    );
  };
  return (
    <svg width={WIDTH} height={HEIGHT} style={{position: 'absolute', inset: 0}}>
      {ring(0, color, 46)}
      {ring(3, C.blueHi, 22)}
    </svg>
  );
};

const Main: React.FC<{f: number; look: Look; lite?: boolean}> = ({f, look, lite = false}) => {
  const id = useSafeId();
  const cam = camera(f);
  const impact = lite ? null : f === RISE ? 'white' : f === RISE + 1 || f === RISE + 2 ? 'yellow' : null;
  const bg = impact === 'white' ? '#ffffff' : impact === 'yellow' ? C.yellow : look.bg;
  const glow = f >= RISE ? 0.22 + 0.45 * impulse(f, RISE + 3, 18) : 0;
  const v = Math.abs(whipX(f + 0.5) - whipX(f - 0.5));
  const whipBlur = lite ? 0 : Math.min(140, v * 0.32);
  const stretch = 1 + Math.min(0.22, v / 2400);

  const rgb = impact
    ? 0
    : 26 * impulse(f, 0, 4) +
      SLAM.reduce((a, c) => a + 10 * impulse(f, c, 2.6), 0) +
      30 * impulse(f, RISE, 5) +
      KICKS.reduce((a, k) => a + 6 * impulse(f, k, 3), 0);
  const shake = 10 * impulse(f, 0, 5) + SLAM.reduce((a, c) => a + 9 * impulse(f, c, 3.5), 0) + 30 * impulse(f, RISE, 6);

  const stage = (
    <AbsoluteFill
      style={{
        transform: `translate(${cam.x}px, ${cam.y}px) rotate(${cam.r}deg) scale(${cam.s * stretch}, ${cam.s})`,
        filter: whipBlur > 0.6 ? `url(#${id}wb)` : undefined,
      }}
    >
      <Word f={f} look={look} lite={lite} impact={impact} />
      {!lite && <Shockwave f={f} color={impact ? C.ink : C.white} />}
      <Bust f={f} impact={impact} lite={lite} />
    </AbsoluteFill>
  );

  return (
    <AbsoluteFill style={{background: bg, overflow: 'hidden'}}>
      {!impact && !lite && (
        <AbsoluteFill
          style={{
            background:
              f < RISE
                ? `radial-gradient(ellipse 60% 55% at 50% 50%, ${C.bg2} 0%, rgba(5,7,12,0) 100%)`
                : `radial-gradient(circle at ${HEAD.x}px ${HEAD.y + 60}px, rgba(55,118,171,${glow}) 0%, rgba(20,41,74,${glow * 0.6}) 30%, rgba(5,7,12,0) 62%)`,
          }}
        />
      )}
      {!lite && <SpeedLines f={f} color={impact ? C.ink : C.white} />}
      {!lite && <WhipLines f={f} />}
      {whipBlur > 0.6 && (
        <svg width="0" height="0" style={{position: 'absolute'}}>
          <filter id={`${id}wb`} x="-30%" y="-10%" width="160%" height="120%">
            <feGaussianBlur stdDeviation={`${whipBlur} 0`} />
          </filter>
        </svg>
      )}
      {lite ? (
        stage
      ) : (
        <Shake intensity={shake} rotate={shake * 0.04} seed="type">
          <RgbSplit amount={rgb}>{stage}</RgbSplit>
        </Shake>
      )}
      {!lite && f < 8 && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: MID - 4,
            height: 8,
            background: `linear-gradient(90deg, rgba(255,255,255,0), ${C.white} 40%, ${C.cyan} 60%, rgba(255,255,255,0))`,
            opacity: 1 - f / 8,
            boxShadow: `0 0 60px 22px rgba(75,139,190,${0.7 * (1 - f / 8)})`,
          }}
        />
      )}
    </AbsoluteFill>
  );
};

const LOOKS: Look[] = [
  {bg: C.yellow, word: C.ink},
  {bg: C.blue, word: C.white},
  {bg: C.magenta, word: C.ink},
  {bg: C.white, word: C.ink},
  {bg: C.cyan, word: C.ink},
  {bg: C.hot, word: C.ink},
  {bg: C.blueDeep, word: C.yellow},
];
const GRIDS = [
  [1, 2],
  [2, 2],
  [3, 3],
  [3, 3],
  [4, 4],
  [4, 4],
  [4, 4],
] as const;
const GUTTER = [12, 16, 18, 18, 20, 22, 24] as const;
const DUPLICATE = [233, 237] as const;

// tension into POP: the poster splits into pop-colored panels that subdivide, shear and recolor on the snare fill,
// then every panel pulls back to a full copy of the poster (a step-and-repeat grid foreshadowing POP)
const Tiles: React.FC<{f: number}> = ({f}) => {
  const hit = TILE_HITS.reduce((a, h, k) => (f >= h ? k : a), 0);
  const [cols, rows] = GRIDS[hit];
  const since = f - TILE_HITS[hit];
  const g = GUTTER[hit];
  const cw = WIDTH / cols;
  const ch = HEIGHT / rows;
  const push = 1 + 0.1 * ramp(f, SPLIT, 239, ease.inCubic);
  const dup = ease.inOutCubic(ramp(f, DUPLICATE[0], DUPLICATE[1]));
  const shear = 70 * Math.exp(-since / 3.5) * (1 - dup);
  return (
    <AbsoluteFill style={{background: C.ink, overflow: 'hidden'}}>
      <Shake intensity={4 + 10 * ramp(f, SPLIT, 239)} rotate={0.2} seed="tiles" speed={1.7}>
        <RgbSplit amount={10 * impulse(f, TILE_HITS[hit], 2.5)}>
          <AbsoluteFill style={{transform: `scale(${push})`}}>
            {Array.from({length: cols * rows}, (_, n) => {
              const c = n % cols;
              const r = Math.floor(n / cols);
              const look = LOOKS[(c + 2 * r + 3 * hit) % LOOKS.length];
              const x = c * cw + g / 2;
              const y = r * ch + g / 2;
              const w = cw - g;
              const h = ch - g;
              const s = lerp(1, Math.min(w / WIDTH, h / HEIGHT), dup);
              const px = lerp(x + w / 2, WIDTH / 2, dup) - ((r % 2 ? 1 : -1) * shear + (random(`tx-${hit}-${n}`) - 0.5) * 10);
              const py = lerp(y + h / 2, HEIGHT / 2, dup) - (c % 2 ? -1 : 1) * shear * 0.35;
              return (
                <div
                  key={n}
                  style={{position: 'absolute', left: x, top: y, width: w, height: h, overflow: 'hidden', background: look.bg}}
                >
                  <div
                    style={{
                      position: 'absolute',
                      left: w / 2 - px * s,
                      top: h / 2 - py * s,
                      width: WIDTH,
                      height: HEIGHT,
                      transformOrigin: '0 0',
                      transform: `scale(${s})`,
                    }}
                  >
                    <Main f={SPLIT - 1} look={look} lite />
                  </div>
                </div>
              );
            })}
          </AbsoluteFill>
        </RgbSplit>
      </Shake>
    </AbsoluteFill>
  );
};

export const Type: React.FC = () => {
  const f = useCurrentFrame();
  return f >= SPLIT ? <Tiles f={f} /> : <Main f={f} look={NORMAL} />;
};
