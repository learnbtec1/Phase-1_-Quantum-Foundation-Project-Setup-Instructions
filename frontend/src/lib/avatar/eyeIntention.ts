/**
 * Cognitive gaze intention — deterministic offsets and multipliers from brain context.
 * Does not add noise; reallocates subtle range so gaze reads as intentional.
 */
'use client';

import type { InteractionIntent } from '@/ai/avatar/avatarIntent';
import type { UserMirrorEmotion } from '@/lib/avatar/userEmotionMirror';

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export type EyeIntentionScalars = {
  /** Extra multiplier on saccade visibility (≤1 when stabilizing) */
  saccadeMul: number;
  /** Multiplier on attention-drift contribution */
  driftMul: number;
  /** Additive to camera-direct blend 0..~0.14 */
  gazeDirectAdd: number;
  /** Multiplies blink interval timing */
  blinkIntervalMul: number;
  /** Scales center-pull toward camera (1 = unchanged) */
  centerPullMul: number;
};

const NEUTRAL: EyeIntentionScalars = {
  saccadeMul: 1,
  driftMul: 1,
  gazeDirectAdd: 0,
  blinkIntervalMul: 1,
  centerPullMul: 1,
};

export type EyeIntentionInput = {
  intent: InteractionIntent;
  isUserSpeaking: boolean;
  isListening: boolean;
  phaseTalking: boolean;
  preSpeechStrength: number;
  comprehensionConfidence: number;
  emotionLabel: string;
  /** Subtle user emotional mirroring — gaze empathy */
  userMirrorEmotion: UserMirrorEmotion;
};

/**
 * Context rules (no RNG):
 * - listening / user speaking → stabilize, stronger contact
 * - speaking (agent) → stronger contact, less drift
 * - low confidence → slightly faster blink, tiny drift allowance
 * - encouraging/friendly while listening → affirming direct gaze bump
 * - pre-speech → micro “decision” tightening
 */
export function getEyeIntentionScalars(inp: EyeIntentionInput): EyeIntentionScalars {
  const em = (inp.emotionLabel ?? 'neutral').toLowerCase();
  const listening = inp.intent === 'listening' || inp.isUserSpeaking || inp.isListening;
  const userFloor = inp.isUserSpeaking || inp.isListening;

  const s = { ...NEUTRAL };

  if (userFloor || listening) {
    s.saccadeMul *= 0.62;
    s.driftMul *= 0.48;
    s.gazeDirectAdd += 0.07;
    s.centerPullMul *= 1.06;
  }

  if (inp.phaseTalking) {
    s.driftMul *= 0.58;
    s.gazeDirectAdd += 0.055;
    s.saccadeMul *= 0.88;
    s.centerPullMul *= 1.05;
  }

  if (inp.comprehensionConfidence < 0.42) {
    s.blinkIntervalMul *= 0.94;
    s.driftMul *= 1.05;
    s.gazeDirectAdd -= 0.02;
  }

  if ((em === 'encouraging' || em === 'friendly' || em === 'happy') && listening && !inp.phaseTalking) {
    s.gazeDirectAdd += 0.035;
    s.centerPullMul *= 1.03;
  }

  /** Confident explaining → read as “confirming” / clear answer: steadier contact */
  if (
    (inp.intent === 'explaining' || inp.intent === 'emphasizing')
    && inp.phaseTalking
    && inp.comprehensionConfidence >= 0.72
  ) {
    s.gazeDirectAdd += inp.intent === 'emphasizing' ? 0.055 : 0.045;
    s.driftMul *= 0.9;
    s.saccadeMul *= 0.92;
  }

  if (inp.intent === 'emphasizing' && inp.phaseTalking) {
    s.gazeDirectAdd += 0.028;
    s.saccadeMul *= 1.05;
  }

  if (inp.preSpeechStrength > 0.12) {
    s.gazeDirectAdd += 0.025 * inp.preSpeechStrength;
    s.driftMul *= lerp(1, 0.62, inp.preSpeechStrength);
  }

  const um = inp.userMirrorEmotion;
  const mirrorFloor =
    inp.isUserSpeaking || inp.isListening || inp.intent === 'listening';
  if (mirrorFloor && um !== 'calm') {
    s.gazeDirectAdd += 0.028;
    s.driftMul *= 0.9;
    s.centerPullMul *= 1.04;
  }
  switch (um) {
    case 'calm':
      s.blinkIntervalMul *= 1.06;
      s.saccadeMul *= 0.92;
      break;
    case 'confused':
      s.blinkIntervalMul *= 1.05;
      s.driftMul *= 0.88;
      s.saccadeMul *= 0.8;
      s.gazeDirectAdd -= 0.012;
      break;
    case 'excited':
      s.gazeDirectAdd += 0.018;
      s.saccadeMul *= 1.05;
      break;
    case 'frustrated':
      s.driftMul *= 0.78;
      s.saccadeMul *= 0.78;
      s.gazeDirectAdd += 0.032;
      break;
    default:
      break;
  }

  return s;
}

/**
 * Thinking gaze — slow, bounded upward + lateral bias (deterministic phase).
 * Active when brain is in thinking and agent is not yet speaking.
 */
export function computeThinkingGazeBias(
  tSec: number,
  thinkingActive: boolean,
): { yaw: number; pitch: number } {
  if (!thinkingActive) return { yaw: 0, pitch: 0 };
  const env = 0.5 + 0.5 * Math.sin(tSec * 2.4);
  return {
    yaw: Math.sin(tSec * 0.85) * 0.012 * env,
    pitch: 0.017 * env,
  };
}

/**
 * Subtle “internal retrieval” look while explaining (reduces fixation on camera).
 */
export function explainingContextualBias(
  tSec: number,
  explainingTalk: boolean,
): { yaw: number; pitch: number } {
  if (!explainingTalk) return { yaw: 0, pitch: 0 };
  return {
    yaw: Math.sin(tSec * 0.55) * 0.014,
    pitch: 0.009,
  };
}

/**
 * Slow, periodic extra contact when user has focus — no RNG ("sometimes" via phase).
 */
export function gazeConnectionHold(
  tSec: number,
  stabilizeMix: number,
  userEngaged: boolean,
): number {
  if (!userEngaged || stabilizeMix < 0.55) return 0;
  const wave = 0.5 + 0.5 * Math.sin(tSec * 0.31);
  return wave * wave * stabilizeMix * 0.06;
}
