'use client';

import { useEffect, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { Mesh } from 'three';
import type { PlayerMode, Vector3 } from '@/types/gameTypes';
import { clampToBounds, type Bounds } from '@/utils/collisionDetection';

interface UsePlayerMovementOptions {
  bounds: Bounds;
  speed?: number;
  sprintMultiplier?: number;
  touchVector?: Vector3;
}

export function usePlayerMovement(ref: React.RefObject<Mesh | null>, options: UsePlayerMovementOptions) {
  const { camera } = useThree();
  const [mode, setMode] = useState<PlayerMode>('walk');
  const [position, setPosition] = useState<Vector3>({ x: 0, y: 0.5, z: 0 });

  const keys = useRef<Record<string, boolean>>({});
  const touchInput = useRef<Vector3>({ x: 0, y: 0, z: 0 });

  useEffect(() => {
    const handleDown = (event: KeyboardEvent) => {
      keys.current[event.key.toLowerCase()] = true;
    };
    const handleUp = (event: KeyboardEvent) => {
      keys.current[event.key.toLowerCase()] = false;
    };
    window.addEventListener('keydown', handleDown);
    window.addEventListener('keyup', handleUp);
    return () => {
      window.removeEventListener('keydown', handleDown);
      window.removeEventListener('keyup', handleUp);
    };
  }, []);

  useFrame((_state, delta) => {
    if (!ref.current) return;
    const speed = options.speed ?? 2.5;
    const sprintMultiplier = options.sprintMultiplier ?? 1.6;
    const isSprint = keys.current['shift'];
    const nextSpeed = speed * (isSprint ? sprintMultiplier : 1);

    const input = options.touchVector ?? touchInput.current;
    const forward = (keys.current['w'] ? -1 : 0) + (keys.current['s'] ? 1 : 0) + input.z;
    const right = (keys.current['d'] ? 1 : 0) - (keys.current['a'] ? 1 : 0) + input.x;

    if (forward !== 0 || right !== 0) {
      setMode(isSprint ? 'run' : 'walk');
    } else {
      setMode('walk');
    }

    const nextPosition = {
      x: position.x + right * nextSpeed * delta,
      y: position.y,
      z: position.z + forward * nextSpeed * delta
    };

    const clamped = clampToBounds(nextPosition, options.bounds);
    ref.current.position.set(clamped.x, clamped.y, clamped.z);
    setPosition(clamped);

    camera.position.lerp({ x: clamped.x, y: 6, z: clamped.z + 8 } as any, 0.1);
    camera.lookAt(clamped.x, clamped.y, clamped.z);
  });

  const setTouchMove = (x: number, z: number) => {
    touchInput.current = { x, y: 0, z };
  };

  return { position, mode, setMode, setTouchMove };
}
