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

export type ArmGestureId = 'explain' | 'point' | 'think' | 'clap' | 'wave' | 'agree';

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
 * ARM_OFFSETS — delta added to ARM_IDLE for each gesture.
 * composed_absolute = ARM_IDLE + offset
 *
 * All values use VERIFIED axis map (2026-04-11):
 *   Right: ruaY+ = fwd | ruaZ- = up | Left: luaY- = fwd | luaZ+ = up
 */
export const ARM_OFFSETS: Record<ArmGestureId, ArmEulerOffset> = {

  // ── WAVE ─────────────────────────────────────────────────────────────────
  // Right arm raised forward-outward, elbow bent — friendly greeting.
  // absolute: ruaY=+0.8 (fwd), ruaZ=-0.5 (raised), rlaX=+0.30
  wave: {
    ruaX:  0.0,  ruaY: +0.8,  ruaZ: -1.9,   // offset = target(-0.5) − idle(+1.4)
    luaX:  0.0,  luaY:  0.0,  luaZ:  0.0,   // left stays at idle
    rlaX: +0.22, rlaZ:  0.0,                 // elbow bent
    llaX:  0.0,  llaZ:  0.0,
    rhX:   0.0,  rhY:   0.0,  rhZ:   0.0,
    lhX:   0.0,  lhY:   0.0,  lhZ:   0.0,
  },

  // ── POINT ────────────────────────────────────────────────────────────────
  // Right arm fully extended forward, nearly horizontal — pointing at student/board.
  // absolute: ruaY=+1.5, ruaZ=+0.1
  point: {
    ruaX:  0.0,  ruaY: +1.5,  ruaZ: -1.3,   // offset = target(+0.1) − idle(+1.4)
    luaX:  0.0,  luaY:  0.0,  luaZ:  0.0,
    rlaX: +0.02, rlaZ:  0.0,                 // nearly straight (pointing)
    llaX:  0.0,  llaZ:  0.0,
    rhX:   0.0,  rhY:   0.0,  rhZ:   0.0,
    lhX:   0.0,  lhY:   0.0,  lhZ:   0.0,
  },

  // ── THINK ────────────────────────────────────────────────────────────────
  // Right hand raised toward chin/face, elbow bent — thoughtful pose.
  // absolute: ruaY=+0.5, ruaZ=0.0 (T-pose level), rlaX=+0.80
  think: {
    ruaX:  0.0,  ruaY: +0.5,  ruaZ: -1.4,   // offset = target(0.0) − idle(+1.4)
    luaX:  0.0,  luaY:  0.0,  luaZ: +0.4,   // left slight raise: -1.0−(−1.4)=+0.4
    rlaX: +0.72, rlaZ:  0.0,                 // strong elbow bend toward chin
    llaX:  0.0,  llaZ:  0.0,
    rhX:   0.0,  rhY:   0.0,  rhZ:   0.0,
    lhX:   0.0,  lhY:   0.0,  lhZ:   0.0,
  },

  // ── EXPLAIN ──────────────────────────────────────────────────────────────
  // Both arms forward at chest level, open palms — presenting/explaining.
  // Right: abs ruaY=+0.8, ruaZ=+0.2 | Left: abs luaY=-0.8, luaZ=-0.2
  explain: {
    ruaX:  0.0,  ruaY: +0.8,  ruaZ: -1.2,   // right fwd: offset = +0.2−1.4
    luaX:  0.0,  luaY: -0.8,  luaZ: +1.2,   // left fwd:  offset = −0.2−(−1.4)
    rlaX: +0.07, rlaZ:  0.0,                 // slight forearm extension
    llaX: +0.07, llaZ:  0.0,
    rhX:   0.0,  rhY:   0.0,  rhZ:   0.0,
    lhX:   0.0,  lhY:   0.0,  lhZ:   0.0,
  },

  // ── CLAP ─────────────────────────────────────────────────────────────────
  // Both hands meeting in front of chest — celebration/applause.
  // Right: abs ruaY=+1.2, ruaZ=0.0 | Left: abs luaY=-1.2, luaZ=0.0
  clap: {
    ruaX:  0.0,  ruaY: +1.2,  ruaZ: -1.4,   // offset = 0.0−1.4
    luaX:  0.0,  luaY: -1.2,  luaZ: +1.4,   // offset = 0.0−(−1.4)
    rlaX: +0.32, rlaZ:  0.0,                 // elbows bent
    llaX: +0.32, llaZ:  0.0,
    rhX:   0.0,  rhY:   0.0,  rhZ:   0.0,
    lhX:   0.0,  lhY:   0.0,  lhZ:   0.0,
  },

  // ── AGREE ────────────────────────────────────────────────────────────────
  // Subtle affirmation — arms mostly at idle, head nods (handled by VRMSkeletonManager).
  agree: {
    ...ZERO,
    ruaY: +0.1,   // very slight right arm forward
    luaY: -0.1,   // mirrored left
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
