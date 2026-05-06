/**
 * armGestureReference.ts — VRM 1.0 Arm Pose Reference (cogni.vrm)
 *
 * Bone-local upper-arm convention only — **world/scene forward is +Z** (`config/avatar.ts`).
 *
 * Full-body procedural layer uses the same local YXZ convention; universal
 * commands live in `semanticCommand.ts` + `generativeBoneNormalize.ts`.
 *
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  SOURCE OF TRUTH — normalized rightUpperArm local Euler YXZ (empirical) ║
 * ║  slerpArmEuler: Euler YXZ → local delta Q, then bindPose.multiply(Q)       ║
 * ║    (same bind-relative contract as shoulders / head in VRMSkeletonManager). ║
 * ║                                                                         ║
 * ║  RIGHT upper arm (rua):                                                ║
 * ║    PRIMARY forward reach = −ruaX (dominant channel; do not use Y)        ║
 * ║    Forward  = −X  (more negative X → bone-local reach toward torso / world +Z) ║
 * ║    Backward = +X                                                       ║
 * ║    Up       = −Z  (more negative Z → raise)                             ║
 * ║    Down     = +Z                                                       ║
 * ║    Y        = lateral / secondary swing (not used for primary reach)   ║
 * ║                                                                         ║
 * ║  LEFT upper arm (lua) — mirror in X for forward:                        ║
 * ║    Forward  = +X                                                       ║
 * ║    Backward = −X                                                       ║
 * ║    Up / Down on Z mirrored vs hang pose (idle luaZ negative)           ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

/** −1: forward reach increases along negative local X (right arm). */
export const RUA_FORWARD_SIGN = -1 as const;
/** −1: upward motion increases along negative local Z (right arm). */
export const RUA_UP_SIGN = -1 as const;
/** +1: left arm forward is positive X (mirror of right). */
export const LUA_FORWARD_SIGN = 1 as const;

export type ArmGestureId =
  | 'explain'
  | 'point'
  | 'think'
  | 'clap'
  | 'wave'
  | 'agree'
  | 'test_elbow';

/** Euler local YXZ — same order as slerpArmEuler in VRMSkeletonManager. */
export type ArmEulerOffset = {
  ruaX: number; ruaY: number; ruaZ: number;
  luaX: number; luaY: number; luaZ: number;
  rlaX: number; rlaZ: number;
  llaX: number; llaZ: number;
  rhX: number;  rhY: number;  rhZ: number;
  lhX: number;  lhY: number;  lhZ: number;
};

/**
 * ARM_IDLE — natural resting position for cogni.vrm (VRM 1.0).
 * Forward/back primary channels start at X=0; hang is Z (right +Z down, left −Z down).
 */
export const ARM_IDLE: ArmEulerOffset = {
  ruaX:  0.0,  ruaY: -0.04, ruaZ: +1.48,
  luaX:  0.0,  luaY:  0.04, luaZ: -1.48,
  rlaX:  0.12, rlaZ:  0.0,
  llaX:  0.12, llaZ:  0.0,
  rhX:   0.0,  rhY:   0.0,  rhZ:   0.0,
  lhX:   0.0,  lhY:   0.0,  lhZ:   0.0,
};

const ZERO: ArmEulerOffset = {
  ruaX: 0, ruaY: 0, ruaZ: 0,
  luaX: 0, luaY: 0, luaZ: 0,
  rlaX: 0, rlaZ: 0,
  llaX: 0, llaZ: 0,
  rhX:  0, rhY:  0, rhZ:  0,
  lhX:  0, lhY:  0, lhZ:  0,
};

/**
 * ARM_OFFSETS — deltas added to ARM_IDLE per gesture.
 * Right-arm reach uses negative ruaX; left-arm reach uses positive luaX.
 */
// [STRICT] DO NOT MODIFY AXIS MAPPING. UP=Z, FORWARD=X, ROTATION=Y. Approved by Maestro.
export const ARM_OFFSETS: Record<ArmGestureId, ArmEulerOffset> = {
  wave: {
    ...ZERO,
    ruaX: -1.35,
    ruaY: 0,
    ruaZ: -0.89,
    rlaX: 2.12,
    rlaZ: -2.2,
    rhY: 0.0982,
    rhZ: -0.06496,
    luaX: 1.07,
    luaY: 0,
    luaZ: 1.12,
    llaX: 0.47,
    llaZ: -0.16,
    lhX: 0.2,
    lhY: -0.03,
    lhZ: -0.08,
  },
  point: {
    ...ZERO,
    ruaX: -1.5,
  },
  think: {
    ...ZERO,
    ruaX: -0.5,
    ruaZ: -0.4,
  },
  explain: {
    ...ZERO,
    ruaX: -0.95,
    ruaY: -0.05,
    luaX: +0.95,
    luaY: 0.05,
    rlaX: 0.06,
    llaX: 0.06,
  },
  clap: {
    ...ZERO,
    ruaX: -1.2,
    luaX: +1.2,
  },
  agree: {
    ...ZERO,
    ruaX: -0.2,
  },
  test_elbow: {
    ...ZERO,
    ruaZ: -0.7,
    ruaX: -0.5,
    rlaZ: -1.8,
    rlaX: 0.5,
    rhY: 0.2,
  },
};

export type GestureOscillationBone = 'rhZ' | 'rhY' | 'ruaZ' | 'luaZ';

export type GestureOscillationConfig = {
  bone: GestureOscillationBone;
  amplitude: number;
  frequency: number;
};

export const GESTURE_OSCILLATIONS: Partial<Record<ArmGestureId, GestureOscillationConfig>> = {
  wave: {
    bone: 'rhZ',
    amplitude: 0.35,
    frequency: 2.5,
  },
  /** Subtle local-Z “breathing” on upper arm so chin pose never reads frozen (Golden map: UP/DOWN = Z). */
  think: {
    bone: 'ruaZ',
    amplitude: 0.055,
    frequency: 0.72,
  },
};

export function composeArmTargets(offset: ArmEulerOffset): ArmEulerOffset {
  return {
    ruaX: ARM_IDLE.ruaX + offset.ruaX,
    ruaY: ARM_IDLE.ruaY + offset.ruaY,
    ruaZ: ARM_IDLE.ruaZ + offset.ruaZ,
    luaX: ARM_IDLE.luaX + offset.luaX,
    luaY: ARM_IDLE.luaY + offset.luaY,
    luaZ: ARM_IDLE.luaZ + offset.luaZ,
    rlaX: ARM_IDLE.rlaX + offset.rlaX,
    rlaZ: ARM_IDLE.rlaZ + offset.rlaZ,
    llaX: ARM_IDLE.llaX + offset.llaX,
    llaZ: ARM_IDLE.llaZ + offset.llaZ,
    rhX:  ARM_IDLE.rhX  + offset.rhX,
    rhY:  ARM_IDLE.rhY  + offset.rhY,
    rhZ:  ARM_IDLE.rhZ  + offset.rhZ,
    lhX:  ARM_IDLE.lhX  + offset.lhX,
    lhY:  ARM_IDLE.lhY  + offset.lhY,
    lhZ:  ARM_IDLE.lhZ  + offset.lhZ,
  };
}

export const MOUSE_CALIB_LS_KEY = 'mouse-gesture-arm-offsets-v1';
