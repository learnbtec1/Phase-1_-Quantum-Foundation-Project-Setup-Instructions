'use client';

import { useEffect, useRef } from 'react';
import { Mesh } from 'three';
import { usePlayerMovement } from '@/hooks/usePlayerMovement';
import type { Vector3 } from '@/types/gameTypes';
import { type Bounds } from '@/utils/collisionDetection';

interface PlayerProps {
  bounds: Bounds;
  onMove?: (position: Vector3) => void;
  touchVector?: Vector3;
}

export default function Player({ bounds, onMove, touchVector }: PlayerProps) {
  const playerRef = useRef<Mesh>(null);
  const { position, mode } = usePlayerMovement(playerRef, { bounds, touchVector });

  useEffect(() => {
    if (onMove) {
      onMove(position);
    }
  }, [onMove, position]);

  return (
    <mesh ref={playerRef}>
      <capsuleGeometry args={[0.35, 1.2, 8, 16]} />
      <meshStandardMaterial color={mode === 'run' ? '#38bdf8' : '#22c55e'} />
    </mesh>
  );
}
