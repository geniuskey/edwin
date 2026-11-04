import {Audio} from '@remotion/media';
import React from 'react';
import {AbsoluteFill, Sequence, staticFile} from 'remotion';
import {Grain, Vignette} from './fx';
import {SCENE_COMPONENTS, SceneKey} from './scenes';
import {C, SCENES} from './theme';

export const Edwin: React.FC = () => (
  <AbsoluteFill style={{background: C.bg}}>
    {(Object.keys(SCENES) as SceneKey[]).map((key) => {
      const Scene = SCENE_COMPONENTS[key];
      return (
        <Sequence key={key} name={key} from={SCENES[key].from} durationInFrames={SCENES[key].duration} premountFor={30}>
          <Scene />
        </Sequence>
      );
    })}
    <Vignette strength={0.45} />
    <Grain opacity={0.06} />
    <Audio src={staticFile('edwin.wav')} />
  </AbsoluteFill>
);
