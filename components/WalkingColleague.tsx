'use client';

import { useRef } from 'react';
import { Mesh } from 'three';
import { Html } from '@react-three/drei';
import { useNPCAI } from '@/hooks/useNPCAI';
import { type Bounds } from '@/utils/collisionDetection';

interface WalkingColleagueProps {
  position: [number, number, number];
  bounds: Bounds;
  avatarUrl?: string;
  label?: string;
}

export default function WalkingColleague({ position, bounds, avatarUrl, label }: WalkingColleagueProps) {
  const ref = useRef<Mesh>(null);
  useNPCAI(ref, bounds);

  return (
    <mesh ref={ref} position={position}>
      <sphereGeometry args={[0.35, 16, 16]} />
      <meshStandardMaterial color="#f97316" />
      {/* @ts-ignore - Drei component type compatibility */}
      <Html distanceFactor={8} position={[0, 0.9, 0.36]}>
        <div className="flex flex-col items-center gap-1">
          {avatarUrl && (
            <img
              src={avatarUrl}
              alt={label ?? 'زميل'}
              className="w-10 h-10 rounded-full border border-white/30 shadow-lg bg-white/10"
            />
          )}
          {label && <div className="text-[10px] text-white/80">{label}</div>}
        </div>
      </Html>
    </mesh>
  );
}
