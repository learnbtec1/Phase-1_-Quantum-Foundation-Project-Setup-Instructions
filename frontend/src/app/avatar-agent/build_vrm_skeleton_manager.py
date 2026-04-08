# One-off: builds VRMSkeletonManager.tsx from AvatarCanvas.tsx excerpt.
from pathlib import Path

ROOT = Path(__file__).resolve().parent
src = (ROOT / "AvatarCanvas.tsx").read_text(encoding="utf-8")
lines = src.splitlines()
# 1-based line numbers from editor: 3975-4742 inclusive
body_lines = lines[3974:4742]
dedented = []
for ln in body_lines:
    inner = ln[4:] if ln.startswith("    ") else ln
    dedented.append("    " + inner if inner.strip() else inner)
body = "\n".join(dedented)
body = body.replace("_noise3D(", "skelNoise3D(")
body = body.replace("rawBone8(", "skelRawBone8(")
body = body.replace("resetLowerBodyToIdle()", "onResetLowerBody()")

header = r"""'use client';

import React, { useMemo } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import type { VRM } from '@pixiv/three-vrm';
import { createNoise3D } from 'simplex-noise';
import { Easing, lerp } from './utils';
import { breathSpineAmount } from './proceduralLife';
import { isHandSeparationPulseActive } from './physics/WorldColliders';
import {
  AVATAR_BREATHE_SCALE_VRM1,
  BREATHE_AMP_SITTING_VRM1,
  BREATHE_AMP_STANDING_VRM1,
  BREATHE_AMP_SITTING,
  BREATHE_AMP_STANDING,
  ENABLE_PROCEDURAL_LIFE,
  ENABLE_FULL_BODY_PROCEDURAL,
  PROC_LIFE_GESTURE_OVERLAY,
  SHOULDER_DROP_RAD,
  SIT_UPPER_LEG_X_VRM0,
  SIT_UPPER_LEG_X_VRM1,
  SIT_LOWER_LEG_X_SEATED,
  WALK_CYCLE_RAD_PER_S,
  WALK_WRIST_MIN_SEP_M,
} from '@/config/avatar';

const WAVE_DURATION = 3.5;

const SK_Euler = new THREE.Euler();
const SK_Euler2 = new THREE.Euler();
const SK_Quat = new THREE.Quaternion();
const SK_Quat2 = new THREE.Quaternion();
const SK_Quat3 = new THREE.Quaternion();
const SK_V_AXIS_X = new THREE.Vector3(1, 0, 0);
const SK_V_AXIS_Y = new THREE.Vector3(0, 1, 0);
const SK_V_AXIS_Z = new THREE.Vector3(0, 0, 1);
const SK_wristSepWpA = new THREE.Vector3();
const SK_wristSepWpB = new THREE.Vector3();

const _skelBoneWarned = new Set<string>();
function skelRawBone8(humanoid: NonNullable<VRM['humanoid']>, boneName: string): THREE.Object3D | null {
  let n: THREE.Object3D | null = null;
  try {
    n = humanoid.getRawBoneNode(boneName as never) ?? null;
  } catch {
    n = null;
  }
  if (!n && !_skelBoneWarned.has(boneName)) {
    _skelBoneWarned.add(boneName);
    console.warn('[VRMSkeletonManager] Missing bone — rotation skipped:', boneName);
  }
  return n;
}

export type AvatarMotionPhase = 'idle' | 'listening' | 'thinking' | 'speaking';

export type VRMSkeletonFrame = {
  safeDelta: number;
  t: number;
  now: number;
  phase: AvatarMotionPhase;
  isVRMAWalking: boolean;
  isSittingNow: boolean;
  isSittingEffective: boolean;
  skelMul: number;
  isWalkingNow: boolean;
  isLaughingNow: boolean;
  disableStabilizers: boolean;
};

export type VRMSkeletonRefs = {
  vrmRef: React.MutableRefObject<VRM | null>;
  groupRef: React.RefObject<THREE.Group | null>;
  spineBreathRef: React.MutableRefObject<number>;
  neckGazeYawRef: React.MutableRefObject<number>;
  neckGazePitchRef: React.MutableRefObject<number>;
  proceduralBreathingRateRef: React.MutableRefObject<number>;
  vrmMetaIsV1Ref: React.MutableRefObject<boolean>;
  nodUntilRef: React.MutableRefObject<number>;
  nodStartRef: React.MutableRefObject<number>;
  nodDurationRef: React.MutableRefObject<number>;
  vrmaReadyRef: React.MutableRefObject<boolean>;
  vrmaGestureNowRef: React.MutableRefObject<boolean>;
  vrmaGestureUntilRef: React.MutableRefObject<number>;
  vrmaClipDoneRef: React.MutableRefObject<boolean>;
  activeVrmaRef: React.MutableRefObject<string | undefined>;
  procLifeDampRef: React.MutableRefObject<number>;
  isTalkingRef: React.MutableRefObject<boolean>;
  isTranscribingRef: React.MutableRefObject<boolean>;
  isListeningExtRef: React.MutableRefObject<boolean>;
  headRollRef: React.MutableRefObject<number>;
  headUntilRef: React.MutableRefObject<number>;
  headYawRef: React.MutableRefObject<number>;
  headPitchRef: React.MutableRefObject<number>;
  idleHeadOffsetRef: React.MutableRefObject<number>;
  headYawSmoothRef: React.MutableRefObject<number>;
  headPitchSmoothRef: React.MutableRefObject<number>;
  headRollSmoothRef: React.MutableRefObject<number>;
  lifeLongHeadTiltRef: React.MutableRefObject<number>;
  headRollEmotionRef: React.MutableRefObject<number>;
  lifeHipTiltZRef: React.MutableRefObject<number>;
  lifeShoulderDropSideRef: React.MutableRefObject<'left' | 'right'>;
  proceduralLogUntilRef: React.MutableRefObject<number>;
  eyeContactIntensityRef: React.MutableRefObject<number>;
  nextEyeSaccadeRef: React.MutableRefObject<number>;
  eyeTargetXRef: React.MutableRefObject<number>;
  eyeTargetYRef: React.MutableRefObject<number>;
  waveUntilRef: React.MutableRefObject<number>;
  gestureRef: React.MutableRefObject<{
    type: 'point' | 'openHand' | 'beat';
    side: 'left' | 'right' | 'both';
    startMs: number;
    durationMs: number;
  } | null>;
  walkUntilRef: React.MutableRefObject<number>;
  laughUntilRef: React.MutableRefObject<number>;
  shoulderShrugUntilRef: React.MutableRefObject<number>;
  handsUpUntilRef: React.MutableRefObject<number>;
  fingerTapUntilRef: React.MutableRefObject<number>;
  fingerTapSideRef: React.MutableRefObject<'left' | 'right'>;
  hipsBindPosRef: React.MutableRefObject<THREE.Vector3 | null>;
  bindLowerBodyRotationsRef: React.MutableRefObject<Map<string, THREE.Quaternion>>;
  pointFingerBlendRef: React.MutableRefObject<number>;
};

export type VRMSkeletonManagerProps = {
  frameRef: React.MutableRefObject<VRMSkeletonFrame | null>;
  r: VRMSkeletonRefs;
  onResetLowerBody: () => void;
};

export function VRMSkeletonManager({ frameRef, r, onResetLowerBody }: VRMSkeletonManagerProps): null {
  const { camera } = useThree();
  const skelNoise3D = useMemo(() => createNoise3D(), []);

  useFrame(() => {
    const fr = frameRef.current;
    if (!fr) return;
    const v = r.vrmRef.current;
    const group = r.groupRef.current;
    if (!v || !group) return;

    const {
      safeDelta,
      t,
      now,
      phase,
      isVRMAWalking,
      isSittingNow,
      isSittingEffective,
      skelMul,
      isWalkingNow,
      isLaughingNow,
      disableStabilizers,
    } = fr;

    const spineBreathRef = r.spineBreathRef;
    const neckGazeYawRef = r.neckGazeYawRef;
    const neckGazePitchRef = r.neckGazePitchRef;
    const proceduralBreathingRateRef = r.proceduralBreathingRateRef;
    const vrmMetaIsV1Ref = r.vrmMetaIsV1Ref;
    const nodUntilRef = r.nodUntilRef;
    const nodStartRef = r.nodStartRef;
    const nodDurationRef = r.nodDurationRef;
    const vrmaReadyRef = r.vrmaReadyRef;
    const vrmaGestureNowRef = r.vrmaGestureNowRef;
    const vrmaGestureUntilRef = r.vrmaGestureUntilRef;
    const vrmaClipDoneRef = r.vrmaClipDoneRef;
    const activeVrmaRef = r.activeVrmaRef;
    const procLifeDampRef = r.procLifeDampRef;
    const isTalkingRef = r.isTalkingRef;
    const isTranscribingRef = r.isTranscribingRef;
    const isListeningExtRef = r.isListeningExtRef;
    const headRollRef = r.headRollRef;
    const headUntilRef = r.headUntilRef;
    const headYawRef = r.headYawRef;
    const headPitchRef = r.headPitchRef;
    const idleHeadOffsetRef = r.idleHeadOffsetRef;
    const headYawSmoothRef = r.headYawSmoothRef;
    const headPitchSmoothRef = r.headPitchSmoothRef;
    const headRollSmoothRef = r.headRollSmoothRef;
    const lifeLongHeadTiltRef = r.lifeLongHeadTiltRef;
    const headRollEmotionRef = r.headRollEmotionRef;
    const lifeHipTiltZRef = r.lifeHipTiltZRef;
    const lifeShoulderDropSideRef = r.lifeShoulderDropSideRef;
    const proceduralLogUntilRef = r.proceduralLogUntilRef;
    const eyeContactIntensityRef = r.eyeContactIntensityRef;
    const nextEyeSaccadeRef = r.nextEyeSaccadeRef;
    const eyeTargetXRef = r.eyeTargetXRef;
    const eyeTargetYRef = r.eyeTargetYRef;
    const waveUntilRef = r.waveUntilRef;
    const gestureRef = r.gestureRef;
    const walkUntilRef = r.walkUntilRef;
    const laughUntilRef = r.laughUntilRef;
    const shoulderShrugUntilRef = r.shoulderShrugUntilRef;
    const handsUpUntilRef = r.handsUpUntilRef;
    const fingerTapUntilRef = r.fingerTapUntilRef;
    const fingerTapSideRef = r.fingerTapSideRef;
    const hipsBindPosRef = r.hipsBindPosRef;
    const bindLowerBodyRotationsRef = r.bindLowerBodyRotationsRef;
    const pointFingerBlendRef = r.pointFingerBlendRef;

    const _scratchEuler = SK_Euler;
    const _scratchEuler2 = SK_Euler2;
    const _scratchQuat = SK_Quat;
    const _scratchQuat2 = SK_Quat2;
    const _scratchQuat3 = SK_Quat3;
    const _V_AXIS_X = SK_V_AXIS_X;
    const _V_AXIS_Y = SK_V_AXIS_Y;
    const _V_AXIS_Z = SK_V_AXIS_Z;
    const _wristSepWpA = SK_wristSepWpA;
    const _wristSepWpB = SK_wristSepWpB;

"""

footer = r"""
  }, 1);

  return null;
}
"""

out = header + "\n" + body + "\n" + footer
(ROOT / "VRMSkeletonManager.tsx").write_text(out, encoding="utf-8")
print("Wrote VRMSkeletonManager.tsx, chars:", len(out))
