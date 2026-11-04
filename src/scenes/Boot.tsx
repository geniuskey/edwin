import React from 'react';
import {AbsoluteFill, Easing, random, useCurrentFrame} from 'remotion';
import {clamp, ease, impulse, ramp, RgbSplit} from '../fx';
import {C, FONT, HEIGHT, WIDTH} from '../theme';

// JetBrains Mono: advance 0.6em; with LH 84 the baseline sits ~62px into each row, caps span 21..62
const FS = 56;
const CW = FS * 0.6;
const LH = 84;
const COLS = 36;
const LEFT = Math.round((WIDTH - COLS * CW) / 2);
const CAP_TOP = 21;
const CAP_H = 41;

const KEYS = [36, 41, 45, 50, 54, 59, 66, 72, 77, 81, 86, 90];
const CMD = 'import edwin';
const KW_LEN = 6;
const T_CURSOR = 14;
const T_PROMPT = 20;
const T_ENTER = 110;
const LOGS = [
  {at: 122, name: 'glasses', value: 'on', color: C.cyan},
  {at: 137, name: 'coffee', value: 'loaded', color: C.orange},
  {at: 152, name: 'python', value: 'ready', color: C.yellow},
] as const;
const P0 = 167;
const P1 = 205;
const CELLS = 8;
const CELL_COL = 22;
const BURSTS = [208, 214, 219, 224, 228];
const INVERT = [214, 224, 228];
const DROPOUT = [211, 217, 222, 226];
const WORD_FRAMES = [219, 220, 224, 225, 228];
const G0 = 208;
const OFF = 229;
const BLACK = 232;
const ROW_EVENTS = [T_ENTER, ...LOGS.map((l) => l.at)];
const CURSOR_EVENTS = [T_CURSOR, T_PROMPT, ...KEYS, ...ROW_EVENTS];

const INK = {
  prompt: C.yellow,
  kw: '#5b9fe0',
  text: '#c9d1de',
  white: C.white,
  dim: '#5a6476',
  faint: '#2b3240',
  ok: '#3ee08f',
};
const GLYPHS = '#$%&*+=<>?!/\\|~^{}[]_:;0123456789ABCDEFX';

const rgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const rgba = (hex: string, a: number) => `rgba(${rgb(hex).join(',')},${a})`;
const mix = (a: string, b: string, t: number) => {
  const B = rgb(b);
  return '#' + rgb(a).map((v, i) => Math.round(v + (B[i] - v) * clamp(t)).toString(16).padStart(2, '0')).join('');
};

type Seg = {t: string; c: string; bold?: boolean; hot?: number; scale?: number};
type Row = {segs: Seg[]; at?: number};

const typedCount = (f: number) => KEYS.filter((k) => f >= k).length;
const progress = (f: number) => Math.pow(clamp((f - P0) / (P1 - P0)), 2.1);
const cellOnFrame = (i: number) => Math.ceil(P0 + (P1 - P0) * Math.pow((i + 1) / CELLS, 1 / 2.1) - 1e-6);

const commandRow = (f: number): Row => {
  if (f < T_PROMPT) return {segs: []};
  const n = typedCount(f);
  const kw = n >= KW_LEN;
  const submit = impulse(f, T_ENTER, 6) * 0.55;
  const segs: Seg[] = [{t: '>>> ', c: INK.prompt, bold: true, hot: impulse(f, T_PROMPT, 4) * 0.8}];
  for (let i = 0; i < n; i++) {
    const isKw = kw && i < KW_LEN;
    const hot = Math.max(impulse(f, KEYS[i], 3.5), isKw ? impulse(f, KEYS[KW_LEN - 1], 7) * 0.75 : 0, submit);
    segs.push({t: CMD[i], c: isKw ? INK.kw : INK.white, bold: isKw, hot});
  }
  return {segs};
};

const logRow = (name: string, value: string, color: string, at: number): Row => ({
  at,
  segs: [
    {t: '[', c: INK.dim},
    {t: 'ok', c: INK.ok, bold: true},
    {t: '] ', c: INK.dim},
    {t: name + ' ', c: INK.text},
    {t: '.'.repeat(COLS - 7 - name.length - value.length), c: INK.faint},
    {t: ' ' + value, c: color, bold: true},
  ],
});

