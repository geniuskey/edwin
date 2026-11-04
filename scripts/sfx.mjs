#!/usr/bin/env node
// EDWIN soundtrack: procedural score + SFX locked to the 60 fps / 120 BPM cue sheet.
// Writes public/edwin.wav (48 kHz, stereo, 16-bit PCM, exactly 24 s). Deterministic, no dependencies.
import {mkdirSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

// ─── time grid ───────────────────────────────────────────────────────────────
const SR = 48000;
const FPS = 60;
const SPF = SR / FPS;
const N = 1440 * SPF;
const BEAT = 30;
const TAU = Math.PI * 2;

const at = (frame) => Math.round(frame * SPF);
const sec = (s) => Math.max(1, Math.round(s * SR));
const db = (d) => 10 ** (d / 20);
const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
const lerp = (a, b, t) => a + (b - a) * t;
const expLerp = (a, b, t) => a * (b / a) ** t;
const smoothstep = (t) => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};
const grid = (from, to, step = BEAT) => {
  const out = [];
  for (let f = from; f <= to + 1e-9; f += step) out.push(f);
  return out;
};

const SEMI = {C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11};
const hz = (name) => {
  const m = /^([A-G])(#|b)?(\d)$/.exec(name);
  if (!m) throw new Error(`bad note ${name}`);
  const midi = SEMI[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12 * (Number(m[3]) + 1);
  return 440 * 2 ** ((midi - 69) / 12);
};
const chord = (names) => names.split(' ').map(hz);

// ─── deterministic randomness (one stream per named event) ──────────────────
function rng(key) {
  let h = 2166136261;
  const s = `edwin/${key}`;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const bi = (r) => r() * 2 - 1;
const between = (r, lo, hi) => lo + (hi - lo) * r();

// ─── signals: mono = Float32Array, stereo = {L, R} ──────────────────────────
const stereo = (n) => ({L: new Float32Array(n), R: new Float32Array(n)});
const channels = (sig) => (sig instanceof Float32Array ? [sig] : [sig.L, sig.R]);

function fade(sig, inMs = 0.3, outMs = 5) {
  for (const ch of channels(sig)) {
    const n = ch.length;
    const a = Math.min(n >> 1, Math.round((inMs * SR) / 1000));
    const b = Math.min(n >> 1, Math.round((outMs * SR) / 1000));
    for (let i = 0; i < a; i++) ch[i] *= Math.sin((Math.PI / 2) * (i / a)) ** 2;
    for (let i = 0; i < b; i++) ch[n - 1 - i] *= Math.sin((Math.PI / 2) * (i / b)) ** 2;
  }
  return sig;
}

function normalize(sig, peak = 1) {
  let m = 0;
  for (const ch of channels(sig)) for (let i = 0; i < ch.length; i++) m = Math.max(m, Math.abs(ch[i]));
  if (m > 0) for (const ch of channels(sig)) for (let i = 0; i < ch.length; i++) ch[i] *= peak / m;
  return sig;
}

function reverse(sig) {
  for (const ch of channels(sig)) ch.reverse();
  return sig;
}

// ─── filters ─────────────────────────────────────────────────────────────────
// Zero-delay-feedback state-variable filter: stable under fast cutoff sweeps.
class SVF {
  constructor(fc = 1000, q = 0.707) {
    this.s1 = 0;
    this.s2 = 0;
    this.band = 0;
    this.low = 0;
    this.set(fc, q);
  }
  set(fc, q = this.q) {
    this.q = q;
    const g = Math.tan((Math.PI * clamp(fc, 5, SR * 0.45)) / SR);
    this.k = 1 / q;
    this.a1 = 1 / (1 + g * (g + this.k));
    this.a2 = g * this.a1;
    this.a3 = g * this.a2;
    return this;
  }
  run(v0) {
    const v3 = v0 - this.s2;
    const v1 = this.a1 * this.s1 + this.a2 * v3;
    const v2 = this.s2 + this.a2 * this.s1 + this.a3 * v3;
    this.s1 = 2 * v1 - this.s1;
    this.s2 = 2 * v2 - this.s2;
    this.band = v1;
    this.low = v2;
    return v0 - this.k * v1 - v2;
  }
  lp(x) {
    this.run(x);
    return this.low;
  }
  hp(x) {
    return this.run(x);
  }
  bp(x) {
    this.run(x);
    return this.band * this.k;
  }
  res(x) {
    this.run(x);
    return this.band;
  }
}

class OnePole {
  constructor(fc) {
    this.z = 0;
    this.set(fc);
  }
  set(fc) {
    this.a = 1 - Math.exp((-TAU * fc) / SR);
    return this;
  }
  lp(x) {
    this.z += this.a * (x - this.z);
    return this.z;
  }
  hp(x) {
    return x - this.lp(x);
  }
}

// ─── oscillators (polyBLEP band-limited) ─────────────────────────────────────
function blep(t, dt) {
  if (t < dt) {
    const x = t / dt;
    return x + x - x * x - 1;
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
}

class Saw {
  constructor(phase = 0) {
    this.p = phase;
  }
  tick(f) {
    const dt = f / SR;
    const y = 2 * this.p - 1 - blep(this.p, dt);
    this.p += dt;
    if (this.p >= 1) this.p -= 1;
    return y;
  }
}

class Pulse {
  constructor(phase = 0) {
    this.p = phase;
  }
  tick(f, width = 0.5) {
    const dt = f / SR;
    let y = this.p < width ? 1 : -1;
    y += blep(this.p, dt);
    y -= blep((this.p + 1 - width) % 1, dt);
    this.p += dt;
    if (this.p >= 1) this.p -= 1;
    return y;
  }
}

class SuperSaw {
  constructor(r, voices = 5, spread = 0.2) {
    this.saws = [];
    this.ratios = [];
    for (let v = 0; v < voices; v++) {
      const x = voices === 1 ? 0 : (v / (voices - 1)) * 2 - 1;
      this.ratios.push(2 ** ((x * spread + bi(r) * spread * 0.1) / 12));
      this.saws.push(new Saw(r()));
    }
    this.norm = 1 / Math.sqrt(voices);
  }
  tick(f) {
    let s = 0;
    for (let v = 0; v < this.saws.length; v++) s += this.saws[v].tick(f * this.ratios[v]);
    return s * this.norm;
  }
}

// TR-808 style inharmonic square bank for hats and cymbals.
const METAL_HZ = [205.3, 304.4, 369.6, 522.7, 540, 800];
class Metal {
  constructor(r, scale) {
    this.osc = METAL_HZ.map(() => new Pulse(r()));
    this.f = METAL_HZ.map((f) => f * scale * (1 + bi(r) * 0.003));
  }
  tick() {
    let s = 0;
    for (let i = 0; i < 6; i++) s += this.osc[i].tick(this.f[i]);
    return s / 6;
  }
}

// ─── FFT convolution reverb ──────────────────────────────────────────────────
function fft(re, im, inverse) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
  }
  const half = n >> 1;
  const cos = new Float64Array(half);
  const sin = new Float64Array(half);
  const sign = inverse ? 1 : -1;
  for (let k = 0; k < half; k++) {
    cos[k] = Math.cos((TAU * k) / n);
    sin[k] = sign * Math.sin((TAU * k) / n);
  }
  for (let size = 2; size <= n; size <<= 1) {
    const h = size >> 1;
    const step = n / size;
    for (let i = 0; i < n; i += size) {
      for (let k = 0, w = 0; k < h; k++, w += step) {
        const a = i + k;
        const b = a + h;
        const tr = re[b] * cos[w] - im[b] * sin[w];
        const ti = re[b] * sin[w] + im[b] * cos[w];
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
}

// Mono in, stereo out: the IR pair is packed as one complex signal (L + iR), so 3 FFTs give both channels.
function convolve(x, s0, s1, ir) {
  const len = s1 - s0;
  const outLen = len + ir.L.length - 1;
  let size = 1;
  while (size < outLen) size <<= 1;
  const xr = new Float64Array(size);
  const xi = new Float64Array(size);
  for (let i = 0; i < len; i++) xr[i] = x[s0 + i];
  const hr = new Float64Array(size);
  const hi = new Float64Array(size);
  hr.set(ir.L);
  hi.set(ir.R);
  fft(xr, xi, false);
  fft(hr, hi, false);
  for (let k = 0; k < size; k++) {
    const a = xr[k];
    const b = xi[k];
    xr[k] = a * hr[k] - b * hi[k];
    xi[k] = a * hi[k] + b * hr[k];
  }
  fft(xr, xi, true);
  const out = stereo(outLen);
  for (let i = 0; i < outLen; i++) {
    out.L[i] = xr[i] / size;
    out.R[i] = xi[i] / size;
  }
  return out;
}

// Decorrelated exponential-noise IR whose tail darkens over time; unit energy per channel.
function makeIR({seed, len, rt60, pre, bright, dark, lowCut}) {
  const n = sec(len);
  const ir = stereo(n);
  const p = sec(pre);
  [ir.L, ir.R].forEach((ch, ci) => {
    const r = rng(`${seed}:${ci}`);
    const lp = new OnePole(bright);
    const hp = new OnePole(lowCut);
    let energy = 0;
    for (let i = p; i < n; i++) {
      const t = (i - p) / SR;
      if ((i & 63) === 0) lp.set(expLerp(bright, dark, Math.min(1, t / rt60)));
      const env = 10 ** ((-3 * t) / rt60) * Math.min(1, t / 0.006) * (1 - (i - p) / (n - p));
      const v = hp.hp(lp.lp(bi(r))) * env;
      ch[i] = v;
      energy += v * v;
    }
    const g = 1 / Math.sqrt(energy);
    for (let i = 0; i < n; i++) ch[i] *= g;
  });
  return ir;
}

const HALL = makeIR({seed: 'hall', len: 3.2, rt60: 2.5, pre: 0.022, bright: 8500, dark: 2000, lowCut: 170});
const ROOM = makeIR({seed: 'room', len: 0.9, rt60: 0.5, pre: 0.006, bright: 10000, dark: 3800, lowCut: 230});

// ─── instruments ─────────────────────────────────────────────────────────────
function kick({seed = 'kick', tone = 55, knock = 180, punch = 1, hold = 0.01, decay = 0.13, click = 1, drive = 1.8} = {}) {
  const n = sec(hold + decay * 6);
  const out = new Float32Array(n);
  const r = rng(seed);
  const bp = new SVF(4000, 0.8);
  const norm = Math.tanh(drive);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    ph += (tone + knock * Math.exp(-t / 0.03) + 1100 * punch * Math.exp(-t / 0.0028)) / SR;
    const amp = t < hold ? 1 : Math.exp(-(t - hold) / decay);
    out[i] = Math.tanh(Math.sin(TAU * ph) * amp * drive) / norm + bp.bp(bi(r)) * Math.exp(-t / 0.002) * 0.45 * click;
  }
  return fade(out, 0.05, 20);
}

function subBoom({f0 = 110, f1 = 34, sweep = 0.1, decay = 0.5, drive = 1.4} = {}) {
  const n = sec(decay * 6);
  const out = new Float32Array(n);
  const norm = Math.tanh(drive);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    ph += (f1 + (f0 - f1) * Math.exp(-t / sweep)) / SR;
    out[i] = (Math.tanh(Math.sin(TAU * ph) * drive) / norm) * Math.min(1, t / 0.002) * Math.exp(-t / decay);
  }
  return fade(out, 0.5, 40);
}

function clap({seed = 'clap', tone = 1500, q = 1.0, decay = 0.12, spread = 0.0095} = {}) {
  const n = sec(0.03 + decay * 5);
  const out = stereo(n);
  const taps = [0, spread, spread * 2.1, spread * 3];
  [out.L, out.R].forEach((ch, ci) => {
    const r = rng(`${seed}:${ci}`);
    const bp = new SVF(tone * (ci ? 1.04 : 0.96), q);
    const hp = new SVF(800, 0.7);
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      let env = 0;
      for (let k = 0; k < 3; k++) if (t >= taps[k]) env += Math.exp(-(t - taps[k]) / 0.0042) * (1 - k * 0.12);
      if (t >= taps[3]) env += Math.exp(-(t - taps[3]) / decay) * 0.95;
      const x = bi(r);
      ch[i] = (bp.bp(x) + hp.hp(x) * 0.35) * env;
    }
  });
  return fade(out, 0.1, 15);
}

function snare({seed = 'snare', pitch = 185, decay = 0.13, toneDecay = 0.055, tone = 0.6, bright = 1} = {}) {
  const n = sec(Math.max(decay, toneDecay) * 5 + 0.01);
  const out = stereo(n);
  [out.L, out.R].forEach((ch, ci) => {
    const r = rng(`${seed}:${ci}`);
    const hp = new SVF(1400, 0.7);
    const lp = new SVF(7500 * bright, 0.6);
    let p1 = 0;
    let p2 = 0;
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const bend = 1 + 0.6 * Math.exp(-t / 0.01);
      p1 += (pitch * bend) / SR;
      p2 += (pitch * 1.71 * bend) / SR;
      const body = (Math.sin(TAU * p1) + 0.45 * Math.sin(TAU * p2)) * Math.exp(-t / toneDecay) * tone;
      const nz = lp.lp(hp.hp(bi(r))) * Math.exp(-t / decay) * (1 + 1.5 * Math.exp(-t / 0.004));
      ch[i] = Math.tanh((body + nz * 0.9) * 1.4);
    }
  });
  return fade(out, 0.1, 10);
}

function hat({seed = 'hat', decay = 0.02, tone = 1} = {}) {
  const n = sec(decay * 6 + 0.005);
  const out = new Float32Array(n);
  const r = rng(seed);
  const metal = new Metal(r, 1.65 * tone);
  const bp = new SVF(9000 * tone, 0.9);
  const hp = new SVF(6800, 0.7);
  const lp = new SVF(12500, 0.7);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const env = Math.exp(-t / decay) * (1 + 0.6 * Math.exp(-t / 0.002));
    out[i] = lp.lp(hp.hp(bp.bp(metal.tick() * 0.8 + bi(r) * 0.45))) * env * 1.6;
  }
  return fade(out, 0.05, 3);
}

