'use client';

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Mesh } from 'three';
import type { Vector3 } from '@/types/gameTypes';
import { clampToBounds, type Bounds } from '@/utils/collisionDetection';

export function useNPCAI(ref: React.RefObject<Mesh | null>, bounds: Bounds) {
  const target = useRef<Vector3>({ x: 0, y: 0.5, z: 0 });
  const timer = useRef(0);

  useFrame((_state, delta) => {
    if (!ref.current) return;
    timer.current += delta;

    if (timer.current > 3) {
      timer.current = 0;
      target.current = {
        x: bounds.minX + Math.random() * (bounds.maxX - bounds.minX),
        y: 0.5,
        z: bounds.minZ + Math.random() * (bounds.maxZ - bounds.minZ)
      };
    }

    const current = ref.current.position;
    const dx = target.current.x - current.x;
    const dz = target.current.z - current.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist > 0.1) {
      const next = {
        x: current.x + (dx / dist) * delta,
        y: current.y,
        z: current.z + (dz / dist) * delta
      };
      const clamped = clampToBounds(next, bounds);
      ref.current.position.set(clamped.x, clamped.y, clamped.z);
    }
  });
}
