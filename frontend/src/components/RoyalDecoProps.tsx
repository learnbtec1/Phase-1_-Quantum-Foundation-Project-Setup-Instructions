'use client';
/**
 * RoyalDecoProps — executive desk & library décor built from R3F primitives.
 * No external assets required. Fully shadow-cast.
 *
 * Props included:
 *  • Leather books stack (3 volumes, earthy tones)
 *  • Gold trophy (cylinder + sphere)
 *  • Crystal vase (lathe geometry, subtle transmission)
 *  • Globe on brass stand
 *  • Framed certificate (gold border, white face)
 */
import * as THREE from 'three';
import React from 'react';

export default function RoyalDecoProps() {
  return (
    <group>
      {/* ── Leather books on desk ───────────────────────────────────── */}
      <group position={[0.55, 0.78, 0.22]}>
        {(
          [
            { c: '#5A3E2B', w: 0.23, h: 0.030, d: 0.16 },
            { c: '#4A1C2C', w: 0.24, h: 0.030, d: 0.17 },
            { c: '#B08968', w: 0.22, h: 0.030, d: 0.14 },
          ] as const
        ).map((b, i) => (
          <mesh key={i} castShadow receiveShadow position={[0, i * 0.035, 0]}>
            <boxGeometry args={[b.w, b.h, b.d]} />
            <meshStandardMaterial color={b.c} roughness={0.85} metalness={0} />
          </mesh>
        ))}
      </group>

      {/* ── Gold trophy ─────────────────────────────────────────────── */}
      <group position={[-0.55, 0.78, -0.12]}>
        {/* pedestal */}
        <mesh castShadow position={[0, 0.09, 0]}>
          <cylinderGeometry args={[0.02, 0.05, 0.18, 24]} />
          <meshStandardMaterial color="#D4AF37" roughness={0.28} metalness={1} />
        </mesh>
        {/* sphere cap */}
        <mesh castShadow position={[0, 0.22, 0]}>
          <sphereGeometry args={[0.05, 24, 24]} />
          <meshStandardMaterial color="#D4AF37" roughness={0.25} metalness={1} />
        </mesh>
      </group>

      {/* ── Crystal vase on shelf ────────────────────────────────────── */}
      <mesh castShadow position={[1.2, 1.2, -1.0]}>
        <latheGeometry
          args={[
            Array.from({ length: 12 }, (_, i) =>
              new THREE.Vector2(Math.sin(i * 0.28) * 0.07 + 0.08, i * 0.02),
            ),
          ]}
        />
        <meshPhysicalMaterial
          color="#FFFFFF"
          transparent
          opacity={0.35}
          roughness={0.10}
          metalness={0}
        />
      </mesh>

      {/* ── Globe on brass stand ─────────────────────────────────────── */}
      <group position={[0.25, 0.80, -0.25]}>
        <mesh castShadow>
          <sphereGeometry args={[0.07, 32, 16]} />
          <meshStandardMaterial color="#7EC8E3" roughness={0.70} metalness={0.05} />
        </mesh>
        {/* stand */}
        <mesh castShadow position={[0, -0.09, 0]}>
          <cylinderGeometry args={[0.03, 0.03, 0.05, 24]} />
          <meshStandardMaterial color="#B08D57" roughness={0.45} metalness={0.80} />
        </mesh>
      </group>

      {/* ── Framed certificate on shelf ──────────────────────────────── */}
      <group position={[-1.15, 1.05, -1.0]}>
        {/* white face */}
        <mesh castShadow>
          <boxGeometry args={[0.35, 0.25, 0.020]} />
          <meshStandardMaterial color="#FFFFFF" roughness={0.90} />
        </mesh>
        {/* gold frame border (slightly larger, set back) */}
        <mesh castShadow position={[0, 0, -0.011]}>
          <boxGeometry args={[0.37, 0.27, 0.004]} />
          <meshStandardMaterial color="#D4AF37" roughness={0.35} metalness={0.90} />
        </mesh>
      </group>
    </group>
  );
}
