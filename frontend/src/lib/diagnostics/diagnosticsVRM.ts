import * as THREE from 'three';

import { DM } from './diagnosticsMetrics';
import { diagInc, diagScalars } from './diagnosticsStore';
import { FILE_ID, STAGE, SUBSYSTEM } from './diagnosticsRegistry';

function touchVrmPosePath(): void {
  diagScalars.lastSubsystemId = SUBSYSTEM.VRM;
  diagScalars.lastStageId = STAGE.APPLY_FINAL;
  diagScalars.lastFileId = FILE_ID.PoseComposer;
}

/** Hot path — branch + increment only. */
export function diagnosticsVrmMissingHumanoid(): void {
  touchVrmPosePath();
  diagInc(DM.MISSING_HUMANOID);
}

export function diagnosticsVrmInvalidQuat(q: THREE.Quaternion): void {
  touchVrmPosePath();
  const { x, y, z, w } = q;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z) || !Number.isFinite(w)) {
    diagInc(DM.INVALID_QUAT_SAMPLE);
    diagInc(DM.NAN_ROTATION_SAMPLE);
    return;
  }
  const len2 = x * x + y * y + z * z + w * w;
  if (len2 < 1e-12) {
    diagInc(DM.ZERO_LENGTH_QUAT);
    diagInc(DM.INVALID_QUAT_SAMPLE);
  }
}

export function diagnosticsVrmNullBoneSkip(): void {
  touchVrmPosePath();
  diagInc(DM.NULL_BONE_WRITE_SKIP);
}