const progressRow = (f: number): Row => {
  const done = f >= P1;
  const ping = impulse(f, P1, 7);
  const phase = Math.floor((f - P0) / 4) % 3;
  const tag: Seg[] = done
    ? [{t: 'ok', c: INK.ok, bold: true, hot: ping}]
    : [0, 1].map((k) => ({t: '.', c: phase === k ? INK.white : phase === 2 ? INK.dim : INK.faint, bold: true}));
  return {
    at: P0,
    segs: [
      {t: '[', c: INK.dim},
      ...tag,
      {t: '] ', c: INK.dim},
      {t: 'rendering ', c: INK.text},
      {t: 'edwin', c: INK.white, bold: true},
      {t: ' [', c: INK.dim},
      {t: ' '.repeat(CELLS), c: INK.dim},
      {t: '] ', c: INK.dim},
      {
        t: `${Math.floor(progress(f) * 100)}%`.padStart(4, ' '),
        c: done ? C.yellow : INK.white,
        bold: true,
        hot: ping,
        scale: done ? 1 + 0.3 * ease.outCubic(1 - clamp((f - P1) / 9)) : 1,
      },
    ],
  };
};

const rowsAt = (f: number): Row[] => {
  const rows = [commandRow(f)];
  LOGS.forEach((l) => {
    if (f >= l.at) rows.push(logRow(l.name, l.value, l.color, l.at));
  });
  if (f >= P0) rows.push(progressRow(f));
  return rows;
};

const cursorAt = (f: number) => {
  if (f < T_CURSOR || f >= P0) return null;
  const last = Math.max(...CURSOR_EVENTS.filter((e) => e <= f));
  if ((f - last) % 30 >= 15) return null;
  if (f < T_PROMPT) return {row: 0, col: 0};
  if (f < T_ENTER) return {row: 0, col: 4 + typedCount(f)};
  return {row: 1 + LOGS.filter((l) => f >= l.at).length, col: 0};
};

// keep the printed block vertically centred: each new row nudges the block up half a line
const scrollY = (f: number) => -(LH / 2) * ROW_EVENTS.reduce((s, t) => s + ramp(f, t, t + 18, ease.snap), 0);
const camScale = (f: number) => 1 + 0.05 * ramp(f, 0, BLACK, Easing.inOut(Easing.sin));

const glow = (c: string, hot: number) =>
  `0 0 ${2 + 5 * hot}px ${rgba(c, 0.5 + 0.45 * hot)}, 0 0 ${14 + 26 * hot}px ${rgba(c, 0.26 + 0.4 * hot)}`;

const corruptText = (t: string, amount: number, key: string) =>
  amount <= 0
    ? t
    : t
        .split('')
        .map((ch, k) =>
          random(`${key}-${k}`) < amount * (ch === ' ' ? 0.25 : 1)
            ? GLYPHS[Math.floor(random(`${key}-g${k}`) * GLYPHS.length)]
            : ch,
        )
        .join('');

const SegView: React.FC<{seg: Seg; extraHot: number; text: string}> = ({seg, extraHot, text}) => {
  const hot = clamp(Math.max(seg.hot ?? 0, extraHot));
  const style: React.CSSProperties = {
    color: hot > 0.01 ? mix(seg.c, '#ffffff', hot) : seg.c,
    fontWeight: seg.bold ? 700 : 400,
    textShadow: glow(seg.c, hot),
  };
  if (seg.scale && seg.scale !== 1) {
    return (
      <span style={{...style, display: 'inline-block', transform: `scale(${seg.scale})`, transformOrigin: '20% 62%'}}>
        {text}
      </span>
    );
  }
  return <span style={style}>{text}</span>;
};

const Cells: React.FC<{f: number}> = ({f}) => {
  const filled = Math.floor(progress(f) * CELLS + 1e-6);
  const ping = impulse(f, P1, 7);
  return (
    <>
      {Array.from({length: CELLS}, (_, i) => {
        const on = i < filled;
        const base = mix(C.blueHi, C.yellow, i / (CELLS - 1));
        const pop = on ? Math.max(impulse(f, cellOnFrame(i), 3), ping) : 0;
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: (CELL_COL + i) * CW + 3,
              top: CAP_TOP,
              width: CW - 6,
              height: CAP_H,
              background: on ? mix(base, '#ffffff', pop * 0.85) : 'rgba(140,160,190,0.09)',
              boxShadow: on ? `0 0 ${8 + 22 * pop}px ${rgba(base, 0.55 + 0.4 * pop)}` : 'inset 0 0 0 1px rgba(140,160,190,0.14)',
            }}
          />
        );
      })}
    </>
  );
};

const RowView: React.FC<{row: Row; index: number; f: number; corrupt: number; seed: string}> = ({
  row,
  index,
  f,
  corrupt,
  seed,
}) => {
  const reveal = row.at === undefined ? 1 : ease.outExpo(clamp((f - row.at + 1) / 5));
  const flash = row.at === undefined ? 0 : impulse(f, row.at, 4) * 0.85;
  const width = COLS * CW;
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        top: index * LH,
        width,
        height: LH,
        clipPath: reveal < 0.999 ? `inset(-30px ${(1 - reveal) * width}px -30px -30px)` : undefined,
      }}
    >
      {row.segs.map((s, i) => (
        <SegView key={i} seg={s} extraHot={flash} text={corruptText(s.t, corrupt, `${seed}-${f}-${index}-${i}`)} />
      ))}
      {index === 4 && <Cells f={f} />}
      {reveal < 0.999 && (
        <div
          style={{
            position: 'absolute',
            left: reveal * width - 3,
            top: 10,
            width: 6,
            height: LH - 20,
            background: '#fff',
            opacity: 1 - reveal * 0.6,
            boxShadow: '0 0 16px 4px rgba(170,215,255,0.7)',
          }}
        />
      )}
    </div>
  );
};

