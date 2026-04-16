/**
 * Central intent brain — temporal memory + derivative signals for embodiment.
 * Raw intent from `computeInteractionIntent` is smoothed so motion/gaze/lips
 * stay intentional rather than snapping frame-to-frame.
 */
'use client';

import * as THREE from 'three';
import type { InteractionIntent } from '@/ai/avatar/avatarIntent';
import type { EmotionLabel, PADVector } from '@/types/ai';
import { AVATAR_PERSONALITY } from '@/config/personality';
import {
  getPersonalityProfile,
  mergeTraitsWithMemory,
} from '@/ai/avatar/personalityProfile';
import { getPersonalityMemoryState } from '@/ai/avatar/personalityMemory';
import type { UserSpeechRhythm } from '@/lib/avatar/userEmotionMirror';

const DWELL_DEFAULT_MS = 160;
const DWELL_EMPH_EXPLAIN_MS = 42;
const DWELL_FROM_LISTEN_MS = 95;

export function smoothInteractionIntentWithMemory(args: {
  committed: InteractionIntent;
  raw: InteractionIntent;
  nowMs: number;
  lastCommitAtMs: number;
}): InteractionIntent {
  const { committed, raw, nowMs, lastCommitAtMs } = args;
  if (raw === committed) return committed;
  if (raw === 'listening') return 'listening';

  const elapsed = nowMs - lastCommitAtMs;
  const emphSwap =
    (committed === 'emphasizing' && raw === 'explaining') ||
    (committed === 'explaining' && raw === 'emphasizing');
  const fromListen =
    committed === 'listening' &&
    (raw === 'thinking' || raw === 'explaining' || raw === 'emphasizing' || raw === 'idle');

  const minDwell = emphSwap
    ? DWELL_EMPH_EXPLAIN_MS
    : fromListen
      ? DWELL_FROM_LISTEN_MS
      : DWELL_DEFAULT_MS;

  if (elapsed < minDwell) return committed;
  return raw;
}

export function computeIntentEnergy(args: {
  pad: PADVector;
  talking: boolean;
  intentAnticipation: number;
  emotionLabel: EmotionLabel;
}): number {
  const { pad, talking, intentAnticipation, emotionLabel } = args;
  const arousalW = Math.abs(pad.arousal);
  const pleasureW = Math.max(0, pad.pleasure);
  let base = 0.32 + 0.34 * arousalW + 0.18 * pleasureW;
  if (talking) base += 0.14;
  if (emotionLabel === 'excited' || emotionLabel === 'encouraging') base += 0.06;
  base += intentAnticipation * 0.38;
  base += AVATAR_PERSONALITY.playfulness * 0.04;
  return THREE.MathUtils.clamp(base, 0, 1);
}

export function computeSpeechStyle(args: {
  energy: number;
  rhythm: UserSpeechRhythm;
  speechEmphasisHint: number;
}): { expressiveness: number; paceMul: number } {
  const { energy, rhythm, speechEmphasisHint } = args;
  const paceMul = rhythm === 'fast' ? 1.07 : rhythm === 'slow' ? 0.93 : 1;
  const expressiveness = THREE.MathUtils.clamp(
    0.42 + 0.38 * energy + 0.22 * speechEmphasisHint,
    0.28,
    1,
  );
  return { expressiveness, paceMul };
}

export type IntentBrainSnapshot = {
  /** intent at t-1 (before last tick committed). */
  intentPrev: InteractionIntent;
  intentRaw: InteractionIntent;
  energy: number;
  anticipation: number;
  emotion: { label: EmotionLabel; pad: PADVector };
  personality: { friendliness: number; curiosity: number };
  speechStyle: { expressiveness: number; paceMul: number };
};

export function buildPersonalityHint(): IntentBrainSnapshot['personality'] {
  const p = getPersonalityProfile();
  const t = mergeTraitsWithMemory(p.traits, getPersonalityMemoryState());
  return {
    friendliness: THREE.MathUtils.lerp(AVATAR_PERSONALITY.friendliness, t.warmth, 0.65),
    curiosity: THREE.MathUtils.lerp(AVATAR_PERSONALITY.curiosity, t.curiosity, 0.65),
  };
}