function crash({seed = 'crash', len = 2.8, decay = 0.9, bright = 1} = {}) {
  const n = sec(len);
  const out = stereo(n);
  [out.L, out.R].forEach((ch, ci) => {
    const r = rng(`${seed}:${ci}`);
    const m1 = new Metal(r, 2.6);
    const m2 = new Metal(r, 4.15);
    const hp = new SVF(3200, 0.7);
    const bp = new SVF(6500 * bright, 0.5);
    const lp = new SVF(11000, 0.7);
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      if ((i & 63) === 0) lp.set(lerp(4000, 11000 * bright, Math.exp(-t / 0.6)), 0.7);
      const x = (m1.tick() + m2.tick()) * 0.6 + bi(r) * 0.7;
      const env = Math.exp(-t / decay) * (1 + 1.8 * Math.exp(-t / 0.025)) * (1 - t / len);
      ch[i] = lp.lp(bp.bp(hp.hp(x))) * env;
    }
  });
  return fade(out, 0.1, 30);
}

// Band-passed noise whose center (f0 -> f1 at `peak` -> f2) and level follow a swell; `flutter` = rotating spin.
function whoosh({seed = 'whoosh', len = 0.8, peak = 0.35, f0 = 400, f1 = 3000, f2 = 600, q = 1.3, rise = 2, fall = 1.6, body = 0.35, flutter = null} = {}) {
  const n = sec(len);
  const out = stereo(n);
  const pk = clamp(peak, 0.01, 0.99);
  [out.L, out.R].forEach((ch, ci) => {
    const r = rng(`${seed}:${ci}`);
    const bp = new SVF(f0, q);
    const lp = new SVF(f0, 0.7);
    let fph = 0;
    for (let i = 0; i < n; i++) {
      const x = i / n;
      if ((i & 15) === 0) {
        const fc = x < pk ? expLerp(f0, f1, smoothstep(x / pk)) : expLerp(f1, f2, smoothstep((x - pk) / (1 - pk)));
        bp.set(fc, q);
        lp.set(fc * 0.6, 0.7);
      }
      let env = x < pk ? (x / pk) ** rise : ((1 - x) / (1 - pk)) ** fall;
      if (flutter) {
        fph += lerp(flutter[0], flutter[1], x) / SR;
        env *= 0.62 + 0.38 * Math.sin(TAU * fph + ci * Math.PI);
      }
      const v = bi(r);
      ch[i] = (bp.bp(v) + lp.lp(v) * body) * env;
    }
  });
  return fade(out, 0.3, 8);
}

function riser({seed = 'riser', len, from, to, nFrom = 300, nTo = 9000, synth = 0.5, curve = 2.2, gate = null}) {
  const n = sec(len);
  const out = stereo(n);
  [out.L, out.R].forEach((ch, ci) => {
    const r = rng(`${seed}:${ci}`);
    const ss = new SuperSaw(r, 5, 0.32);
    const nf = new SVF(nFrom, 0.9);
    const sf = new SVF(from * 4, 0.8);
    for (let i = 0; i < n; i++) {
      const x = i / n;
      const f = expLerp(from, to, x ** 1.5);
      if ((i & 15) === 0) {
        nf.set(expLerp(nFrom, nTo, x ** 1.4), lerp(0.9, 2.4, x));
        sf.set(Math.min(14000, f * lerp(3, 8, x)), 0.9);
      }
      const g = gate ? gate(x) : 1;
      ch[i] = (nf.bp(bi(r)) * (1 - synth) + sf.lp(ss.tick(f)) * synth) * x ** curve * g;
    }
  });
  return fade(out, 5, 1.5);
}