const Screen: React.FC<{f: number; corrupt: number; seed: string}> = ({f, corrupt, seed}) => {
  const rows = rowsAt(f);
  const cur = cursorAt(f);
  return (
    <AbsoluteFill style={{transform: `scale(${camScale(f)})`, transformOrigin: `${WIDTH / 2}px ${HEIGHT / 2}px`}}>
      <div
        style={{
          position: 'absolute',
          left: LEFT,
          top: HEIGHT / 2 - LH / 2 + scrollY(f),
          fontFamily: FONT.mono,
          fontSize: FS,
          lineHeight: `${LH}px`,
          whiteSpace: 'pre',
          fontVariantLigatures: 'none',
          fontFeatureSettings: '"calt" 0, "liga" 0',
        }}
      >
        {rows.map((row, i) => (
          <RowView key={i} row={row} index={i} f={f} corrupt={corrupt} seed={seed} />
        ))}
        {f >= P1 && f < P1 + 14 && (
          <div
            style={{
              position: 'absolute',
              left: -60,
              top: 4 * LH + CAP_TOP + CAP_H / 2 - 1,
              width: COLS * CW + 120,
              height: 2,
              opacity: impulse(f, P1, 4),
              background: `linear-gradient(90deg, rgba(255,212,59,0), ${rgba(C.yellowHi, 0.95)} 70%, rgba(255,212,59,0))`,
              boxShadow: `0 0 14px 2px ${rgba(C.yellow, 0.55)}`,
            }}
          />
        )}
        {cur && (
          <div
            style={{
              position: 'absolute',
              left: cur.col * CW + 2,
              top: cur.row * LH + 15,
              width: CW - 3,
              height: 58,
              background: '#e9eef7',
              boxShadow: '0 0 3px rgba(255,255,255,0.9), 0 0 22px rgba(170,205,255,0.45)',
            }}
          />
        )}
      </div>
    </AbsoluteFill>
  );
};

// giant name bleeding through a corrupted scanline band (subliminal, 1-2 frames)
const BigWord: React.FC<{bg: string}> = ({bg}) => (
  <AbsoluteFill style={{background: bg, alignItems: 'center', justifyContent: 'center'}}>
    <div style={{fontFamily: FONT.display, fontSize: 760, lineHeight: 1, color: C.white, letterSpacing: 6}}>EDWIN</div>
  </AbsoluteFill>
);

type Slice = {y0: number; y1: number; dx: number; word: string | null; tint: string | null};

const slicesAt = (f: number, g: number): Slice[] => {
  if (g < 0.04) return [{y0: 0, y1: HEIGHT, dx: 0, word: null, tint: null}];
  const n = 3 + Math.floor(g * 12);
  const cuts = Array.from({length: n - 1}, (_, i) => 200 + random(`cut-${f}-${i}`) * 680).sort((a, b) => a - b);
  const ys = [0, ...cuts, HEIGHT];
  const wordAt = WORD_FRAMES.includes(f) ? 1 + Math.floor(random(`ws-${f}`) * (n - 2)) : -1;
  return ys.slice(0, -1).map((y0, i) => {
    const big = random(`big-${f}-${i}`) < 0.45;
    const roll = random(`tint-${f}-${i}`);
    return {
      y0,
      y1: ys[i + 1],
      dx: (random(`dx-${f}-${i}`) - 0.5) * 2 * g * (big ? 380 : 46),
      word: i === wordAt ? [C.blue, C.magenta, '#000000'][Math.floor(random(`wc-${f}`) * 3)] : null,
      tint: i === 0 || i === n - 1 || ys[i + 1] - y0 > 130 ? null : roll < 0.16 * g ? C.cyan : roll < 0.28 * g ? C.magenta : null,
    };
  });
};

