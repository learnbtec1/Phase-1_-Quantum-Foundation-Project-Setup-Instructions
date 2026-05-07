'use client';

import type { DiagnosticsWindowSurface } from '@/lib/diagnostics/diagnosticsTypes';
import type { ConversationalKinematicsReportPayload } from '@/lib/cognition/types';

import type { FinalSpatialBoneForensicsPayload, GestureVisibilityProjectionPayload, SpatialVerifiedFailure } from './types';

const CONF = 0.55;

export function projectGestureVisibility(params: {
  shell: DiagnosticsWindowSurface | null;
  kinematics: ConversationalKinematicsReportPayload;
  forensics: FinalSpatialBoneForensicsPayload;
}): GestureVisibilityProjectionPayload {
  const ts = new Date().toISOString();
  const verifiedFailures: SpatialVerifiedFailure[] = [];
  const k = params.kinematics;
  const g = params.shell?.motion.gestureLayerW ?? 0;

  const compressedPosture =
    k.opennessScore < 28 && k.conversationalSpread < 30 && g > 0.2 && !params.shell?.speech.speaking;
  if (compressedPosture) {
    verifiedFailures.push({
      id: 'gesture_visibility_compressed_posture',
      subsystem: 'social_projection',
      summary: 'Openness and spread collapsed while gesture channel carries weight — socially unreadable silhouette',
      confidence: 0.6,
      evidence: [`openness=${k.opennessScore}`, `spread=${k.conversationalSpread}`, `gestureW=${g.toFixed(2)}`],
    });
  }

  if (k.gestureProjectionScore < 22 && g > 0.22) {
    verifiedFailures.push({
      id: 'gesture_visibility_low_projection',
      subsystem: 'camera_room',
      summary: 'Gesture projection score crashed vs active gesture weights — elevation / cone mismatch',
      confidence: 0.57,
      evidence: [`gestureProjection=${k.gestureProjectionScore}`, `gestureW=${g.toFixed(2)}`],
    });
  }

  if (k.silhouetteClarity < 24 && params.forensics.aggregatedCameraVisibility < 35) {
    verifiedFailures.push({
      id: 'gesture_visibility_silhouette_dead',
      subsystem: 'spatial',
      summary: 'Silhouette clarity and mean camera visibility both indicate dead upper-body readability',
      confidence: 0.56,
      evidence: [`silhouette=${k.silhouetteClarity}`, `meanCam=${params.forensics.aggregatedCameraVisibility}`],
    });
  }

  const emotionalProjectionScore = Math.round((k.conversationalEnergy + k.gesturePersistence) / 2);
  const socialProjectionScore = Math.round((k.opennessScore + k.cameraReadability + k.shoulderVisibility) / 3);

  return {
    timestamp: ts,
    opennessScore: k.opennessScore,
    shoulderSpreadScore: k.shoulderSpreadProxy,
    torsoEngagementScore: k.torsoParticipation,
    gestureElevationScore: k.handElevationProxy,
    conversationalReachScore: k.conversationalSpread,
    chestParticipationScore: k.chestParticipation,
    framingScore: k.gestureVisibilityCone,
    emotionalProjectionScore,
    socialProjectionScore,
    verifiedFailures: verifiedFailures.filter((f) => f.confidence >= CONF),
  };
}
