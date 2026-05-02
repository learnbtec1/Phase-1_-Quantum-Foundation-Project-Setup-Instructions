'use client';
/**
 * ComfortLightingRig — Professional anime three-point lighting.
 * V2: Mood-reactive lighting — key light and ambient lerp to emotion-matched
 * color palettes without re-rendering the scene.  Uses THREE.Color lerp
 * driven by useFrame (R3F context required).
 *
 * Emotion presets:
 *   celebrate / excited  → warm golden (#ffd880) — celebration glow
 *   encouraging / happy  → warm amber  (#ffb563) — praise warmth
 *   neutral / attentive  → soft white  (#fff5e0) — default
 *   thinking / curious   → cool blue   (#d0e8ff) — analytical focus
 *   sad / concerned      → cool grey   (#d8e0f0) — empathetic calm
 *   angry / strict       → deep red    (#ffcfc0) — authoritative heat
 */
import React, { useRef, useEffect } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Environment } from '@react-three/drei';

// ── Emotion → key-light colour map ────────────────────────────────────────────
const EMOTION_KEY_COLOR: Record<string, string> = {
  celebrate:   '#ffd880',
  excited:     '#ffc44d',
  happy:       '#ffb563',
  encouraging: '#ffb563',
  proud:       '#ffc070',
  neutral:     '#fff5e0',
  attentive:   '#fff5e0',
  friendly:    '#ffe8c0',
  calm:        '#e8f0ff',
  thinking:    '#d0e8ff',
  curious:     '#c8e0ff',
  sad:         '#d8e0f0',
  concerned:   '#d8e0f0',
  anxious:     '#e0d8f0',
  angry:       '#ffcfc0',
  strict:      '#ffd8c8',
  surprised:   '#fff0a0',
};

const EMOTION_AMBIENT_COLOR: Record<string, string> = {
  celebrate:   '#ffedd0',
  excited:     '#ffe4b0',
  encouraging: '#ffe4b0',
  thinking:    '#c8d8f8',
  curious:     '#c0d4f8',
  sad:         '#c8d0e8',
  angry:       '#f8d0c8',
  neutral:     '#ffe8d6',
};

const EMOTION_AMBIENT_INTENSITY: Record<string, number> = {
  celebrate:   0.22,
  excited:     0.20,
  thinking:    0.10,
  sad:         0.10,
  neutral:     0.12,
};

interface ComfortLightingRigProps {
  emotion?: string;
  /**
   * No 3D room GI — compensate with higher ambient + a single directional key from (1,1,1).
   * Keeps a mild IBL preset for VRM 1.0 PBR reads.
   */
  flatImageBackdrop?: boolean;
}

export default function ComfortLightingRig({
  emotion = 'neutral',
  flatImageBackdrop = false,
}: ComfortLightingRigProps) {
  const keyLightRef  = useRef<THREE.DirectionalLight>(null);
  const ambientRef   = useRef<THREE.AmbientLight>(null);
  const targetKeyClr = useRef(new THREE.Color('#fff5e0'));
  const targetAmbClr = useRef(new THREE.Color('#ffe8d6'));
  const targetAmbInt = useRef(0.12);

  // Update target colours when emotion changes
  useEffect(() => {
    const kc = EMOTION_KEY_COLOR[emotion]    ?? '#fff5e0';
    const ac = EMOTION_AMBIENT_COLOR[emotion] ?? '#ffe8d6';
    const ai = EMOTION_AMBIENT_INTENSITY[emotion] ?? 0.12;
    targetKeyClr.current.set(kc);
    targetAmbClr.current.set(ac);
    targetAmbInt.current = ai;
  }, [emotion]);

  // Smoothly lerp lights toward target each frame (no re-render, pure ref mutation)
  useFrame((_, delta) => {
    if (flatImageBackdrop) return;
    const t = Math.min(1, delta * 2.5);   // ~400 ms transition at 60fps
    if (keyLightRef.current) {
      (keyLightRef.current.color as THREE.Color).lerp(targetKeyClr.current, t);
    }
    if (ambientRef.current) {
      (ambientRef.current.color as THREE.Color).lerp(targetAmbClr.current, t);
      ambientRef.current.intensity += (targetAmbInt.current - ambientRef.current.intensity) * t;
    }
  });

  if (flatImageBackdrop) {
    return (
      <>
        <ambientLight intensity={1.2} color="#ffffff" />
        <directionalLight
          position={[1, 1, 1]}
          intensity={2.4}
          color="#fff8f0"
          castShadow
          shadow-mapSize-width={2048}
          shadow-mapSize-height={2048}
          shadow-camera-near={0.1}
          shadow-camera-far={30}
          shadow-camera-left={-6}
          shadow-camera-right={6}
          shadow-camera-top={8}
          shadow-camera-bottom={-4}
          shadow-bias={-0.0008}
          shadow-normalBias={0.04}
        />
        <Environment preset="apartment" background={false} environmentIntensity={0.75} />
      </>
    );
  }

  return (
    <>
      {/* ── Ambient — warm natural base, bright enough to lift shadows */}
      <ambientLight ref={ambientRef} intensity={0.55} color="#fff8f0" />

      {/* ── Hemisphere — warm sky / warm ground bounce (no more dark base) */}
      <hemisphereLight args={['#ffe8d0', '#c8a87a', 0.65]} />

      {/* ── Key light: warm-white studio, upper-left-front, casts shadow */}
      <directionalLight
        ref={keyLightRef}
        position={[-2.5, 5.5, 3.0]}
        intensity={3.2}
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
        shadow-intensity={0.6}
      />

      {/* ── Fill light: soft warm, right side — reduces harsh shadow contrast */}
      <directionalLight
        position={[3.5, 2.5, 2.0]}
        intensity={1.6}
        color="#ffe4c0"
        castShadow={false}
      />

      {/* ── Front fill: straight-on soft light eliminates flat dark areas */}
      <directionalLight
        position={[0, 2.5, 4.0]}
        intensity={1.2}
        color="#fff8f4"
        castShadow={false}
      />

      {/* ── Rim light: subtle warm-white edge from behind */}
      <directionalLight
        position={[0.5, 3.5, -4.5]}
        intensity={1.0}
        color="#ffe8d0"
        castShadow={false}
      />

      {/* ── Face-level point: warm natural bounce from below */}
      <pointLight
        position={[0, 1.0, 1.8]}
        intensity={1.2}
        color="#ffe8c8"
        distance={4.0}
        decay={2}
      />

      {/* Ceiling cove-style accents — reads with matte backdrop uplighting */}
      <pointLight position={[1.55, 3.52, -0.55]} intensity={0.44} distance={16} decay={2} color="#fff7ee" />
      <pointLight position={[-1.75, 3.42, 0.85]} intensity={0.34} distance={14} decay={2} color="#fff1e8" />

      {/* ── PBR env map: apartment preset — warmer, more natural than city */}
      <Environment preset="apartment" background={false} environmentIntensity={1.1} />
    </>
  );
}
