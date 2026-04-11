/**
 * armGestureReference.ts — VRM 1.0 Arm Pose Reference (cogni.vrm)
 *
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  ✅ VERIFIED AXIS MAP — cogni.vrm (VRM 1.0) — confirmed 2026-04-11  ║
 * ║  slerpArmEuler: SK_E.set(ex, ey, ez, 'YXZ')                        ║
 * ║                                                                      ║
 * ║  RIGHT upper arm:                                                    ║
 * ║    ruaY +  = FORWARD  (toward avatar front)                         ║
 * ║    ruaY −  = BACKWARD                                                ║
 * ║    ruaZ +  = DOWN     (hang at side)                                 ║
 * ║    ruaZ −  = UP       (raise above shoulder)                         ║
 * ║    ruaX ±  = ROLL/TWIST (around arm length axis)                    ║
 * ║                                                                      ║
 * ║  LEFT upper arm  (Y mirrored from right):                            ║
 * ║    luaY −  = FORWARD  (toward avatar front)                         ║
 * ║    luaY +  = BACKWARD                                                ║
 * ║    luaZ −  = DOWN     (hang at side)                                 ║
 * ║    luaZ +  = UP       (raise above shoulder)                         ║
 * ║    luaX ±  = ROLL/TWIST                                              ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

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
 *
 * Arms hang naturally at sides (T-pose → +1.4 rad downward).
 * All Y = 0 (no forward/backward swing).
 * This is the base from which all gesture OFFSETS are added.
 */
export const ARM_IDLE: ArmEulerOffset = {
  ruaX:  0.0,  ruaY:  0.0,  ruaZ: +1.4,   // right: hanging naturally
  luaX:  0.0,  luaY:  0.0,  luaZ: -1.4,   // left:  hanging naturally (mirrored)
  rlaX:  0.08, rlaZ:  0.0,                 // forearms: slight natural bend
  llaX:  0.08, llaZ:  0.0,
  rhX:   0.0,  rhY:   0.0,  rhZ:   0.0,
  lhX:   0.0,  lhY:   0.0,  lhZ:   0.0,
};

// ─── ZERO OFFSET TEMPLATE ────────────────────────────────────────────────────
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
 */
export const ARM_OFFSETS: Record<ArmGestureId, ArmEulerOffset> = {
  wave: {
    ...ZERO,
    ruaX: -1.13,
    ruaY: 0.22,
    ruaZ: -0.89,
    rlaX: 2.12,
    rlaZ: -2.2,
    rhY: 0.0982,
    rhZ: -0.06496,
    luaX: 0.95,
    luaY: -0.12,
    luaZ: 1.12,
    llaX: 0.47,
    llaZ: -0.16,
    lhX: 0.2,
    lhY: -0.03,
    lhZ: -0.08,
  },
  point: {
    ...ZERO,
    ruaY: +1.5,   // full forward extension
  },
  think: {
    ...ZERO,
    ruaY: +0.5,   // forward (clear vs idle)
    ruaZ: -0.4,   // slight raise — was −0.3; stronger delta for visible procedural think
  },
  explain: {
    ...ZERO,
    ruaY: +0.8,   // right arm forward
    luaY: -0.8,   // left arm forward (mirrored: -Y)
  },
  clap: {
    ...ZERO,
    ruaY: +1.2,   // right toward center
    luaY: -1.2,   // left toward center
  },
  agree: {
    ...ZERO,
    ruaY: +0.2,   // slight forward nod (no neckY to avoid type errors)
  },
  /** تشخيص: ثني كوع واضح + لف ساعد — للتحقق من تطبيق rlaZ/rlaX عبر السلسلة الإجرائية */
  test_elbow: {
    ...ZERO,
    ruaZ: -0.7,
    ruaY: 0.5,
    rlaZ: -1.8,
    rlaX: 0.5,
    rhY: 0.2,
  },
};

/** Which local Euler channel receives procedural oscillation (YXZ / slerpArmEuler). */
export type GestureOscillationBone = 'rhZ' | 'rhY' | 'ruaZ' | 'luaZ';

/** Parametric sine oscillation layered on top of static gesture targets (see VRMSkeletonManager). */
export type GestureOscillationConfig = {
  bone: GestureOscillationBone;
  /** Peak deviation from the static target (radians). */
  amplitude: number;
  /** Full cycles per second (Hz). */
  frequency: number;
};

/**
 * Per-gesture wrist/arm oscillation (optional). Static `ARM_OFFSETS` stay unchanged;
 * VRMSkeletonManager adds `sin(t * 2πf) * amplitude` to the listed bone while the gesture runs.
 */
export const GESTURE_OSCILLATIONS: Partial<Record<ArmGestureId, GestureOscillationConfig>> = {
  wave: {
    bone: 'rhZ',
    amplitude: 0.35,
    frequency: 2.5,
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
