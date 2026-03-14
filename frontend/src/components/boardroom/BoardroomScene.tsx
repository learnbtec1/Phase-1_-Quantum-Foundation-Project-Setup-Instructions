'use client';

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import {
  Environment,
  ContactShadows,
  Sparkles,
  SpotLight,
} from '@react-three/drei';
import { XR, useXR, type XRStore, type XRState } from '@react-three/xr';
import * as THREE from 'three';
import dynamic from 'next/dynamic';
import ErrorBoundary from '@/components/ErrorBoundary';
import type { VRMAvatarRef } from '@/components/avatar/VRMAvatar';

function useIsMobile() {
  return useMemo(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth < 768 || /Mobi|Android/i.test(navigator.userAgent);
  }, []);
}

import BoardroomAvatar from '@/components/avatar/VRMAvatar';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const VRMAvatarCompat = BoardroomAvatar as unknown as React.ForwardRefExoticComponent<React.PropsWithoutRef<{ useSimpleFallback?: boolean }> & React.RefAttributes<VRMAvatarRef>>;
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

// ─── Fallback shown while VRM loads ───────────────────────────────────────────

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

// ─── City backdrop ────────────────────────────────────────────────────────────

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
  const texRef = useRef<THREE.Texture | null>(null);

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
      <mesh position={[2, 0, 0.2]}>
        <planeGeometry args={[3, 8]} />
        <meshBasicMaterial
          color={0x4a90e2}
          transparent
          opacity={0.06}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh position={[-2.5, 0, 0.2]}>
        <planeGeometry args={[2.5, 7]} />
        <meshBasicMaterial
          color={0xffedd6}
          transparent
          opacity={0.05}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          side={THREE.DoubleSide}
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

// ─── Desktop-only scene (no XR) ───────────────────────────────────────────────

function BoardroomContent({
  useSimpleFallback = false,
  avatarRef,
}: {
  useSimpleFallback?: boolean;
  avatarRef?: React.RefObject<VRMAvatarRef | null>;
}) {
  const mobile = useIsMobile();
  return (
    <>
      <Environment preset="city" environmentIntensity={0.6} />
      <ambientLight intensity={0.35} />
      <hemisphereLight color="#4a90e2" groundColor="#1a1a2e" intensity={0.4} />
      <SpotLight
        position={[6, 8, 4]}
        angle={0.4}
        penumbra={0.6}
        color="#ffedd6"
        intensity={1.2}
        castShadow
        shadow-mapSize={1024}
      />
      <pointLight position={[-3, 4, 3]} color="#4a90e2" intensity={0.5} />
      <pointLight position={[3, 3, 2]} color="#4a90e2" intensity={0.25} />
      <CityWindow />
      <Table />
      <ChairSilhouette position={[1.4, -0.37, 0.8]} />
      <ChairSilhouette position={[-1.4, -0.37, 0.8]} />
      <ChairSilhouette position={[1.2, -0.37, -0.6]} />
      <ChairSilhouette position={[-1.2, -0.37, -0.6]} />
      <BrandingText />
      <HolographicPanels />
      <Suspense fallback={<FallbackAvatar />}>
        <VRMAvatarCompat ref={avatarRef} useSimpleFallback={useSimpleFallback} />
      </Suspense>
      <ContactShadows position={[0, -0.82, 0]} opacity={0.45} scale={12} blur={2.5} far={4} />
      <Sparkles count={mobile ? 30 : 80} scale={14} size={1.2} opacity={0.08} color="#4a90e2" />
    </>
  );
}

// ─── XRSessionEffects — manages transparency + shadows on AR/desktop toggle ───

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

function WebGLContextEvents() {
  const { gl } = useThree();

  useEffect(() => {
    const cvs = gl.domElement;
    const handleContextLost = (e: Event) => {
      e.preventDefault();
      window.dispatchEvent(new Event('boardroom:contextlost'));
    };
    const handleContextRestored = () => {
      window.dispatchEvent(new Event('boardroom:contextrestored'));
    };
    cvs.addEventListener('webglcontextlost', handleContextLost);
    cvs.addEventListener('webglcontextrestored', handleContextRestored);
    return () => {
      cvs.removeEventListener('webglcontextlost', handleContextLost);
      cvs.removeEventListener('webglcontextrestored', handleContextRestored);
    };
  }, [gl]);

  return null;
}

// ─── XR-aware scene manager (must live inside <XR>) ───────────────────────────

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
      {/* Transparent-background handler */}
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
      <pointLight
        position={[-3, 4, 3]}
        color="#4a90e2"
        intensity={isPresenting ? 0.3 : 0.5}
      />
      <pointLight
        position={[3, 3, 2]}
        color="#4a90e2"
        intensity={isPresenting ? 0.15 : 0.25}
      />

      {/* Boardroom furniture — hidden in AR to expose camera feed */}
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

      {/* AR surface reticle — only in session */}
      {isPresenting && <ARPlacementManager onPlace={handleARPlace} />}

      {/* Avatar + panels — always visible; shift to AR placement position */}
      <group position={isPresenting ? arPosition : [0, 0, 0]}>
        <HolographicPanels />
        <Suspense fallback={<FallbackAvatar />}>
          <VRMAvatarCompat ref={avatarRef} useSimpleFallback={useSimpleFallback} />
        </Suspense>
        {isPresenting && (
          <ContactShadows
            position={[0, -0.02, 0]}
            opacity={0.35}
            scale={2}
            blur={1.5}
            far={1}
          />
        )}
      </group>

      {!isPresenting && (
        <ContactShadows
          position={[0, -0.82, 0]}
          opacity={0.45}
          scale={12}
          blur={2.5}
          far={4}
        />
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

// ─── Public component ─────────────────────────────────────────────────────────

export interface BoardroomSceneProps {
  canvasKey?: number;
  useSimpleAvatarFallback?: boolean;
  /** XRStore — when provided the Canvas gains full WebXR AR support */
  xrStore?: XRStore | null;
  /** Ref to access avatar speak() */
  avatarRef?: React.RefObject<VRMAvatarRef | null>;
}

export default function BoardroomScene({
  canvasKey = 0,
  useSimpleAvatarFallback = false,
  xrStore,
  avatarRef,
}: BoardroomSceneProps) {
  return (
    <div className="absolute inset-0 w-full h-full min-h-[300px]">
      <Canvas
        key={canvasKey}
        dpr={[1, 2]}
        shadows
        camera={{ position: [0, 1.8, 6.8], fov: 60 }}
        gl={{
          antialias: true,
          alpha: true,          // Required for AR transparent compositing
          preserveDrawingBuffer: false,
          outputColorSpace: THREE.SRGBColorSpace,
          powerPreference: 'high-performance',
        }}
        style={{ width: '100%', height: '100%', display: 'block' }}
        onCreated={({ gl }) => {
          gl.setPixelRatio(Math.min(typeof window !== 'undefined' ? window.devicePixelRatio : 1, 2));
          // Start opaque (desktop default)
          gl.setClearAlpha(1);
        }}
      >
        <WebGLContextEvents />
        {xrStore != null ? (
          <XR store={xrStore}>
            <SceneManager useSimpleFallback={useSimpleAvatarFallback} avatarRef={avatarRef} />
          </XR>
        ) : (
          <BoardroomContent useSimpleFallback={useSimpleAvatarFallback} avatarRef={avatarRef} />
        )}
      </Canvas>
    </div>
  );
}
