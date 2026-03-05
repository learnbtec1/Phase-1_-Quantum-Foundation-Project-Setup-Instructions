'use client';

import { useRef } from 'react';
import { Mesh } from 'three';
import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import type { NPCDefinition, Vector3 } from '@/types/gameTypes';

interface NPCProps {
  npc: NPCDefinition;
  playerPosition: Vector3;
  onInteract: (npc: NPCDefinition) => void;
}

export default function NPC({ npc, playerPosition, onInteract }: NPCProps) {
  const ref = useRef<Mesh>(null);

  useFrame(() => {
    if (!ref.current) return;
    const dx = playerPosition.x - npc.position.x;
    const dz = playerPosition.z - npc.position.z;
    const distance = Math.sqrt(dx * dx + dz * dz);
    if (distance < 1.5) {
      // تلميح تلقائي فقط
    }
  });

  return (
    <mesh ref={ref} position={[npc.position.x, 0.5, npc.position.z]}>
      <boxGeometry args={[0.7, 1.4, 0.7]} />
      <meshStandardMaterial color="#a855f7" />
      {/* @ts-ignore - Drei component type compatibility */}
      <Html distanceFactor={8} position={[0, 1.4, 0.38]}>
        <div className="flex flex-col items-center gap-2">
          {npc.avatarUrl && (
            <img
              src={npc.avatarUrl}
              alt={npc.name}
              className="w-12 h-12 rounded-full border border-white/30 shadow-lg bg-white/10"
            />
          )}
          <button
            onClick={() => onInteract(npc)}
            className="px-3 py-1 text-xs rounded-full bg-black/70 text-white border border-white/20"
          >
            {npc.name}
          </button>
        </div>
      </Html>
    </mesh>
  );
}
