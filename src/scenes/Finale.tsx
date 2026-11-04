import {noise2D} from '@remotion/noise';
import React from 'react';
import {AbsoluteFill, Easing, random, useCurrentFrame} from 'remotion';
import {Avatar, AVATAR_PATHS, anchors} from '../Avatar';
import {clamp, ease, impulse, lerp, ramp, useSafeId} from '../fx';
import {C, FONT, HEIGHT, WIDTH} from '../theme';

// Match-cut contract: Pop's last frame === Finale's first frame
export const MATCH = {size: 1500, x: 960, y: 600} as const;

const NAVY = '#070d1a';
const DISC = {x: 580, y: 540, r: 380};
const AV = {size: 880, x: 600, y: 576};
const IRIS_R0 = 1250;
const RING = {r: 418, font: 21, repeats: 5, text: 'EDWIN • PYTHON • HELLO WORLD • '};
// Anton metrics measured at 300px: cap height 257, left bearing 12
const WORD = {
  x: 1064,
  base: 609,
  size: 300,
  letters: ['E', 'D', 'W', 'I', 'N'],
  kern: [0, -2, 1, 2, -4],
  ticks: [12, 16, 20, 24, 28],
};
const LINE = {x: 1076, y: 639, h: 11, w: 699};
const TAG = {x: 1064, y: 687, size: 40, code: 'print("Hello, World!")', start: 40, end: 90};

const Placed: React.FC<{size: number; x: number; y: number; children: React.ReactNode}> = ({size, x, y, children}) => (
  <div style={{position: 'absolute', left: x - size / 2, top: y - size / 2, width: size, height: size}}>{children}</div>
);

export const MatchFrame: React.FC = () => (
  <AbsoluteFill style={{background: C.yellow}}>
    <Placed size={MATCH.size} x={MATCH.x} y={MATCH.y}>
      <Avatar size={MATCH.size} style={{display: 'block'}} />
    </Placed>
  </AbsoluteFill>
);

// avatar and iris travel together; the iris shrinks faster so the art's flat bottom edge never shows inside it
const motion = (f: number) => {
  const eA = ramp(f, 0, 46, ease.snap);
  const eI = ramp(f, 0, 25, ease.snap);
  return {
    size: lerp(MATCH.size, AV.size, eA),
    x: lerp(MATCH.x, AV.x, eA),
    y: lerp(MATCH.y, AV.y, eA),
    ix: lerp(MATCH.x, DISC.x, eA),
    iy: lerp(MATCH.y, DISC.y, eA),
    r: Math.exp(lerp(Math.log(IRIS_R0), Math.log(DISC.r), eI)),
  };
};
type Motion = ReturnType<typeof motion>;

const Background: React.FC<{f: number}> = ({f}) => {
  const glow = ramp(f, 4, 50, ease.outCubic);
  return (
    <AbsoluteFill style={{background: NAVY}}>
      <AbsoluteFill
        style={{
          opacity: glow,
          background: `radial-gradient(circle 860px at ${DISC.x}px ${DISC.y}px, rgba(55,118,171,0.5) 0%, rgba(28,60,108,0.3) 40%, rgba(10,18,34,0) 100%)`,
        }}
      />
      <AbsoluteFill
        style={{
          opacity: glow,
          background: `radial-gradient(ellipse 700px 460px at 1420px ${DISC.y}px, rgba(34,66,120,0.3) 0%, rgba(10,18,34,0) 100%)`,
        }}
      />
    </AbsoluteFill>
  );
};

const BOKEH = Array.from({length: 60}, (_, i) => {
  const r = (k: string) => random(`bokeh-${i}-${k}`);
  const depth = r('d');
  const rgb = ['75,139,190', '75,139,190', '45,226,255', '255,212,59', '245,247,251'][Math.floor(r('c') * 5)];
  return {
    x: r('x') * WIDTH,
    y: r('y') * HEIGHT,
    size: 16 + depth * depth * 110,
    speed: 0.1 + depth * 0.4,
    sway: 6 + r('s') * 16,
    phase: r('p') * Math.PI * 2,
    alpha: 0.04 + r('a') * 0.09,
    rgb,
  };
})
  .filter((b) => Math.hypot(b.x - DISC.x, b.y - DISC.y) > 470 && !(b.x > 1020 && b.x < 1840 && b.y > 300 && b.y < 780))
  .slice(0, 18);

