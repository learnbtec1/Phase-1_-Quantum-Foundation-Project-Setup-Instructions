'use client';

import { getBehaviorQueueDepth, getLastBehaviorAudit } from '@/app/avatar-agent/motion/behaviorTimeline';

import { diagnosticsMotionAfterBlend } from './diagnosticsMotion';
import {
  diagnosticsReporterFlush,
  type DiagnosticsFlushEmbodimentCtx,
  type DiagnosticsFlushExecCtx,
  type DiagnosticsFlushMotionCtx,
} from './diagnosticsReporter';
import { diagnosticsSpeechEnergyMismatch } from './diagnosticsSpeech';
import { diagnosticsTimelineQueueDepth, diagnosticsTimelineSnapShort } from './diagnosticsTimeline';
import { isDiagnosticsEnabled } from './diagnosticsStore';

/** Post blendPoseLayers — increments overwrite / collapse counters (hot path). */
export { diagnosticsMotionAfterBlend };

export type DiagnosticsExecLoopRef = {
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
  s_humanoid1End: number;
  s_biomechEnd: number;
  s_humanoid2End: number;
  s_frameEnd: number;
  ov_afterBio: number;
  ov_atFrameEnd: number;
};

export type DiagnosticsFrameEndArgs = {
  exec: DiagnosticsExecLoopRef;
  motionSource: string;
  gestureState: string;
  gestureLayerW: number;
  idleLayerW: number;
  vrmaLayerW: number;
  generativeLayerW: number;
  speaking: boolean;
  motionEnergyUnified: number;
  stableMotionEnergy: number;
  humanoidPresent: boolean;
  autoUpdateHumanBones: boolean | null;
  idleDominatesGesture: boolean;
  armDeviationLuaRad: number | null;
  finalPoseBoneCount: number;
  timelineEnvelope: number;
};

/**
 * Single exit-point telemetry for the avatar frame — cheap scalar work every frame;
 * structured snapshot + graph rebuild only inside {@link diagnosticsReporterFlush} throttle.
 */
export function diagnosticsFrameEnd(args: DiagnosticsFrameEndArgs): void {
  if (!isDiagnosticsEnabled()) return;

  diagnosticsSpeechEnergyMismatch(args.speaking, args.motionEnergyUnified);

  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();

  const series = [
    args.exec.s_motionEnd,
    args.exec.s_finalPoseEnd,
    args.exec.s_humanoid1End,
    args.exec.s_biomechEnd,
    args.exec.s_humanoid2End,
    args.exec.s_frameEnd,
  ];
  let orderCorrect = true;
  for (let i = 1; i < series.length; i++) {
    if (series[i] < series[i - 1]) {
      orderCorrect = false;
      break;
    }
  }
  const ovDelta = Math.abs(args.exec.ov_atFrameEnd - args.exec.ov_afterBio);
  const overrideDetected = Number.isFinite(ovDelta) && ovDelta > 1e-4;

  const execution: DiagnosticsFlushExecCtx = {
    frameCount: args.exec.frameCount,
    measuredFps: args.exec.measuredFps,
    earlyReturnReason: args.exec.earlyReturnReason,
    s_motionExecuted: args.exec.s_motionExecuted,
    s_finalPoseExecuted: args.exec.s_finalPoseExecuted,
    s_humanoid1Executed: args.exec.s_humanoid1Executed,
    s_biomechExecuted: args.exec.s_biomechExecuted,
    s_humanoid2Executed: args.exec.s_humanoid2Executed,
    s_motionEnd: args.exec.s_motionEnd,
    s_finalPoseEnd: args.exec.s_finalPoseEnd,
    s_frameEnd: args.exec.s_frameEnd,
    orderCorrect,
    overrideDetected,
  };

  const motion: DiagnosticsFlushMotionCtx = {
    motionSource: args.motionSource,
    gestureState: args.gestureState,
    gestureLayerW: args.gestureLayerW,
    idleLayerW: args.idleLayerW,
    vrmaLayerW: args.vrmaLayerW,
    generativeLayerW: args.generativeLayerW,
    idleDominatesGesture: args.idleDominatesGesture,
    armDeviationLuaRad: args.armDeviationLuaRad,
    finalPoseBoneCount: args.finalPoseBoneCount,
  };

  const speech = {
    speaking: args.speaking,
    motionEnergyUnified: args.motionEnergyUnified,
    stableMotionEnergy: args.stableMotionEnergy,
  };

  const vrm = {
    humanoidPresent: args.humanoidPresent,
    autoUpdateHumanBones: args.autoUpdateHumanBones,
  };

  const audit = getLastBehaviorAudit();
  if (audit?.snappingDetected) {
    diagnosticsTimelineSnapShort();
  }
  const qDepth = getBehaviorQueueDepth();
  diagnosticsTimelineQueueDepth(qDepth);

  const embodiment: DiagnosticsFlushEmbodimentCtx = {
    behaviorQueueDepth: qDepth,
    timelineEnvelope: args.timelineEnvelope,
  };

  diagnosticsReporterFlush(now, {
    execution,
    motion,
    speech,
    vrm,
    embodiment,
  });
}
