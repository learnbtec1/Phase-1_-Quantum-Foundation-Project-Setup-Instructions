'use client';

/** Ref handle exposed by this canvas – matches evaluate/page.tsx expectations. */
export type AvatarCanvasRef = {
  speak: (text: string, onEnd?: () => void) => void;
  setEmotion?: (emotion: string) => void;
};

import React, { Suspense, useCallback, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas } from '@react-three/fiber';
import VRMAvatar from '@/components/avatar/VRMAvatar';
import type { VRMAvatarRef } from '@/components/avatar/VRMAvatar';
import styles from './AvatarCanvas.module.css';

interface AvatarCanvasProps {
  vrmUrl?: string;
  onReady?: (ref: AvatarCanvasRef) => void;
}

/**
 * AvatarCanvas – simple Three.js canvas that renders the VRM avatar.
 * Designed for embedding inside the /evaluate page's avatarFrame container.
 * Calls onReady once the VRM model finishes loading.
 */
export default function AvatarCanvas({
  vrmUrl = '/models/teach.vrm',
  onReady,
}: AvatarCanvasProps) {
  const vrmRef = useRef<VRMAvatarRef>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLoad = useCallback(() => {
    setLoaded(true);
    onReady?.({
      speak: (text, _onEnd) => vrmRef.current?.speak(text),
      setEmotion: (emotion) => vrmRef.current?.setEmotion(emotion),
    });
  }, [onReady]);

  const handleError = useCallback((err: string) => {
    setError(err);
  }, []);

  return (
    <div className={styles.avatarMount}>
      {!loaded && !error && (
        <div className={styles.loadingOverlay}>جاري تحميل فورينا…</div>
      )}
      {error && (
        <div className={styles.errorOverlay}>⚠️ تعذّر تحميل الأفاتار</div>
      )}
      <Canvas
        dpr={[1, 2]}
        camera={{ position: [0, 0.6, 3.2], fov: 50, near: 0.01, far: 100 }}
        gl={{ antialias: true, alpha: false }}
        onCreated={({ gl }) => {
          gl.setClearColor(0x202533, 1);
          gl.outputColorSpace = THREE.SRGBColorSpace;
          // [COPILOT_PBR] ACESFilmic tone mapping for physically correct rendering
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.75;
        }}
        style={{ width: '100%', height: '100%', display: 'block' }}
      >
        <ambientLight intensity={3.5} />
        <directionalLight position={[1, 3, 2]} intensity={4.0} />
        <pointLight position={[-2, 2, 2]} intensity={1.2} color="#8ecfff" />
        <Suspense fallback={null}>
          <VRMAvatar
            ref={vrmRef}
            vrmUrl={vrmUrl}
            scale={1}
            onLoad={handleLoad}
            onError={handleError}
          />
        </Suspense>
      </Canvas>
    </div>
  );
}