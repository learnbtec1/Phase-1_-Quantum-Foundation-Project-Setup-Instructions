// File: frontend/src/ai/cognitive/BehaviorRulesEngine.ts
import type { PADVector, BehaviorOutput } from '@/types/ai';

export function decideBehaviorFromPAD(pad: PADVector): BehaviorOutput {
  const { pleasure, arousal, dominance } = pad;

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

  const thinkingDelayMs = 300 + Math.random() * 600;

  // Cast via unknown: this function deliberately adds un-modelled fields
  // (expression, voiceParameters) that AgentDirector reads via _RulesEngineBehavior.
  const output = {
    gesture,
    expression,
    voiceParameters: { pitch: voicePitch, rate: voiceRate },
    thinkingDelayMs,
  } as unknown as BehaviorOutput;

  console.log('[BehaviorRules] PAD → Behavior:', pad, output);
  return output;
}