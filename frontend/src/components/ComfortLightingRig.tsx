'use client';
/**
 * ComfortLightingRig — Professional anime three-point lighting.
 *
 * Tuned for MToon 1.0 (VRM 1.0 standard) which computes:
 *   - Toon-shaded diffuse from directional lights
 *   - Rim-highlight layer on top of each directional source
 *   - Specular gloss from the PBR environment map
 *
 * Three-point setup:
 *   Key  — warm, upper-left-front, high intensity → defines face + rim glow
 *   Fill — cool lavender, right side, 45 % key    → prevents flat/chalky look
 *   Rim  — bright white-blue, behind avatar        → silhouette separation
 *
 * Still comfortable for long Arabic-learning sessions:
 *   hemisphere sky is very soft, ambient is kept below 0.2.
 */
import React from 'react';
import { Environment } from '@react-three/drei';

export default function ComfortLightingRig() {
  return (
    <>
      {/* ── Very soft ambient — prevents pure-black shadows ────────────────── */}
      <ambientLight intensity={0.12} color="#ffe8d6" />

      {/* ── Hemisphere — sky lavender / dark ground bounce ──────────────────── */}
      <hemisphereLight args={['#c8d8ff', '#0a0d14', 0.45]} />

      {/* ── Key light: warm, upper-left-front — main MToon toon shading ──────── */}
      <directionalLight
        position={[-2.5, 5.5, 3.0]}
        intensity={2.4}
        color="#fff5e0"
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-near={0.1}
        shadow-camera-far={25}
        shadow-camera-left={-5}
        shadow-camera-right={5}
        shadow-camera-top={6}
        shadow-camera-bottom={-2}
        shadow-bias={-0.0008}
        shadow-normalBias={0.04}
      />

      {/* ── Fill light: cool lavender, right side — softens key shadows ──────── */}
      <directionalLight
        position={[3.5, 3.0, 2.5]}
        intensity={1.0}
        color="#c9d4ff"
        castShadow={false}
      />

      {/* ── Rim light: bright white-blue, behind avatar — silhouette pop ──────── */}
      <directionalLight
        position={[0.5, 4.0, -5.0]}
        intensity={1.5}
        color="#ddeeff"
        castShadow={false}
      />

      {/* ── Face-level point: warm desk bounce — MToon inner glow effect ──────── */}
      <pointLight
        position={[0, 0.3, -1.2]}
        intensity={0.55}
        color="#ffd6a0"
        distance={2.5}
        decay={2}
      />

      {/* ── PBR env: city preset — gives specular gloss to MToon surfaces ──────── */}
      <Environment preset="city" background={false} environmentIntensity={0.50} />
    </>
  );
}
