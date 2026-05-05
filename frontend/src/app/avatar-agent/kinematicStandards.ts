/**
 * Empirical kinematic baseline (cogni.vrm, normalized bones, local Euler order YXZ).
 *
 * Bone-local axes only — **world/scene forward is +Z** (`config/avatar.ts`).
 *
 * Right upper arm (reference limb): primary reach = −X, primary up = −Z.
 * Left upper limb: mirror X (forward = +X); Z vertical follows mirrored hang vs idle.
 *
 * Layer intent when `generativeBonesRef` holds a target for a joint:
 *   generative (1) suppresses idle / gesture / VRMA / collision on that joint so
 *   the commanded pose is not pulled toward bind / clip / guard.
 *
 * Euler convention: all generative / semantic Eulers are local YXZ **radians** unless
 * `GenerativeGestureDetail.assumeEulerDegrees` is true on the dispatched event.
 *
 * @see armGestureReference.ts — arm idle + gesture offsets
 * @see VRMSkeletonManager — per-bone weight overrides + post-stack stamp
 */

/** VRMA + collision blend weight on a joint under generative priority lock (hard suppress). */
export const KINEMATIC_GENERATIVE_LOCK_VRMA = 0;
export const KINEMATIC_GENERATIVE_LOCK_COLLISION = 0;
export const KINEMATIC_GENERATIVE_LOCK_IDLE = 0;
export const KINEMATIC_GENERATIVE_LOCK_GESTURE = 0;

/** Global collision layer scale while any generative target is active (body-wide guard). */
export const KINEMATIC_GLOBAL_COLLISION_WHILE_GENERATIVE = 0;

/**
 * Anatomical bounds — local Euler **YXZ** in radians (same convention as `armGestureReference`:
 * right reach −X, up −Z; left arm mirrored in X).
 *
 * Used only by `clampGenerativeEulerYXZ` / `enforceAnatomicalLimits` before values hit `generativeBonesRef`.
 * Order per entry: X ≈ pitch-like, Y ≈ yaw-like, Z ≈ roll-like on normalized VRM bones (YXZ).
 */
export type AnatomicalEulerLimitBox = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
};

/** Head — no full spins; slightly wider than neck. */
export const ANATOMICAL_LIMITS_HEAD_RAD: AnatomicalEulerLimitBox = {
  minX: -1.0123, // ~−58° pitch
  maxX: 1.0123,
  minY: -1.3614, // ~−78° yaw
  maxY: 1.3614,
  minZ: -0.733, // ~−42° roll
  maxZ: 0.733,
};

/** Neck — stricter than head (no “exorcist” yaw/pitch). */
export const ANATOMICAL_LIMITS_NECK_RAD: AnatomicalEulerLimitBox = {
  minX: -0.8727, // ~−50°
  maxX: 0.8727,
  minY: -1.2217, // ~−70°
  maxY: 1.2217,
  minZ: -0.5236, // ~−30°
  maxZ: 0.5236,
};

/**
 * Right upper arm — tighter Y limits reduce inward adduction toward chest (FK proxy for self-collision).
 * X/Z still allow forward reach and vertical swing around idle (ruaZ ≈ +1.4).
 */
export const ANATOMICAL_LIMITS_RUA_RAD: AnatomicalEulerLimitBox = {
  minX: -2.12,
  maxX: 2.12,
  minY: -0.9,
  maxY: 0.9,
  minZ: -2.05,
  maxZ: 2.18,
};

/** Left upper arm — same magnitude; Y band limits cross-midline / clip toward sternum. */
export const ANATOMICAL_LIMITS_LUA_RAD: AnatomicalEulerLimitBox = {
  minX: -2.12,
  maxX: 2.12,
  minY: -0.9,
  maxY: 0.9,
  minZ: -2.18,
  maxZ: 2.05,
};

/**
 * Right lower arm (elbow) — hinge: dominant flex on +X from idle (~0.08); block hyperextension on −X.
 * Y/Z kept tight to limit non-physiological twist.
 */
export const ANATOMICAL_LIMITS_RLA_RAD: AnatomicalEulerLimitBox = {
  minX: -0.06,
  maxX: 2.32,
  minY: -0.26,
  maxY: 0.26,
  minZ: -0.38,
  maxZ: 0.38,
};

/** Left lower arm — mirrored flex axis (flex toward −X). */
export const ANATOMICAL_LIMITS_LLA_RAD: AnatomicalEulerLimitBox = {
  minX: -2.32,
  maxX: 0.06,
  minY: -0.26,
  maxY: 0.26,
  minZ: -0.38,
  maxZ: 0.38,
};

/**
 * Wrist / hand — limit pronation/supination and extreme flex to reduce hand–torso penetration under FK.
 */
export const ANATOMICAL_LIMITS_WRIST_RAD: AnatomicalEulerLimitBox = {
  minX: -1.15,
  maxX: 1.15,
  minY: -0.55,
  maxY: 0.55,
  minZ: -0.72,
  maxZ: 0.72,
};

/** Clavicle — small rotations only (FK guard). */
export const ANATOMICAL_LIMITS_CLAVICLE_RAD: AnatomicalEulerLimitBox = {
  minX: -0.42,
  maxX: 0.42,
  minY: -0.42,
  maxY: 0.42,
  minZ: -0.75,
  maxZ: 0.75,
};

/** Trunk (hips / spine / chest) — unchanged conservative band vs prior jointEulerLimits. */
export const ANATOMICAL_LIMITS_TRUNK_RAD: AnatomicalEulerLimitBox = {
  minX: -0.55,
  maxX: 0.55,
  minY: -0.55,
  maxY: 0.55,
  minZ: -0.65,
  maxZ: 0.65,
};

/** Published table for audits (head, neck, shoulders, elbows + wrist + clavicle + trunk). */
export const ANATOMICAL_DICTIONARY_YXZ_RAD = {
  head: ANATOMICAL_LIMITS_HEAD_RAD,
  neck: ANATOMICAL_LIMITS_NECK_RAD,
  rightUpperArm: ANATOMICAL_LIMITS_RUA_RAD,
  leftUpperArm: ANATOMICAL_LIMITS_LUA_RAD,
  rightLowerArm: ANATOMICAL_LIMITS_RLA_RAD,
  leftLowerArm: ANATOMICAL_LIMITS_LLA_RAD,
  wrist: ANATOMICAL_LIMITS_WRIST_RAD,
  clavicle: ANATOMICAL_LIMITS_CLAVICLE_RAD,
  trunk: ANATOMICAL_LIMITS_TRUNK_RAD,
} as const;
