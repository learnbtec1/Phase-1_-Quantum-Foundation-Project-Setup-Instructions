import * as THREE from 'three';
import { readRugWalkSurfaceYExtraEnv } from '@/config/avatar';

/** Rug walk surface offset in metres (from `NEXT_PUBLIC_RUG_WALK_SURFACE_Y_EXTRA`). */
export function readRugExtraEnv(): number {
  return readRugWalkSurfaceYExtraEnv();
}

export function computeRugSurfaceWorld(rugRoot: THREE.Object3D): {
  box: THREE.Box3;
  worldTopY: number;
} {
  const box = new THREE.Box3().setFromObject(rugRoot);
  return { box, worldTopY: box.max.y };
}
