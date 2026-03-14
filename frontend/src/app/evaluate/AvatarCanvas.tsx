'use client';

/**
 * evaluate/AvatarCanvas — Slim standalone VRM canvas.
 * Loads VRM directly via GLTFLoader + VRMLoaderPlugin.
 * Does NOT import from components/avatar/VRMAvatar.tsx.
 */

export type AvatarCanvasRef = {
  speak: (text: string, onEnd?: () => void) => void;
  setEmotion?: (emotion: string) => void;
};

import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame } from '@react-three/fiber';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRM, VRMLoaderPlugin } from '@pixiv/three-vrm';
import styles from './AvatarCanvas.module.css';

interface AvatarCanvasProps {
  vrmUrl?: string;
  onReady?: (ref: AvatarCanvasRef) => void;
}

// ── VRMScene (lives inside <Canvas>) ─────────────────────────────────────────
function VRMScene({
  vrmUrl,
  onLoad,
  onError,
}: {
  vrmUrl: string;
  onLoad: () => void;
  onError: (err: string) => void;
}) {
  const [vrm, setVrm]       = useState<VRM | null>(null);
  const vrmRef               = useRef<VRM | null>(null);
  const groupRef             = useRef<THREE.Group>(null);
  const isTalkingRef         = useRef(false);
  const talkElapsedRef       = useRef(0);
  const emotionRef           = useRef('neutral');
  const nextBlinkRef         = useRef(Date.now() + 3000);
  const blinkPhaseRef        = useRef(0);

  // Load VRM
  useEffect(() => {
    let cancelled = false;
    const loader = new GLTFLoader();
    loader.register((p: unknown) => new VRMLoaderPlugin(p as never));
    loader.load(
      vrmUrl,
      (gltf) => {
        if (cancelled) return;
        const model = gltf.userData.vrm as VRM;
        if (!model?.scene) { onError('No VRM data'); return; }
        // NOTE: combineSkeletons breaks humanoid bone lookup — do NOT call it
        model.scene.traverse((o) => {
          o.frustumCulled = false;
          if ((o as THREE.Mesh).isMesh) {
            const mesh = o as THREE.Mesh;
            const mats = Array.isArray(mesh.material) ? mesh.material as THREE.Material[] : [mesh.material as THREE.Material];
            mats.forEach((m) => { m.depthWrite = true; m.visible = true; m.side = THREE.DoubleSide; m.needsUpdate = true; });
          }
        });
        vrmRef.current = model;
        setVrm(model);
        onLoad();
      },
      undefined,
      () => { if (!cancelled) onError('Load failed'); },
    );
    return () => { cancelled = true; };
  }, [vrmUrl, onLoad, onError]);

  // Window event listeners for speak / emotion
  useEffect(() => {
    const onSpeakStart = () => { isTalkingRef.current = true; talkElapsedRef.current = 0; };
    const onSpeakEnd   = () => { isTalkingRef.current = false; };
    const onEmotion    = (e: Event) => {
      const em = (e as CustomEvent<{ emotion?: string }>).detail?.emotion;
      if (em) emotionRef.current = em;
    };
    window.addEventListener('avatar:speak:start',   onSpeakStart);
    window.addEventListener('avatar:speak:end',     onSpeakEnd);
    window.addEventListener('avatar:stopSpeaking',  onSpeakEnd);
    window.addEventListener('avatar:emotion',       onEmotion);
    return () => {
      window.removeEventListener('avatar:speak:start',  onSpeakStart);
      window.removeEventListener('avatar:speak:end',    onSpeakEnd);
      window.removeEventListener('avatar:stopSpeaking', onSpeakEnd);
      window.removeEventListener('avatar:emotion',      onEmotion);
    };
  }, []);

  useFrame((_state, delta) => {
    const v     = vrmRef.current;
    const group = groupRef.current;
    if (!v || !group) return;

    const t   = _state.clock.elapsedTime;
    const now = Date.now();

    group.position.y = -1.0 + Math.sin(t * 0.9) * 0.01;

    const em = v.expressionManager;
    if (em) {
      // Blink
      if (blinkPhaseRef.current > 0) {
        blinkPhaseRef.current += delta * 12;
        const bv = blinkPhaseRef.current < Math.PI ? Math.sin(blinkPhaseRef.current) : 0;
        try { em.setValue('blink' as never, Math.min(1, bv)); } catch {
          try { em.setValue('blinkLeft' as never, bv); em.setValue('blinkRight' as never, bv); } catch { /* no-op */ }
        }
        if (blinkPhaseRef.current > Math.PI * 2) {
          blinkPhaseRef.current = 0;
          nextBlinkRef.current  = now + (3 + Math.random() * 4) * 1000;
          try { em.setValue('blink' as never, 0); } catch {}
        }
      } else if (now >= nextBlinkRef.current) {
        blinkPhaseRef.current = 0.001;
      }

      // Procedural lip-sync
      if (isTalkingRef.current) {
        talkElapsedRef.current += delta;
        const jaw = Math.max(0, Math.min(1, 0.35 + 0.5 * Math.sin(talkElapsedRef.current * 9.1)));
        try { em.setValue('aa' as never, jaw); } catch {}
      } else {
        try { em.setValue('aa' as never, 0); } catch {}
      }

      // Emotion blendshapes
      const emo = emotionRef.current;
      const isHappy = emo === 'friendly' || emo === 'happy' || emo === 'excited';
      try { em.setValue('happy' as never, isHappy ? 0.7 : 0); } catch {}
      try { em.setValue('sad'   as never, emo === 'sad' ? 0.6 : 0); } catch {}

      em.update();
    }

    v.update(delta);

    // Idle arm sway — MUST run after v.update() so spring bones don't reset manually set poses
    if (v.humanoid) {
      const sway = Math.sin(t * 0.4) * 0.06;
      const rua = v.humanoid.getRawBoneNode('rightUpperArm' as never);
      const lua = v.humanoid.getRawBoneNode('leftUpperArm'  as never);
      if (rua) rua.rotation.set(sway,  0, -1.3, 'XYZ');
      if (lua) lua.rotation.set(-sway, 0,  1.3, 'XYZ');
    }
  });

  return (
    <group ref={groupRef} position={[0, -1.0, 0]} rotation={[0, Math.PI, 0]} scale={[1.2, 1.2, 1.2]}>
      {vrm && <primitive object={vrm.scene} />}
    </group>
  );
}

