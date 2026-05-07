'use client';

/**
 * Deterministic 60s controlled embodiment verification — canonical gestures + optional TTS,
 * samples diagnostics + skeletal exports, evaluates checkpoints, persists logs via BFF.
 *
 * Enable: NEXT_PUBLIC_CONTROLLED_EMBODIMENT_VERIFICATION=1 (diagnostics must be on).
 * Cleaner isolation: NEXT_PUBLIC_DISABLE_AUTOMATIC_GESTURE_INJECTORS=true.
 */

import { speakWithTTS } from '@/ai/io/tts';
import { exportSkeletalTelemetryReport } from '@/lib/cognition/EmbodiedSkeletalTelemetry';
import type { BoneTelemetrySample, SkeletalTelemetryReportPayload } from '@/lib/cognition/types';
import type { DiagnosticsWindowSurface } from '@/lib/diagnostics/diagnosticsTypes';
import { isDiagnosticsEnabled } from '@/lib/diagnostics/diagnosticsStore';
import { latestBoneSample } from '@/lib/forensics/spatialFinal/boneSampleUtils';
import { dispatchAvatar } from '@/utils/events/normalizeAvatarEvents';

const CONF_REPORT_MIN = 0.55;
const TOTAL_MS = 60_000;

export type ControlledCheckpointRecord = {
  checkpoint: string;
  phase: string;
  passed: boolean;
  confidence: number;
  expectedBehavior: string;
  actualBehavior: string;
  affectedBone?: string;
  cameraVisibility?: number;
  humanReadable?: boolean;
  evidence?: string[];
};

export type ControlledEmbodimentVerificationReport = {
  sequenceExecuted: boolean;
  phasesCompleted: string[];
  checkpointResults: ControlledCheckpointRecord[];
  verifiedExecutionFailures: string[];
  verifiedSpatialFailures: string[];
  verifiedQuaternionFailures: string[];
  verifiedHumanoidPropagationFailures: string[];
  verifiedGestureVisibilityFailures: string[];
  verifiedConversationalCompressionFailures: string[];
  dominantMotionCollapseStage: string;
  dominantSpatialFailure: string;
  dominantExecutionFailure: string;
  gestureVisibilityScore: number;
  cameraReadabilityScore: number;
  torsoParticipationScore: number;
  conversationalEmbodimentScore: number;
  finalRenderedMotionStrength: number;
  mostLikelyReasonAvatarAppearsStatic: string;
  expectedBehaviorIfFailureRemoved: string;
  confidenceLevel: number;
};

type Sample = { iso: string; shell: DiagnosticsWindowSurface | null; skeletal: SkeletalTelemetryReportPayload };

function readShell(): DiagnosticsWindowSurface | null {
  if (typeof window === 'undefined') return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = (window as any).__DIAGNOSTICS as DiagnosticsWindowSurface | undefined;
  return d && typeof d === 'object' ? d : null;
}