const Blocks: React.FC<{f: number; g: number}> = ({f, g}) => {
  const n = Math.floor(g * 11);
  const colors = [C.cyan, C.magenta, '#ffffff', C.yellow, C.blueHi];
  return (
    <AbsoluteFill style={{mixBlendMode: 'screen'}}>
      {Array.from({length: n}, (_, i) => {
        const r = (k: string) => random(`blk-${f}-${i}-${k}`);
        const c = colors[Math.floor(r('c') * colors.length)];
        const striped = r('s') < 0.5;
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: 220 + r('x') * 1400,
              top: 260 + r('y') * 560,
              width: 24 + Math.pow(r('w'), 2) * 620,
              height: 4 + Math.pow(r('h'), 3) * 80,
              opacity: 0.35 + 0.6 * r('o'),
              background: striped ? `repeating-linear-gradient(180deg, ${c} 0 2px, transparent 2px 5px)` : c,
            }}
          />
        );
      })}
      {Array.from({length: Math.floor(g * 4)}, (_, i) => (
        <div
          key={`t${i}`}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: random(`tear-${f}-${i}`) * HEIGHT,
            height: 1 + Math.floor(random(`tearh-${f}-${i}`) * 3),
            background: 'rgba(235,245,255,0.85)',
          }}
        />
      ))}
    </AbsoluteFill>
  );
};

// CRT power-off: frame collapses to a white line, then to a dot
const CrtOff: React.FC<{f: number}> = ({f}) => {
  const t = f - OFF;
  const w = [WIDTH * 0.96, 640, 14][t];
  const h = [7, 3, 14][t];
  return (
    <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center'}}>
      <div
        style={{
          width: w,
          height: h,
          borderRadius: h,
          background: '#fff',
          opacity: [1, 0.95, 0.55][t],
          boxShadow: `0 0 ${[26, 18, 22][t]}px ${[6, 4, 6][t]}px rgba(170,225,255,0.8), 0 0 ${[90, 50, 40][t]}px rgba(45,226,255,0.45)`,
        }}
      />
    </AbsoluteFill>
  );
};

const glitchAmount = (f: number) => {
  if (f < G0 || f >= OFF) return 0;
  const burst = BURSTS.reduce((m, at, i) => Math.max(m, impulse(f, at, 2.2) * (0.62 + i * 0.095)), 0);
  return clamp(burst + ramp(f, G0, OFF) * 0.28 * random(`unrest-${f}`));
};

export const Boot: React.FC = () => {
  const f = useCurrentFrame();
  if (f >= BLACK) return <AbsoluteFill style={{background: '#000'}} />;

  const g = glitchAmount(f);
  const corrupt = f < G0 ? 0 : clamp(0.03 + g * 0.42 + ramp(f, G0, OFF) * 0.22);
  const off = f >= OFF;
  const slices = slicesAt(f, g);
  const jumpY = g > 0.3 ? (random(`jy-${f}`) - 0.5) * 90 * g : 0;
  const flicker = f >= G0 ? (DROPOUT.includes(f) ? 0.12 : 0.78 + 0.22 * random(`fl-${f}`)) : 1;
  const bandY = ((f * 7) % 1700) - 320;

  return (
    <AbsoluteFill style={{background: '#000', filter: INVERT.includes(f) ? 'invert(1)' : undefined}}>
      <AbsoluteFill
        style={{
          opacity: ramp(f, 0, 18, ease.outCubic),
          background: 'radial-gradient(ellipse 72% 64% at 50% 50%, #0c1119 0%, #070a0f 52%, #020304 100%)',
        }}
      />
      {!off && (
        <AbsoluteFill style={{opacity: flicker, transform: `translateY(${jumpY}px)`}}>
          <RgbSplit amount={f >= G0 ? 3 + g * 26 : 0}>
            {slices.map((s, i) => (
              <AbsoluteFill
                key={i}
                style={{
                  clipPath: `inset(${s.y0}px 0 ${HEIGHT - s.y1}px 0)`,
                  transform: s.dx ? `translateX(${s.dx}px)` : undefined,
                  background: s.tint ?? undefined,
                }}
              >
                {s.word ? <BigWord bg={s.word} /> : <Screen f={f} corrupt={corrupt} seed={`s${i}`} />}
              </AbsoluteFill>
            ))}
          </RgbSplit>
        </AbsoluteFill>
      )}
      {!off && g > 0.3 && <Blocks f={f} g={g} />}
      {!off && (
        <AbsoluteFill
          style={{
            pointerEvents: 'none',
            opacity: 0.3 + 0.5 * g,
            backgroundImage:
              'repeating-linear-gradient(180deg, rgba(0,0,0,0) 0px, rgba(0,0,0,0) 2px, rgba(0,0,0,0.55) 2px, rgba(0,0,0,0.55) 3px)',
          }}
        />
      )}
      {!off && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: bandY,
            height: 320,
            background: 'linear-gradient(180deg, rgba(140,175,255,0) 0%, rgba(140,175,255,0.035) 50%, rgba(140,175,255,0) 100%)',
          }}
        />
      )}
      {off && <CrtOff f={f} />}
    </AbsoluteFill>
  );
};
