'use client';
// src/components/HologramWindow.tsx
// Royal Panoramic Holographic Window for AI-EDUCATE
// - Animated hologram layers (logo, grid, scanlines, particles)
// - Gentle parallax based on camera forward direction
// - Additive blending for elegant glow WITHOUT Bloom
// - Eye-friendly exposure (handled by Canvas) and performance toggle

import * as THREE from 'three';
import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useTexture } from '@react-three/drei';

export type HologramWindowProps = {
  /** Window plane size in meters */
  size?: [number, number];
  /** World position */
  position?: [number, number, number];
  /** World rotation (radians) */
  rotation?: [number, number, number];
  /** Overall hologram intensity (used to modulate opacities) */
  intensity?: number;          // 0..1.25
  /** Max parallax shift factor (0..1) */
  parallax?: number;           // recommended 0.15..0.3
  /** Quality mode: controls particles count/size */
  quality?: 'low' | 'high';
  /** Optional logo scale (relative to window size) */
  logoScale?: number;          // 0.2..0.7
};

export default function HologramWindow({
  size = [8.0, 3.6],
  // ادفع النافذة للخلف حتى لا تطفو أمام الأفاتار
  position = [0, 1.6, -6.0],
  rotation = [0, 0, 0],
  intensity = 0.85,
  parallax = 0.20,
  quality = 'high',
  logoScale = 0.38,
  mode = 'window', // NEW: 'window' | 'hud'
}: HologramWindowProps & { mode?: 'window' | 'hud' }) {
  const group       = useRef<THREE.Group>(null);
  const cityRef     = useRef<THREE.Mesh>(null);
  const gridRef     = useRef<THREE.Mesh>(null);
  const scanRef     = useRef<THREE.Mesh>(null);
  const logoRef     = useRef<THREE.Mesh>(null);
  const particlesRef = useRef<THREE.Points>(null);
  const { camera }  = useThree();

  // --- Load textures (placeholders are fine) ---
  const [cityTex, logoTex, gridTex, scanTex, particleTex] = useTexture([
    '/textures/city_panorama.jpg',
    '/ui/eduverse_logo.png',   // official EduVerse neon logo
    '/ui/holo_grid.png',
    '/ui/scanlines.png',
    '/ui/particles.png',
  ]);

  // --- Materials (MeshBasic, toneMapped=false for UI-like luminance) ---
  const cityMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: cityTex,
        toneMapped: false,
        depthWrite: false,
        depthTest: true,
      }),
    [cityTex],
  );

  const gridMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: gridTex,
        transparent: true,
        opacity: 0.16 * intensity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true,
        toneMapped: false,
        color: new THREE.Color('#6CC9FF'),
      }),
    [gridTex, intensity],
  );

  const scanMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: scanTex,
        transparent: true,
        opacity: 0.10 * intensity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true,
        toneMapped: false,
        color: new THREE.Color('#9FE3FF'),
      }),
    [scanTex, intensity],
  );

  const logoMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: logoTex,
        transparent: true,
        opacity: 0.92 * intensity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true,
        toneMapped: false,           // let neon purple/blue/gold pop at full brightness
        color: new THREE.Color('#FFFFFF'), // neutral white — show EduVerse logo colors as-is
      }),
    [logoTex, intensity],
  );

  // --- Particles geometry/material (optional by quality) ---
  const particleGeom = useMemo(() => {
    const g     = new THREE.BufferGeometry();
    const count = quality === 'high' ? 520 : 220;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3 + 0] = (Math.random() - 0.5) * size[0] * 0.92;
      positions[i * 3 + 1] = (Math.random() - 0.5) * size[1] * 0.92;
      positions[i * 3 + 2] = Math.random() * 0.02;
    }
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return g;
  }, [quality, size]);

  const particleMat = useMemo(
    () =>
      new THREE.PointsMaterial({
        map: particleTex,
        transparent: true,
        alphaTest: 0.1,
        size: quality === 'high' ? 0.030 : 0.045,
        color: new THREE.Color('#9FE3FF'),
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
      }),
    [particleTex, quality],
  );

  // --- Animation (parallax + layer motion) ---
  useFrame((state, dt) => {
    const t = state.clock.elapsedTime;

    // Parallax derived from camera forward vector (clamped)
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    const px = THREE.MathUtils.clamp(-dir.x * parallax, -0.35, 0.35);
    const py = THREE.MathUtils.clamp( dir.y * parallax, -0.20, 0.20);
    if (group.current)
      group.current.position.set(position[0] + px, position[1] + py, position[2]);

    // Mild layer motions (eye-friendly)
    if (gridRef.current) {
      gridRef.current.rotation.z = t * 0.02;
      const m = gridRef.current.material as THREE.MeshBasicMaterial;
      m.opacity = 0.16 * intensity + Math.sin(t * 0.6) * 0.04 * intensity;
    }
    if (scanRef.current) {
      scanRef.current.position.y = Math.sin(t * 0.6) * (size[1] * 0.35);
      const m = scanRef.current.material as THREE.MeshBasicMaterial;
      m.opacity = 0.10 * intensity + (Math.sin(t * 1.2) * 0.06 + 0.06) * intensity;
    }
    if (logoRef.current) {
      // Gentle Z rotation + Y float + pulse scale — makes EduVerse logo feel alive
      logoRef.current.rotation.z = Math.sin(t * 0.22) * 0.025;    // very slow tilt
      logoRef.current.position.y = size[1] * 0.12 + Math.sin(t * 0.8) * 0.08; // float up/down
      const baseW = size[0] * logoScale;
      const baseH = size[1] * logoScale;
      const pulse = 1.0 + Math.sin(t * 0.6) * 0.025;
      logoRef.current.scale.set(baseW * pulse, baseH * pulse, 1);
    }
    if (particlesRef.current) {
      particlesRef.current.rotation.z += dt * 0.05;
    }
  });

  // --- Cleanup to avoid GPU leaks on hot-reload ---
  useEffect(() => {
    return () => {
      cityMat.dispose();
      gridMat.dispose();
      scanMat.dispose();
      logoMat.dispose();
      particleGeom.dispose();
      particleMat.dispose();
    };
  }, [cityMat, gridMat, scanMat, logoMat, particleGeom, particleMat]);

  // In HUD mode we intentionally draw last; in window mode we rely on depth.
  const hudRenderOrder = 10;
  const commonProps = mode === 'hud'
    ? { renderOrder: hudRenderOrder }
    : {};

  // --- Render ---
  return (
    <group ref={group} position={position} rotation={rotation}>
      {/* Base city panorama */}
      <mesh ref={cityRef} {...commonProps}>
        <planeGeometry args={size} />
        <meshBasicMaterial map={cityTex} toneMapped={false} depthWrite={false} depthTest={true} />
      </mesh>

      {/* Hologram grid overlay */}
      <mesh ref={gridRef} position={[0, 0, 0.001]} {...commonProps}>
        <planeGeometry args={size} />
        <primitive object={gridMat} attach="material" />
      </mesh>

      {/* Vertical scan band */}
      <mesh ref={scanRef} position={[0, 0, 0.002]} {...commonProps}>
        <planeGeometry args={[size[0], size[1] * 0.4]} />
        <primitive object={scanMat} attach="material" />
      </mesh>

      {/* AI‑EDUCATE logo */}
      <mesh ref={logoRef} position={[0.0, size[1] * 0.12, 0.003]} {...commonProps}>
        {/* هندسة قياسية 1×1 ثم نضبط scale ديناميكيًا */}
        <planeGeometry args={[1, 1]} />
        <primitive object={logoMat} attach="material" />
      </mesh>

      {/* Floating particles (quality-dependent) */}
      {quality !== 'low' && (
        <points ref={particlesRef} position={[0, 0, 0.004]} geometry={particleGeom} {...commonProps}>
          <primitive object={particleMat} attach="material" />
        </points>
      )}
    </group>
  );
}
