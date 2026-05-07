'use client';

/**
 * Derives conversational visibility reports from live shells + kinematics + perception.
 * Disk persistence via `/api/cognition/reports` (see EmbodiedCognitiveCore).
 */

import type { DiagnosticsWindowSurface } from '@/lib/diagnostics/diagnosticsTypes';

import type {
  ConversationalKinematicsReportPayload,
  HumanPerceptionAnalysisPayload,
  SpatialCognitionReportPayload,
} from './types';

export type ConversationalVisibilityAmplificationPayload = {
  timestamp: string;
  summary: string;
  opennessScore: number;
  gestureProjectionScore: number;
  conversationalSpread: number;
  cameraReadability: number;
  torsoParticipation: number;
  shoulderVisibility: number;
  gesturePersistence: number;
  socialPresence: number;
  conversationalEnergy: number;
  silhouetteClarity: number;
  dominantWeakness: string | null;
};

export type SocialPresenceAnalysisPayload = {
  timestamp: string;
  socialPresence: number;
  conversationalWarmth: number;
  perceivedConfidence: number;
  engagementQuality: number;
  perceivedAliveness: number;
  visualEmbodimentQuality: number;
  narrative: string;
};

export type GestureProjectionReportPayload = {
  timestamp: string;
  gestureProjectionScore: number;
  handElevationProxy: number;
  gestureVisibilityCone: number;
  cameraFacingContribution: number;
  speakingBoost: number;
};

export type ConversationalOpennessReportPayload = {
  timestamp: string;
  opennessScore: number;
  armOpenness: number;
  shoulderSpreadProxy: number;
  elbowSeparationReadability: number;
  chestParticipation: number;
  conversationalSpread: number;
};

export type TorsoParticipationReportPayload = {
  timestamp: string;
  torsoParticipation: number;
  torsoTwistProxy: number;
  chestParticipation: number;
  spineCouplingProxy: number;
};

function clamp100(x: number): number {
  return Math.max(0, Math.min(100, Math.round(x)));
}

export function buildConversationalVisibilityAmplificationBundle(params: {
  shell: DiagnosticsWindowSurface | null;
  kin: ConversationalKinematicsReportPayload;
  perception: HumanPerceptionAnalysisPayload;
  spatial: SpatialCognitionReportPayload;
}): {
  conversational_visibility_amplification: ConversationalVisibilityAmplificationPayload;
  social_presence_analysis: SocialPresenceAnalysisPayload;
  gesture_projection_report: GestureProjectionReportPayload;
  conversational_openness_report: ConversationalOpennessReportPayload;
  torso_participation_report: TorsoParticipationReportPayload;
} {
  const ts = new Date().toISOString();
  const sh = params.shell;
  const k = params.kin;
  const p = params.perception;
  const sp = params.spatial;

  const elbowOpenReadability = clamp100(100 - k.elbowFlexionProxy * 0.82);
  const spineCoupling = clamp100(k.torsoTwistProxy * 0.45 + k.chestParticipation * 0.55);

  const hiddenPenalty = sp.hiddenGestureRisk * 100;
  const framingPenalty = sp.framingCollapseRisk * 100;

  const gestureProjectionScore = clamp100(
    k.gestureProjectionScore * 0.82 + (100 - hiddenPenalty) * 0.18,
  );

  const cameraFacingContribution = clamp100(
    k.cameraReadability * 0.62 + (100 - hiddenPenalty) * 0.22 + (100 - framingPenalty) * 0.16,
  );

  const cameraReadability = clamp100(
    k.cameraReadability * 0.52 + p.visualReadability * 0.28 + cameraFacingContribution * 0.2,
  );

  const silhouetteClarity = clamp100(
    k.silhouetteClarity * 0.58 + (100 - hiddenPenalty) * 0.22 + k.conversationalReadability * 0.2,
  );

  const socialPresence = clamp100(
    k.gesturePersistence * 0.26 +
      k.conversationalEnergy * 0.22 +
      p.conversationalWarmth * 0.22 +
      p.engagementQuality * 0.18 +
      cameraReadability * 0.12,
  );

  const speakingBoost =
    sh?.speech.speaking === true
      ? clamp100(k.conversationalEnergy + Math.min(18, sh.speech.motionEnergyUnified * 22))
      : k.conversationalEnergy;

  let dominantWeakness: string | null = null;
  if (cameraReadability < 34) dominantWeakness = 'camera_readability';
  else if (k.opennessScore < 30) dominantWeakness = 'postural_openness';
  else if (k.gesturePersistence < 32) dominantWeakness = 'gesture_persistence';
  else if (sp.hiddenGestureRisk > 0.52) dominantWeakness = 'hidden_gesture_cone';

  const amplification: ConversationalVisibilityAmplificationPayload = {
    timestamp: ts,
    summary:
      dominantWeakness != null
        ? `Visibility amplification focus: ${dominantWeakness.replace(/_/g, ' ')}`
        : 'Conversational visibility within nominal social-readability band',
    opennessScore: k.opennessScore,
    gestureProjectionScore,
    conversationalSpread: k.conversationalSpread,
    cameraReadability,
    torsoParticipation: k.torsoParticipation,
    shoulderVisibility: k.shoulderVisibility,
    gesturePersistence: k.gesturePersistence,
    socialPresence,
    conversationalEnergy: k.conversationalEnergy,
    silhouetteClarity,
    dominantWeakness,
  };

  const socialPresencePayload: SocialPresenceAnalysisPayload = {
    timestamp: ts,
    socialPresence,
    conversationalWarmth: p.conversationalWarmth,
    perceivedConfidence: p.perceivedConfidence,
    engagementQuality: p.engagementQuality,
    perceivedAliveness: p.perceivedAliveness,
    visualEmbodimentQuality: p.visualEmbodimentQuality,
    narrative:
      socialPresence >= 54
        ? 'Viewer-facing cues cluster toward engaged, socially readable embodiment.'
        : 'Social presence suppressed — elevate openness, camera cone exposure, and gesture sustain.',
  };

  const gestureProj: GestureProjectionReportPayload = {
    timestamp: ts,
    gestureProjectionScore,
    handElevationProxy: k.handElevationProxy,
    gestureVisibilityCone: k.gestureVisibilityCone,
    cameraFacingContribution,
    speakingBoost,
  };

  const openness: ConversationalOpennessReportPayload = {
    timestamp: ts,
    opennessScore: k.opennessScore,
    armOpenness: k.armOpenness,
    shoulderSpreadProxy: k.shoulderSpreadProxy,
    elbowSeparationReadability: elbowOpenReadability,
    chestParticipation: k.chestParticipation,
    conversationalSpread: k.conversationalSpread,
  };

  const torso: TorsoParticipationReportPayload = {
    timestamp: ts,
    torsoParticipation: k.torsoParticipation,
    torsoTwistProxy: k.torsoTwistProxy,
    chestParticipation: k.chestParticipation,
    spineCouplingProxy: spineCoupling,
  };

  return {
    conversational_visibility_amplification: amplification,
    social_presence_analysis: socialPresencePayload,
    gesture_projection_report: gestureProj,
    conversational_openness_report: openness,
    torso_participation_report: torso,
  };
}