const Bokeh: React.FC<{f: number}> = ({f}) => {
  const fade = ramp(f, 10, 70, ease.outCubic);
  if (fade <= 0) return null;
  const span = HEIGHT + 240;
  return (
    <AbsoluteFill style={{opacity: fade}}>
      {BOKEH.map((b, i) => {
        const y = ((((b.y + 120 - f * b.speed) % span) + span) % span) - 120;
        const x = b.x + Math.sin(f * 0.015 + b.phase) * b.sway;
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: x - b.size / 2,
              top: y - b.size / 2,
              width: b.size,
              height: b.size,
              borderRadius: '50%',
              background: `radial-gradient(circle, rgba(${b.rgb},${b.alpha * 0.7}) 0%, rgba(${b.rgb},${b.alpha}) 55%, rgba(${b.rgb},0) 71%)`,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

const Ring: React.FC<{f: number}> = ({f}) => {
  const id = useSafeId();
  const reveal = ramp(f, 18, 72, ease.inOutCubic);
  if (reveal <= 0) return null;
  const {x, y} = DISC;
  const r = RING.r;
  const circ = 2 * Math.PI * r;
  const spacing = circ / (RING.text.length * RING.repeats) - RING.font * 0.6;
  const intro = lerp(-40, 0, ease.outCubic(reveal));
  const parts = RING.text.repeat(RING.repeats).split('•');
  return (
    <svg width={WIDTH} height={HEIGHT} style={{position: 'absolute', left: 0, top: 0}}>
      <defs>
        <path id={`${id}p`} d={`M ${x - r} ${y} a ${r} ${r} 0 1 1 ${2 * r} 0 a ${r} ${r} 0 1 1 ${-2 * r} 0`} />
        <mask id={`${id}m`} maskUnits="userSpaceOnUse" x={0} y={0} width={WIDTH} height={HEIGHT}>
          <circle
            cx={x}
            cy={y}
            r={r}
            fill="none"
            stroke="#fff"
            strokeWidth={80}
            strokeDasharray={`${circ * reveal} ${circ}`}
            transform={`rotate(${intro - 90} ${x} ${y})`}
          />
        </mask>
      </defs>
      <g mask={`url(#${id}m)`}>
        <g transform={`rotate(${intro - f * 0.11} ${x} ${y})`}>
          <text
            fontFamily={FONT.mono}
            fontWeight={700}
            fontSize={RING.font}
            letterSpacing={spacing}
            dominantBaseline="central"
            fill="rgba(245,247,251,0.6)"
          >
            <textPath href={`#${id}p`}>
              {parts.map((p, i) => (
                <React.Fragment key={i}>
                  {p}
                  {i < parts.length - 1 && <tspan fill={C.yellow}>•</tspan>}
                </React.Fragment>
              ))}
            </textPath>
          </text>
        </g>
      </g>
    </svg>
  );
};

const Sparkle: React.FC<{x: number; y: number; size: number; rotate: number; glow: string}> = ({x, y, size, rotate, glow}) => {
  if (size <= 0.2) return null;
  const w = size * 0.11;
  const star = `M 0 ${-size} C ${w} ${-w} ${w} ${-w} ${size} 0 C ${w} ${w} ${w} ${w} 0 ${size} C ${-w} ${w} ${-w} ${w} ${-size} 0 C ${-w} ${-w} ${-w} ${-w} 0 ${-size} Z`;
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle r={size * 0.7} fill={`url(#${glow})`} />
      <ellipse rx={size * 2.4} ry={size * 0.035} fill="#fff" opacity={0.85} />
      <g transform={`rotate(${rotate})`}>
        <path d={star} fill="#fff" />
        <path d={star} fill="#fff" transform="rotate(45) scale(0.42)" />
      </g>
    </g>
  );
};

const envelope = (f: number, at: number, attack: number, decay: number) =>
  f < at ? ease.outCubic(ramp(f, at - attack, at)) : 1 - Easing.in(Easing.quad)(ramp(f, at, at + decay));

const Glint: React.FC<{f: number}> = ({f}) => {
  const id = useSafeId();
  if (f < 82 || f > 112) return null;
  const sweep = ramp(f, 84, 96, ease.inOutCubic);
  const {lensL, lensR} = anchors;
  const sx = lerp(lensL.x - 40, lensR.x + 40, sweep);
  const flash = envelope(f, 90, 3, 10);
  return (
    <g>
      <defs>
        <clipPath id={`${id}c`}>
          <path d={AVATAR_PATHS.body.lens} clipRule="evenodd" />
        </clipPath>
        <radialGradient id={`${id}g`}>
          <stop offset="0" stopColor="#fff" stopOpacity={0.9} />
          <stop offset="0.35" stopColor="#fff6cf" stopOpacity={0.45} />
          <stop offset="1" stopColor="#fff6cf" stopOpacity={0} />
        </radialGradient>
      </defs>
      <g clipPath={`url(#${id}c)`}>
        <rect x={lensL.x - 40} y={lensL.y - 40} width={140} height={80} fill="#fff" opacity={flash * 0.6} />
        <g transform={`rotate(30 ${sx} ${lensL.y})`}>
          <rect x={sx - 6} y={lensL.y - 60} width={12} height={120} fill="#fff" />
          <rect x={sx + 11} y={lensL.y - 60} width={4} height={120} fill="#fff" opacity={0.85} />
        </g>
      </g>
      <Sparkle x={lensL.x + 9} y={lensL.y - 9} size={62 * envelope(f, 90, 4, 16)} rotate={(f - 86) * 2} glow={`${id}g`} />
      <Sparkle x={lensR.x + 9} y={lensR.y - 9} size={30 * envelope(f, 94, 4, 12)} rotate={(f - 90) * -2.4} glow={`${id}g`} />
    </g>
  );
};

const ClippedAvatar: React.FC<{f: number; m: Motion}> = ({f, m}) => {
  const id = useSafeId();
  const breathe = 1 + 0.006 * Math.sin(((f - 46) / 150) * Math.PI * 2) * ramp(f, 46, 90);
  const size = m.size * breathe * (1 + 0.012 * impulse(f, 180, 10));
  const k = size / 512;
  const left = m.x - size / 2;
  const top = m.y - size / 2;
  const sticker = 5 * ramp(f, 8, 36, ease.outCubic);
  const shadow = ramp(f, 10, 40);
  const wig = f - 150;
  const logo =
    wig >= 0
      ? {rotate: 16 * Math.sin(wig * 0.62) * Math.exp(-wig / 9), scale: 1 + 0.14 * Math.sin(clamp(wig / 10) * Math.PI)}
      : undefined;
  const clip = f >= 1;
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        filter: shadow > 0 ? `drop-shadow(0 ${18 * shadow}px ${26 * shadow}px rgba(96,52,0,${0.32 * shadow}))` : undefined,
      }}
    >
      {clip && (
        <svg width={0} height={0} style={{position: 'absolute'}}>
          <clipPath id={`${id}c`} clipPathUnits="userSpaceOnUse">
            <circle cx={m.ix} cy={m.iy} r={m.r} />
            <rect x={-10} y={-10} width={WIDTH + 20} height={m.iy + 10} />
            <path d={AVATAR_PATHS.silhouette.bubble} transform={`translate(${left} ${top}) scale(${k})`} />
          </clipPath>
        </svg>
      )}
      <div style={{position: 'absolute', inset: 0, clipPath: clip ? `url(#${id}c)` : undefined}}>
        <Placed size={size} x={m.x} y={m.y}>
          <Avatar size={size} style={{display: 'block'}} sticker={sticker} logo={logo}>
            <Glint f={f} />
          </Avatar>
        </Placed>
      </div>
    </div>
  );
};

const Iris: React.FC<{f: number; m: Motion}> = ({f, m}) => {
  const shade = ramp(f, 14, 44);
  const pulse = ramp(f, 180, 218, ease.outCubic);
  return (
    <>
      <div
        style={{
          position: 'absolute',
          left: m.ix - m.r,
          top: m.iy - m.r,
          width: m.r * 2,
          height: m.r * 2,
          borderRadius: '50%',
          background: C.yellow,
          boxShadow: shade > 0 ? `0 0 ${150 * shade}px ${10 * shade}px rgba(255,212,59,${0.14 * shade})` : undefined,
        }}
      >
        {shade > 0 && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: '50%',
              opacity: shade,
              background: `radial-gradient(circle at 30% 24%, rgba(255,236,140,0.85) 0%, rgba(255,232,115,0) 52%)`,
            }}
          />
        )}
      </div>
      {pulse > 0 && pulse < 1 && (
        <div
          style={{
            position: 'absolute',
            left: DISC.x - DISC.r,
            top: DISC.y - DISC.r,
            width: DISC.r * 2,
            height: DISC.r * 2,
            borderRadius: '50%',
            border: `3px solid ${C.yellow}`,
            opacity: (1 - pulse) * 0.6,
            transform: `scale(${1 + pulse * 0.4})`,
          }}
        />
      )}
    </>
  );
};

