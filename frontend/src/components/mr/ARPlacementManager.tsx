'use client';

/**
 * ARPlacementManager
 *
 * Renders a glowing cyan reticle that snaps to real-world surfaces detected
 * via WebXR hit-testing.  When the user taps (select event / pointer click),
 * the confirmed hit position is surfaced via `onPlace`.
 *
 * Must be rendered inside an active `<XR>` context.
 */

import React, { useCallback, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useXRHitTest } from '@react-three/xr';
import * as THREE from 'three';

const _matrix = new THREE.Matrix4();

export interface ARPlacementManagerProps {
  /** Called with the world-space placement position when the user taps a surface */
  onPlace: (position: THREE.Vector3) => void;
}

function Reticle({ onPlace }: ARPlacementManagerProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  /** Latest valid hit position in world space */
  const hitPos = useRef(new THREE.Vector3());
  const hasHit = useRef(false);

  // Continuously resolve hit-test results from the viewer reference space
  useXRHitTest(
    (results, getWorldMatrix) => {
      if (!results?.length) {
        hasHit.current = false;
        return;
      }
      try {
        getWorldMatrix(_matrix, results[0]);
        hitPos.current.setFromMatrixPosition(_matrix);
        hasHit.current = true;
      } catch {
        // Ignore errors when session/frame state is briefly invalid
        hasHit.current = false;
      }
    },
    'viewer',
    ['plane', 'mesh'],
  );

  // Smoothly lerp the reticle mesh toward the latest hit position each frame
  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    if (hasHit.current) {
      mesh.position.lerp(hitPos.current, 0.15);
      mesh.visible = true;
    } else {
      mesh.visible = false;
    }
  });

  // On tap (XR select → Three.js onClick), confirm placement
  const handleClick = useCallback(() => {
    if (hasHit.current) onPlace(hitPos.current.clone());
  }, [onPlace]);

  return (
    <mesh
      ref={meshRef}
      rotation={[-Math.PI / 2, 0, 0]}
      visible={false}
      onClick={handleClick}
    >
      {/* Glowing ring that sits flat on the detected surface */}
      <ringGeometry args={[0.15, 0.2, 32]} />
      <meshBasicMaterial
        color="#00ffff"
        transparent
        opacity={0.85}
        side={THREE.DoubleSide}
        depthWrite={false}
      />
    </mesh>
  );
}

export default function ARPlacementManager({ onPlace }: ARPlacementManagerProps) {
  return <Reticle onPlace={onPlace} />;
}
