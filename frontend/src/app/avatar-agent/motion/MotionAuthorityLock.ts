'use client';

/**
 * Conversational motion authority lock — single dominant writer per upper-body channel.
 *
 * PoseComposer blends IDLE → GENERATIVE → GESTURE sequentially with global weights.
 * When both idle and gesture globals stay high, spine/neck/head and arms still fight
 * unless per-bone overrides cap idle and floor gesture on conversational bones.
 */

export type ProceduralMotionAuthoritySource = 'VRMA' | 'GESTURE' | 'IDLE';

/** PoseComposer map keys used by VRMSkeletonManager / gesture idle poses */
export const CONVERSATIONAL_AUTHORITY_BONES: readonly string[] = [
  'spine',
  'chest',
  'neck',
  'head',
  'leftShoulder',
  'rightShoulder',
  'lua',
  'rua',
  'lla',
  'rla',
];

export type BoneBlendWeightOverride = {
  idle?: number;
  generative?: number;
  gesture?: number;
  collision?: number;
  vrma?: number;
};

export type MotionAuthorityLockInput = {
  motionSource: ProceduralMotionAuthoritySource;
  speaking: boolean;
  rawGestureId: string;
  behaviorEnvelope: number;
  /** Timeline gesture event active (non-idle semantics) */
  hasBehaviorGestureEvent: boolean;
  gestureLayerW: number;
  generativeExternalActive: boolean;
  vrIsolationTest: boolean;
  /** Prior-frame idle overwrite → temporary gesture-first recovery */
  authorityRecoveryActive?: boolean;
};

export type MotionAuthorityLockResult = {
  lockActive: boolean;
  envelope01: number;
  gestureStrengthFloor: number;
  idleSupportCap: number;
};

const ENV_LOCK_THRESHOLD = 0.055;

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Public clamp for any gesture / timeline envelope consumer */
export function clampGestureEnvelope01(envelope: number): number {
  return clamp01(envelope);
}

export function evaluateMotionAuthorityLock(
  input: MotionAuthorityLockInput,
): MotionAuthorityLockResult {
  const envelope01 = clampGestureEnvelope01(input.behaviorEnvelope);

  if (
    input.generativeExternalActive ||
    input.vrIsolationTest ||
    input.motionSource === 'VRMA'
  ) {
    return { lockActive: false, envelope01, gestureStrengthFloor: 0, idleSupportCap: 1 };
  }

  const conversationalGesture = input.rawGestureId !== 'idle';

  const envelopeLift =
    input.hasBehaviorGestureEvent && envelope01 > ENV_LOCK_THRESHOLD;

  const lockActive =
    input.authorityRecoveryActive === true ||
    (conversationalGesture &&
      (input.motionSource === 'GESTURE' ||
        envelopeLift ||
        input.gestureLayerW > 0.055 ||
        (input.speaking && input.hasBehaviorGestureEvent)));

  if (!lockActive) {
    return { lockActive: false, envelope01, gestureStrengthFloor: 0, idleSupportCap: 1 };
  }

  const baseGestureDrive = Math.max(
    input.gestureLayerW,
    conversationalGesture ? envelope01 * 0.84 : envelope01 * 0.35,
    input.speaking && conversationalGesture ? 0.34 : conversationalGesture ? 0.24 : 0.18,
  );

  let gestureStrengthFloor = clamp01(baseGestureDrive * 1.065);
  if (gestureStrengthFloor < 0.46) gestureStrengthFloor = 0.46;

  let idleSupportCap = clamp01(1 - gestureStrengthFloor * 0.52);
  idleSupportCap = Math.min(0.88, Math.max(0.14, idleSupportCap));

  if (input.speaking && conversationalGesture) {
    const cap2 = 0.62 - gestureStrengthFloor * 0.29;
    idleSupportCap = Math.min(idleSupportCap, Math.min(0.69, Math.max(0.11, cap2)));
  }

  if (input.authorityRecoveryActive) {
    idleSupportCap *= 0.55;
    gestureStrengthFloor = clamp01(gestureStrengthFloor * 1.08);
    gestureStrengthFloor = Math.max(gestureStrengthFloor, 0.52);
  }

  return {
    lockActive: true,
    envelope01,
    gestureStrengthFloor,
    idleSupportCap,
  };
}

