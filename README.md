# EDWIN

[![EDWIN](https://geniuskey.github.io/edwin/poster.jpg)](https://geniuskey.github.io/edwin/)

**Watch:** https://geniuskey.github.io/edwin/

A 24-second, beat-synced motion graphics profile reveal built with [Remotion](https://www.remotion.dev/).
1920x1080, 60 fps, 120 BPM, procedural soundtrack.

## Scenes

| Time | Scene | |
|---|---|---|
| 0–4s | Boot | `>>> import edwin` typed in a terminal, boot log, progress bar, glitch out |
| 4–8s | Build | Neon line art draws itself, beat rings, warp streaks, snare-roll build-up |
| 8–14s | Reveal | The drop: flash, shockwave, speed lines, confetti; speech bubble pop, Python logo spin, `edwin.*` callouts |
| 14–18s | Type | E-D-W-I-N slams on 8th notes, avatar rises in front of the word |
| 18–20s | Pop | Warhol-style recolored grid, card flips, marquee tape, zoom into the center tile |
| 20–24s | Finale | Pixel-matched cut into the lockup: wordmark, `print("Hello, World!")`, orbiting text ring |

## How it works

- `scripts/prepare_assets.py` turns `edwin.png` into layered vector art (`src/avatarData.ts`): background removal,
  per-color layer split, the shoulder hidden behind the speech bubble rebuilt from the character's symmetry,
  and potrace tracing. This enables outline draw-on, recoloring, and animating the bubble and logo independently.
- `scripts/sfx.mjs` synthesizes the whole soundtrack and SFX (no samples) on the same frame cue sheet as the visuals.
- `src/scenes/*` contain one component per scene; `src/Edwin.tsx` sequences them with the audio.

## Usage

Requires Node 22+ and pnpm.

```bash
pnpm install
pnpm studio    # preview in Remotion Studio
pnpm render    # out/edwin.mp4
pnpm poster    # out/edwin-poster.png (last frame)
pnpm sfx       # regenerate public/edwin.wav
pnpm assets    # regenerate src/avatarData.ts (needs Python: numpy, scipy, pillow, potracer)
```

The web page is served from the `gh-pages` branch via GitHub Pages.
