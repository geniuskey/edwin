import {getLength} from '@remotion/paths';
import React from 'react';
import {
  anchors,
  body,
  bodyLineContours,
  bubble as bubblePaths,
  bubbleLineContours,
  colors,
  python,
  silhouette,
  VIEW,
} from './avatarData';
import {clamp, ease, useSafeId} from './fx';

export {anchors};
export const AVATAR_PATHS = {body, bubble: bubblePaths, python, silhouette} as const;

export type AvatarPalette = {
  line: string;
  hair: string;
  skin: string;
  lens: string;
  shirt: string;
  laptop: string;
  bubble: string;
  bubbleLine: string;
  blue: readonly [string, string];
  yellow: readonly [string, string];
  eye: string;
};

export const AVATAR_PALETTE: AvatarPalette = {
  line: colors.line,
  hair: colors.hair,
  skin: colors.skin,
  lens: colors.lens,
  shirt: colors.shirt,
  laptop: colors.laptop,
  bubble: colors.white,
  bubbleLine: colors.line,
  blue: colors.blue,
  yellow: colors.yellow,
  eye: colors.white,
};

export const monoPalette = (c: string): AvatarPalette => ({
  line: c,
  hair: c,
  skin: c,
  lens: c,
  shirt: c,
  laptop: c,
  bubble: c,
  bubbleLine: c,
  blue: [c, c],
  yellow: [c, c],
  eye: c,
});

export type BubbleState = {
  scale?: number | readonly [number, number];
  rotate?: number;
  x?: number;
  y?: number;
  opacity?: number;
};

export type AvatarProps = {
  /** rendered size in px of the 512x512 avatar box */
  size: number;
  palette?: Partial<AvatarPalette>;
  /** outline draw-on progress 0..1 (1 = fully drawn) */
  draw?: number;
  fillOpacity?: number;
  lines?: boolean;
  /** false hides the speech bubble; transforms pivot around the bubble tail tip */
  bubble?: false | BubbleState;
  /** python logo transform, pivots around the logo center */
  logo?: {scale?: number; rotate?: number};
  /** stroke width (avatar units) for outlining the python logo in line-art mode */
  logoStroke?: number;
  /** white die-cut border width in avatar units */
  sticker?: number;
  stickerColor?: string;
  /** svg content drawn below / above the avatar, in 512 avatar space */
  under?: React.ReactNode;
  children?: React.ReactNode;
  style?: React.CSSProperties;
};

const FILLS = ['hair', 'skin', 'lens', 'shirt', 'laptop'] as const;
const TIP = anchors.tailTip;
const PY = anchors.python;
const PYC = {x: (PY.x0 + PY.x1) / 2, y: (PY.y0 + PY.y1) / 2};

const contourSet = (contours: readonly string[]) =>
  contours.map((d) => ({d, len: getLength(d)})).sort((a, b) => b.len - a.len);

const BODY_DRAW = contourSet(bodyLineContours);
const BUBBLE_DRAW = contourSet(bubbleLineContours);
const LOGO_DRAW = contourSet([python.blue, python.yellow]);

const strokes = (set: {d: string; len: number}[], progress: number, width: number, color: string, fill = 'none') =>
  set.map(({d, len}, i) => {
    const stagger = set.length > 1 ? 0.35 : 0;
    const start = set.length > 1 ? (i / (set.length - 1)) * stagger : 0;
    const p = ease.inOutCubic(clamp((progress - start) / (1 - stagger)));
    return (
      <path
        key={i}
        d={d}
        fill={fill}
        stroke={color}
        strokeWidth={width}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={`${len} ${len + 2}`}
        strokeDashoffset={len * (1 - p)}
      />
    );
  });

const atRest = (b: BubbleState) =>
  (b.scale ?? 1) === 1 && !b.rotate && !b.x && !b.y && (b.opacity ?? 1) === 1;

