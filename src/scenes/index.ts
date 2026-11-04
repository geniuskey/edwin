import type React from 'react';
import {SCENES} from '../theme';
import {Boot} from './Boot';
import {Build} from './Build';
import {Finale} from './Finale';
import {Pop} from './Pop';
import {Reveal} from './Reveal';
import {Type} from './Type';

export type SceneKey = keyof typeof SCENES;

export const SCENE_COMPONENTS: Record<SceneKey, React.FC> = {
  boot: Boot,
  build: Build,
  reveal: Reveal,
  type: Type,
  pop: Pop,
  finale: Finale,
};
