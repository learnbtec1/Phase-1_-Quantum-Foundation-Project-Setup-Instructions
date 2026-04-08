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

  // ── PAD → Gesture / Expression ──────────────────────────────────────────────
  // Exceptional teacher profile: reads micro-states and responds with authority + warmth
  if (pleasure > 0.6 && arousal > 0.5) {
    // High joy + energy = celebration moment — teacher is genuinely excited
    expression = 'excited';
    voiceRate = 1.12;
    voicePitch = 3;
    gesture = Math.random() < 0.5 ? 'clap' : 'cheer';
  } else if (pleasure > 0.4) {
    // Moderate joy = warm encouragement
    expression = 'happy';
    voiceRate = 1.08;
    voicePitch = 2;
    if (arousal > 0.35) gesture = 'openHand';
    else if (dominance > 0.3) gesture = 'agree';
    else gesture = 'smile';
  } else if (pleasure > 0.1) {
    // Mild positivity = engaged teacher listening actively
    expression = 'friendly';
    voiceRate = 1.0;
    voicePitch = 1;
    gesture = Math.random() < 0.4 ? 'nod' : 'lean_forward';
  } else if (pleasure < -0.5) {
    // Student struggling = teacher shifts to maximum empathy
    expression = 'empathetic';
    voiceRate = 0.87;   // slower, clearer
    voicePitch = -1;
    gesture = arousal < -0.2 ? 'relax' : 'lean_forward';
  } else if (pleasure < -0.2) {
    // Mild negativity = concerned, attentive
    expression = 'concerned';
    voiceRate = 0.92;
    voicePitch = 0;
    gesture = 'lean_forward';
  } else if (arousal > 0.65) {
    // High arousal (surprise / excitement) = teacher matches energy
    expression = 'surprised';
    voiceRate = 1.06;
    voicePitch = 2;
    gesture = pleasure > 0.1 ? 'openHand' : 'think';
  } else if (arousal < -0.45) {
    // Low arousal (tired / bored) = teacher re-energises with hook
    expression = 'calm';
    voiceRate = 0.91;
    voicePitch = -1;
    gesture = 'wait'; // "لحظة معي"
  } else {
    // Neutral/mid state = professional authoritative teaching mode
    if (dominance > 0.45) {
      expression = 'attentive';
      gesture = 'point';
    } else if (dominance < -0.3) {
      expression = 'empathetic';
      gesture = 'lean_forward';
    } else {
      expression = 'encouraging';
      gesture = curiosity > 0.7 ? 'think' : 'explain';
    }
  }

  // ── Personality modulation ───────────────────────────────────────────────────
  // Warm, passionate teacher = faster, more energetic than cold academic
  const rateMul =
    1
    + (friendliness - 0.5) * 0.10   // warmer = slightly faster and more engaged
    - (seriousness - 0.4) * 0.05    // more serious = slightly more deliberate
    + (curiosity   - 0.5) * 0.05    // more curious = slightly more varied rhythm
    + (playfulness - 0.4) * 0.03;   // playful = light variation

  const padPitch = voicePitch;
  const personalityPitchNudge = Math.round((curiosity - 0.5) * 2.2);
  let voiceRateAdj = voiceRate;

  // ── Emotional trajectory adjustments ────────────────────────────────────────
  const tr = emotionalContext?.trend;
  if (tr === 'falling_negative' || tr === 'stable_negative') {
    // Student has been struggling consistently → maximum patience, slower, gentler
    voiceRateAdj = Math.max(0.76, voiceRateAdj * 0.88);
    if (gesture === 'point' || gesture === 'explain') gesture = 'lean_forward';
    if (expression === 'attentive') expression = 'empathetic';
  } else if (tr === 'rising_positive') {
    // Student is making progress → match their growing confidence, slightly faster
    voiceRateAdj = Math.min(1.16, voiceRateAdj * 1.05);
    if (gesture === 'idle' || gesture === 'rest') gesture = 'openHand';
    if (expression === 'neutral') expression = 'encouraging';
  } else if (tr === 'volatile' && (emotionalContext?.variance ?? 0) > 0.35) {
    // Emotional rollercoaster → stabilise, calm authority
    voiceRateAdj = Math.max(0.83, voiceRateAdj * 0.95);
  }

  let finalRate = Math.min(1.22, Math.max(0.76, voiceRateAdj * rateMul));

  // Long-term adaptation from emotional memory
  const adapt = emotionalMemoryManager.getPersonalityAdaptation();
  finalRate = Math.min(1.24, finalRate * adapt.voiceRateMultiplier);

  const finalPitch = padPitch + personalityPitchNudge;

  // ── Thinking delay — deliberate teacher doesn't rush ────────────────────────
  // Base delay reflects "wisdom pause" before responding
  let baseThink = 280 + Math.random() * 520;
  baseThink *= COGNI_PERSONA.timing.deliberationScale;
  // Playful teachers add a slight unpredictable jitter (wit timing)
  let thinkingDelayMs = baseThink * (1 + playfulness * (Math.random() * 0.28));
  // Under stress: longer deliberation (more care)
  if (tr === 'falling_negative' || tr === 'stable_negative') {
    thinkingDelayMs *= 1.28;
  } else if (tr === 'volatile' && (emotionalContext?.variance ?? 0) > 0.35) {
    thinkingDelayMs *= 1.14;
  }
  // Excitement: slightly faster response (teacher is genuinely engaged)
  if (expression === 'excited' || expression === 'proud') {
    thinkingDelayMs *= 0.82;
  }

  const output = {
    gesture,
    expression,
    voiceParameters: { rate: finalRate, pitch: finalPitch, personalityPitchNudge, padPitch },
    thinkingDelayMs,
  } as unknown as BehaviorOutput;

  if (typeof process !== 'undefined' && process.env.NODE_ENV === 'development') {
    console.log('[BehaviorRules] PAD → Behavior:', { pad, gesture, expression, finalRate, tr });
  }
  return output;
}