const rise = Easing.bezier(0.2, 1.3, 0.4, 1);

const Wordmark: React.FC<{f: number}> = ({f}) => {
  const sweep = ramp(f, 118, 152, Easing.bezier(0.45, 0, 0.3, 1));
  const sweeping = sweep > 0 && sweep < 1;
  const s = WORD.size / 300;
  const text = (extra?: React.CSSProperties) => (
    <div
      style={{
        position: 'absolute',
        left: WORD.x,
        top: WORD.base - 282 * s,
        height: 312 * s,
        overflow: 'hidden',
        whiteSpace: 'nowrap',
        fontFamily: FONT.display,
        fontSize: WORD.size,
        lineHeight: `${312 * s}px`,
        color: C.white,
        paddingRight: 20,
        ...extra,
      }}
    >
      {WORD.letters.map((ch, i) => {
        const p = ramp(f, WORD.ticks[i] - 2, WORD.ticks[i] + 12, rise);
        return (
          <span
            key={i}
            style={{
              display: 'inline-block',
              marginLeft: WORD.kern[i] * s,
              paddingRight: 6 * s,
              transform: `translateY(${(1 - p) * 105}%)`,
            }}
          >
            {ch}
          </span>
        );
      })}
    </div>
  );
  const band = lerp(-30, 130, sweep);
  const gradient = `linear-gradient(105deg, rgba(255,255,255,0) ${band - 16}%, rgba(255,232,115,0.9) ${band - 5}%, #ffffff ${band}%, rgba(255,232,115,0.9) ${band + 5}%, rgba(255,255,255,0) ${band + 16}%)`;
  const clipText: React.CSSProperties = {
    backgroundImage: gradient,
    WebkitBackgroundClip: 'text',
    backgroundClip: 'text',
    color: 'transparent',
  };
  return (
    <>
      {text()}
      {sweeping && (
        <>
          {text({...clipText, filter: 'blur(16px)', opacity: 0.9})}
          {text(clipText)}
        </>
      )}
    </>
  );
};

