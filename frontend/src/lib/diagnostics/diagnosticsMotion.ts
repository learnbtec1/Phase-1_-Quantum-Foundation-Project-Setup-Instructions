import { DM } from './diagnosticsMetrics';
import { diagInc, diagSetLastConflictBone } from './diagnosticsStore';
import { diagTimelinePushConflictBone } from './diagnosticsTimelineProbe';

/** Hot path — numeric comparisons only. */
export function diagnosticsMotionAfterBlend(params: {
  gestureLayerW: number;
  idleLayerW: number;
  hasGestureEvent: boolean;
  idleOverwriteHeuristic: boolean;
}): void {
  if (params.idleOverwriteHeuristic) {
    diagInc(DM.IDLE_OVERWRITE_GESTURE);
  }
  if (params.hasGestureEvent && params.gestureLayerW < 0.12 && params.idleLayerW > 0.85) {
    diagInc(DM.GESTURE_WEIGHT_COLLAPSE);
  }
}

export function diagnosticsAuthorityConflict(boneKey?: string): void {
  diagInc(DM.AUTHORITY_CONFLICT);
  if (boneKey && boneKey.length > 0) {
    diagSetLastConflictBone(boneKey);
    diagTimelinePushConflictBone(boneKey);
  }
}