function bassNote({freq, len, seed = 'bass', cut = 900, cutDecay = 0.09, sub = 1, mid = 0.7, octave = 1, drive = 1.6, attack = 0.004, release = 0.03}) {
  const n = sec(len);
  const out = new Float32Array(n);
  const r = rng(seed);
  const s1 = new Saw(r());
  const s2 = new Saw(r());
  const lp = new SVF(cut, 1.0);
  const norm = Math.tanh(drive);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    if ((i & 15) === 0) lp.set(110 + cut * Math.exp(-t / cutDecay), 1.0);
    ph += freq / SR;
    const amp = Math.max(0, Math.min(1, t / attack, (len - t) / release));
    const m = lp.lp((s1.tick(freq * octave * 1.003) + s2.tick(freq * octave * 0.997)) * 0.5);
    out[i] = (Math.tanh((Math.sin(TAU * ph) * sub + m * mid) * drive) / norm) * amp;
  }
  return fade(out, 0.5, 3);
}

function pluck({freq, seed = 'pluck', len = 0.7, decay = 0.2, cut = 4200, cutDecay = 0.08}) {
  const n = sec(len);
  const out = stereo(n);
  [out.L, out.R].forEach((ch, ci) => {
    const r = rng(`${seed}:${ci}`);
    const a = new Saw(r());
    const b = new Saw(r());
    const sq = new Pulse(r());
    const lp = new SVF(cut, 1.2);
    const d = ci ? 1.006 : 0.994;
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      if ((i & 15) === 0) lp.set(260 + cut * Math.exp(-t / cutDecay), 1.2);
      const x = (a.tick(freq * d) + b.tick(freq / d)) * 0.5 + sq.tick(freq * 0.5) * 0.25;
      ch[i] = lp.lp(x) * Math.min(1, t / 0.0015) * Math.exp(-t / decay);
    }
  });
  return fade(out, 0.1, 15);
}

function stab({notes, seed = 'stab', len = 0.34, decay = 0.11, cut = 6000, cutDecay = 0.07}) {
  const n = sec(len);
  const out = stereo(n);
  [out.L, out.R].forEach((ch, ci) => {
    const r = rng(`${seed}:${ci}`);
    const voices = notes.map(() => new SuperSaw(r, 5, 0.22));
    const lp = new SVF(cut, 0.9);
    const norm = 1 / Math.sqrt(notes.length);
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      if ((i & 15) === 0) lp.set(500 + cut * Math.exp(-t / cutDecay), 0.9);
      let s = 0;
      for (let v = 0; v < notes.length; v++) s += voices[v].tick(notes[v]);
      ch[i] = Math.tanh(lp.lp(s * norm) * 1.5 * Math.min(1, t / 0.001) * Math.exp(-t / decay));
    }
  });
  return fade(out, 0.1, 12);
}

function pad({notes, len, seed = 'pad', attack = 0.6, release = 0.8, cutoff = () => 1600, q = 0.8, spread = 0.2, lfo = 0.13}) {
  const n = sec(len);
  const out = stereo(n);
  [out.L, out.R].forEach((ch, ci) => {
    const r = rng(`${seed}:${ci}`);
    const voices = notes.map(() => new SuperSaw(r, 5, spread));
    const lp = new SVF(cutoff(0), q);
    const lfoPh = r() * TAU;
    const norm = 1 / Math.sqrt(notes.length);
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      if ((i & 31) === 0) lp.set(cutoff(i / n) * (1 + 0.18 * Math.sin(TAU * lfo * t + lfoPh)), q);
      let s = 0;
      for (let v = 0; v < notes.length; v++) s += voices[v].tick(notes[v]);
      ch[i] = lp.lp(s * norm) * smoothstep(t / attack) * smoothstep((len - t) / release);
    }
  });
  return fade(out, 1, 10);
}

function chorus(sig, {base = 0.011, depth = 0.0035, rate = 0.27, mix = 0.5} = {}) {
  [sig.L, sig.R].forEach((ch, ci) => {
    const dry = ch.slice();
    for (let i = 0; i < ch.length; i++) {
      const pos = i - (base + depth * Math.sin(TAU * rate * (i / SR) + ci * Math.PI * 0.5)) * SR;
      const k = Math.floor(pos);
      const fr = pos - k;
      const a = k >= 0 ? dry[k] : 0;
      const b = k + 1 >= 0 ? dry[k + 1] : 0;
      ch[i] = dry[i] * (1 - mix * 0.4) + (a + (b - a) * fr) * mix;
    }
  });
  return sig;
}

// Two-operator FM electric piano with a short tine transient.
function ep({freq, len = 2.6, decay = 1.0, index = 1.6}) {
  const n = sec(len);
  const out = stereo(n);
  [out.L, out.R].forEach((ch, ci) => {
    const f = freq * 2 ** (((ci ? 1 : -1) * 3) / 1200);
    let pc = 0;
    let pt = 0;
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      pc += f / SR;
      pt += (f * 14) / SR;
      const I = 0.25 + index * Math.exp(-t / 0.22);
      const env = Math.min(1, t / 0.002) * Math.exp(-t / decay);
      const tine = Math.sin(TAU * pt) * Math.exp(-t / 0.018) * 0.12 * Math.min(1, t / 0.0005);
      ch[i] = Math.sin(TAU * pc + I * Math.sin(TAU * pc)) * env + tine;
    }
  });
  return fade(out, 0.2, 40);
}

function bell({freq, len = 1.6, ratio = 3.5, index = 2, idxDecay = 0.15, decay = 0.5, detune = 3, partial = 0.2}) {
  const n = sec(len);
  const out = stereo(n);
  [out.L, out.R].forEach((ch, ci) => {
    const fc = freq * 2 ** (((ci ? 1 : -1) * detune) / 1200);
    let pc = 0;
    let pm = 0;
    let pp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      pc += fc / SR;
      pm += (fc * ratio) / SR;
      pp += (fc * 2.76) / SR;
      const I = index * Math.exp(-t / idxDecay);
      const env = Math.min(1, t / 0.0008) * Math.exp(-t / decay);
      ch[i] = (Math.sin(TAU * pc + I * Math.sin(TAU * pm)) + partial * Math.sin(TAU * pp) * Math.exp(-t / (decay * 0.35))) * env;
    }
  });
  return fade(out, 0.1, 30);
}

function blip({freq, len = 0.16, decay = 0.045, glide = 0.07, harm = 0.3, attack = 0.0015}) {
  const n = sec(len);
  const out = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    ph += (freq * (1 - glide * Math.exp(-t / 0.012))) / SR;
    out[i] = (Math.sin(TAU * ph) + harm * Math.sin(2 * TAU * ph)) * Math.min(1, t / attack) * Math.exp(-t / decay);
  }
  return fade(out, 0.1, 10);
}

// Fast ascending bell arpeggio, panned along its run (sparkles, shimmer sweeps).
function arp({notes, step = 0.03, decay = 0.25, panFrom = 0, panTo = 0, index = 0.4}) {
  const n = sec(step * notes.length + decay * 5);
  const out = stereo(n);
  notes.forEach((f, k) => {
    const s0 = sec(step * k);
    const th = ((lerp(panFrom, panTo, k / Math.max(1, notes.length - 1)) + 1) * Math.PI) / 4;
    const gl = Math.SQRT2 * Math.cos(th);
    const gr = Math.SQRT2 * Math.sin(th);
    let ph = 0;
    for (let i = 0; s0 + i < n; i++) {
      const t = i / SR;
      ph += f / SR;
      const v = Math.sin(TAU * ph + index * Math.exp(-t / 0.05) * Math.sin(TAU * ph * 3.01)) * Math.min(1, t / 0.0008) * Math.exp(-t / decay);
      out.L[s0 + i] += v * gl;
      out.R[s0 + i] += v * gr;
    }
  });
  return fade(out, 0.1, 20);
}