export const Avatar: React.FC<AvatarProps> = ({
  size,
  palette,
  draw = 1,
  fillOpacity = 1,
  lines = true,
  bubble = {},
  logo,
  logoStroke = 0,
  sticker = 0,
  stickerColor = '#fff',
  under,
  children,
  style,
}) => {
  const id = useSafeId();
  const pal = {...AVATAR_PALETTE, ...palette};
  const drawing = draw < 1;
  const merged = bubble === false || atRest(bubble);
  const sc = bubble === false ? [1, 1] : typeof bubble.scale === 'number' ? [bubble.scale, bubble.scale] : bubble.scale ?? [1, 1];
  const bubbleTransform =
    bubble === false
      ? undefined
      : `translate(${bubble.x ?? 0} ${bubble.y ?? 0}) translate(${TIP.x} ${TIP.y}) rotate(${bubble.rotate ?? 0}) scale(${sc[0]} ${sc[1]}) translate(${-TIP.x} ${-TIP.y})`;
  const logoTransform = `translate(${PYC.x} ${PYC.y}) rotate(${logo?.rotate ?? 0}) scale(${logo?.scale ?? 1}) translate(${-PYC.x} ${-PYC.y})`;
  const stickerPath = (d: string) => (
    <path d={d} fill={stickerColor} stroke={stickerColor} strokeWidth={sticker * 2} strokeLinejoin="round" />
  );

  return (
    <svg viewBox={`0 0 ${VIEW} ${VIEW}`} width={size} height={size} style={{overflow: 'visible', ...style}}>
      <defs>
        <linearGradient id={`${id}b`} gradientUnits="userSpaceOnUse" x1={PY.x0} y1={PY.y0} x2={PY.x1} y2={PY.y1}>
          <stop offset="0" stopColor={pal.blue[0]} />
          <stop offset="1" stopColor={pal.blue[1]} />
        </linearGradient>
        <linearGradient id={`${id}y`} gradientUnits="userSpaceOnUse" x1={PY.x0} y1={PY.y0} x2={PY.x1} y2={PY.y1}>
          <stop offset="0" stopColor={pal.yellow[0]} />
          <stop offset="1" stopColor={pal.yellow[1]} />
        </linearGradient>
        {drawing && (
          <>
            <mask id={`${id}mb`} maskUnits="userSpaceOnUse" x={-64} y={-64} width={VIEW + 128} height={VIEW + 128}>
              {strokes(BODY_DRAW, draw, 26, '#fff')}
            </mask>
            <mask id={`${id}mu`} maskUnits="userSpaceOnUse" x={-64} y={-64} width={VIEW + 128} height={VIEW + 128}>
              {strokes(BUBBLE_DRAW, draw, 26, '#fff')}
            </mask>
          </>
        )}
      </defs>
      {under}
      {sticker > 0 && merged && stickerPath(bubble === false ? silhouette.body : silhouette.all)}
      <g>
        {fillOpacity > 0 && (
          <g opacity={fillOpacity}>
            {FILLS.map((k) => (
              <path key={k} d={body[k]} fill={pal[k]} fillRule="evenodd" />
            ))}
          </g>
        )}
        {lines && <path d={body.line} fill={pal.line} fillRule="evenodd" mask={drawing ? `url(#${id}mb)` : undefined} />}
      </g>
      {bubble !== false && (
        <g transform={bubbleTransform} opacity={bubble.opacity ?? 1}>
          {sticker > 0 && !merged && stickerPath(silhouette.bubble)}
          {fillOpacity > 0 && <path d={bubblePaths.fill} fill={pal.bubble} opacity={fillOpacity} />}
          <g transform={logoTransform}>
            {fillOpacity > 0 && (
              <g opacity={fillOpacity}>
                <path d={python.blue} fill={`url(#${id}b)`} fillRule="evenodd" />
                <path d={python.yellow} fill={`url(#${id}y)`} fillRule="evenodd" />
                {anchors.eyes.map((e, i) => (
                  <circle key={i} cx={e.x} cy={e.y} r={e.r} fill={pal.eye} />
                ))}
              </g>
            )}
            {logoStroke > 0 && strokes(LOGO_DRAW, draw, logoStroke, pal.line)}
          </g>
          {lines && (
            <path
              d={bubblePaths.line}
              fill={pal.bubbleLine}
              fillRule="evenodd"
              mask={drawing ? `url(#${id}mu)` : undefined}
            />
          )}
        </g>
      )}
      {children}
    </svg>
  );
};
