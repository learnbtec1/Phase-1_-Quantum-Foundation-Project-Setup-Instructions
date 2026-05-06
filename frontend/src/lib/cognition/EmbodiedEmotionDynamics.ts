'use client';

import { useBrainStore } from '@/store/useBrainStore';

export type EmotionBodyDynamics = {
  hesitation: number;
  warmth: number;
  attentiveness: number;
  confidence: number;
  curiosity: number;
  calmAuthority: number;
  engagement: number;
  reflection: number;
};

export function sampleEmotionBodyDynamics(): EmotionBodyDynamics {
  const s = useBrainStore.getState();
  const pad = s.pad;
  const pleasure = THREE_CLAMP((pad?.pleasure ?? 0) + 1, 0, 2) / 2;
  const arousal = THREE_CLAMP((pad?.arousal ?? 0) + 1, 0, 2) / 2;
  const dominance = THREE_CLAMP((pad?.dominance ?? 0) + 1, 0, 2) / 2;

  return {
    hesitation: THREE_CLAMP(1 - arousal * 0.85 + (s.thinking ? 0.22 : 0), 0, 1),
    warmth: THREE_CLAMP(0.45 + pleasure * 0.5 + (s.physical?.isListening ? 0.18 : 0), 0, 1),
    attentiveness: THREE_CLAMP(0.42 + (s.physical?.isListening ? 0.35 : 0) + arousal * 0.12, 0, 1),
    confidence: THREE_CLAMP(0.48 + arousal * 0.22 + dominance * 0.32 + pleasure * 0.12, 0, 1),
    curiosity: THREE_CLAMP(0.36 + arousal * 0.22 + pleasure * 0.18, 0, 1),
    calmAuthority: THREE_CLAMP(0.62 - arousal * 0.25 + dominance * 0.35 + pleasure * 0.08, 0, 1),
    engagement: THREE_CLAMP(arousal * 0.55 + pleasure * 0.35 + (s.physical?.isListening ? 0.15 : 0), 0, 1),
    reflection: THREE_CLAMP((s.thinking ? 0.72 : 0.35) + (1 - arousal) * 0.12, 0, 1),
  };
}

function THREE_CLAMP(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}