const Underline: React.FC<{f: number}> = ({f}) => {
  const p = ramp(f, 6, 34, ease.outExpo);
  if (p <= 0) return null;
  return <div style={{position: 'absolute', left: LINE.x, top: LINE.y, width: LINE.w * p, height: LINE.h, background: C.yellow}} />;
};

const SYNTAX: {text: string; color: string}[] = [
  {text: 'print', color: '#6aaee8'},
  {text: '(', color: '#c9d4e6'},
  {text: '"Hello, World!"', color: C.yellow},
  {text: ')', color: '#c9d4e6'},
];

const Tagline: React.FC<{f: number}> = ({f}) => {
  const show = ramp(f, 34, 42);
  if (show <= 0) return null;
  const n = Math.floor(clamp((f - TAG.start) / (TAG.end - TAG.start)) * TAG.code.length + 1e-6);
  const cursorOn = f < TAG.end || (239 - f) % 30 < 15;
  let used = 0;
  return (
    <div
      style={{
        position: 'absolute',
        left: TAG.x,
        top: TAG.y,
        fontFamily: FONT.mono,
        fontWeight: 700,
        fontSize: TAG.size,
        lineHeight: 1,
        whiteSpace: 'pre',
        display: 'flex',
        alignItems: 'center',
        opacity: show,
      }}
    >
      <span style={{color: '#4f6488'}}>{'>>> '}</span>
      {SYNTAX.map((s, i) => {
        const visible = s.text.slice(0, clamp(n - used, 0, s.text.length));
        used += s.text.length;
        return (
          <span key={i} style={{color: s.color}}>
            {visible}
          </span>
        );
      })}
      <span
        style={{
          display: 'inline-block',
          width: TAG.size * 0.6,
          height: TAG.size * 1.05,
          marginLeft: 4,
          background: C.yellow,
          opacity: cursorOn ? 0.9 : 0,
        }}
      />
    </div>
  );
};

export const Finale: React.FC = () => {
  const f = useCurrentFrame();
  const m = motion(f);
  const kick = f >= 1 ? impulse(f, 1, 6) : 0;
  const sx = noise2D('fin-x', f * 0.8, 0) * 12 * kick;
  const sy = noise2D('fin-y', 0, f * 0.8) * 12 * kick;
  const flash = f >= 1 ? 0.3 * impulse(f, 1, 4) : 0;
  return (
    <AbsoluteFill style={{background: NAVY, overflow: 'hidden'}}>
      <AbsoluteFill style={{transform: f >= 1 ? `translate(${sx}px, ${sy}px) scale(${1 + 0.025 * kick})` : undefined}}>
        <Background f={f} />
        <Bokeh f={f} />
        <Ring f={f} />
        <Iris f={f} m={m} />
        <ClippedAvatar f={f} m={m} />
        <Underline f={f} />
        <Wordmark f={f} />
        <Tagline f={f} />
      </AbsoluteFill>
      {flash > 0.004 && <AbsoluteFill style={{background: '#fff8e0', opacity: flash}} />}
    </AbsoluteFill>
  );
};
