import { diagScalars } from './diagnosticsStore';
import { FILE_ID, STAGE, SUBSYSTEM } from './diagnosticsRegistry';

export function diagnosticsPoseBlendEnter(): void {
  diagScalars.lastSubsystemId = SUBSYSTEM.POSE;
  diagScalars.lastStageId = STAGE.BLEND_POSE;
  diagScalars.lastFileId = FILE_ID.PoseComposer;
}

export function diagnosticsPoseApplyFinalEnter(): void {
  diagScalars.lastSubsystemId = SUBSYSTEM.POSE;
  diagScalars.lastStageId = STAGE.APPLY_FINAL;
  diagScalars.lastFileId = FILE_ID.PoseComposer;
}
