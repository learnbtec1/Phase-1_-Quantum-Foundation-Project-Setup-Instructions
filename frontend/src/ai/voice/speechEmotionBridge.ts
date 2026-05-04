/**
 * Short-lived speech emotion snapshot (set when client TTS starts, cleared on end).
 * Drives lip expression overlay + motion coupling without touching viseme timing.
 */
'use client';

export type SpeechEmotionSnapshot = {
  emotion: string;
  intensity: number;
  /** Unified motion energy 0–1 (from {@link tickUnifiedEnergy}); not raw RMS. */
  energy?: number;
};

let snapshot: SpeechEmotionSnapshot | null = null;

export function setSpeechEmotionBridge(next: SpeechEmotionSnapshot | null): void {
  snapshot = next;
}

export function getSpeechEmotionSnapshot(): SpeechEmotionSnapshot | null {
  return snapshot;
}

/** Updates bridge energy from smoothed unified model — not raw analyser RMS. */
export function patchSpeechEmotionEnergy(energy: number): void {
  if (!snapshot) return;
  const e = Math.min(1, Math.max(0, energy));
  snapshot = { ...snapshot, energy: e };
}