function takeSample(): Sample {
  return { iso: new Date().toISOString(), shell: readShell(), skeletal: exportSkeletalTelemetryReport() };
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('aborted', 'AbortError'));
      return;
    }
    const id = window.setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        window.clearTimeout(id);
        reject(new DOMException('aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

async function collectSamples(durationMs: number, signal: AbortSignal, bucket: Sample[]): Promise<void> {
  const end = Date.now() + durationMs;
  while (Date.now() < end) {
    if (signal.aborted) break;
    bucket.push(takeSample());
    try {
      await sleep(420, signal);
    } catch {
      break;
    }
  }
}

function mean(nums: number[]): number {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

function frac(cond: boolean[]): number {
  if (!cond.length) return 0;
  return cond.filter(Boolean).length / cond.length;
}

function bone(samples: Sample[], key: string): BoneTelemetrySample[] {
  const out: BoneTelemetrySample[] = [];
  for (const s of samples) {
    const last = latestBoneSample(s.skeletal.bones[key]);
    if (last) out.push(last);
  }
  return out;
}

function evalGestureGeneration(samples: Sample[], phase: string): ControlledCheckpointRecord {
  const mo = samples.map((s) => s.shell?.motion.motionSource ?? '');
  const gw = samples.map((s) => s.shell?.motion.gestureLayerW ?? 0);
  const gestureHit = frac(samples.map((_, i) => mo[i] === 'GESTURE' && gw[i] > 0.04));
  const passed = gestureHit >= 0.35;
  const confidence = passed ? 0.72 : Math.min(0.94, 0.58 + (1 - gestureHit) * 0.45);
  return {
    checkpoint: 'CHECKPOINT_A_GESTURE_GENERATION',
    phase,
    passed,
    confidence,
    expectedBehavior: 'gesture active; gestureLayerW > 0; motionSource = GESTURE',
    actualBehavior: `gesture_hit_fraction=${gestureHit.toFixed(2)} lastMotion=${mo[mo.length - 1] ?? 'n/a'}`,
    evidence: [`samples=${samples.length}`, `meanGestureW=${mean(gw).toFixed(3)}`],
  };
}

function evalPoseComposition(samples: Sample[], phase: string): ControlledCheckpointRecord {
  const ru = bone(samples, 'rightUpperArm');
  const spread = samples.some((s) => latestBoneSample(s.skeletal.bones.leftShoulder))
    ? mean(
        samples.map((s) => {
          const ls = latestBoneSample(s.skeletal.bones.leftShoulder);
          const rs = latestBoneSample(s.skeletal.bones.rightShoulder);
          return ls && rs ? Math.abs(rs.localEulerDeg.roll - ls.localEulerDeg.roll) : 0;
        }),
      )
    : 0;
  const openness = mean(ru.map((b) => Math.abs(b.localEulerDeg.yaw)));
  const passed = openness > 8 || spread > 6;
  const confidence = passed ? 0.68 : Math.min(0.9, 0.55 + Math.max(0, (14 - openness) / 40));
  return {
    checkpoint: 'CHECKPOINT_B_POSE_COMPOSITION',
    phase,
    passed,
    confidence,
    expectedBehavior: 'arm openness valid; shoulder spread valid',
    actualBehavior: `meanAbsArmYawDeg=${openness.toFixed(1)} shoulderSpreadDeg=${spread.toFixed(1)}`,
    affectedBone: 'rightUpperArm',
  };
}

function evalFinalBoneRotation(samples: Sample[], phase: string): ControlledCheckpointRecord {
  const ru = bone(samples, 'rightUpperArm');
  const rl = bone(samples, 'rightLowerArm');
  const fz = mean(ru.map((b) => b.forwardVector.z));
  const backward = frac(ru.map((b) => /BACKWARD|CORRUPTION/i.test(b.biomechanicalStatus)));
  const passed = fz > 0.22 && backward < 0.35;
  const confidence = passed ? 0.7 : Math.min(0.92, 0.56 + backward * 0.5 + Math.max(0, 0.22 - fz) * 2);
  return {
    checkpoint: 'CHECKPOINT_C_FINAL_BONE_ROTATION',
    phase,
    passed,
    confidence,
    expectedBehavior: 'rightUpperArm forward-facing; elbow/wrist orientation valid',
    actualBehavior: `meanFwdZ=${fz.toFixed(2)} backward_frac=${backward.toFixed(2)}`,
    affectedBone: 'rightUpperArm',
    evidence: rl.length ? [`lowerArmYawMean=${mean(rl.map((b) => b.localEulerDeg.yaw)).toFixed(1)}`] : [],
    humanReadable: passed,
  };
}

function evalCameraVisibility(samples: Sample[], phase: string): ControlledCheckpointRecord {
  const ru = bone(samples, 'rightUpperArm');
  const cam = mean(ru.map((b) => b.cameraFacingScore));
  const passed = cam >= 0.26;
  const confidence = passed ? 0.66 : Math.min(0.91, 0.55 + Math.max(0, 0.26 - cam) * 2.2);
  return {
    checkpoint: 'CHECKPOINT_D_CAMERA_VISIBILITY',
    phase,
    passed,
    confidence,
    expectedBehavior: 'gesture visible to camera; arm not fully torso-occluded (proxy)',
    actualBehavior: `meanCameraFacingArm=${cam.toFixed(3)}`,
    affectedBone: 'rightUpperArm',
    cameraVisibility: cam,
    humanReadable: passed,
  };
}

function evalTorsoParticipation(samples: Sample[], phase: string): ControlledCheckpointRecord {
  const env = samples.map((s) => s.shell?.embodiment.timelineEnvelope ?? 0);
  const chest = bone(samples, 'chest');
  const chestRead = mean(chest.map((b) => b.conversationalReadability));
  const mEnv = mean(env);
  const passed = mEnv > 0.07 || chestRead > 0.22;
  const confidence = passed ? 0.64 : Math.min(0.88, 0.55 + Math.max(0, 0.12 - mEnv) * 3);
  return {
    checkpoint: 'CHECKPOINT_E_TORSO_PARTICIPATION',
    phase,
    passed,
    confidence,
    expectedBehavior: 'torso / timeline envelope participates (proxy for torsoContribution)',
    actualBehavior: `meanTimelineEnvelope=${mEnv.toFixed(3)} chestReadability=${chestRead.toFixed(3)}`,
    affectedBone: 'chest',
  };
}

function evalConversationalVisibility(samples: Sample[], phase: string): ControlledCheckpointRecord {
  const lh = bone(samples, 'leftHand');
  const rh = bone(samples, 'rightHand');
  const cam = mean([...lh, ...rh].map((b) => b.cameraFacingScore));
  const passed = cam >= 0.24;
  const confidence = passed ? 0.63 : Math.min(0.9, 0.55 + Math.max(0, 0.24 - cam) * 2);
  return {
    checkpoint: 'CHECKPOINT_F_CONVERSATIONAL_VISIBILITY',
    phase,
    passed,
    confidence,
    expectedBehavior: 'hands visible; conversational readability proxies acceptable',
    actualBehavior: `meanHandsCameraFacing=${cam.toFixed(3)}`,
    cameraVisibility: cam,
    humanReadable: passed,
  };
}

function evalGesturePersistence(samples: Sample[], phase: string): ControlledCheckpointRecord {
  const gw = samples.map((s) => s.shell?.motion.gestureLayerW ?? 0);
  const blocks = samples.map((s) => s.shell?.scheduler.blocksSinceFlush ?? 0);
  const sustained = frac(gw.map((v) => v > 0.06));
  const blockSpike = mean(blocks) > 18;
  const passed = sustained >= 0.45 && !blockSpike;
  const confidence = passed ? 0.62 : Math.min(0.9, 0.56 + (1 - sustained) * 0.35 + (blockSpike ? 0.18 : 0));
  return {
    checkpoint: 'CHECKPOINT_G_GESTURE_PERSISTENCE',
    phase,
    passed,
    confidence,
    expectedBehavior: 'gestures sustained across phase window; scheduler starvation bounded',
    actualBehavior: `sustainedGestureFrac=${sustained.toFixed(2)} meanBlocks=${mean(blocks).toFixed(1)}`,
  };
}

function evalCameraProjection(samples: Sample[], phase: string): ControlledCheckpointRecord {
  const ru = bone(samples, 'rightUpperArm');
  const read = mean(ru.map((b) => b.conversationalReadability));
  const passed = read >= 0.26;
  const confidence = passed ? 0.65 : Math.min(0.88, 0.55 + Math.max(0, 0.26 - read) * 2);
  return {
    checkpoint: 'CHECKPOINT_H_CAMERA_PROJECTION',
    phase,
    passed,
    confidence,
    expectedBehavior: 'conversational readability proxy acceptable for projection phase',
    actualBehavior: `meanConversationalReadability=${read.toFixed(3)}`,
    humanReadable: passed,
  };
}

function evalSemanticCoherence(samples: Sample[], phase: string): ControlledCheckpointRecord {
  const mo = samples.map((s) => s.shell?.motion.motionSource ?? '');
  const gs = samples.map((s) => s.shell?.motion.gestureState ?? '');
  const gestureish = frac(
    samples.map((_, i) => mo[i] === 'GESTURE' || gs[i] === 'think' || gs[i].includes('think')),
  );
  const passed = gestureish >= 0.25;
  const confidence = passed ? 0.61 : Math.min(0.87, 0.55 + (1 - gestureish) * 0.5);
  return {
    checkpoint: 'CHECKPOINT_I_SEMANTIC_COHERENCE',
    phase,
    passed,
    confidence,
    expectedBehavior: 'thinking motion / semantic posture proxies observable',
    actualBehavior: `think_motion_frac=${gestureish.toFixed(2)}`,
  };
}

function evalNeckHead(samples: Sample[], phase: string): ControlledCheckpointRecord {
  const nk = bone(samples, 'neck');
  const hd = bone(samples, 'head');
  const yawSpread =
    nk.length > 2
      ? Math.max(...nk.map((b) => Math.abs(b.localEulerDeg.yaw))) -
        Math.min(...nk.map((b) => Math.abs(b.localEulerDeg.yaw)))
      : 0;
  const headOm = mean(hd.map((b) => Math.abs(b.angularVelocityRadS)));
  const passed = yawSpread > 1.2 || mean(hd.map((b) => Math.abs(b.localEulerDeg.yaw))) > 4;
  const confidence = passed ? 0.6 : Math.min(0.86, 0.56 + Math.max(0, 3 - yawSpread) * 0.08);
  return {
    checkpoint: 'CHECKPOINT_J_NECK_AND_HEAD',
    phase,
    passed,
    confidence,
    expectedBehavior: 'neck animation variance or head involvement present',
    actualBehavior: `neckYawSpreadDeg=${yawSpread.toFixed(2)} headOmegaMean=${headOm.toFixed(3)}`,
    affectedBone: 'neck',
  };
}

function evalArmOpenness(samples: Sample[], phase: string): ControlledCheckpointRecord {
  const ru = bone(samples, 'rightUpperArm');
  const lu = bone(samples, 'leftUpperArm');
  const spread = mean([...ru, ...lu].map((b) => Math.abs(b.localEulerDeg.yaw)));
  const passed = spread > 14;
  const confidence = passed ? 0.67 : Math.min(0.89, 0.55 + Math.max(0, 14 - spread) / 35);
  return {
    checkpoint: 'CHECKPOINT_K_ARM_OPENNESS',
    phase,
    passed,
    confidence,
    expectedBehavior: 'open-arm explanation envelope readable',
    actualBehavior: `meanAbsUpperArmYawDeg=${spread.toFixed(1)}`,
    humanReadable: passed,
  };
}

function evalSpatialReadability(samples: Sample[], phase: string): ControlledCheckpointRecord {
  const ru = bone(samples, 'rightUpperArm');
  const compressed = frac(ru.map((b) => Math.abs(b.localEulerDeg.yaw) < 10 && b.cameraFacingScore < 0.2));
  const passed = compressed < 0.55;
  const confidence = passed ? 0.66 : Math.min(0.93, 0.58 + compressed * 0.45);
  return {
    checkpoint: 'CHECKPOINT_L_SPATIAL_READABILITY',
    phase,
    passed,
    confidence,
    expectedBehavior: 'avoid prolonged compressed unreadable arm posture',
    actualBehavior: `compressed_posture_frac=${compressed.toFixed(2)}`,
    humanReadable: passed,
  };
}

function evalHumanoidPropagation(samples: Sample[], phase: string): ControlledCheckpointRecord {
  const inv = samples.map((s) => s.shell?.vrm.invalidQuatSamplesSinceFlush ?? 0);
  const hu2 = samples.map((s) => s.shell?.execution.stages.humanoidUpdate2 ?? false);
  const bio = samples.map((s) => s.shell?.execution.stages.biomechanical ?? false);
  const invMean = mean(inv);
  const hu2hit = frac(hu2);
  const biohit = frac(bio);
  const passed = invMean < 1.5 && hu2hit >= 0.5 && biohit >= 0.45;
  const confidence = passed ? 0.71 : Math.min(0.93, 0.58 + invMean * 0.12 + (1 - hu2hit) * 0.35);
  return {
    checkpoint: 'CHECKPOINT_M_HUMANOID_PROPAGATION',
    phase,
    passed,
    confidence,
    expectedBehavior: 'humanoid stages execute; invalid quaternion counters quiet',
    actualBehavior: `invalidQuatMean=${invMean.toFixed(2)} humanoidUpdate2_frac=${hu2hit.toFixed(2)} biomech_frac=${biohit.toFixed(2)}`,
  };
}

function evalFinalRenderedPose(samples: Sample[], phase: string): ControlledCheckpointRecord {
  const ru = bone(samples, 'rightUpperArm');
  const bad = frac(
    ru.map((b) => /BACKWARD|CORRUPTION|MISMATCH|AUTHORITY_STRADDLE/i.test(b.biomechanicalStatus)),
  );
  const gw = mean(samples.map((s) => s.shell?.motion.gestureLayerW ?? 0));
  const passed = bad < 0.4 && gw > 0.05;
  const confidence = passed ? 0.69 : Math.min(0.92, 0.57 + bad * 0.45);
  return {
    checkpoint: 'CHECKPOINT_N_FINAL_RENDERED_POSE',
    phase,
    passed,
    confidence,
    expectedBehavior: 'final proxies align with conversational posture / authority',
    actualBehavior: `biomech_bad_frac=${bad.toFixed(2)} meanGestureW=${gw.toFixed(3)}`,
    affectedBone: 'rightUpperArm',
    humanReadable: passed,
  };
}

function executionTraceRows(samples: Sample[]): Array<Record<string, unknown>> {
  return samples.map((s) => ({
    iso: s.iso,
    motionSource: s.shell?.motion.motionSource ?? null,
    gestureState: s.shell?.motion.gestureState ?? null,
    gestureLayerW: s.shell?.motion.gestureLayerW ?? null,
    idleLayerW: s.shell?.motion.idleLayerW ?? null,
    idleDominatesGesture: s.shell?.motion.idleDominatesGesture ?? null,
    stages: s.shell?.execution.stages ?? null,
    orderCorrect: s.shell?.execution.orderCorrect ?? null,
    invalidQuatSinceFlush: s.shell?.vrm.invalidQuatSamplesSinceFlush ?? null,
    nullBoneSinceFlush: s.shell?.vrm.nullBoneSamplesSinceFlush ?? null,
    schedulerBlocks: s.shell?.scheduler.blocksSinceFlush ?? null,
    speaking: s.shell?.speech.speaking ?? null,
  }));
}

function spatialAggForPhase(samples: Sample[]): Record<string, unknown> {
  const ru = bone(samples, 'rightUpperArm');
  const chest = bone(samples, 'chest');
  return {
    sampleCount: samples.length,
    meanRightUpperArmYawDeg: mean(ru.map((b) => b.localEulerDeg.yaw)),
    meanRightUpperArmForwardZ: mean(ru.map((b) => b.forwardVector.z)),
    meanCameraFacingRightArm: mean(ru.map((b) => b.cameraFacingScore)),
    meanGestureLayerW: mean(samples.map((s) => s.shell?.motion.gestureLayerW ?? 0)),
    meanTimelineEnvelope: mean(samples.map((s) => s.shell?.embodiment.timelineEnvelope ?? 0)),
    meanChestReadability: mean(chest.map((b) => b.conversationalReadability)),
  };
}

function compileVerificationReport(args: {
  phasesCompleted: string[];
  checkpoints: ControlledCheckpointRecord[];
}): ControlledEmbodimentVerificationReport {
  const cp = args.checkpoints;
  const failed = cp.filter((c) => !c.passed && c.confidence >= CONF_REPORT_MIN);

  const verifiedSpatialFailures = failed
    .filter((c) => /CAMERA|VISIBILITY|SPATIAL|OPENNESS|RENDERED|TORSO/i.test(c.checkpoint))
    .map((c) => `${c.checkpoint}:${c.actualBehavior}`);
  const verifiedExecutionFailures = failed
    .filter((c) => /GESTURE_GENERATION|PERSISTENCE|HUMANOID|PROPAGATION/i.test(c.checkpoint))
    .map((c) => `${c.checkpoint}:${c.actualBehavior}`);
  const verifiedQuaternionFailures = failed
    .filter((c) => /HUMANOID|FINAL_BONE|RENDERED/i.test(c.checkpoint))
    .filter((c) => /invalid|quat|backward/i.test(c.actualBehavior))
    .map((c) => `${c.checkpoint}:${c.actualBehavior}`);
  const verifiedHumanoidPropagationFailures = failed
    .filter((c) => c.checkpoint.includes('HUMANOID'))
    .map((c) => `${c.checkpoint}:${c.actualBehavior}`);
  const verifiedGestureVisibilityFailures = failed
    .filter((c) => /CAMERA|VISIBILITY|PROJECTION/i.test(c.checkpoint))
    .map((c) => `${c.checkpoint}:${c.actualBehavior}`);
  const verifiedConversationalCompressionFailures = failed
    .filter((c) => /SPATIAL_READABILITY|COMPOSITION/i.test(c.checkpoint))
    .map((c) => `${c.checkpoint}:${c.actualBehavior}`);

  const topFail = [...failed].sort((a, b) => b.confidence - a.confidence)[0];
  let dominantMotionCollapseStage = 'none_detected';
  let dominantSpatialFailure = 'none_detected';
  let dominantExecutionFailure = 'none_detected';

  if (topFail) {
    if (/GESTURE_GENERATION|PERSISTENCE/i.test(topFail.checkpoint)) dominantExecutionFailure = topFail.checkpoint;
    if (/HUMANOID|PROPAGATION/i.test(topFail.checkpoint)) dominantMotionCollapseStage = 'humanoid_propagation';
    else if (/GESTURE_GENERATION/i.test(topFail.checkpoint)) dominantMotionCollapseStage = 'semantic_gesture_authority';
    else if (/PERSISTENCE/i.test(topFail.checkpoint)) dominantMotionCollapseStage = 'scheduler_timeline';
    else if (/CAMERA|VISIBILITY|PROJECTION|SPATIAL|OPENNESS|RENDERED/i.test(topFail.checkpoint)) {
      dominantSpatialFailure = topFail.checkpoint;
      if (dominantMotionCollapseStage === 'none_detected') dominantMotionCollapseStage = 'spatial_camera_readability';
    }
  }

  const gestureVisibilityScore = Math.round(
    (() => {
      const xs = cp.filter((c) => c.cameraVisibility != null).map((c) => (c.cameraVisibility ?? 0) * 100);
      return xs.length ? mean(xs) : 0;
    })(),
  );
  const cameraReadabilityScore = Math.round(
    (() => {
      const xs = cp.filter((c) => c.checkpoint.includes('CAMERA')).map((c) => (c.passed ? 78 : 28));
      return xs.length ? mean(xs) : 50;
    })(),
  );
  const torsoParticipationScore = Math.round(
    (() => {
      const xs = cp.filter((c) => c.checkpoint.includes('TORSO')).map((c) => (c.passed ? 80 : 35));
      return xs.length ? mean(xs) : 50;
    })(),
  );
  const conversationalEmbodimentScore = Math.round(
    (() => {
      const xs = cp
        .filter((c) => /CONVERSATIONAL|VISIBILITY|PROJECTION/i.test(c.checkpoint))
        .map((c) => (c.passed ? 82 : 34));
      return xs.length ? mean(xs) : 50;
    })(),
  );
  const finalRenderedMotionStrength = Math.round(
    (() => {
      const xs = cp.filter((c) => /FINAL|BONE|RENDERED/i.test(c.checkpoint)).map((c) => (c.passed ? 85 : 40));
      return xs.length ? mean(xs) : 50;
    })(),
  );

  const confidenceLevel = Math.round(
    (() => {
      const xs = failed.length ? failed.map((c) => c.confidence * 100) : cp.map((c) => (c.passed ? 72 : 55));
      return xs.length ? mean(xs) : 50;
    })(),
  );

  const mostLikelyReasonAvatarAppearsStatic =
    topFail && topFail.confidence >= CONF_REPORT_MIN
      ? `${topFail.checkpoint}: ${topFail.actualBehavior}`
      : 'No high-confidence controlled collapse — check flush cadence / idle injectors if avatar still looks static.';

  const expectedBehaviorIfFailureRemoved =
    topFail && topFail.confidence >= CONF_REPORT_MIN
      ? topFail.expectedBehavior
      : 'Maintain gesture→authority→pose→humanoid ordering with diagnostics skeletal proofs.';

  return {
    sequenceExecuted: true,
    phasesCompleted: args.phasesCompleted,
    checkpointResults: cp,
    verifiedExecutionFailures,
    verifiedSpatialFailures,
    verifiedQuaternionFailures,
    verifiedHumanoidPropagationFailures,
    verifiedGestureVisibilityFailures,
    verifiedConversationalCompressionFailures,
    dominantMotionCollapseStage,
    dominantSpatialFailure,
    dominantExecutionFailure,
    gestureVisibilityScore,
    cameraReadabilityScore,
    torsoParticipationScore,
    conversationalEmbodimentScore,
    finalRenderedMotionStrength,
    mostLikelyReasonAvatarAppearsStatic,
    expectedBehaviorIfFailureRemoved,
    confidenceLevel,
  };
}

async function postArtifacts(payload: Record<string, unknown>): Promise<void> {
  if ((process.env.NEXT_PUBLIC_CONTROLLED_EMBODIMENT_REPORT_SYNC ?? '1').trim() === '0') return;
  try {
    await fetch('/api/diagnostics/controlled-embodiment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    });
  } catch {
    /* best-effort */
  }
}

let _running = false;
let _abort: AbortController | null = null;

export function cancelControlledEmbodimentVerificationSequence(): void {
  _abort?.abort();
}

export function startControlledEmbodimentVerificationSequence(): { cancel: () => void } {
  if (typeof window === 'undefined') return { cancel: () => {} };
  if (_running) return { cancel: () => _abort?.abort() };
  if (!isDiagnosticsEnabled()) return { cancel: () => {} };
  if ((process.env.NEXT_PUBLIC_CONTROLLED_EMBODIMENT_VERIFICATION ?? '').trim() !== '1') {
    return { cancel: () => {} };
  }

  _running = true;
  _abort = new AbortController();
  const signal = _abort.signal;

  void (async (): Promise<void> => {
    const phasesCompleted: string[] = [];
    const allCheckpoints: ControlledCheckpointRecord[] = [];
    const spatialByPhase: Record<string, Record<string, unknown>> = {};
    const trace: Array<Record<string, unknown>> = [];
    const failuresOut: ControlledCheckpointRecord[] = [];

    try {
      await sleep(900, signal);

      const p1: Sample[] = [];
      dispatchAvatar('avatar:emotion', { emotion: 'friendly', strength: 0.55 });
      dispatchAvatar('avatar:gesture', { type: 'wave', duration: 9.5, side: 'right', intensity: 0.92 });
      void speakWithTTS('Hello. I am starting embodiment diagnostics.', { emotion: 'neutral' });
      await collectSamples(10_000, signal, p1);
      trace.push(...executionTraceRows(p1));
      spatialByPhase.phase1_greeting_wave = spatialAggForPhase(p1);
      allCheckpoints.push(
        evalGestureGeneration(p1, 'phase1'),
        evalPoseComposition(p1, 'phase1'),
        evalFinalBoneRotation(p1, 'phase1'),
        evalCameraVisibility(p1, 'phase1'),
      );
      phasesCompleted.push('phase1_greeting_wave');

      const p2: Sample[] = [];
      dispatchAvatar('avatar:gesture', { type: 'explain', duration: 18, side: 'both', intensity: 0.88 });
      void speakWithTTS('What would you like me to explain today?', { emotion: 'friendly' });
      await collectSamples(20_000, signal, p2);
      trace.push(...executionTraceRows(p2));
      spatialByPhase.phase2_conversational_explain = spatialAggForPhase(p2);
      allCheckpoints.push(
        evalTorsoParticipation(p2, 'phase2'),
        evalConversationalVisibility(p2, 'phase2'),
        evalGesturePersistence(p2, 'phase2'),
        evalCameraProjection(p2, 'phase2'),
      );
      phasesCompleted.push('phase2_conversational_explain');

      const p3: Sample[] = [];
      dispatchAvatar('avatar:gesture', { type: 'think', duration: 9, side: 'right', intensity: 0.82 });
      window.dispatchEvent(
        new CustomEvent('avatar:gaze', {
          detail: { target: 'think', yaw: -0.12, pitch: -0.07, durationMs: 8000 },
        }),
      );
      void speakWithTTS('Analyzing conversational context.', { emotion: 'thinking' });
      await collectSamples(10_000, signal, p3);
      trace.push(...executionTraceRows(p3));
      spatialByPhase.phase3_thinking = spatialAggForPhase(p3);
      allCheckpoints.push(evalSemanticCoherence(p3, 'phase3'), evalNeckHead(p3, 'phase3'));
      phasesCompleted.push('phase3_thinking');

      const p4: Sample[] = [];
      dispatchAvatar('avatar:gesture', { type: 'hands_up', duration: 10, side: 'both', intensity: 0.9 });
      dispatchAvatar('avatar:gesture', { type: 'explain', duration: 14, side: 'both', intensity: 0.88 });
      void speakWithTTS('I can help explain programming, AI, and avatar systems.', { emotion: 'encouraging' });
      await collectSamples(20_000, signal, p4);
      trace.push(...executionTraceRows(p4));
      spatialByPhase.phase4_open_explanation = spatialAggForPhase(p4);
      allCheckpoints.push(
        evalArmOpenness(p4, 'phase4'),
        evalSpatialReadability(p4, 'phase4'),
        evalHumanoidPropagation(p4, 'phase4'),
        evalFinalRenderedPose(p4, 'phase4'),
      );
      phasesCompleted.push('phase4_open_explanation');

      const verificationReport = compileVerificationReport({ phasesCompleted, checkpoints: allCheckpoints });
      for (const c of allCheckpoints) {
        if (!c.passed && c.confidence >= CONF_REPORT_MIN) failuresOut.push(c);
      }

      await postArtifacts({
        controlled_embodiment_sequence_report: {
          timestamp: new Date().toISOString(),
          totalMs: TOTAL_MS,
          notes: [
            'Uses diagnostics shell + flush-fed skeletal telemetry proxies.',
            'TTS requires JWT/guest per speakWithTTS.',
            'Optional: NEXT_PUBLIC_DISABLE_AUTOMATIC_GESTURE_INJECTORS=true for isolation.',
          ],
          CONTROLLED_EMBODIMENT_VERIFICATION_REPORT: verificationReport,
        },
        controlled_embodiment_checkpoints: allCheckpoints,
        controlled_embodiment_failures: failuresOut,
        controlled_embodiment_spatial_analysis: spatialByPhase,
        controlled_embodiment_execution_trace: trace,
      });

      // eslint-disable-next-line no-console
      console.info('[CONTROLLED_EMBODIMENT_VERIFICATION_REPORT]\n' + JSON.stringify(verificationReport, null, 2));
    } catch {
      /* aborted */
    } finally {
      _running = false;
      _abort = null;
    }
  })();

  return { cancel: (): void => _abort?.abort() };
}
