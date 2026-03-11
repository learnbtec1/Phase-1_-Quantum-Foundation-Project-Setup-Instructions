'use client';
/**
 * LightingRig.tsx — Soft lighting for dark navy office.
 *
 * Key directional (shadows) + hemisphere sky/ground fill.
 * Intentionally lower intensity than before to let navy materials breathe.
 */
import React from 'react';

export interface LightingRigProps {
  keyIntensity?:   number;
  ambientIntensity?: number;
  hemiIntensity?:  number;
  shadows?:        boolean;
  keyPosition?:    [number, number, number];
}

export function LightingRig({
  keyIntensity    = 1.2,
  ambientIntensity = 0.35,
  hemiIntensity   = 0.25,
  shadows         = true,
  keyPosition     = [3, 5, 2] as [number, number, number],
}: LightingRigProps) {
  return (
    <>
      {/* Base ambient — prevents pitch-black */}
      <ambientLight intensity={ambientIntensity} />

      {/* Key light — top-right-front, casts shadows */}
      <directionalLight
        position={keyPosition}
        intensity={keyIntensity}
        castShadow={shadows}
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-near={0.5}
        shadow-camera-far={30}
        shadow-camera-left={-6}
        shadow-camera-right={6}
        shadow-camera-top={6}
        shadow-camera-bottom={-6}
        shadow-bias={-0.002}
      />

      {/* Hemisphere — sky blue / ground dark for navy feel */}
      <hemisphereLight
        color="#8aaad6"
        groundColor="#10141b"
        intensity={hemiIntensity}
      />
    </>
  );
}
