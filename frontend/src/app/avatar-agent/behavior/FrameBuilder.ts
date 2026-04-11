/**
 * Level 7 — Build {@link GlobalMindFrame} from post-arbitration intent + drifted emotion.
 */

import type { GlobalMindFrame } from './GlobalMindFrame';
import type { Intent } from './intentTypes';
import type { EmotionState } from './EmotionDrift';
import { TimeCore } from './TimeCore';

export function buildFrame(intent: Intent, emotion: EmotionState): GlobalMindFrame {
  const attention =
    intent.type === 'thinking'
      ? 0.72
      : intent.type === 'listening'
        ? 0.88
        : intent.type === 'speaking'
          ? 0.84
          : 0.86;

  const arousal = Math.min(1, Math.max(0, intent.intensity));

  const cognitiveLoad =
    intent.type === 'thinking'
      ? 0.62
      : intent.type === 'reacting'
        ? 0.42
        : intent.type === 'speaking'
          ? 0.35
          : 0.22;

  return {
    intent,
    emotion: { ...emotion },
    attention,
    arousal,
    confidence: intent.confidence ?? 0.8,
    timestamp: Date.now(),
    cognitiveLoad,
  };
}

/** Deterministic 0..max jitter from {@link TimeCore} (no parallel RNG clock). */
export function mindJitterMs(max: number): number {
  if (max <= 0) return 0;
  const t = TimeCore.get();
  const u = Math.abs(Math.sin(t * 0.0013) * Math.cos(t * 0.0009));
  return u * max;
}
