'use client';
/**
 * RoomWithShelves.tsx — Classroom room shell with bookcases on the side walls.
 *
 * Exports:
 *  RoomShell          — React component
 *  physicsFallbacks   — { snapYWithRay, separateBoxZ } helpers for non-Rapier setups
 *
 * The room origin is at (0, 0, 0) which is the room centre.
 * Floor is at y = -height/2.
 * Back glass wall is at z = -depth/2 (away from camera).
 * "DeskAnchor" empty object is placed at [0, 0, 0.9] (front half of room).
 *
 * Physics (Rapier) code is preserved in comments — uncomment + wrap in <Physics>
 * and pass usePhysics={true} when @react-three/rapier is installed.
 */
import React, { useMemo } from 'react';
import { Environment } from '@react-three/drei';
import {
  Box3, Color, MeshPhysicalMaterial, MeshStandardMaterial, Object3D, Vector3,
} from 'three';

// ── Physics-fallback helpers (replace Rapier when not installed) ──────────────
export const snapYWithRay = (object3D: Object3D): void => {
  // In a real setup: cast a ray downward from object3D and snap to hit point.
  console.log('[RoomWithShelves] snapYWithRay called for', object3D.name);
};

export const separateBoxZ = (avatar: Object3D, obstacle: Object3D): void => {
  const avatarBox    = new Box3().setFromObject(avatar);
  const obstacleBox  = new Box3().setFromObject(obstacle);
  if (avatarBox.intersectsBox(obstacleBox)) {
    const intersection = avatarBox.clone().intersect(obstacleBox);
    const depth        = intersection.max.z - intersection.min.z;
    const direction    = avatar.position.z > obstacle.position.z ? 1 : -1;
    avatar.position.z += depth * direction;
  }
};

export const physicsFallbacks = { snapYWithRay, separateBoxZ };

// ── Types ─────────────────────────────────────────────────────────────────────
type RoomTheme = {
  walls?:     string;
  floor?:     string;
  trims?:     string;
  shelfWood?: string;
  glassTint?: string;
};

type RoomProps = {
  width?:       number;
  depth?:       number;
  height?:      number;
  thickness?:   number;
  shelvesCount?: number;
  usePhysics?:  boolean;
  useHDRI?:     boolean;
  theme?:       RoomTheme;
};