// Poisson cloud of tiny sine grains; `rate(x)` = grains/s over normalized time.
function grains({seed = 'grains', len, rate, notes, dur = [0.03, 0.09], spread = 0.85, sharp = 0.5}) {
  const n = sec(len);
  const out = stereo(n);
  const r = rng(seed);
  for (let t = 0; ; ) {
    t += -Math.log(1 - r()) / Math.max(1e-3, rate(t / len));
    if (t >= len) break;
    const f = notes[Math.floor(r() * notes.length)] * 2 ** ((bi(r) * 4) / 1200);
    const m = sec(between(r, dur[0], dur[1]));
    const a = between(r, 0.35, 1);
    const th = ((bi(r) * spread + 1) * Math.PI) / 4;
    const gl = Math.SQRT2 * Math.cos(th) * a;
    const gr = Math.SQRT2 * Math.sin(th) * a;
    const percussive = r() < sharp;
    const s0 = sec(t);
    for (let i = 0; i < m && s0 + i < n; i++) {
      const u = i / m;
      const w = percussive ? Math.min(1, i / (SR * 0.002)) * (1 - u) ** 3 : Math.sin(Math.PI * u) ** 2;
      const v = Math.sin((TAU * f * i) / SR) * w;
      out.L[s0 + i] += v * gl;
      out.R[s0 + i] += v * gr;
    }
  }
  return fade(out, 1, 10);
}

// Mechanical key: bright switch tick + modal "thock" body excited at bottom-out (+ stabilizer rattle, Enter thunk).
const KEYS = {
  key: {len: 0.09, click: [3800, 5200], bottom: [0.0055, 0.0085], modes: [[1900, 2400, 9, 0.55], [3000, 3600, 11, 0.3], [420, 520, 7, 0.7]], mix: [0.8, 1, 0], rattle: 0},
  space: {len: 0.16, click: [3000, 4000], bottom: [0.008, 0.011], modes: [[1100, 1400, 8, 0.5], [2300, 2700, 10, 0.25], [190, 230, 9, 1]], mix: [0.55, 1, 0], rattle: 0.5},
  enter: {len: 0.26, click: [3200, 4200], bottom: [0.009, 0.012], modes: [[900, 1100, 7, 0.6], [2000, 2400, 9, 0.3], [140, 170, 10, 1]], mix: [0.6, 1, 0.8], rattle: 0.35},
  soft: {len: 0.05, click: [4200, 6000], bottom: [0.004, 0.006], modes: [[2600, 3400, 8, 1]], mix: [1, 0.35, 0], rattle: 0},
};
function keyClick({seed, kind = 'key'}) {
  const spec = KEYS[kind];
  const r = rng(seed);
  const n = sec(spec.len);
  const parts = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  const cbp = new SVF(between(r, ...spec.click), 1.3);
  const modes = spec.modes.map(([lo, hi, q, g]) => ({f: new SVF(between(r, lo, hi), q), g}));
  const tb = between(r, ...spec.bottom);
  const burst = (t, t0, w) => (t >= t0 && t < t0 + w ? bi(r) * (1 - (t - t0) / w) : 0);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const e1 = burst(t, 0, 0.0007);
    const e2 = burst(t, tb, 0.0011) + burst(t, tb + 0.013, 0.0009) * spec.rattle;
    parts[0][i] = cbp.bp(e1 + e2 * 0.3);
    let b = 0;
    for (const m of modes) b += m.f.res(e1 * 0.3 + e2) * m.g;
    parts[1][i] = b;
    if (t >= tb) {
      ph += 82 / SR;
      parts[2][i] = Math.sin(TAU * ph) * Math.exp(-(t - tb) / 0.045) * Math.min(1, (t - tb) / 0.002);
    }
  }
  const out = new Float32Array(n);
  parts.forEach((p, k) => {
    normalize(p);
    for (let i = 0; i < n; i++) out[i] += p[i] * spec.mix[k];
  });
  return fade(normalize(out), 0.05, 6);
}

function bubblePop() {
  const n = sec(0.4);
  const out = new Float32Array(n);
  const r = rng('pop');
  const cl = new SVF(2600, 1.2);
  let p1 = 0;
  let p2 = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    p1 += (240 + 980 * (1 - Math.exp(-t / 0.016))) / SR;
    const main = Math.sin(TAU * p1) * Math.min(1, t / 0.0008) * Math.exp(-t / 0.05);
    const wt = t - 0.03;
    let wob = 0;
    if (wt > 0) {
      p2 += (760 * (1 + 0.07 * Math.sin(TAU * 13 * wt) * Math.exp(-wt / 0.12))) / SR;
      wob = Math.sin(TAU * p2) * smoothstep(wt / 0.01) * Math.exp(-wt / 0.08) * 0.32;
    }
    const click = cl.bp(t < 0.001 ? bi(r) : 0) * 0.6;
    out[i] = Math.tanh((main + wob + click) * 1.3);
  }
  return fade(out, 0.05, 10);
}

// Letter slam: tuned boom + saturated body + steel-plate partials + noise crack.
function slam({freq, seed}) {
  const n = sec(1.1);
  const out = stereo(n);
  [out.L, out.R].forEach((ch, ci) => {
    const r = rng(`${seed}:${ci}`);
    const nb = new SVF(1900, 0.9);
    const nh = new SVF(5000, 0.7);
    const modes = [1, 1.47, 2.09, 2.56, 3.1].map((m) => ({f: freq * 6 * m * (1 + bi(r) * 0.004), g: 0.6 / (1 + m), p: 0}));
    let pb = 0;
    let pd = 0;
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      pb += (freq * 0.5 * (1 + 1.2 * Math.exp(-t / 0.025))) / SR;
      pd += (freq * (1 + 0.5 * Math.exp(-t / 0.01))) / SR;
      const boom = Math.sin(TAU * pb) * Math.exp(-t / 0.17) * 0.8;
      const body = Math.tanh(Math.sin(TAU * pd) * 3) * Math.exp(-t / 0.075) * 0.55;
      let metal = 0;
      for (const m of modes) {
        m.p += m.f / SR;
        metal += Math.sin(TAU * m.p) * m.g;
      }
      const v = bi(r);
      const crack = nb.bp(v) * Math.exp(-t / 0.008) * 1.1 + nh.hp(v) * Math.exp(-t / 0.02) * 0.35;
      ch[i] = Math.tanh((boom + body + metal * Math.exp(-t / 0.06) * 0.5 + crack) * 1.2);
    }
  });
  return fade(out, 0.02, 30);
}

function impactNoise({seed = 'impact', decay = 0.12, cut = 1400} = {}) {
  const n = sec(decay * 6);
  const out = stereo(n);
  [out.L, out.R].forEach((ch, ci) => {
    const r = rng(`${seed}:${ci}`);
    const lp = new SVF(cut, 0.8);
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      if ((i & 15) === 0) lp.set(200 + cut * Math.exp(-t / (decay * 1.5)), 0.8);
      ch[i] = Math.tanh(lp.lp(bi(r)) * 2.5) * Math.exp(-t / decay);
    }
  });
  return fade(out, 0.05, 20);
}

function drone(frames) {
  const n = sec(frames / FPS);
  const out = stereo(n);
  const voices = [
    [hz('A1'), 1],
    [hz('A2'), 0.6],
    [hz('E2'), 0.5],
    [hz('E3'), 0.18],
  ];
  const subHz = hz('A1');
  [out.L, out.R].forEach((ch, ci) => {
    const r = rng(`drone:${ci}`);
    const saws = voices.map(() => [new Saw(r()), new Saw(r())]);
    const lp = new SVF(200, 1.1);
    const air = new SVF(2400, 3);
    let sub = 0;
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const frame = t * FPS;
      const open = smoothstep((frame - 160) / 45);
      if ((i & 31) === 0) lp.set((190 + 70 * Math.sin(TAU * 0.11 * t + ci)) * (1 + 3.5 * open), 1.1);
      let s = 0;
      for (let v = 0; v < voices.length; v++) {
        const [f, a] = voices[v];
        s += (saws[v][0].tick(f * 1.0025) + saws[v][1].tick(f * 0.9975)) * a;
      }
      sub += subHz / SR;
      const amp = smoothstep(frame / 110) * (1 + 0.3 * open);
      ch[i] = (lp.lp(s * 0.35) + Math.sin(TAU * sub) * 0.28 + air.bp(bi(r)) * 0.03 * (1 + Math.sin(TAU * 0.07 * t))) * amp;
    }
  });
  return fade(out, 5, 2);
}

function progressTone(frames) {
  const n = sec(frames / FPS);
  const out = stereo(n);
  [out.L, out.R].forEach((ch, ci) => {
    const p = new Pulse(ci * 0.25);
    const lp = new SVF(2000, 0.9);
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const x = i / n;
      const f = expLerp(hz('A3'), hz('A5'), x ** 1.6) * (1 + 0.004 * Math.sin((TAU * 6 * i) / SR));
      if ((i & 15) === 0) lp.set(f * 3, 0.9);
      ph += f / SR;
      ch[i] = (lp.lp(p.tick(f, 0.3)) * 0.35 + Math.sin(TAU * ph) * 0.65) * lerp(0.25, 1, x ** 1.2);
    }
  });
  return fade(out, 4, 4);
}