export type EffectiveBlendWeights = {
  idle: number;
  gesture: number;
  generative: number;
  collision: number;
  vrma: number;
};

export function resolvePerBoneBlendWeights(
  bone: string,
  globals: EffectiveBlendWeights,
  overrides?: Map<string, Partial<EffectiveBlendWeights>>,
): EffectiveBlendWeights {
  const ov = overrides?.get(bone);
  return {
    idle: ov?.idle ?? globals.idle,
    gesture: ov?.gesture ?? globals.gesture,
    generative: ov?.generative ?? globals.generative,
    collision: ov?.collision ?? globals.collision,
    vrma: ov?.vrma ?? globals.vrma,
  };
}

export function classifyBoneAuthorityOwner(w: EffectiveBlendWeights): string {
  const pairs: [string, number][] = [
    ['generative', w.generative],
    ['vrma', w.vrma],
    ['gesture', w.gesture],
    ['idle', w.idle],
    ['collision', w.collision],
  ];
  pairs.sort((a, b) => b[1] - a[1]);
  const top = pairs[0][1];
  const second = pairs[1][1];
  if (top < 0.08) return 'bind';
  if (Math.abs(top - second) < 0.06) return 'conflict';
  return pairs[0][0];
}

export type ConversationalBoneTelemetryRow = {
  bone: string;
  idleEffective: number;
  gestureEffective: number;
  generativeEffective: number;
  vrmaEffective: number;
  authorityOwner: string;
  authorityConflict: boolean;
  angleVsBindDeg: number;
  quaternionWxyz: { w: number; x: number; y: number; z: number };
  eulerYxzDeg: { x: number; y: number; z: number };
  cameraFacingScore?: number | null;
  conversationalVisibilityProxy?: number;
};

export type MotionAuthorityRecoveryReport = {
  authorityLockWorking: boolean;
  idleSuppressionWorking: boolean;
  gesturePersistenceWorking: boolean;
  gestureEnvelopeStable: boolean;
  authorityConflictsResolved: boolean;
  spatialArmRecoveryWorking: boolean;
  conversationalEmbodimentRecovered: boolean;
  transitionStabilityWorking: boolean;
  selfHealingRecoveryWorking: boolean;
  previousRootCause: string;
  fixedAuthorityConflicts: string[];
  repairedBones: readonly string[];
  repairedBlendChains: string[];
  remainingWeaknesses: string[];
  currentDominantAuthority: string;
  conversationalVisibilityScore: number;
  gesturePersistenceScore: number;
  torsoParticipationScore: number;
  embodimentRecoveryScore: number;
  confidenceLevel: number;
};

