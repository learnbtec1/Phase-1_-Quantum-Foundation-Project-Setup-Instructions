'use client';
/**
 * ComfortLightingRig — Royal Ultra-Lux lighting setup.
 * Replaces the previous CinematicScene lights.
 *
 * Warm key (FFEED8) + cool fill (CFE3FF) + soft hemisphere + city env.
 * No bloom. Calibrated for long Arabic-learning sessions (eye comfort).
 * Shadow-casting directional for depth on walnut + navy surfaces.
 */
import React from 'react';
import { Environment } from '@react-three/drei';

export default function ComfortLightingRig() {
  return (
    <>
      {/* Soft ambient base — warm sky / neutral ground */}
      <hemisphereLight args={['#FFFFFF', '#E6E6E6', 0.50]} />

      {/* Warm key light — royal ambience, casts crisp soft shadows */}
      <directionalLight
        position={[5, 7, 3]}
        intensity={0.65}
        color="#FFEED8"
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-near={0.5}
        shadow-camera-far={30}
        shadow-camera-left={-8}
        shadow-camera-right={8}
        shadow-camera-top={8}
        shadow-camera-bottom={-8}
        shadow-bias={-0.0005}
        shadow-normalBias={0.02}
      />

      {/* Cool fill — counteracts warm key, prevents muddy shadows */}
      <directionalLight
        position={[-4, 3, -3]}
        intensity={0.22}
        color="#CFE3FF"
      />

      {/* Avatar ground wrap — prevents pitch-black underside */}
      <pointLight
        position={[0, -0.6, 0]}
        intensity={0.30}
        distance={3.5}
        color="#FFF8F0"
      />

      {/* PBR environment — city preset (bundled, no external CDN dependency) */}
      <Environment preset="city" background={false} environmentIntensity={0.30} />
    </>
  );
}
