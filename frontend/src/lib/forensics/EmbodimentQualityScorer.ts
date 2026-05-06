'use client';

import type { EmbodimentQualityBreakdown } from './types';

export function computeEmbodimentQualityScores(args: {
  diagnosticsHealth: number;
  lipSyncDriftMs: number;
  gestureVisibilityProxy: number;
  personalityConsistencyProxy: number;
  behavioralCoherenceProxy: number;
  spatialIntegrityProxy: number;
  facialProxy: number;
  fpsStableProxy: number;
  couplingScore: number;
}): EmbodimentQualityBreakdown {
  const lipAcc = Math.max(
    0,
    100 - Math.min(55, args.lipSyncDriftMs / 12 + (args.facialProxy < 0.04 ? 18 : 0)),
  );
  const gestureVis = Math.max(5, Math.min(100, args.gestureVisibilityProxy * 100));
  const spatial = Math.max(5, Math.min(100, args.spatialIntegrityProxy * 100));
  const motionFluidity = Math.max(5, Math.min(100, args.fpsStableProxy * 100));

  const speechEmbodiment = Math.round((args.diagnosticsHealth * 0.55 + args.couplingScore * 0.45) * 0.92);
  const lipSyncAccuracy = Math.round(lipAcc);
  const personalityConsistency = Math.round(Math.max(8, Math.min(100, args.personalityConsistencyProxy * 100)));
  const behavioralCoherence = Math.round(Math.max(8, Math.min(100, args.behavioralCoherenceProxy * 100)));
  const facialEmbodiment = Math.round(Math.max(6, Math.min(100, 52 + args.facialProxy * 420)));

  const cameraPresence = Math.round(motionFluidity * 0.94 + spatial * 0.06);

  const overallEmbodiment = Math.round(
    speechEmbodiment * 0.18 +
      gestureVis * 0.14 +
      lipSyncAccuracy * 0.14 +
      personalityConsistency * 0.1 +
      behavioralCoherence * 0.12 +
      motionFluidity * 0.1 +
      spatial * 0.08 +
      facialEmbodiment * 0.08 +
      cameraPresence * 0.06,
  );

  return {
    speechEmbodiment,
    gestureVisibility: Math.round(gestureVis),
    lipSyncAccuracy,
    personalityConsistency,
    behavioralCoherence,
    motionFluidity: Math.round(motionFluidity),
    cameraPresence,
    spatialEmbodiment: Math.round(spatial),
    facialEmbodiment,
    overallEmbodiment: Math.max(0, Math.min(100, overallEmbodiment)),
  };
}
