'use client';

import React from 'react';
import { Text } from '@react-three/drei';
import * as THREE from 'three';

export default function BrandingText() {
  return (
    <>
      {/* ── Back-wall branding ─────────────────────────────────────────── */}
      <group position={[0, 2.8, -5.8]}>
        {/* Glowing emissive panel behind text */}
        <mesh position={[0, -0.1, -0.02]}>
          <planeGeometry args={[5.2, 1.05]} />
          <meshStandardMaterial
            color="#0f172a"
            emissive="#0e7490"
            emissiveIntensity={0.18}
            transparent
            opacity={0.55}
            side={THREE.DoubleSide}
          />
        </mesh>
        <Text
          fontSize={0.35}
          color="#e2e8f0"
          anchorX="center"
          anchorY="middle"
          maxWidth={6}
          outlineWidth={0.02}
          outlineColor="#1e293b"
        >
          QUANTUM FOUNDATION
        </Text>
        <Text
          fontSize={0.18}
          color="#94a3b8"
          anchorX="center"
          anchorY="middle"
          position={[0, -0.5, 0]}
        >
          Dr. AISHA | QUANTUM FOUNDATION
        </Text>
      </group>

      {/* ── Table nameplate ────────────────────────────────────────────── */}
      <group position={[0, -0.74, 0.6]}>
        {/* Nameplate base */}
        <mesh castShadow>
          <boxGeometry args={[1.4, 0.06, 0.28]} />
          <meshPhysicalMaterial
            color="#1e3a5f"
            emissive="#0ea5e9"
            emissiveIntensity={0.22}
            roughness={0.3}
            metalness={0.6}
          />
        </mesh>
        {/* Nameplate text */}
        <Text
          fontSize={0.065}
          color="#e0f2fe"
          anchorX="center"
          anchorY="middle"
          position={[0, 0.06, 0.08]}
          rotation={[-0.35, 0, 0]}
          maxWidth={1.3}
        >
          Dr. AISHA | QUANTUM FOUNDATION
        </Text>
      </group>
    </>
  );
}
