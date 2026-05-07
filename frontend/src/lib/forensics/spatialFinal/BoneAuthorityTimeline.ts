'use client';

import type { DiagnosticsWindowSurface } from '@/lib/diagnostics/diagnosticsTypes';

import type { BoneAuthorityTimelinePayload, SpatialVerifiedFailure } from './types';

const CONF = 0.55;

export function buildBoneAuthorityTimeline(params: {
  shell: DiagnosticsWindowSurface | null;
  conflictBones: string[];
}): BoneAuthorityTimelinePayload {
  const ts = new Date().toISOString();
  const verifiedFailures: SpatialVerifiedFailure[] = [];
  const sh = params.shell;

  const motionSource = sh?.motion.motionSource ?? 'UNKNOWN';
  const gestureState = sh?.motion.gestureState ?? '';
  const gestureLayerW = sh?.motion.gestureLayerW ?? 0;
  const idleLayerW = sh?.motion.idleLayerW ?? 0;
  const timelineEnvelope = sh?.embodiment.timelineEnvelope ?? 0;

  const ex = sh?.execution.stages;
  const orderedLayers: BoneAuthorityTimelinePayload['orderedLayers'] = [
    { phase: 'idle_micro', active: idleLayerW > 0.2, detail: `w=${idleLayerW.toFixed(2)}` },
    { phase: 'gesture_layer', active: gestureLayerW > 0.12, detail: `w=${gestureLayerW.toFixed(2)}` },
    { phase: 'vrma_layer', active: (sh?.motion.vrmaLayerW ?? 0) > 0.08, detail: `w=${(sh?.motion.vrmaLayerW ?? 0).toFixed(2)}` },
    { phase: 'emotion_timeline', active: timelineEnvelope > 0.08, detail: `env=${timelineEnvelope.toFixed(2)}` },
    { phase: 'motion_stage', active: ex?.motion ?? false },
    { phase: 'biomechanical_clamp', active: ex?.biomechanical ?? false },
    { phase: 'apply_final_pose', active: ex?.applyFinalPose ?? false },
    { phase: 'humanoid_update', active: (ex?.humanoidUpdate1 ?? false) || (ex?.humanoidUpdate2 ?? false) },
  ];

  if (params.conflictBones.length >= 2 && gestureLayerW > 0.15) {
    verifiedFailures.push({
      id: 'authority_recent_overwrites',
      subsystem: 'motion_authority',
      summary: 'Multiple bones flagged with recent overwrite conflicts while gestures are active',
      confidence: 0.59,
      evidence: [`bones=${params.conflictBones.slice(0, 8).join(',')}`, `gestureW=${gestureLayerW.toFixed(2)}`],
    });
  }

  if (sh?.motion.idleDominatesGesture && gestureLayerW > 0.2) {
    verifiedFailures.push({
      id: 'authority_idle_crushes_gesture',
      subsystem: 'motion_authority',
      summary: 'Idle dominates gesture flag set despite meaningful gesture weight — late-frame authority war',
      confidence: 0.58,
      evidence: [`idleW=${idleLayerW.toFixed(2)}`, `gestureW=${gestureLayerW.toFixed(2)}`, `src=${motionSource}`],
    });
  }

  if ((sh?.authority.conflictsSinceFlush ?? 0) > 2 && motionSource === 'GESTURE') {
    verifiedFailures.push({
      id: 'authority_flush_conflict_burst',
      subsystem: 'motion_authority',
      summary: 'Authority conflicts accumulated this flush while motionSource claims gesture stream',
      confidence: 0.6,
      evidence: [
        `conflictsΔ=${sh?.authority.conflictsSinceFlush ?? 0}`,
        `lastBone=${sh?.authority.lastConflictBone ?? ''}`,
      ],
    });
  }

  return {
    timestamp: ts,
    motionSource,
    gestureState,
    gestureLayerW,
    idleLayerW,
    timelineEnvelope,
    conflictBonesRecent: [...params.conflictBones],
    orderedLayers,
    verifiedFailures: verifiedFailures.filter((f) => f.confidence >= CONF),
  };
}