function penHiss(frames) {
  const n = sec(frames / FPS);
  const out = stereo(n);
  [out.L, out.R].forEach((ch, ci) => {
    const r = rng(`pen:${ci}`);
    const bp = new SVF(5000, 2.2);
    const slow = new OnePole(6);
    for (let i = 0; i < n; i++) {
      const x = i / n;
      if ((i & 63) === 0) bp.set(4200 + 1800 * Math.sin((TAU * 0.9 * i) / SR + ci), 2.2);
      const scribble = 0.5 + 0.5 * Math.tanh(slow.lp(bi(r)) * 40);
      ch[i] = bp.bp(bi(r)) * scribble * smoothstep(x / 0.12) * smoothstep((1 - x) / 0.15);
    }
  });
  return out;
}

// Digital corruption: segments of bit-crushed, sample-held stutter / square / noise, hard-panned at random.
function glitchBurst({seed, frames, src, from}) {
  const r = rng(seed);
  const n = sec(frames / FPS);
  const out = stereo(n);
  const tones = chord('A3 E4 A4 C5 E5 A5 C6 E6');
  for (let i = 0; i < n; ) {
    const m = Math.min(n - i, sec(i === 0 ? 0.009 : between(r, 0.004, 0.012)));
    const mode = i === 0 ? 0.5 : r();
    const hold = 1 + Math.floor(r() * 8);
    const levels = 2 ** (2 + Math.floor(r() * 4));
    const pan = i === 0 ? 0 : bi(r) * 0.7;
    const amp = i === 0 ? 1 : between(r, 0.45, 1);
    const f = tones[Math.floor(r() * tones.length)];
    const slice = sec(between(r, 0.0025, 0.008));
    let held = 0;
    for (let k = 0; k < m; k++) {
      if (k % hold === 0) {
        let v;
        if (mode < 0.4) {
          const j = from - slice + (k % slice);
          v = (src.L[j] + src.R[j]) * 2.2;
        } else if (mode < 0.75) v = ((k * f) / SR) % 1 < 0.5 ? 0.5 : -0.5;
        else v = bi(r) * 0.45;
        held = Math.round(clamp(v, -1, 1) * levels) / levels;
      }
      const e = Math.min(1, k / 16, (m - 1 - k) / 16) * amp * held * (1 - 0.45 * ((i + k) / n));
      out.L[i + k] = e * (1 - pan);
      out.R[i + k] = e * (1 + pan);
    }
    i += m;
  }
  return fade(out, 0.2, 1);
}

function powerDown(frames) {
  const n = sec(frames / FPS);
  const out = stereo(n);
  let ph = 0;
  let held = 0;
  for (let i = 0; i < n; i++) {
    const x = i / n;
    ph += expLerp(1500, 40, x ** 0.6) / SR;
    const hold = 1 + Math.floor(x * x * 30);
    if (i % hold === 0) held = Math.round((((ph % 1) * 2 - 1) * 0.6 + Math.sin(TAU * ph * 0.5) * 0.4) * 8) / 8;
    out.L[i] = out.R[i] = held * (1 - 0.5 * x);
  }
  return fade(out, 0.2, 3);
}

// ─── mixer ───────────────────────────────────────────────────────────────────
const sendPair = () => ({hall: new Float32Array(N), room: new Float32Array(N)});
const track = (sends) => ({L: new Float32Array(N), R: new Float32Array(N), sends});

const bootSends = sendPair();
const buildSends = sendPair();
const mainSends = sendPair();
const BOOT = track(bootSends);
const BUILD = track(buildSends);
const DRUMS = track(mainSends);
const BASS = track(mainSends);
const MUSIC = track(mainSends);
const FX = track(mainSends);
const ducks = [];

// Place a signal at a (possibly fractional) frame. Pan law is +3 dB at the sides so centered sounds keep unity.
function play(trk, frame, sig, {gain = 1, pan = 0, hall = 0, room = 0} = {}) {
  const [L, R = L] = channels(sig);
  const start = at(frame);
  const n = L.length;
  const moving = typeof pan === 'function';
  let gl = gain;
  let gr = gain;
  const aim = (p) => {
    const th = ((clamp(p, -1, 1) + 1) * Math.PI) / 4;
    gl = Math.SQRT2 * Math.cos(th) * gain;
    gr = Math.SQRT2 * Math.sin(th) * gain;
  };
  aim(moving ? pan(0) : pan);
  for (let i = Math.max(0, -start); i < n && start + i < N; i++) {
    if (moving && (i & 31) === 0) aim(pan(i / n));
    const j = start + i;
    trk.L[j] += L[i] * gl;
    trk.R[j] += R[i] * gr;
    if (hall || room) {
      const m = (L[i] + R[i]) * 0.5 * gain;
      trk.sends.hall[j] += m * hall;
      trk.sends.room[j] += m * room;
    }
  }
}

// Sidechain gain curve from the kick/impact list (starts 3 ms early so the kick lands in a clean hole).
function pump(depth, release) {
  const g = new Float32Array(N).fill(1);
  const pre = sec(0.003);
  const hold = sec(0.012);
  for (const {s, amt, rel = release} of ducks) {
    const r = sec(rel);
    for (let i = -pre; i < hold + r; i++) {
      const j = s + i;
      if (j < 0 || j >= N) continue;
      const e = i < 0 ? (i + pre) / pre : i < hold ? 1 : 0.5 * (1 + Math.cos((Math.PI * (i - hold)) / r));
      g[j] = Math.min(g[j], 1 - depth * amt * e);
    }
  }
  return g;
}

function reverbOf(sends, fromFrame, toFrame) {
  const out = stereo(N);
  const s0 = at(fromFrame);
  const s1 = Math.min(N, at(toFrame));
  for (const [send, ir] of [
    [sends.hall, HALL],
    [sends.room, ROOM],
  ]) {
    const wet = convolve(send, s0, s1, ir);
    for (let i = 0; i < wet.L.length && s0 + i < N; i++) {
      out.L[s0 + i] += wet.L[i];
      out.R[s0 + i] += wet.R[i];
    }
  }
  return out;
}

function mixInto(dst, src, gainAt = null) {
  for (let i = 0; i < N; i++) {
    const g = gainAt ? gainAt(i) : 1;
    if (g === 0) continue;
    dst.L[i] += src.L[i] * g;
    dst.R[i] += src.R[i] * g;
  }
}

// Silence [from, to) with a short fade-out ending exactly at `from`.
function mute(bufs, fromFrame, toFrame, fadeMs = 1) {
  const a = at(fromFrame);
  const b = Math.min(N, at(toFrame));
  const f = sec(fadeMs / 1000);
  for (const ch of bufs) {
    for (let i = 0; i < f; i++) ch[a - f + i] *= Math.cos((Math.PI / 2) * ((i + 1) / f)) ** 2;
    ch.fill(0, a, b);
  }
}

