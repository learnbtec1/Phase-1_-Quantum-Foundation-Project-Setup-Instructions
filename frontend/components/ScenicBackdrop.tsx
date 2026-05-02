'use client';
/**
 * ScenicBackdrop — panoramic city backdrop with mild parallax.
 * Loads /public/textures/city_panorama.jpg as a fullscreen plane
 * placed at z=-6.0 (inside the window aperture behind the avatar).
 *
 * Graceful: if the texture file is absent the component renders nothing
 * (no error thrown — backdrop is simply hidden until the file is placed).
 *
 * Parallax: the plane shifts slightly opposite to camera look direction,
 * giving a comfortable depth-of-field sensation without post-processing.
 */
import * as THREE from 'three';
import React, { useMemo, useRef, useEffect, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';

interface ScenicBackdropProps {
  size?:     [number, number];
  position?: [number, number, number];
  rotation?: [number, number, number];
  /** Parallax strength 0–0.35. Default 0.18 (eye-friendly). */
  parallax?: number;
}

export default function ScenicBackdrop({
  size     = [8.0, 3.6],
  position = [0, 1.6, -6.0],
  rotation = [0, 0, 0],
  parallax = 0.18,
}: ScenicBackdropProps) {
  const groupRef = useRef<THREE.Group>(null);
  const { camera } = useThree();
  const [pano, setPano] = useState<THREE.Texture | null>(null);

  // Graceful texture load — renders nothing if 404
  useEffect(() => {
    const loader = new THREE.TextureLoader();
    loader.load(
      '/textures/city_panorama.jpg',
      (tx) => {
        tx.colorSpace = THREE.SRGBColorSpace;
        setPano(tx);
      },
      undefined,
      () =>
        console.warn(
          '[ScenicBackdrop] /textures/city_panorama.jpg not found — backdrop hidden. ' +
          'Place a panoramic city JPEG there to enable the backdrop.',
        ),
    );
  }, []);

  const mat = useMemo(() => {
    if (!pano) return null;
    return new THREE.MeshBasicMaterial({
      map:        pano,
      toneMapped: false,   // preserve sky colours; ACES should not crush the backdrop
      depthWrite: false,
      depthTest:  true,
    });
  }, [pano]);

  // Mild parallax: translate opposite to camera look-dir (X + Y axes only)
  useFrame(() => {
    if (!groupRef.current) return;
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    const px = THREE.MathUtils.clamp(-dir.x * parallax, -0.30, 0.30);
    const py = THREE.MathUtils.clamp( dir.y * parallax, -0.15, 0.15);
    groupRef.current.position.set(position[0] + px, position[1] + py, position[2]);
  });

  if (!mat) return null;

  return (
    <group ref={groupRef} position={position} rotation={rotation}>
      <mesh>
        <planeGeometry args={size} />
        <primitive object={mat} attach="material" />
      </mesh>
    </group>
  );
}
