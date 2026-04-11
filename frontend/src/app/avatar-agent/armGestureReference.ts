/**
 * armGestureReference.ts — VRM 1.0 Arm Pose Reference (cogni.vrm)
 *
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  ✅ VERIFIED AXIS MAP — cogni.vrm (VRM 1.0) — confirmed 2026-04-11  ║
 * ║                                                                      ║
 * ║  slerpArmEuler uses SK_E.set(ex, ey, ez, 'YXZ')                     ║
 * ║                                                                      ║
 * ║  RIGHT upper arm:                                                    ║
 * ║    ruaY +  = FORWARD  (toward avatar front)  ✅                      ║
 * ║    ruaY −  = BACKWARD                                                ║
 * ║    ruaZ +  = DOWN     (arm hangs at side)    ✅                      ║
 * ║    ruaZ −  = UP       (arm raises above shoulder)                    ║
 * ║    ruaX ±  = ROLL/TWIST (arm rotation around its length axis)        ║
 * ║                                                                      ║
 * ║  LEFT upper arm  (Y axis mirrored from right):                       ║
 * ║    luaY −  = FORWARD  (toward avatar front)  ✅                      ║
 * ║    luaY +  = BACKWARD                                                ║
 * ║    luaZ −  = DOWN     (arm hangs at side)    ✅                      ║
 * ║    luaZ +  = UP       (arm raises above shoulder)                    ║
 * ║    luaX ±  = ROLL/TWIST                                              ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 *
 * Calibration workflow:
 *   1. Set ARM_IDLE to desired base pose (verified values above)
 *   2. For each gesture, set ARM_OFFSETS[id] = delta from ARM_IDLE
 *   3. Rebuild Docker: docker compose build frontend && docker compose up -d --force-recreate frontend
 */

export type ArmGestureId = 'explain' | 'point' | 'think' | 'clap' | 'wave' | 'agree';

/** Euler local YXZ for each bone — same order as slerpArmEuler in VRMSkeletonManager. */
export type ArmEulerOffset = {
  ruaX: number; ruaY: number; ruaZ: number;
  luaX: number; luaY: number; luaZ: number;
  rlaX: number; rlaZ: number;
  llaX: number; llaZ: number;
  rhX: number;  rhY: number;  rhZ: number;
  lhX: number;  lhY: number;  lhZ: number;
};

/**
 * ARM_IDLE — base static pose (confirmed working, 2026-04-11).
 *
 * Right arm: extended FORWARD (ruaY=+1.2) with slight downward tilt (ruaZ=+0.3)
 * Left arm:  raised UP (luaZ=+1.3)
 *
 * NOTE: BLOCK_ALL_GESTURES=true in VRMSkeletonManager keeps this pose static.
 *       Set false + calibrate ARM_OFFSETS before enabling gestures.
 */
export const ARM_IDLE: ArmEulerOffset = {
  ruaX:  0.0,  ruaY: +1.2,  ruaZ: +0.3,   // right: FORWARD + slight down
  luaX:  0.0,  luaY:  0.0,  luaZ: +1.3,   // left:  raised UP
  rlaX:  0.25, rlaZ:  0.0,                 // right forearm: slight elbow bend
  llaX:  0.08, llaZ:  0.0,                 // left forearm: natural
  rhX:   0.0,  rhY:   0.0,  rhZ:   0.0,
  lhX:   0.0,  lhY:   0.0,  lhZ:   0.0,
};

// ─── ZERO OFFSET TEMPLATE ────────────────────────────────────────────────────
// All zeros = no deviation from ARM_IDLE.
const ZERO: ArmEulerOffset = {
  ruaX: 0, ruaY: 0, ruaZ: 0,
  luaX: 0, luaY: 0, luaZ: 0,
  rlaX: 0, rlaZ: 0,
  llaX: 0, llaZ: 0,
  rhX:  0, rhY:  0, rhZ:  0,
  lhX:  0, lhY:  0, lhZ:  0,
};

/**
 * ARM_OFFSETS — delta added to ARM_IDLE for each gesture.
 * composed = ARM_IDLE + offset
 *
 * All gestures = ZERO until calibrated (avatar holds ARM_IDLE pose).
 * Calibrate using: ruaY+ = forward, ruaZ- = up (right) / luaZ+ = up (left)
 */
export const ARM_OFFSETS: Record<ArmGestureId, ArmEulerOffset> = {

  // ── EXPLAIN ─────────────────────────────────────────────────────────────
  // TODO: Both arms forward at chest level, open palms.
  explain: { ...ZERO },

  // ── POINT ───────────────────────────────────────────────────────────────
  // TODO: Right arm fully extended forward, left at side.
  point: { ...ZERO },

  // ── THINK ───────────────────────────────────────────────────────────────
  // TODO: Right hand near chin, thoughtful pose.
  think: { ...ZERO },

  // ── CLAP ────────────────────────────────────────────────────────────────
  // TODO: Both hands meeting in front of chest.
  clap: { ...ZERO },

  // ── WAVE ────────────────────────────────────────────────────────────────
  // TODO: Right arm raised beside head, elbow bent ~90°.
  wave: { ...ZERO },

  // ── AGREE ───────────────────────────────────────────────────────────────
  // TODO: Arms relaxed, head nods (handled by VRMSkeletonManager).
  agree: { ...ZERO },

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