// ─── score: BOOT 0-239 ───────────────────────────────────────────────────────
function scoreBoot() {
  play(BOOT, 0, drone(232), {gain: db(-20), hall: 0.12});
  play(BOOT, 14, blip({freq: hz('A5'), len: 0.12, decay: 0.03, harm: 0.1}), {gain: db(-30), hall: 0.25});
  [20, 21.5, 23].forEach((f, i) => play(BOOT, f, keyClick({seed: `prompt${i}`, kind: 'soft'}), {gain: db(-31), pan: -0.2 + i * 0.05}));

  const keys = [36, 41, 45, 50, 54, 59, 66, 72, 77, 81, 86, 90];
  keys.forEach((f, i) => {
    const r = rng(`keyvar${i}`);
    const kind = f === 66 ? 'space' : 'key';
    play(BOOT, f + bi(r) * 0.03, keyClick({seed: `key${i}`, kind}), {gain: db(kind === 'space' ? -14 : -15) * between(r, 0.8, 1.1), pan: bi(r) * 0.25 - 0.1, room: 0.22, hall: 0.05});
  });
  play(BOOT, 110, keyClick({seed: 'enter', kind: 'enter'}), {gain: db(-11), room: 0.3, hall: 0.1});

  ['A5', 'C6', 'E6'].forEach((note, i) => {
    const f = [122, 137, 152][i];
    play(BOOT, f, blip({freq: hz(note)}), {gain: db(-18), pan: -0.15 + i * 0.1, hall: 0.25, room: 0.1});
    play(BOOT, f, whoosh({seed: `scan${i}`, len: 0.09, peak: 0.12, f0: 3000, f1: 9000, f2: 5000, q: 1.2, rise: 1, fall: 1.5, body: 0}), {gain: db(-30), pan: (x) => lerp(-0.6, 0.6, x)});
  });

  play(BOOT, 167, progressTone(38), {gain: db(-24), hall: 0.15});
  const blocks = [179, 184, 188, 191, 194, 196, 199, 201, 203];
  const climb = chord('A4 C5 D5 E5 G5 A5 C6 D6 E6');
  blocks.forEach((f, i) => play(BOOT, f, blip({freq: climb[i], len: 0.07, decay: 0.018, harm: 0.4, glide: 0.03}), {gain: db(-22), pan: lerp(-0.35, 0.35, i / 8), hall: 0.2}));
  play(BOOT, 205, bell({freq: hz('A6'), ratio: 3.5, index: 1.6, idxDecay: 0.09, decay: 0.45, len: 1.2}), {gain: db(-14), hall: 0.45});
  play(BOOT, 205, bell({freq: hz('E7'), ratio: 2, index: 0.6, idxDecay: 0.05, decay: 0.3, len: 1}), {gain: db(-24), hall: 0.3});

  const wet = reverbOf(bootSends, 0, 232);
  mixInto(BOOT, wet);

  // 208-231: the whole boot mix degrades (crush + hold), the bursts replace it outright.
  const a = at(208);
  const b = at(232);
  for (const ch of [BOOT.L, BOOT.R]) {
    let held = 0;
    for (let i = a; i < b; i++) {
      if ((i - a) % 3 === 0) held = Math.round(ch[i] * 64) / 64;
      ch[i] = lerp(ch[i], held, 0.7) * 0.5;
    }
  }
  const bursts = [
    {frame: 208, frames: 3.2},
    {frame: 214, frames: 3},
    {frame: 219, frames: 3},
    {frame: 224, frames: 2.6},
    {frame: 228, frames: 4, final: true},
  ];
  for (const {frame, frames, final} of bursts) {
    const s0 = at(frame);
    const g = final ? powerDown(frames) : glitchBurst({seed: `glitch${frame}`, frames, src: BOOT, from: s0});
    const n = g.L.length;
    const gain = db(final ? -11 : -7);
    for (let i = 0; i < n && s0 + i < N; i++) {
      const m = final ? Math.min(1, i / 24) : Math.min(1, i / 24, (n - 1 - i) / 24);
      BOOT.L[s0 + i] = BOOT.L[s0 + i] * (1 - m) + g.L[i] * gain * m;
      BOOT.R[s0 + i] = BOOT.R[s0 + i] * (1 - m) + g.R[i] * gain * m;
    }
  }
  mute([BOOT.L, BOOT.R], 232, 1440);
}

// ─── score: BUILD 240-479 ────────────────────────────────────────────────────
function scoreBuild() {
  play(BUILD, 240, whoosh({seed: 'in', len: 1.1, peak: 0.12, f0: 250, f1: 2600, f2: 380, q: 1.1, rise: 1.4, fall: 1.8, body: 0.5}), {gain: db(-15), hall: 0.35});
  grid(240, 450).forEach((f, k) => play(BUILD, f, subBoom({f0: 78, f1: 44, sweep: 0.05, decay: 0.16, drive: 2.2}), {gain: db(lerp(-18, -6, (k / 7) ** 1.2))}));

  const padCut = (x) => {
    const frame = 240 + x * 228;
    return frame < 450 ? expLerp(320, 2600, smoothstep((frame - 240) / 210)) : expLerp(2600, 500, (frame - 450) / 18);
  };
  play(BUILD, 240, chorus(pad({notes: chord('A2 E3 A3 B3 C4'), len: 228 / FPS, attack: 1.6, release: 0.02, cutoff: padCut, q: 1, seed: 'buildpad'})), {gain: db(-21), hall: 0.3});
  play(BUILD, 240, grains({seed: 'draw', len: 2.5, rate: (x) => 25 + 95 * Math.sin(Math.PI * x) ** 1.5, notes: chord('A5 C6 D6 E6 G6 A6 C7 E7'), dur: [0.025, 0.08], sharp: 0.45}), {gain: db(-21), hall: 0.5});
  play(BUILD, 240, penHiss(150), {gain: db(-34), hall: 0.2});

  const roll = [360, 375, 390, 405, 420, 427.5, 435, 442.5, 450, 453.75, 457.5, 461.25, 465];
  roll.forEach((f, i) => {
    const x = i / (roll.length - 1);
    const decay = f < 420 ? 0.12 : f < 450 ? 0.09 : 0.06;
    play(BUILD, f, snare({seed: `roll${i}`, pitch: 185 * 2 ** ((x * 5) / 12), decay, bright: lerp(1, 1.2, x)}), {gain: db(lerp(-16, -9, x ** 0.9)), room: 0.2, hall: 0.12});
  });
  const rollGate = (x) => {
    const frame = 360 + x * 108;
    const step = frame < 420 ? 15 : frame < 450 ? 7.5 : 3.75;
    const ph = ((frame - 360) % step) / step;
    return lerp(1, 0.55 + 0.45 * Math.exp(-ph * 4), smoothstep((frame - 380) / 40));
  };
  play(BUILD, 360, riser({seed: 'riser1', len: 108 / FPS, from: hz('A2'), to: hz('A4'), nFrom: 300, nTo: 9000, curve: 2.2, gate: rollGate}), {gain: db(-10), hall: 0.1});

  const rev = reverse(crash({seed: 'revcym', len: 1.15, decay: 0.45}));
  play(BUILD, 468 - rev.L.length / SPF, rev, {gain: db(-11), hall: 0.1});

  mute([BUILD.L, BUILD.R, buildSends.hall, buildSends.room], 468, 1440, 1.5);
  const wet = reverbOf(buildSends, 240, 468);
  const t0 = at(468);
  const t1 = at(472);
  mixInto(BUILD, wet, (i) => (i < t0 ? 1 : i >= t1 ? 0 : Math.cos((Math.PI / 2) * ((i - t0) / (t1 - t0))) ** 3));
}

// ─── score: REVEAL / TYPE / POP / FINALE 480-1439 ───────────────────────────
function scoreGroove() {
  const KICK = kick({seed: 'kick'});
  const SOFT_KICK = kick({seed: 'kick-soft', punch: 0.45, decay: 0.24, click: 0.35, drive: 1.3, knock: 120});
  grid(480, 1170).forEach((f) => {
    play(DRUMS, f, KICK, {gain: db(-6)});
    ducks.push({s: at(f), amt: 1});
  });
  grid(1230, 1350).forEach((f) => {
    play(DRUMS, f, SOFT_KICK, {gain: db(-11)});
    ducks.push({s: at(f), amt: 0.6});
  });

  [510, 570, 630, 690, 750, 810, 990, 1050, 1110, 1170].forEach((f) => play(DRUMS, f, clap({seed: `clap${f}`}), {gain: db(-11), room: 0.3, hall: 0.06}));

  const open = [0, 1, 2, 3].map((k) => hat({seed: `oh${k}`, decay: 0.085}));
  const closed = [0, 1, 2, 3].map((k) => hat({seed: `ch${k}`, decay: 0.016}));
  let h = 0;
  for (const b of grid(480, 1170)) {
    const sparse = b >= 840 && b < 960;
    play(DRUMS, b + 15, sparse ? closed[h++ % 4] : open[h++ % 4], {gain: db(sparse ? -21 : -17), pan: 0.15, room: 0.1});
    if (!sparse) for (const o of [7.5, 22.5]) play(DRUMS, b + o, closed[h++ % 4], {gain: db(-23), pan: -0.2});
  }
  for (const b of grid(1200, 1350)) play(DRUMS, b + 15, closed[h++ % 4], {gain: db(-27), pan: 0.2, room: 0.15});

  const sub = (from, to, root, g) => play(BASS, from, bassNote({freq: root, len: (to - from) / FPS, cut: 90, mid: 0.12, attack: 0.03, release: 0.08, drive: 1.3, seed: `sub${from}`}), {gain: db(g)});
  const bounce = (from, to, root) => {
    for (const b of grid(from, to - 1)) {
      play(BASS, b + 15, bassNote({freq: root, octave: 2, len: 0.2, cut: 1500, cutDecay: 0.07, sub: 0.5, mid: 0.95, seed: `bn${b}`}), {gain: db(-12)});
      if ((b - 480) % 120 === 90 && b + 22.5 < to) play(BASS, b + 22.5, bassNote({freq: root * 2, octave: 2, len: 0.1, cut: 1800, sub: 0.5, mid: 0.8, seed: `bp${b}`}), {gain: db(-15)});
    }
  };
  bounce(480, 600, hz('A1'));
  bounce(600, 720, hz('F1'));
  bounce(720, 840, hz('C2'));
  bounce(960, 1050, hz('A1'));
  bounce(1080, 1140, hz('F1'));
  bounce(1140, 1200, hz('G1'));
  sub(840, 960, hz('G1'), -17);
  sub(1200, 1320, hz('F1'), -20);
  sub(1320, 1395, hz('C2'), -20);

  [
    [480, 'A3 C4 E4'],
    [600, 'A3 C4 F4'],
    [720, 'G3 C4 E4'],
  ].forEach(([f, notes]) => play(MUSIC, f, chorus(pad({notes: chord(notes), len: 2.15, attack: 0.05, release: 0.25, cutoff: () => 1400, seed: `rpad${f}`})), {gain: db(-25), hall: 0.25}));
  play(MUSIC, 960, chorus(pad({notes: chord('A3 C4 E4 A4'), len: 2, attack: 0.05, release: 0.05, cutoff: (x) => expLerp(900, 4500, x ** 2), seed: 'tpad'})), {gain: db(-24), hall: 0.25});

  const motif = {480: 'A4 C5 E5 A5 E5 C5 A4 C5', 600: 'A4 C5 F5 A5 F5 C5 A4 C5', 720: 'G4 C5 E5 G5 E5 C5 G4 C5', 960: 'A4 C5 E5 A5 E5 C5'};
  for (const [bar, line] of Object.entries(motif)) {
    chord(line).forEach((freq, k) => {
      const f = Number(bar) + k * 15;
      play(MUSIC, f, pluck({freq, seed: `pl${f}`}), {gain: db(k % 2 ? -24 : -21), pan: k % 2 ? 0.3 : -0.3, hall: 0.18, room: 0.1});
    });
  }
}

