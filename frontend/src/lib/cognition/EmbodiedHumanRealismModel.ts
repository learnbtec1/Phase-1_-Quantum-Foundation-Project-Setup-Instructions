'use client';

import type { ConversationalKinematicsReportPayload } from './types';

import type { HumanPerceptionAnalysisPayload } from './types';

export type HumanRealismAggregate = {
  score: number;
  rationale: string[];
};

export function synthesizeHumanRealism(params: {
  perception: HumanPerceptionAnalysisPayload;
  kinematics: ConversationalKinematicsReportPayload;
  embodimentHealth: number;
  measuredFps: number;
}): HumanRealismAggregate {
  const rationale: string[] = [];
  const fpsFactor = Math.min(1, params.measuredFps / 72);
  const motionPenalty = fpsFactor < 0.55 ? 12 : 0;
  if (motionPenalty) rationale.push('Motion fluidity penalty — FPS stressed vs conversational baseline.');

  const score = Math.round(
    params.perception.perceivedRealism * 0.28 +
      params.perception.visualEmbodimentQuality * 0.26 +
      params.kinematics.conversationalReadability * 0.18 +
      params.kinematics.gestureVisibilityCone * 0.12 +
      params.embodimentHealth * 0.14 -
      motionPenalty,
  );

  return {
    score: Math.max(0, Math.min(100, score)),
    rationale,
  };
}
