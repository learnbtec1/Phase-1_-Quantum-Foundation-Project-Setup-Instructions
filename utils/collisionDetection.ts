import type { Vector3 } from '@/types/gameTypes';

export interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export function clampToBounds(position: Vector3, bounds: Bounds): Vector3 {
  return {
    x: Math.min(bounds.maxX, Math.max(bounds.minX, position.x)),
    y: position.y,
    z: Math.min(bounds.maxZ, Math.max(bounds.minZ, position.z))
  };
}