function scoreReveal() {
  play(DRUMS, 480, kick({seed: 'dropkick', punch: 1.5, decay: 0.3, drive: 2.6, knock: 200}), {gain: db(-4)});
  play(DRUMS, 480, subBoom({f0: 130, f1: 33, sweep: 0.12, decay: 0.5, drive: 1.6}), {gain: db(-5)});
  play(FX, 480, impactNoise({seed: 'drop', decay: 0.16, cut: 2200}), {gain: db(-8), hall: 0.4});
  play(DRUMS, 480, crash({seed: 'dropcrash', len: 3.2, decay: 1.1}), {gain: db(-10), hall: 0.5});
  play(FX, 480, stab({notes: chord('A2 E3 A3 C4 E4 A4'), len: 1.6, decay: 0.38, cut: 7000, cutDecay: 0.15, seed: 'dropstab'}), {gain: db(-10), hall: 0.6});
  play(FX, 480, whoosh({seed: 'shock', len: 0.9, peak: 0.04, f0: 9000, f1: 7000, f2: 300, rise: 1, fall: 2.2, body: 0.3}), {gain: db(-15), hall: 0.3});
  ducks.push({s: at(480), amt: 1, rel: 0.55});

  play(FX, 600, bubblePop(), {gain: db(-8), pan: 0.25, room: 0.2, hall: 0.1});
  play(FX, 612, whoosh({seed: 'spin', len: 0.5, peak: 0.12, f0: 700, f1: 3800, f2: 900, q: 1.6, rise: 1.2, fall: 1.4, flutter: [16, 4]}), {gain: db(-12), pan: 0.25, hall: 0.2});
  play(FX, 612, grains({seed: 'spark612', len: 0.6, rate: (x) => 120 * (1 - x) ** 2, notes: chord('C7 F7 A7 C8'), dur: [0.015, 0.05], sharp: 0.8}), {gain: db(-22), pan: 0.25, hall: 0.4});
  play(FX, 630, arp({notes: chord('C6 F6 A6 C7 F7'), step: 0.028, decay: 0.3}), {gain: db(-15), pan: 0.25, hall: 0.45});
  play(FX, 660, whoosh({seed: 'push', len: 0.9, peak: 0.22, f0: 300, f1: 2600, f2: 500, q: 1.1, rise: 1.4, fall: 1.6, body: 0.5, flutter: [3, 9]}), {gain: db(-11), hall: 0.25});

  [
    [720, 'C6', -0.15],
    [750, 'E6', -0.1],
    [780, 'G6', 0.25],
  ].forEach(([f, note, pan]) => {
    play(FX, f, blip({freq: hz(note), len: 0.14, decay: 0.04, harm: 0.35}), {gain: db(-14), pan, hall: 0.2, room: 0.1});
    play(FX, f + 3, whoosh({seed: `zip${f}`, len: 0.13, peak: 0.6, f0: 1800, f1: 7000, f2: 5000, q: 1.4, rise: 1.5, fall: 1, body: 0}), {gain: db(-24), pan: pan + 0.2});
    const r = rng(`typing${f}`);
    for (let k = 0; k < 10; k++) play(FX, f + 11 + k, keyClick({seed: `co${f}:${k}`, kind: 'soft'}), {gain: db(-27) * between(r, 0.7, 1.1), pan: pan + 0.3, room: 0.1});
  });

  play(FX, 822, whoosh({seed: 'whip', len: 0.48, peak: 0.62, f0: 350, f1: 5200, f2: 900, q: 1.2, rise: 2.6, fall: 1.2, body: 0.6}), {gain: db(-11), pan: (x) => lerp(0.85, -0.85, smoothstep(x / 0.75)), hall: 0.15});
}

function scoreType() {
  play(DRUMS, 840, kick({seed: 'landkick', punch: 1.3, decay: 0.16, drive: 2.2}), {gain: db(-8)});
  play(DRUMS, 840, snare({seed: 'landsnap', pitch: 230, decay: 0.09, toneDecay: 0.04, bright: 1.2}), {gain: db(-10), room: 0.35, hall: 0.15});
  play(DRUMS, 840, subBoom({f0: 100, f1: 40, sweep: 0.06, decay: 0.2}), {gain: db(-15)});
  play(FX, 840, impactNoise({seed: 'land', decay: 0.07, cut: 3000}), {gain: db(-14), hall: 0.2});

  ['G2', 'A2', 'B2', 'D3', 'E3'].forEach((note, i) => {
    const f = 870 + i * 15;
    play(DRUMS, f, slam({freq: hz(note), seed: `slam${i}`}), {gain: db(-11 + i * 0.4), room: 0.3, hall: 0.2});
    ducks.push({s: at(f), amt: 0.9});
  });

  play(DRUMS, 960, kick({seed: 'bigkick', punch: 1.4, decay: 0.18, drive: 2.4}), {gain: db(-7)});
  play(DRUMS, 960, subBoom({f0: 120, f1: 35, sweep: 0.1, decay: 0.28}), {gain: db(-13)});
  play(DRUMS, 960, crash({seed: 'bigcrash', len: 2.6, decay: 0.9}), {gain: db(-13), hall: 0.4});
  play(FX, 960, impactNoise({seed: 'big', decay: 0.11, cut: 2000}), {gain: db(-13), hall: 0.3});
  play(FX, 960, stab({notes: chord('A2 E3 A3 C4 E4'), len: 1.2, decay: 0.3, cut: 6000, cutDecay: 0.12, seed: 'bigstab'}), {gain: db(-14), hall: 0.5});
  play(FX, 960, whoosh({seed: 'rise960', len: 0.5, peak: 0.25, f0: 250, f1: 3000, f2: 1500, rise: 1, fall: 1.5}), {gain: db(-16)});
  ducks.push({s: at(960), amt: 1, rel: 0.4});

  play(FX, 1020, riser({seed: 'riser2', len: 58 / FPS, from: hz('E3'), to: hz('E5'), nFrom: 500, nTo: 10000, curve: 2}), {gain: db(-9), hall: 0.15});
  [1050, 1057.5, 1065, 1072.5].forEach((f, i) => play(DRUMS, f, snare({seed: `fill${i}`, pitch: 190 * 2 ** (i / 12), decay: 0.09}), {gain: db(-14 + i * 2.2), room: 0.25, hall: 0.1}));
}

function scorePop() {
  play(DRUMS, 1080, crash({seed: 'popcrash', len: 2.4, decay: 0.8}), {gain: db(-10), hall: 0.35});
  play(DRUMS, 1080, subBoom({f0: 110, f1: 40, sweep: 0.08, decay: 0.25}), {gain: db(-11)});
  const F = chord('F3 A3 C4 F4 A4');
  const G = chord('G3 B3 D4 G4 B4');
  grid(1080, 1185, 15).forEach((f, k) => play(FX, f, stab({notes: f < 1140 ? F : G, seed: `stab${f}`}), {gain: db(k % 2 ? -16 : -14), hall: 0.15, room: 0.15}));
  play(FX, 1110, whoosh({seed: 'swish1', len: 0.3, peak: 0.25, f0: 1500, f1: 7500, f2: 2500, q: 1.3, rise: 1.3, fall: 1.4, body: 0.2}), {gain: db(-14), pan: (x) => lerp(-0.7, 0.7, x)});
  play(FX, 1140, whoosh({seed: 'swish2', len: 0.3, peak: 0.25, f0: 1500, f1: 7500, f2: 2500, q: 1.3, rise: 1.3, fall: 1.4, body: 0.2}), {gain: db(-14), pan: (x) => lerp(0.7, -0.7, x)});
  play(FX, 1170, whoosh({seed: 'zoom', len: 0.5, peak: 0.97, f0: 300, f1: 6000, f2: 6000, q: 1, rise: 2.2, fall: 1, body: 0.5}), {gain: db(-9), hall: 0.1});
  play(FX, 1170, riser({seed: 'zoomtone', len: 0.5, from: hz('C4'), to: hz('C6'), synth: 0.8, curve: 1.6}), {gain: db(-17)});
}

