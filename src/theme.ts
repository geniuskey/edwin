import {loadFont as loadAnton} from '@remotion/google-fonts/Anton';
import {loadFont as loadJetBrains} from '@remotion/google-fonts/JetBrainsMono';

export const FPS = 60;
export const WIDTH = 1920;
export const HEIGHT = 1080;

// 120 BPM -> one beat = 30 frames at 60 fps
export const BEAT = 30;
export const BAR = BEAT * 4;

export const SCENES = {
  boot: {from: 0, duration: 2 * BAR},
  build: {from: 2 * BAR, duration: 2 * BAR},
  reveal: {from: 4 * BAR, duration: 3 * BAR},
  type: {from: 7 * BAR, duration: 2 * BAR},
  pop: {from: 9 * BAR, duration: BAR},
  finale: {from: 10 * BAR, duration: 2 * BAR},
} as const;

export const TOTAL = 12 * BAR;

export const C = {
  bg: '#05070c',
  bg2: '#0a1222',
  ink: '#0b0b0d',
  white: '#f5f7fb',
  blue: '#3776ab',
  blueHi: '#4b8bbe',
  blueDeep: '#14294a',
  yellow: '#ffd43b',
  yellowHi: '#ffe873',
  orange: '#f8b050',
  hot: '#ff6a1f',
  cyan: '#2de2ff',
  magenta: '#ff2e7e',
} as const;

export const FONT = {
  display: loadAnton('normal', {weights: ['400'], subsets: ['latin']}).fontFamily,
  mono: loadJetBrains('normal', {weights: ['400', '700', '800'], subsets: ['latin']}).fontFamily,
} as const;
