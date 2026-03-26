// File: frontend/src/ai/cognitive/BehaviorRulesEngine.ts
import type { PADVector, BehaviorOutput } from '@/types/ai';
import type { EmotionalTrend } from '@/ai/avatar/EmotionalMemoryManager';
import { emotionalMemoryManager } from '@/ai/avatar/EmotionalMemoryManager';
import { AVATAR_PERSONALITY, COGNI_PERSONA } from '@/config/personality';

/** FIX: Phase 3/4 — optional trajectory summary to nudge expression + voice */
export interface EmotionalContextBrief {
  trend: EmotionalTrend;
  avgPleasure: number;
  variance: number;
}

export function decideBehaviorFromPAD(
  pad: PADVector,
  emotionalContext?: EmotionalContextBrief | null,
): BehaviorOutput {
  const { pleasure, arousal, dominance } = pad;
  const { friendliness, curiosity, seriousness, playfulness } = AVATAR_PERSONALITY;

  let gesture = 'idle';
  let expression = 'neutral';
  let voiceRate = 1.0;
  let voicePitch = 0;

  // قواعد متقدمة تعتمد على PAD
  if (pleasure > 0.5) {
    expression = 'happy';
    voiceRate = 1.1;
    voicePitch = 2;

    if (arousal > 0.6) gesture = 'celebration';
    else if (dominance > 0.3) gesture = 'openHand';
    else gesture = 'smile';
  } else if (pleasure < -0.5) {
    expression = 'sad';
    voiceRate = 0.9;
    voicePitch = -1;

    if (arousal < -0.2) gesture = 'shoulder_sigh';
    else gesture = 'head_down';
  } else if (arousal > 0.6) {
    expression = 'surprised';
    voiceRate = 1.05;
    voicePitch = 1;

    if (pleasure > 0.2) gesture = 'hands_up';
    else gesture = 'lean_back';
  } else if (arousal < -0.4) {
    expression = 'tired';
    voiceRate = 0.9;
    voicePitch = -2;
    gesture = 'rest';
  } else {
    if (dominance > 0.4) {
      expression = 'strict';
      gesture = 'point';
    } else if (dominance < -0.3) {
      expression = 'empathetic';
      gesture = 'lean_forward';
    } else {
      expression = 'neutral';
      gesture = 'idle';
    }
  }

  // Personality: friendlier → slightly faster speech; serious → slower; playful → longer "thinking" jitter
  const rateMul =
    1 + (friendliness - 0.5) * 0.08 - (seriousness - 0.5) * 0.06 + (curiosity - 0.5) * 0.04;
  /** PAD-derived pitch (semitone-ish offset) before personality */
  const padPitch = voicePitch;
  const personalityPitchNudge = Math.round((curiosity - 0.5) * 2);
  let voiceRateAdj = voiceRate;

  // FIX: emotional memory — slower, gentler delivery when trajectory is negative / frustrated
  const tr = emotionalContext?.trend;
  if (tr === 'falling_negative' || tr === 'stable_negative') {
    voiceRateAdj = Math.max(0.78, voiceRateAdj * 0.9);
    if (gesture === 'point') gesture = 'openHand';
  } else if (tr === 'rising_positive') {
    voiceRateAdj = Math.min(1.15, voiceRateAdj * 1.04);
    if (gesture === 'idle' || gesture === 'rest') gesture = 'openHand';
  } else if (tr === 'volatile' && (emotionalContext?.variance ?? 0) > 0.35) {
    voiceRateAdj = Math.max(0.82, voiceRateAdj * 0.96);
  }

  let finalRate = Math.min(1.2, Math.max(0.78, voiceRateAdj * rateMul));

  // Long-term user traits: technical interests → slightly faster, clearer delivery
  const adapt = emotionalMemoryManager.getPersonalityAdaptation();
  finalRate = Math.min(1.22, finalRate * adapt.voiceRateMultiplier);

  const finalPitch = padPitch + personalityPitchNudge;

  let baseThink = 300 + Math.random() * 600;
  baseThink *= COGNI_PERSONA.timing.deliberationScale;
  let thinkingDelayMs = baseThink * (1 + playfulness * (Math.random() * 0.35));
  if (tr === 'falling_negative' || tr === 'stable_negative') {
    thinkingDelayMs *= 1.22;
  } else if (tr === 'volatile' && (emotionalContext?.variance ?? 0) > 0.35) {
    thinkingDelayMs *= 1.12;
  }

  // Cast via unknown: adds expression + voiceParameters for AgentDirector (_RulesEngineBehavior).
  const output = {
    gesture,
    expression,
    voiceParameters: {
      rate: finalRate,
      pitch: finalPitch,
      personalityPitchNudge,
      padPitch,
    },
    thinkingDelayMs,
  } as unknown as BehaviorOutput;

  if (typeof process !== 'undefined' && process.env.NODE_ENV === 'development') {
    console.log('[BehaviorRules] PAD → Behavior:', pad, output);
  }
  return output;
}