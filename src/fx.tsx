import {noise2D} from '@remotion/noise';
import React, {useId} from 'react';
import {AbsoluteFill, Easing, interpolate, useCurrentFrame} from 'remotion';

export const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export const ease = {
  linear: Easing.linear,
  outCubic: Easing.out(Easing.cubic),
  inCubic: Easing.in(Easing.cubic),
  inOutCubic: Easing.inOut(Easing.cubic),
  outQuart: Easing.out(Easing.poly(4)),
  outExpo: Easing.out(Easing.exp),
  outBack: Easing.out(Easing.back(1.7)),
  outBackBig: Easing.out(Easing.back(3)),
  snap: Easing.bezier(0.16, 1, 0.3, 1),
} as const;

// 0 -> 1 between two frames, clamped, with easing
export const ramp = (frame: number, start: number, end: number, easing: (t: number) => number = Easing.linear) =>
  interpolate(frame, [start, end], [0, 1], {easing, extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});

// 1 at `at`, exponential decay afterwards (impact envelopes: shake, flash, aberration)
export const impulse = (frame: number, at: number, decay = 8) => (frame < at ? 0 : Math.exp(-(frame - at) / decay));

// strongest recent impulse among several hit frames
export const hits = (frame: number, at: readonly number[], decay = 8) =>
  at.reduce((m, a) => Math.max(m, impulse(frame, a, decay)), 0);

// SVG ids must be unique per instance and safe inside url(#...)
export const useSafeId = () => 'i' + useId().replace(/[^a-zA-Z0-9]/g, '');

export const Shake: React.FC<{
  intensity: number;
  rotate?: number;
  speed?: number;
  seed?: string;
  children: React.ReactNode;
}> = ({intensity, rotate = 0, speed = 0.9, seed = 'shake', children}) => {
  const f = useCurrentFrame();
  const x = noise2D(seed + 'x', f * speed, 0) * intensity;
  const y = noise2D(seed + 'y', 0, f * speed) * intensity;
  const r = noise2D(seed + 'r', f * speed, 7) * rotate;
  return <AbsoluteFill style={{transform: `translate(${x}px, ${y}px) rotate(${r}deg)`}}>{children}</AbsoluteFill>;
};

// Chromatic aberration: red shifted one way, blue the other, added back together
export const RgbSplit: React.FC<{amount: number; angle?: number; children: React.ReactNode}> = ({
  amount,
  angle = 0,
  children,
}) => {
  const id = useSafeId();
  if (Math.abs(amount) < 0.25) return <AbsoluteFill>{children}</AbsoluteFill>;
  const dx = Math.cos((angle * Math.PI) / 180) * amount;
  const dy = Math.sin((angle * Math.PI) / 180) * amount;
  return (
    <AbsoluteFill>
      <svg width="0" height="0" style={{position: 'absolute'}}>
        <filter id={id} x="-5%" y="-5%" width="110%" height="110%" colorInterpolationFilters="sRGB">
          <feOffset in="SourceGraphic" dx={-dx} dy={-dy} result="r0" />
          <feColorMatrix in="r0" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="r" />
          <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="g" />
          <feOffset in="SourceGraphic" dx={dx} dy={dy} result="b0" />
          <feColorMatrix in="b0" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="b" />
          <feComposite in="r" in2="g" operator="arithmetic" k2="1" k3="1" result="rg" />
          <feComposite in="rg" in2="b" operator="arithmetic" k2="1" k3="1" />
        </filter>
      </svg>
      <AbsoluteFill style={{filter: `url(#${id})`}}>{children}</AbsoluteFill>
    </AbsoluteFill>
  );
};

// Animated film grain (seed changes every frame)
export const Grain: React.FC<{opacity?: number}> = ({opacity = 0.07}) => {
  const f = useCurrentFrame();
  const id = useSafeId();
  return (
    <AbsoluteFill style={{opacity, mixBlendMode: 'overlay', pointerEvents: 'none'}}>
      <svg width="100%" height="100%">
        <filter id={id}>
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves={2} seed={f % 97} stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter={`url(#${id})`} />
      </svg>
    </AbsoluteFill>
  );
};

export const Vignette: React.FC<{strength?: number; color?: string}> = ({strength = 0.6, color = '0,0,0'}) => (
  <AbsoluteFill
    style={{
      pointerEvents: 'none',
      background: `radial-gradient(ellipse 75% 70% at 50% 50%, rgba(${color},0) 55%, rgba(${color},${strength}) 100%)`,
    }}
  />
);
