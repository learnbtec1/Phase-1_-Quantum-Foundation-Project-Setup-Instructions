'use client';

/**
 * XR-enabled boardroom content. Loaded dynamically only when xrStore is provided
 * to avoid pulling @react-three/xr into the main bundle (React 19 compatibility).
 */
import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useThree } from '@react-three/fiber';
import {
  Environment,
  ContactShadows,
  Sparkles,
  SpotLight,
} from '@react-three/drei';
import { XR, useXR, type XRStore, type XRState } from '@react-three/xr';
import * as THREE from 'three';
import dynamic from 'next/dynamic';
import type { VRMAvatarRef } from '@/components/avatar/VRMAvatar';
import BoardroomAvatar from '@/components/avatar/VRMAvatar';

const HolographicPanels = dynamic(
  () => import('@/components/boardroom/HolographicPanels').then((m) => m.default),
  { ssr: false }
);
const BrandingText = dynamic(
  () => import('@/components/boardroom/BrandingText').then((m) => m.default),
  { ssr: false }
);
const ARPlacementManager = dynamic(
  () => import('@/components/mr/ARPlacementManager').then((m) => m.default),
  { ssr: false }
);

function useIsMobile() {
  return useMemo(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth < 768 || /Mobi|Android/i.test(navigator.userAgent);
  }, []);
}

function FallbackAvatar() {
  return (
    <group position={[0, -1.02, 0.2]}>
      <mesh>
        <boxGeometry args={[0.4, 0.9, 0.2]} />
        <meshStandardMaterial color="#334155" />
      </mesh>
    </group>
  );
}

function ChairSilhouette({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh castShadow>
        <boxGeometry args={[0.5, 0.9, 0.5]} />
        <meshStandardMaterial color="#1a1512" roughness={0.9} metalness={0.1} />
      </mesh>
    </group>
  );
}

function makeFallbackTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 2;
  canvas.height = 2;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(canvas);
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, 2, 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

function CityWindow() {
  const [tex, setTex] = useState<THREE.Texture | null>(null);
  const texRef = React.useRef<THREE.Texture | null>(null);

  useEffect(() => {
    try {
      if (typeof document === 'undefined') return;
      const fallback = makeFallbackTexture();
      texRef.current = fallback;
      setTex(fallback);
    } catch {
      setTex(null);
    }
    return () => {
      texRef.current?.dispose();
      texRef.current = null;
    };
  }, []);

  return (
    <group position={[0, 2.5, -6.5]}>
      <mesh>
        <planeGeometry args={[18, 10]} />
        <meshBasicMaterial
          map={tex}
          color={!tex ? '#0f172a' : undefined}
          transparent
          opacity={tex ? 0.85 : 0.7}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

function Table() {
  return (
    <group position={[0, -0.82, 0]}>
      <mesh receiveShadow castShadow>
        <boxGeometry args={[4.2, 0.08, 2.2]} />
        <meshPhysicalMaterial
          color="#2c1810"
          roughness={0.22}
          metalness={0.25}
          clearcoat={0.6}
          clearcoatRoughness={0.3}
          envMapIntensity={0.8}
        />
      </mesh>
    </group>
  );
}

function XRSessionEffects() {
  const { gl } = useThree();
  const session = useXR((s: XRState) => s.session);
  const isPresenting = session != null;

  useEffect(() => {
    if (isPresenting) {
      gl.setClearAlpha(0);
      gl.domElement.style.background = 'transparent';
      const onEnd = () => {
        gl.setClearAlpha(1);
        gl.domElement.style.background = '';
      };
      session?.addEventListener('end', onEnd);
      return () => {
        session?.removeEventListener('end', onEnd);
        gl.setClearAlpha(1);
        gl.domElement.style.background = '';
      };
    }
    gl.setClearAlpha(1);
    gl.domElement.style.background = '';
    return () => {
      gl.setClearAlpha(1);
      gl.domElement.style.background = '';
    };
  }, [isPresenting, gl, session]);

  return null;
}

function SceneManager({
  useSimpleFallback = false,
  avatarRef,
}: {
  useSimpleFallback?: boolean;
  avatarRef?: React.RefObject<VRMAvatarRef | null>;
}) {
  const session = useXR((s: XRState) => s.session);
  const isPresenting = session != null;
  const mobile = useIsMobile();

  const [arPosition, setArPosition] = useState<THREE.Vector3>(
    () => new THREE.Vector3(0, 0, -1.5)
  );

  const handleARPlace = useCallback((pos: THREE.Vector3) => {
    setArPosition(pos);
  }, []);

  return (
    <>
      <XRSessionEffects />
      <Environment preset="city" environmentIntensity={isPresenting ? 0.4 : 0.6} />
      <ambientLight intensity={isPresenting ? 0.8 : 0.35} />
      <hemisphereLight color="#4a90e2" groundColor="#1a1a2e" intensity={isPresenting ? 0.2 : 0.4} />
      {!isPresenting && (
        <SpotLight
          position={[6, 8, 4]}
          angle={0.4}
          penumbra={0.6}
          color="#ffedd6"
          intensity={1.2}
          castShadow
          shadow-mapSize={1024}
        />
      )}
      <pointLight position={[-3, 4, 3]} color="#4a90e2" intensity={isPresenting ? 0.3 : 0.5} />
      <pointLight position={[3, 3, 2]} color="#4a90e2" intensity={isPresenting ? 0.15 : 0.25} />
      {!isPresenting && <CityWindow />}
      {!isPresenting && <Table />}
      {!isPresenting && (
        <>
          <ChairSilhouette position={[1.4, -0.37, 0.8]} />
          <ChairSilhouette position={[-1.4, -0.37, 0.8]} />
          <ChairSilhouette position={[1.2, -0.37, -0.6]} />
          <ChairSilhouette position={[-1.2, -0.37, -0.6]} />
        </>
      )}
      {!isPresenting && <BrandingText />}
      {isPresenting && <ARPlacementManager onPlace={handleARPlace} />}
      <group position={isPresenting ? arPosition : [0, 0, 0]}>
        <HolographicPanels />
        <Suspense fallback={<FallbackAvatar />}>
          <BoardroomAvatar ref={avatarRef as React.RefObject<VRMAvatarRef>} useSimpleFallback={useSimpleFallback} />
        </Suspense>
        {isPresenting && (
          <ContactShadows position={[0, -0.02, 0]} opacity={0.35} scale={2} blur={1.5} far={1} />
        )}
      </group>
      {!isPresenting && (
        <ContactShadows position={[0, -0.82, 0]} opacity={0.45} scale={12} blur={2.5} far={4} />
      )}
      <Sparkles
        count={isPresenting ? 30 : mobile ? 30 : 80}
        scale={isPresenting ? 3 : 14}
        size={1.2}
        opacity={0.08}
        color="#4a90e2"
      />
    </>
  );
}

export interface XRBoardroomWrapperProps {
  xrStore: XRStore;
  useSimpleFallback?: boolean;
  avatarRef?: React.RefObject<VRMAvatarRef | null>;
}

export default function XRBoardroomWrapper({
  xrStore,
  useSimpleFallback = false,
  avatarRef,
}: XRBoardroomWrapperProps) {
  return (
    <XR store={xrStore}>
      <SceneManager useSimpleFallback={useSimpleFallback} avatarRef={avatarRef} />
    </XR>
  );
}