function scoreFinale() {
  play(DRUMS, 1200, kick({seed: 'warmkick', punch: 0.5, decay: 0.24, click: 0.4, drive: 1.3, knock: 130}), {gain: db(-7)});
  ducks.push({s: at(1200), amt: 0.8, rel: 0.35});
  play(DRUMS, 1200, subBoom({f0: 85, f1: 38, sweep: 0.09, decay: 0.45, drive: 1.2}), {gain: db(-12)});
  play(DRUMS, 1200, crash({seed: 'warmcrash', len: 3, decay: 1.2, bright: 0.55}), {gain: db(-16), hall: 0.5});
  for (const freq of chord('F2 C3 A3 E4 G4')) play(FX, 1200, ep({freq, decay: 1.4}), {gain: db(-21), hall: 0.35});
  play(MUSIC, 1200, chorus(pad({notes: chord('F3 A3 C4 E4'), len: 2.3, attack: 0.9, release: 0.35, cutoff: () => 1500, seed: 'fpad'})), {gain: db(-22), hall: 0.45});
  play(MUSIC, 1320, chorus(pad({notes: chord('C3 E3 G3 B3 D4'), len: 2, attack: 0.5, release: 1.1, cutoff: () => 1700, seed: 'cpad'})), {gain: db(-22), hall: 0.45});

  ['A5', 'C6', 'E6', 'F6', 'A6'].forEach((note, i) => {
    const f = 1212 + i * 4;
    const pan = lerp(0.18, 0.8, i / 4);
    play(FX, f, blip({freq: hz(note), len: 0.1, decay: 0.022, glide: 0.02, harm: 0.15}), {gain: db(-15), pan, room: 0.2, hall: 0.25});
    play(FX, f, keyClick({seed: `wm${i}`, kind: 'soft'}), {gain: db(-21), pan});
  });
  const r = rng('tagline');
  for (let k = 0; k < 22; k++) play(FX, 1240 + Math.round((k * 50) / 22), keyClick({seed: `tag${k}`, kind: 'soft'}), {gain: db(-22) * between(r, 0.75, 1.1), pan: lerp(0.2, 0.7, k / 21), room: 0.15});

  play(FX, 1290, bell({freq: hz('E7'), ratio: 1.41, index: 1.3, idxDecay: 0.08, decay: 0.75, partial: 0.12}), {gain: db(-16), pan: -0.45, hall: 0.5});
  play(FX, 1290, grains({seed: 'glint', len: 0.35, rate: (x) => 160 * (1 - x) ** 2, notes: chord('E7 B7 E8'), dur: [0.01, 0.035], sharp: 0.9}), {gain: db(-25), pan: -0.45, hall: 0.4});

  play(FX, 1320, arp({notes: chord('C6 E6 G6 B6 D7 E7 G7 B7'), step: 0.045, decay: 0.35, panFrom: 0.1, panTo: 0.85, index: 0.25}), {gain: db(-20), hall: 0.55});
  play(FX, 1320, whoosh({seed: 'shimmer', len: 0.9, peak: 0.55, f0: 2500, f1: 9000, f2: 6000, q: 2, rise: 1.4, fall: 1.6, body: 0}), {gain: db(-28), pan: (x) => lerp(0.1, 0.85, x), hall: 0.3});
  for (const freq of chord('C3 G3 B3 E4 D5')) play(FX, 1320, ep({freq, decay: 1.3, index: 1.1}), {gain: db(-24), hall: 0.35});

  play(DRUMS, 1380, kick({seed: 'endkick', punch: 0.5, decay: 0.3, drive: 1.3, click: 0.3, tone: 48}), {gain: db(-7)});
  play(DRUMS, 1380, subBoom({f0: 75, f1: 33, sweep: 0.12, decay: 0.6, drive: 1.3}), {gain: db(-11)});
  for (const freq of chord('C2 C3 G3')) play(FX, 1380, ep({freq, decay: 1.6, index: 1.0}), {gain: db(-19), hall: 0.45});
  play(DRUMS, 1380, crash({seed: 'endcrash', len: 2.2, decay: 0.9, bright: 0.45}), {gain: db(-18), hall: 0.5});
}

// ─── master ──────────────────────────────────────────────────────────────────
// Offline look-ahead limiter: backward pass = attack before peaks, forward pass = release. Never exceeds ceiling.
function limit(L, R, ceiling, attackMs = 1.5, releaseMs = 90) {
  const g = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const p = Math.max(Math.abs(L[i]), Math.abs(R[i]));
    g[i] = p > ceiling ? ceiling / p : 1;
  }
  const a = Math.exp(-1 / ((attackMs * SR) / 1000));
  const r = Math.exp(-1 / ((releaseMs * SR) / 1000));
  for (let i = N - 2; i >= 0; i--) g[i] = Math.min(g[i], 1 - (1 - g[i + 1]) * a);
  for (let i = 1; i < N; i++) g[i] = Math.min(g[i], 1 - (1 - g[i - 1]) * r);
  for (let i = 0; i < N; i++) {
    L[i] *= g[i];
    R[i] *= g[i];
  }
  return g;
}

function render() {
  scoreBoot();
  scoreBuild();
  scoreGroove();
  scoreReveal();
  scoreType();
  scorePop();
  scoreFinale();

  const wet = reverbOf(mainSends, 480, 1440);
  const duckBass = pump(0.85, 0.17);
  const duckMusic = pump(0.45, 0.24);
  const duckWet = pump(0.3, 0.25);

  const out = stereo(N);
  mixInto(out, BOOT);
  mixInto(out, BUILD);
  mixInto(out, DRUMS);
  mixInto(out, FX);
  mixInto(out, BASS, (i) => duckBass[i]);
  mixInto(out, MUSIC, (i) => duckMusic[i]);
  mixInto(out, wet, (i) => duckWet[i]);

  const MASTER_GAIN = db(-1);
  for (const ch of [out.L, out.R]) {
    const hp = new SVF(22, 0.707);
    for (let i = 0; i < N; i++) ch[i] = hp.hp(ch[i] * MASTER_GAIN);
  }
  const gr = limit(out.L, out.R, db(-1.2));

  mute([out.L, out.R], 232, 240);
  mute([out.L, out.R], 478, 480);
  const f0 = at(1386);
  const f1 = at(1439);
  for (const ch of [out.L, out.R]) {
    for (let i = f0; i < N; i++) ch[i] *= i >= f1 ? 0 : Math.cos((Math.PI / 2) * ((i - f0) / (f1 - f0))) ** 2;
  }
  return {out, gr};
}

function writeWav(path, {L, R}) {
  const buf = Buffer.alloc(44 + N * 4);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + N * 4, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(N * 4, 40);
  const q = (x) => clamp(Math.round(x * 32767), -32768, 32767);
  for (let i = 0; i < N; i++) {
    buf.writeInt16LE(q(L[i]), 44 + i * 4);
    buf.writeInt16LE(q(R[i]), 46 + i * 4);
  }
  mkdirSync(dirname(path), {recursive: true});
  writeFileSync(path, buf);
}

function stats({L, R}, gr) {
  const span = (a, b) => {
    let s = 0;
    let p = 0;
    let g = 1;
    for (let i = at(a); i < at(b); i++) {
      s += (L[i] * L[i] + R[i] * R[i]) / 2;
      p = Math.max(p, Math.abs(L[i]), Math.abs(R[i]));
      g = Math.min(g, gr[i]);
    }
    const f = (v) => (v > 0 ? (20 * Math.log10(v)).toFixed(1) : '-inf');
    return `rms ${f(Math.sqrt(s / (at(b) - at(a))))} dBFS  peak ${f(p)} dBFS  limiter -${(-20 * Math.log10(g)).toFixed(1)} dB`;
  };
  const sections = [
    ['boot', 0, 232],
    ['build', 240, 468],
    ['drop', 480, 495],
    ['reveal', 480, 840],
    ['type', 840, 1080],
    ['pop', 1080, 1200],
    ['finale', 1200, 1440],
    ['all', 0, 1440],
  ];
  for (const [name, a, b] of sections) console.log(`${name.padEnd(7)} ${span(a, b)}`);
}

const t0 = Date.now();
const {out, gr} = render();
const path = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'edwin.wav');
writeWav(path, out);
stats(out, gr);
console.log(`wrote ${path} (${N} frames) in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