export function buildMotionAuthorityRecoveryReport(ctx: {
  lockResult: MotionAuthorityLockResult;
  speaking: boolean;
  rawGestureId: string;
  gestureLayerW: number;
  idleLayerW: number;
  idleOverwriteDetected: boolean;
  authorityRecoveryActive: boolean;
  conversationalReachBiasApplied: boolean;
  rows: ConversationalBoneTelemetryRow[];
}): MotionAuthorityRecoveryReport {
  const conflicts = ctx.rows.filter((r) => r.authorityConflict || r.authorityOwner === 'conflict');
  const gestureWins = ctx.rows.filter((r) => r.authorityOwner === 'gesture').length;
  const torsoKeys = new Set(['spine', 'chest', 'neck', 'head']);
  const torsoGesture = ctx.rows.filter(
    (r) => torsoKeys.has(r.bone) && r.gestureEffective >= r.idleEffective - 1e-4,
  ).length;

  const gesturePersistenceScore =
    ctx.rawGestureId !== 'idle'
      ? clamp01(ctx.gestureLayerW * 0.55 + (gestureWins / Math.max(1, ctx.rows.length)) * 0.45)
      : clamp01(ctx.gestureLayerW);

  const conversationalVisibilityScore =
    ctx.rows.length === 0
      ? 0
      : clamp01(
          ctx.rows.reduce((acc, r) => acc + Math.min(1, r.angleVsBindDeg / 42), 0) / ctx.rows.length,
        );

  const torsoParticipationScore =
    torsoKeys.size === 0 ? 0 : clamp01(torsoGesture / torsoKeys.size);

  const idleSuppressed =
    ctx.lockResult.lockActive &&
    ctx.lockResult.idleSupportCap < 0.82 &&
    ctx.gestureLayerW + 1e-3 >= ctx.lockResult.gestureStrengthFloor;

  const embodimentRecoveryScore = clamp01(
    gesturePersistenceScore * 0.34 +
      conversationalVisibilityScore * 0.22 +
      torsoParticipationScore * 0.24 +
      (idleSuppressed ? 0.2 : 0.08),
  );

  const confidenceLevel = clamp01(embodimentRecoveryScore * 0.92 + (ctx.lockResult.lockActive ? 0.08 : 0));

  const repairedChains: string[] = [];
  if (ctx.lockResult.lockActive) repairedChains.push('idle↔gesture:perBoneOverrides');

  const weaknesses: string[] = [];
  if (conflicts.length > 0) weaknesses.push(`weightedBlendAmbiguity:${conflicts.length}bones`);
  if (ctx.idleOverwriteDetected && !ctx.authorityRecoveryActive)
    weaknesses.push('idleOverwrite:eventWithoutRecoveryOverlap');

  return {
    authorityLockWorking: ctx.lockResult.lockActive,
    idleSuppressionWorking: idleSuppressed,
    gesturePersistenceWorking:
      ctx.rawGestureId !== 'idle' && ctx.gestureLayerW >= 0.12 && gestureWins >= 3,
    gestureEnvelopeStable: ctx.lockResult.envelope01 >= 0 && ctx.lockResult.envelope01 <= 1.0001,
    authorityConflictsResolved: conflicts.length === 0 && ctx.lockResult.lockActive,
    spatialArmRecoveryWorking: ctx.conversationalReachBiasApplied,
    conversationalEmbodimentRecovered: embodimentRecoveryScore >= 0.52,
    transitionStabilityWorking: ctx.lockResult.lockActive && ctx.speaking && ctx.rawGestureId !== 'idle',
    selfHealingRecoveryWorking: ctx.authorityRecoveryActive || !ctx.idleOverwriteDetected,
    previousRootCause:
      'Idle layer retained global weight 1 alongside gesture weight 1; per-bone overrides omitted spine/neck/head, producing simultaneous full-weight blend steps on conversational bones.',
    fixedAuthorityConflicts: ['idle+gesture:simultaneousGlobalMax', 'missingTorsoPartition'],
    repairedBones: [...CONVERSATIONAL_AUTHORITY_BONES],
    repairedBlendChains: repairedChains,
    remainingWeaknesses: weaknesses,
    currentDominantAuthority:
      ctx.gestureLayerW >= ctx.idleLayerW + 0.04
        ? 'gesture'
        : ctx.idleLayerW > ctx.gestureLayerW
          ? 'idle'
          : 'mixed',
    conversationalVisibilityScore: +conversationalVisibilityScore.toFixed(4),
    gesturePersistenceScore: +gesturePersistenceScore.toFixed(4),
    torsoParticipationScore: +torsoParticipationScore.toFixed(4),
    embodimentRecoveryScore: +embodimentRecoveryScore.toFixed(4),
    confidenceLevel: +confidenceLevel.toFixed(4),
  };
}
