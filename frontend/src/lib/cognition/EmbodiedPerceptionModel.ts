'use client';

import type { DiagnosticsWindowSurface } from '@/lib/diagnostics/diagnosticsTypes';

import type { HumanPerceptionAnalysisPayload } from './types';

import type { EmotionBodyDynamics } from './EmbodiedEmotionDynamics';

export function simulateHumanPerception(params: {
  shell: DiagnosticsWindowSurface | null;
  emotion: EmotionBodyDynamics;
  embodimentHealth: number;
  realismSeed: number;
}): HumanPerceptionAnalysisPayload {
  const ts = new Date().toISOString();
  if (!params.shell) {
    return {
      timestamp: ts,
      conversationalWarmth: 0,
      visualReadability: 0,
      perceivedIntelligence: 0,
      perceivedRealism: 0,
      perceivedConfidence: 0,
      perceivedAliveness: 0,
      emotionalClarity: 0,
      engagementQuality: 0,
      socialComfort: 0,
      visualEmbodimentQuality: 0,
    };
  }
  const sh = params.shell;
  const gw = sh.motion.gestureLayerW;
  const te = sh.embodiment.timelineEnvelope;
  const motorShown =
    gw * 0.42 +
    te * 0.42 +
    Math.min(1, sh.speech.motionEnergyUnified * 1.45) * 0.18;
  // When diagnostics briefly lag envelope vs. stable speech energy (e.g. end-of-utterance transition),
  // avoid forcing readability to zero while still speaking with non-dead motion cues.
  const speechResidualHold =
    sh.speech.speaking &&
    !sh.speech.speakingZeroEnergy &&
    gw + te < 0.055 &&
    sh.speech.stableMotionEnergy > 0.07
      ? Math.min(0.2, sh.speech.stableMotionEnergy * 0.36)
      : 0;
  const readability =
    motorShown + speechResidualHold - (sh.motion.idleDominatesGesture ? 0.18 : 0);

  const warmth = params.emotion.warmth * 0.42 + readability * 0.38 + params.realismSeed * 0.12;
  const intel =
    params.emotion.confidence * 0.33 +
    params.emotion.attentiveness * 0.36 +
    Math.min(100, params.embodimentHealth) / 100 * 0.28;
  const realism = params.realismSeed * 0.55 + readability * 0.35 + params.emotion.reflection * 0.1;
  const alive =
    params.emotion.engagement * 0.4 +
    Math.min(1, sh.speech.stableMotionEnergy * 1.2) * 0.35 +
    readability * 0.25;

  return {
    timestamp: ts,
    conversationalWarmth: clamp01(warmth) * 100,
    visualReadability: clamp01(readability) * 100,
    perceivedIntelligence: clamp01(intel) * 100,
    perceivedRealism: clamp01(realism) * 100,
    perceivedConfidence: clamp01(params.emotion.confidence * 0.7 + params.emotion.calmAuthority * 0.3) * 100,
    perceivedAliveness: clamp01(alive) * 100,
    emotionalClarity: clamp01(params.emotion.reflection * 0.45 + params.emotion.confidence * 0.55) * 100,
    engagementQuality: clamp01(params.emotion.engagement * 0.55 + params.emotion.attentiveness * 0.45) * 100,
    socialComfort: clamp01(params.emotion.warmth * 0.5 + params.emotion.calmAuthority * 0.5) * 100,
    visualEmbodimentQuality: clamp01(readability * 0.6 + alive * 0.4) * 100,
  };
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}
