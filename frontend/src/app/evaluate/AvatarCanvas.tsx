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
  // Head-pose smooth refs (work without VRMA — no rigid-loop risk, but still
  // use tracked refs for consistency and future-proofing)
  const headYawSmoothRef     = useRef(0);
  const headPitchSmoothRef   = useRef(0);
  const headYawTargetRef     = useRef(0);
  const headPitchTargetRef   = useRef(0);
  const headUntilRef         = useRef(0);
  // Laugh shake until-timestamp
  const laughUntilRef        = useRef(0);
  // Active gesture { arm, until }
  const gestureRef           = useRef<{ arm: 'left' | 'right' | 'both'; until: number } | null>(null);

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
    // ── Newly wired events (previously silent on the slim evaluate canvas) ──
    const onBlink = () => {
      // Force an immediate blink by resetting the phase
      blinkPhaseRef.current = 0.001;
    };
    const onLaugh = (e: Event) => {
      const dur = (e as CustomEvent<{ duration?: number }>).detail?.duration ?? 1200;
      laughUntilRef.current = Date.now() + dur;
      isTalkingRef.current  = true; // jaw moves during laugh
    };
    const onHeadpose = (e: Event) => {
      const d = (e as CustomEvent<{ yaw?: number; pitch?: number; duration?: number }>).detail;
      headYawTargetRef.current   = d?.yaw   ?? 0;
      headPitchTargetRef.current = d?.pitch ?? 0;
      headUntilRef.current = Date.now() + (d?.duration ?? 2000);
    };
    const onGesture = (e: Event) => {
      const d   = (e as CustomEvent<{ side?: string; duration?: number; type?: string }>).detail;
      const arm = d?.side === 'left' ? 'left' : d?.side === 'both' ? 'both' : 'right';
      gestureRef.current = { arm, until: Date.now() + ((d?.duration ?? 2) * 1000) };
    };
    const onAudioEl = (e: Event) => {
      const audio = (e as CustomEvent<{ audio?: HTMLAudioElement }>).detail?.audio;
      if (!audio) return;
      isTalkingRef.current  = true;
      talkElapsedRef.current = 0;
      audio.play().catch(() => {});
      const end = () => {
        isTalkingRef.current = false;
        audio.removeEventListener('ended', end);
      };
      audio.addEventListener('ended', end);
    };
    window.addEventListener('avatar:speak:start',   onSpeakStart);
    window.addEventListener('avatar:speak:end',     onSpeakEnd);
    window.addEventListener('avatar:stopSpeaking',  onSpeakEnd);
    window.addEventListener('avatar:emotion',       onEmotion);
    window.addEventListener('avatar:blink',         onBlink);
    window.addEventListener('avatar:laugh',         onLaugh);
    window.addEventListener('avatar:headpose',      onHeadpose);
    window.addEventListener('avatar:gesture',       onGesture);
    window.addEventListener('avatar:audio:element', onAudioEl);
    return () => {
      window.removeEventListener('avatar:speak:start',   onSpeakStart);
      window.removeEventListener('avatar:speak:end',     onSpeakEnd);
      window.removeEventListener('avatar:stopSpeaking',  onSpeakEnd);
      window.removeEventListener('avatar:emotion',       onEmotion);
      window.removeEventListener('avatar:blink',         onBlink);
      window.removeEventListener('avatar:laugh',         onLaugh);
      window.removeEventListener('avatar:headpose',      onHeadpose);
      window.removeEventListener('avatar:gesture',       onGesture);
      window.removeEventListener('avatar:audio:element', onAudioEl);
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

    // ── Post-update bone overrides (run AFTER v.update so spring bones don't fight us) ──

    // Head-pose: smooth tracked refs → absolute assign (no VRMA here so no rigid-loop,
    // but consistent with main canvas pattern for future merge)
    if (v.humanoid) {
      const headBone    = v.humanoid.getRawBoneNode('head' as never);
      const headActive  = headUntilRef.current > now;
      const targetYaw   = headActive ? headYawTargetRef.current   : 0;
      const targetPitch = headActive ? headPitchTargetRef.current : 0;
      // Laugh: fast sinusoidal head shake around Y axis
      const laughActive = now < laughUntilRef.current;
      const laughShake  = laughActive ? Math.sin(now * 0.025) * 0.12 : 0;
      headYawSmoothRef.current   = THREE.MathUtils.lerp(headYawSmoothRef.current,   targetYaw + laughShake, delta * 8);
      headPitchSmoothRef.current = THREE.MathUtils.lerp(headPitchSmoothRef.current, targetPitch,            delta * 8);
      if (headBone) {
        headBone.rotation.y = headYawSmoothRef.current;
        headBone.rotation.x = headPitchSmoothRef.current;
      }
    }

    // Arm pose: gesture override takes priority, else idle sway
    if (v.humanoid) {
      const gesture     = gestureRef.current;
      const hasGesture  = gesture && now < gesture.until;
      const sway        = Math.sin(t * 0.4) * 0.06;
      const rua = v.humanoid.getRawBoneNode('rightUpperArm' as never);
      const lua = v.humanoid.getRawBoneNode('leftUpperArm'  as never);
      if (hasGesture) {
        const raiseR = gesture!.arm === 'right' || gesture!.arm === 'both';
        const raiseL = gesture!.arm === 'left'  || gesture!.arm === 'both';
        if (rua) rua.rotation.set(raiseR ? -0.85 : sway,   raiseR ?  0.20 : 0, -1.3, 'XYZ');
        if (lua) lua.rotation.set(raiseL ? -0.85 : -sway,  raiseL ? -0.20 : 0,  1.3, 'XYZ');
      } else {
        // Idle arm sway
        if (rua) rua.rotation.set(sway,  0, -1.3, 'XYZ');
        if (lua) lua.rotation.set(-sway, 0,  1.3, 'XYZ');
      }
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