// ── AvatarCanvas (exported default) ──────────────────────────────────────────
export default function AvatarCanvas({
  vrmUrl = '/models/teach.vrm',
  onReady,
}: AvatarCanvasProps) {
  const [loaded, setLoaded] = useState(false);
  const [error,  setError]  = useState<string | null>(null);

  const handleLoad = useCallback(() => {
    setLoaded(true);
    onReady?.({
      speak:      (text, _onEnd) => window.dispatchEvent(new CustomEvent('avatar:speak:text', { detail: { text } })),
      setEmotion: (emotion)      => window.dispatchEvent(new CustomEvent('avatar:emotion',    { detail: { emotion } })),
    });
  }, [onReady]);

  const handleError = useCallback((err: string) => setError(err), []);

  return (
    <div className={styles.avatarMount}>
      {!loaded && !error && (
        <div className={styles.loadingOverlay}>جاري تحميل الدكتور حمزة...</div>
      )}
      {error && (
        <div className={styles.errorOverlay}>⚠️ تعذّر تحميل الأفاتار</div>
      )}
      <Canvas
        dpr={[1, 2]}
        camera={{ position: [0, 0.6, 3.2], fov: 50, near: 0.01, far: 100 }}
        gl={{ antialias: true, alpha: false }}
        onCreated={({ gl }) => {
          gl.setClearColor(0x101520, 1);
          gl.outputColorSpace    = THREE.SRGBColorSpace;
          gl.toneMapping         = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.75;
        }}
        style={{ width: '100%', height: '100%', display: 'block' }}
      >
        <ambientLight intensity={3.5} />
        <directionalLight position={[1, 3, 2]} intensity={4.0} />
        <pointLight position={[-2, 2, 2]} intensity={1.2} color="#8ecfff" />
        <Suspense fallback={null}>
          <VRMScene vrmUrl={vrmUrl} onLoad={handleLoad} onError={handleError} />
        </Suspense>
      </Canvas>
    </div>
  );
}