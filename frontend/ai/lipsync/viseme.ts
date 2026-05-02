/**
 * Viseme mapping: amplitude / procedural → A/I/U/E/O blendshapes.
 * Damping to avoid sticky mouth; pause on silence.
 */
export const VISEME_NAMES = ['aa', 'ih', 'ou'] as const;

export interface VisemeWeights {
  aa: number;
  ih: number;
  ou: number;
}

const DECAY = 0.85;
const SILENCE_THRESHOLD = 0.02;

export function amplitudeToViseme(amplitude: number): VisemeWeights {
  const v = Math.max(0, Math.min(1, amplitude));
  return {
    aa: v,
    ih: v * 0.6,
    ou: v * 0.4,
  };
}

export function proceduralViseme(elapsedSec: number): VisemeWeights {
  const v = Math.max(0, (0.5 + 0.5 * Math.sin(elapsedSec * 9.1)) * (0.6 + 0.4 * Math.sin(elapsedSec * 14.7 + 1.3)));
  return amplitudeToViseme(v);
}

export function decayViseme(current: VisemeWeights): VisemeWeights {
  return {
    aa: current.aa > SILENCE_THRESHOLD ? current.aa * DECAY : 0,
    ih: current.ih > SILENCE_THRESHOLD ? current.ih * DECAY : 0,
    ou: current.ou > SILENCE_THRESHOLD ? current.ou * DECAY : 0,
  };
}
