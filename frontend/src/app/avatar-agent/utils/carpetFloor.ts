/**
 * carpetFloor.ts — V100 rug world-AABB helpers
 *
 * Computes the rug's true walk-surface Y from a real world-space Box3 rather than
 * relying on a hardcoded constant.  Called from AvatarCanvas after `room:carpet:changed`.
 */
import * as THREE from 'three';

export interface RugSurface {
  /** Top of carpet mesh in world Y (= proposed `ROOM_BOUNDS.floorY` before extra). */
  worldTopY: number;
  /** Bottom of carpet mesh in world Y. */
  worldBottomY: number;
  /** Full world AABB. */
  box: THREE.Box3;
}

/**
 * Measure the world AABB of `carpetRoot` and return the surface descriptor.
 * Forces `updateMatrixWorld(true)` first so baked-node transforms are included.
 */
export function computeRugSurfaceWorld(carpetRoot: THREE.Object3D): RugSurface {
  carpetRoot.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(carpetRoot);
  return { worldTopY: box.max.y, worldBottomY: box.min.y, box };
}

/**
 * Read `NEXT_PUBLIC_RUG_WALK_SURFACE_Y_EXTRA` (metres).
 * Falls back to **0** (not 0.10) so the world-AABB value is used as-is by default.
 */
export function readRugExtraEnv(): number {
  if (typeof process === 'undefined') return 0;
  const v = (process.env.NEXT_PUBLIC_RUG_WALK_SURFACE_Y_EXTRA ?? '').trim();
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}
