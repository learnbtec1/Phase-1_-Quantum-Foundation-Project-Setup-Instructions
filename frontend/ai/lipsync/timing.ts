/**
 * Map word-level timings from Kokoro TTS to viseme weights for lip-sync.
 * Uses simple phoneme-to-viseme mapping; smooth transitions between phonemes.
 */
import type { VisemeWeights } from './viseme';

export interface WordTiming {
  word: string;
  start_time: number;
  end_time: number;
}

const LERP_SPEED = 18;
const PEAK_WEIGHT = 0.85;
const REST_WEIGHT = 0.08;

/**
 * Map a phoneme-like character to viseme weights.
 * Kokoro tokens are word-level; we approximate by using word length for duration.
 */
function wordToViseme(word: string): VisemeWeights {
  const len = word.length;
  const v = Math.min(1, 0.3 + len * 0.15);
  return {
    aa: v * 0.7,
    ih: v * 0.5,
    ou: v * 0.35,
  };
}

/**
 * Get viseme weights at a given time (ms) from word timings.
 */
export function timingsToVisemeAt(
  timings: WordTiming[],
  timeMs: number
): VisemeWeights {
  if (!timings.length) return { aa: 0, ih: 0, ou: 0 };

  for (const t of timings) {
    if (timeMs >= t.start_time && timeMs <= t.end_time) {
      const dur = t.end_time - t.start_time;
      const progress = dur > 0 ? (timeMs - t.start_time) / dur : 0.5;
      const peak = Math.sin(progress * Math.PI);
      const w = wordToViseme(t.word);
      return {
        aa: w.aa * peak * PEAK_WEIGHT + REST_WEIGHT,
        ih: w.ih * peak * PEAK_WEIGHT + REST_WEIGHT,
        ou: w.ou * peak * PEAK_WEIGHT + REST_WEIGHT,
      };
    }
  }

  const last = timings[timings.length - 1];
  if (timeMs > last.end_time) {
    const decay = Math.exp(-(timeMs - last.end_time) / 80);
    const w = wordToViseme(last.word);
    return {
      aa: w.aa * decay * 0.3,
      ih: w.ih * decay * 0.3,
      ou: w.ou * decay * 0.3,
    };
  }

  return { aa: REST_WEIGHT, ih: REST_WEIGHT * 0.6, ou: REST_WEIGHT * 0.4 };
}

/**
 * Lerp current viseme toward target.
 */
export function lerpViseme(
  current: VisemeWeights,
  target: VisemeWeights,
  deltaSec: number
): VisemeWeights {
  const t = 1 - Math.exp(-LERP_SPEED * deltaSec);
  return {
    aa: current.aa + (target.aa - current.aa) * t,
    ih: current.ih + (target.ih - current.ih) * t,
    ou: current.ou + (target.ou - current.ou) * t,
  };
}
