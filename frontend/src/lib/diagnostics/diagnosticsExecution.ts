import type { DiagnosticsExecutionSnapshot } from './diagnosticsTypes';

/** Populate execution snapshot from VRMSkeletonManager _execLoop-style fields (primitive copy only). */
export function diagnosticsFillExecution(
  target: DiagnosticsExecutionSnapshot,
  src: {
    frameCount: number;
    measuredFps: number;
    earlyReturnReason: string | null;
    s_motionExecuted: boolean;
    s_finalPoseExecuted: boolean;
    s_humanoid1Executed: boolean;
    s_biomechExecuted: boolean;
    s_humanoid2Executed: boolean;
    s_motionEnd: number;
    s_finalPoseEnd: number;
    s_frameEnd: number;
    orderCorrect: boolean;
    overrideDetected: boolean;
  },
): void {
  target.frameCount = src.frameCount;
  target.measuredFps = src.measuredFps;
  target.earlyReturnReason = src.earlyReturnReason;
  target.stages.motion = src.s_motionExecuted;
  target.stages.applyFinalPose = src.s_finalPoseExecuted;
  target.stages.humanoidUpdate1 = src.s_humanoid1Executed;
  target.stages.biomechanical = src.s_biomechExecuted;
  target.stages.humanoidUpdate2 = src.s_humanoid2Executed;
  target.timingsMs.motionToFinalPose = Math.max(0, src.s_finalPoseEnd - src.s_motionEnd);
  target.timingsMs.totalFrameMs = Math.max(0, src.s_frameEnd - src.s_motionEnd);
  target.orderCorrect = src.orderCorrect;
  target.overrideDetected = src.overrideDetected;
}
