import React from 'react';
import {Composition, Folder} from 'remotion';
import {Edwin} from './Edwin';
import {SCENE_COMPONENTS, SceneKey} from './scenes';
import {FPS, HEIGHT, SCENES, TOTAL, WIDTH} from './theme';

export const RemotionRoot: React.FC = () => (
  <>
    <Composition id="Edwin" component={Edwin} durationInFrames={TOTAL} fps={FPS} width={WIDTH} height={HEIGHT} />
    <Folder name="Scenes">
      {(Object.keys(SCENES) as SceneKey[]).map((key) => (
        <Composition
          key={key}
          id={`Scene-${key}`}
          component={SCENE_COMPONENTS[key]}
          durationInFrames={SCENES[key].duration}
          fps={FPS}
          width={WIDTH}
          height={HEIGHT}
        />
      ))}
    </Folder>
  </>
);
