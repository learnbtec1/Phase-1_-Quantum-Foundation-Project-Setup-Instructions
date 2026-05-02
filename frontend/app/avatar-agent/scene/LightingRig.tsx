'use client';
/**
 * LightingRig.tsx — Professional anime-style three-point lighting.
 *
 * Mimics the high-fidelity shading seen in studio-quality VRoid renders:
 *   - Key light:  warm, high-angle, upper-left-front — defines face shape
 *   - Fill light: cool, opposite side at ~40 % key — prevents flat look
 *   - Rim light:  bright back-right — separates character from background
 *   - Hemisphere: sky/ground ambient — soft environmental fill
 *
 * MToon materials (used by VRM 1.0) respond well to multiple directional
 * sources because the shader adds a rim-highlight pass on top of each light.
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
  keyIntensity    = 2.2,
  ambientIntensity = 0.18,
  hemiIntensity   = 0.40,
  shadows         = true,
  keyPosition     = [-2.5, 4.0, 2.5] as [number, number, number],
}: LightingRigProps) {
  return (
    <>
      {/* ── Ambient: very low — prevents pitch-black fill ─────────────────────── */}
      <ambientLight intensity={ambientIntensity} color="#ffe8d6" />

      {/* ── Key light: warm, upper-left-front — main face illumination ────────── */}
      <directionalLight
        position={keyPosition}
        intensity={keyIntensity}
        color="#fff5e0"
        castShadow={shadows}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-near={0.1}
        shadow-camera-far={25}
        shadow-camera-left={-4}
        shadow-camera-right={4}
        shadow-camera-top={5}
        shadow-camera-bottom={-2}
        shadow-bias={-0.0008}
        shadow-normalBias={0.04}
      />

      {/* ── Fill light: cool blue-lavender, right-front at 40 % key ──────────── */}
      <directionalLight
        position={[3.0, 2.5, 2.0]}
        intensity={keyIntensity * 0.40}
        color="#c9d8ff"
        castShadow={false}
      />

      {/* ── Rim / back light: pure white, behind avatar — separates silhouette ── */}
      <directionalLight
        position={[0.5, 3.5, -4.0]}
        intensity={keyIntensity * 0.60}
        color="#e8f0ff"
        castShadow={false}
      />

      {/* ── Hemisphere: sky lavender / ground dark — soft sky-bounce fill ──────── */}
      <hemisphereLight
        color="#b8ceff"
        groundColor="#0a0d14"
        intensity={hemiIntensity}
      />

      {/* ── Subtle under-fill: warm bounce from desk surface ─────────────────── */}
      <pointLight
        position={[0, -0.3, -1.8]}
        intensity={0.35}
        color="#ffd6a5"
        distance={3.5}
        decay={2}
      />
    </>
  );
}
