/**
 * Brain store transition churn — rapid flipping may indicate logic bugs.
 */

import { useBrainStore } from '@/store/useBrainStore';

let unsub: (() => void) | null = null;
const transitionTimestamps: number[] = [];
const WINDOW_MS = 3000;

export function startStateConsistencyProbe(): void {
  if (unsub) return;
  unsub = useBrainStore.subscribe(
    (s) =>
      `${s.talking}|${s.thinking}|${s.physical.isListening}|${s.emotionLabel}|${s.isUserSpeaking}`,
    () => {
      const now = performance.now();
      transitionTimestamps.push(now);
      while (transitionTimestamps.length && now - transitionTimestamps[0]! > WINDOW_MS) {
        transitionTimestamps.shift();
      }
      lastChurnPerSec = transitionTimestamps.length / (WINDOW_MS / 1000);
    },
  );
}

export function stopStateConsistencyProbe(): void {
  if (unsub) {
    unsub();
    unsub = null;
  }
  transitionTimestamps.length = 0;
}

let lastChurnPerSec = 0;

export function getBrainChurnPerSec(): number {
  return lastChurnPerSec;
}

export function isStateChurnWarn(): boolean {
  return lastChurnPerSec > 18;
}
