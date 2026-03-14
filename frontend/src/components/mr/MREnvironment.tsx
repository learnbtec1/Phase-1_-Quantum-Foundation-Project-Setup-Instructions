'use client';

import React, { useEffect, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, ContactShadows, Float } from '@react-three/drei';
import { XR, useXRHitTest } from '@react-three/xr';
import * as THREE from 'three';
import type { XRStore } from '@react-three/xr';
import dynamic from 'next/dynamic';

const BoardroomAvatar = dynamic(
  () => import('@/components/avatar/VRMAvatar').then((m) => m.default),
  { ssr: false }
);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const BoardroomAvatarEl = BoardroomAvatar as unknown as React.ComponentType<{ scale?: number }>;

/** Handles WebGL context loss/restore inside the MR Canvas */
function MRContextEvents() {
  const { gl } = useThree();
  useEffect(() => {
    const cvs = gl.domElement;
    const onLost = (e: Event) => {
      e.preventDefault();
      window.dispatchEvent(new Event('mr:contextlost'));
    };
    const onRestored = () => {
      // Re-apply alpha on restore so AR compositing stays correct
      gl.setClearAlpha(0);
      window.dispatchEvent(new Event('mr:contextrestored'));
    };
    cvs.addEventListener('webglcontextlost', onLost, false);
    cvs.addEventListener('webglcontextrestored', onRestored, false);
    return () => {
      cvs.removeEventListener('webglcontextlost', onLost);
      cvs.removeEventListener('webglcontextrestored', onRestored);
      // Reset alpha so the MR canvas doesn't leave a transparent hole on unmount
      try { gl.setClearAlpha(1); } catch { /* canvas already destroyed */ }
    };
  }, [gl]);
  return null;
}

const matrixHelper = new THREE.Matrix4();
const hitTestPosition = new THREE.Vector3(0, 0, 0);

function MRContent() {
  const groupRef = useRef<THREE.Group>(null);
  const placedRef = useRef(false);

  useXRHitTest(
    (results, getWorldMatrix) => {
      if (!results || results.length === 0 || placedRef.current) return;
      const hit = results[0];
      if (!hit) return;
      try {
        getWorldMatrix(matrixHelper, hit);
        hitTestPosition.setFromMatrixPosition(matrixHelper);
        placedRef.current = true;
      } catch {
        // ignore hit-test errors when session or frame state is invalid
      }
    },
    'viewer',
    ['plane', 'mesh']
  );

  useFrame(() => {
    const g = groupRef.current;
    if (g && placedRef.current) {
      g.position.lerp(hitTestPosition, 0.08);
      g.visible = true;
    }
  });

  return (
    <>
      <Environment preset="city" environmentIntensity={0.5} />
      <ambientLight intensity={0.6} />
      <directionalLight position={[2, 4, 2]} intensity={0.8} />
      <group ref={groupRef} position={[0, 0, 0]} visible={false}>
        <Float speed={1} floatIntensity={0.03}>
          <group scale={0.6}>
            <BoardroomAvatarEl scale={1} />
          </group>
        </Float>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]}>
          <circleGeometry args={[0.5, 32]} />
          <meshStandardMaterial color="#1e293b" />
        </mesh>
        <ContactShadows position={[0, -0.02, 0]} opacity={0.4} scale={2} blur={1.5} far={1} />
      </group>
    </>
  );
}

export interface MREnvironmentProps {
  store: XRStore | null;
  active: boolean;
}

export default function MREnvironment({ store, active }: MREnvironmentProps) {
  if (!store) return null;
  // Only mount XR Canvas when MR is active to avoid library running onDeviceFrame with null session/hit results
  if (!active) return null;

  return (
    <div
      className="fixed inset-0 z-30"
      style={{ width: '100%', height: '100%' }}
      aria-hidden
    >
      <Canvas
        dpr={[1, 1.5]}
        camera={{ position: [0, 0, 2], fov: 60 }}
        gl={{
          antialias: true,
          alpha: true,
          preserveDrawingBuffer: false,
        }}
        style={{ width: '100%', height: '100%', display: 'block' }}
      >
        <XR store={store}>
          <MRContextEvents />
          <MRContent />
        </XR>
      </Canvas>
    </div>
  );
}