// ── Component ─────────────────────────────────────────────────────────────────
export const RoomShell = ({
  width       = 7,
  depth       = 5,
  height      = 3,
  thickness   = 0.05,
  shelvesCount = 5,
  usePhysics  = false,
  useHDRI     = true,
  theme       = {},
}: RoomProps) => {
  const { walls, floor, shelfWood, glassTint } = {
    walls:     '#f0f0f0',
    floor:     '#4a4a4a',
    shelfWood: '#8B4513',
    glassTint: '#a0c0d0',
    ...theme,
  };

  // Memoised materials — recreated only when colour props change
  const wallMat  = useMemo(() => new MeshStandardMaterial({ color: new Color(walls) }),     [walls]);
  const floorMat = useMemo(() => new MeshStandardMaterial({ color: new Color(floor) }),     [floor]);
  const shelfMat = useMemo(() => new MeshStandardMaterial({ color: new Color(shelfWood) }), [shelfWood]);

  const glassMat = useMemo(() => {
    const mat = new MeshPhysicalMaterial({
      transmission: 0.8,
      roughness:    0.05,
      ior:          1.2,
      color:        new Color(glassTint),
      transparent:  true,
    });

    if (!useHDRI) {
      mat.onBeforeCompile = (shader) => {
        shader.uniforms.gradientColor1 = { value: new Color('#a0c0d0') };
        shader.uniforms.gradientColor2 = { value: new Color('#e0f0ff') };
        shader.fragmentShader = `
          uniform vec3 gradientColor1;
          uniform vec3 gradientColor2;
          ${shader.fragmentShader}
        `.replace(
          '#include <dithering_fragment>',
          `
          vec2 uv = vUv;
          vec3 gradient = mix(gradientColor1, gradientColor2, uv.y);
          gl_FragColor = vec4(gradient, 1.0);
          #include <dithering_fragment>
          `,
        );
      };
    }
    return mat;
  }, [glassTint, useHDRI]);

  // Half-extents for readability
  const hw = width  / 2;
  const hd = depth  / 2;
  const hh = height / 2;

  return (
    <group>
      {/* ── Lighting ─────────────────────────────────────────────── */}
      <ambientLight intensity={0.5} />
      <directionalLight
        position={[5, 10, 7.5]}
        intensity={0.8}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-near={0.1}
        shadow-camera-far={50}
        shadow-camera-left={-10}
        shadow-camera-right={10}
        shadow-camera-top={10}
        shadow-camera-bottom={-10}
      />
      {/* R3F uses `color` for sky color, not `skyColor` */}
      <hemisphereLight color="#ffffff" groundColor="#000000" intensity={0.3} />

      {/* ── HDRI environment (outside any mesh) ──────────────────── */}
      {useHDRI && <Environment preset="city" background={false} />}

      {/* ── Floor ────────────────────────────────────────────────── */}
      <mesh receiveShadow position={[0, -hh, 0]} material={floorMat}>
        <boxGeometry args={[width, thickness, depth]} />
        {/* {usePhysics && <RigidBody type="fixed"><boxGeometry args={[width, thickness, depth]} /></RigidBody>} */}
      </mesh>

      {/* ── Ceiling ──────────────────────────────────────────────── */}
      <mesh position={[0, hh, 0]} material={wallMat}>
        <boxGeometry args={[width, thickness, depth]} />
      </mesh>

      {/* ── Back wall (glass) ─────────────────────────────────────── */}
      <mesh receiveShadow position={[0, 0, -hd]} material={glassMat}>
        <boxGeometry args={[width, height, thickness]} />
        {/* {usePhysics && <RigidBody type="fixed"><boxGeometry args={[width, height, thickness]} /></RigidBody>} */}
      </mesh>

      {/* ── Left wall + bookshelves ───────────────────────────────── */}
      <group position={[-hw, 0, 0]}>
        <mesh receiveShadow material={wallMat}>
          <boxGeometry args={[thickness, height, depth]} />
          {/* {usePhysics && <RigidBody type="fixed"><boxGeometry args={[thickness, height, depth]} /></RigidBody>} */}
        </mesh>

        {Array.from({ length: shelvesCount }).map((_, i) => {
          const y = hh - (i + 1) * (height / (shelvesCount + 1));
          return (
            <React.Fragment key={i}>
              {/* Horizontal plank */}
              <mesh position={[thickness / 2 + 0.01, y, 0]} material={shelfMat}>
                <boxGeometry args={[0.8, 0.02, depth - 0.2]} />
              </mesh>
              {/* Front upright */}
              <mesh position={[thickness / 2 + 0.41, y, -(hd - 0.1)]} material={shelfMat}>
                <boxGeometry args={[0.02, 0.2, 0.02]} />
              </mesh>
              {/* Back upright */}
              <mesh position={[thickness / 2 + 0.41, y,  (hd - 0.1)]} material={shelfMat}>
                <boxGeometry args={[0.02, 0.2, 0.02]} />
              </mesh>
            </React.Fragment>
          );
        })}
      </group>

      {/* ── Right wall + bookshelves ──────────────────────────────── */}
      <group position={[hw, 0, 0]}>
        <mesh receiveShadow material={wallMat}>
          <boxGeometry args={[thickness, height, depth]} />
          {/* {usePhysics && <RigidBody type="fixed"><boxGeometry args={[thickness, height, depth]} /></RigidBody>} */}
        </mesh>

        {Array.from({ length: shelvesCount }).map((_, i) => {
          const y = hh - (i + 1) * (height / (shelvesCount + 1));
          return (
            <React.Fragment key={i}>
              <mesh position={[-(thickness / 2 + 0.01), y, 0]} material={shelfMat}>
                <boxGeometry args={[0.8, 0.02, depth - 0.2]} />
              </mesh>
              <mesh position={[-(thickness / 2 + 0.41), y, -(hd - 0.1)]} material={shelfMat}>
                <boxGeometry args={[0.02, 0.2, 0.02]} />
              </mesh>
              <mesh position={[-(thickness / 2 + 0.41), y,  (hd - 0.1)]} material={shelfMat}>
                <boxGeometry args={[0.02, 0.2, 0.02]} />
              </mesh>
            </React.Fragment>
          );
        })}
      </group>

      {/* ── Desk anchor (OfficeDeskPro snaps here on mount) ───────── */}
      <object3D name="DeskAnchor" position={[0, 0, 0.9]} />
    </group>
  );
};
