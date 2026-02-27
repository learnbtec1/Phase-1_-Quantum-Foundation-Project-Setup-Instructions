'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Float } from '@react-three/drei';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRM, VRMLoaderPlugin } from '@pixiv/three-vrm';
import { Howl } from 'howler';
import { synthesizeSpeech } from '@/lib/voice/engine';

const VRM_URL = '/models/Furina.vrm';
// Hum audio — low-volume ambient loop attached to avatar.
// Place an MP3 at this path to enable; silently skipped if missing.
const HUM_URL = '/audio/voices/furina/hum.mp3';

// ─── Blend-shape preset names (VRM 1.0 / VRMC_vrm) ───────────────────────────
const BS_AA = 'aa';
const BS_IH = 'ih';
const BS_OU = 'ou';

// ─── VRMModel ─────────────────────────────────────────────────────────────────

function VRMModel({
  vrmUrl,
  onLoad,
  onError,
}: {
  vrmUrl: string;
  onLoad?: () => void;
  onError?: (err: string) => void;
}) {
  const [vrm, setVrm] = useState<VRM | null>(null);
  // Keep a ref so useFrame / event callbacks always see the latest VRM
  const vrmRef = useRef<VRM | null>(null);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const groupRef = useRef<THREE.Group>(null);
  const receivedAtRef = useRef<number>(0);
  const { pointer } = useThree();

  // ── Lip-sync state ──────────────────────────────────────────────────────────
  const isTalkingRef = useRef(false);
  const talkStartRef = useRef(0); // clock.elapsedTime when speech started
  // Accumulated blob URLs that need to be revoked to prevent memory leaks
  const blobUrlRef = useRef<string | null>(null);
  // Active TTS howl — keep ref so we can stop on new message
  const ttsHowlRef = useRef<Howl | null>(null);

  // ── Hum Howl ────────────────────────────────────────────────────────────────
  const humRef = useRef<Howl | null>(null);
  const humResetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    let hum: Howl | null = null;
    const onResume = () => {
      if (hum) {
        hum.volume(0.02);
        if (!hum.playing()) hum.play();
        return;
      }
      try {
        hum = new Howl({
          src: [HUM_URL],
          volume: 0.02,
          loop: true,
          html5: true,
          onloaderror: () => { hum = null; humRef.current = null; },
        });
        humRef.current = hum;
        hum.play();
      } catch {
        // file absent — silently skip
      }
    };
    window.addEventListener('audio:resume', onResume);
    return () => {
      window.removeEventListener('audio:resume', onResume);
      hum?.stop();
      hum?.unload();
      humRef.current = null;
    };
  }, []);

  // Bump hum on chat:received
  useEffect(() => {
    const onReceived = () => {
      receivedAtRef.current = Date.now();
      const h = humRef.current;
      if (!h) return;
      if (humResetTimeoutRef.current) {
        clearTimeout(humResetTimeoutRef.current);
      }
      h.volume(0.06);
      humResetTimeoutRef.current = setTimeout(() => {
        h.volume(0.02);
        humResetTimeoutRef.current = null;
      }, 600);
    };
    window.addEventListener('chat:received', onReceived);
    return () => {
      window.removeEventListener('chat:received', onReceived);
      if (humResetTimeoutRef.current) {
        clearTimeout(humResetTimeoutRef.current);
        humResetTimeoutRef.current = null;
      }
    };
  }, []);

  // ── VRM loader ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const loader = new GLTFLoader();
    loader.register((parser: unknown) => new VRMLoaderPlugin(parser as never));

    const origWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      if (String(args[0] ?? '').includes('LookAtDegreeMap')) return;
      origWarn.apply(console, args);
    };

    loader.load(
      vrmUrl,
      (gltf) => {
        setTimeout(() => { console.warn = origWarn; }, 0);
        try {
          const vrmModel = gltf.userData.vrm as VRM;
          if (!vrmModel?.scene) { onError?.('Invalid VRM data'); return; }
          vrmModel.scene.traverse((o) => {
            if ((o as THREE.Mesh).isMesh) {
              const m = (o as THREE.Mesh).material;
              const mats = Array.isArray(m) ? m : [m];
              mats.forEach((mat) => {
                if (mat && (mat as THREE.MeshStandardMaterial).envMapIntensity !== undefined)
                  (mat as THREE.MeshStandardMaterial).envMapIntensity = 1;
              });
            }
          });
          vrmRef.current = vrmModel;
          setVrm(vrmModel);
          onLoad?.();
          const clips = (vrmModel as unknown as { animations?: THREE.AnimationClip[] }).animations;
          if (clips?.length) {
            const mixer = new THREE.AnimationMixer(vrmModel.scene);
            mixerRef.current = mixer;
            mixer.clipAction(clips[0]).play();
          }
        } catch (e) {
          console.warn = origWarn;
          onError?.((e as Error)?.message ?? 'VRM load error');
        }
      },
      undefined,
      (error) => {
        console.warn = origWarn;
        onError?.((error as Error)?.message || 'VRM load failed');
      }
    );
    return () => { console.warn = origWarn; };
  }, [vrmUrl, onLoad, onError]);

  // ── avatar:speak listener ───────────────────────────────────────────────────
  useEffect(() => {
    const onSpeak = async (e: Event) => {
      const text = (e as CustomEvent<string>).detail;
      if (!text) return;

      // Stop any currently playing TTS (prevent double-playback)
      if (ttsHowlRef.current) {
        ttsHowlRef.current.stop();
        ttsHowlRef.current = null;
      }
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
      isTalkingRef.current = false;

      // Synthesize speech server-side (token guard: only one TTS at a time)
      const blobUrl = await synthesizeSpeech(text);
      if (!blobUrl) return;
      
      // Double-check: if another TTS started while we were synthesizing, abort
      if (ttsHowlRef.current) {
        URL.revokeObjectURL(blobUrl);
        return;
      }
      
      blobUrlRef.current = blobUrl;

      const howl = new Howl({
        src: [blobUrl],
        format: ['mp3'],
        html5: true,
        volume: 0.9,
        onplay: () => {
          isTalkingRef.current = true;
          talkStartRef.current = 0; // reset — will be set in useFrame
        },
        onend: () => {
          isTalkingRef.current = false;
          // Reset lips after audio finishes
          const v = vrmRef.current;
          if (v?.expressionManager) {
            v.expressionManager.setValue(BS_AA, 0);
            v.expressionManager.setValue(BS_IH, 0);
            v.expressionManager.setValue(BS_OU, 0);
          }
          URL.revokeObjectURL(blobUrl);
          blobUrlRef.current = null;
          ttsHowlRef.current = null;
        },
        onstop: () => {
          isTalkingRef.current = false;
          if (blobUrlRef.current) {
            URL.revokeObjectURL(blobUrlRef.current);
            blobUrlRef.current = null;
          }
          ttsHowlRef.current = null;
        },
      });
      ttsHowlRef.current = howl;
      howl.play();
    };

    window.addEventListener('avatar:speak', onSpeak);
    return () => {
      window.removeEventListener('avatar:speak', onSpeak);
      ttsHowlRef.current?.stop();
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    };
  }, []);

  // ── Animation frame ─────────────────────────────────────────────────────────
  useFrame((state, delta) => {
    if (mixerRef.current) mixerRef.current.update(delta);
    const currentVrm = vrmRef.current;
    if (currentVrm) {
      currentVrm.update(delta);

      // ── Lip-sync ────────────────────────────────────────────────────────────
      const em = currentVrm.expressionManager;
      if (em) {
        if (isTalkingRef.current) {
          // Stamp the first frame of talking
          if (talkStartRef.current === 0) talkStartRef.current = state.clock.elapsedTime;
          const t = state.clock.elapsedTime - talkStartRef.current;
          // Procedural sine-based viseme approximation
          const v = Math.max(0, (0.5 + 0.5 * Math.sin(t * 9.1)) * (0.6 + 0.4 * Math.sin(t * 14.7 + 1.3)));
          em.setValue(BS_AA, v);
          em.setValue(BS_IH, v * 0.6);
          em.setValue(BS_OU, v * 0.4);
        } else {
          // Smoothly lerp lips back to neutral
          const aa = em.getValue(BS_AA) ?? 0;
          if (aa > 0.001) {
            em.setValue(BS_AA, aa * 0.8);
            em.setValue(BS_IH, (em.getValue(BS_IH) ?? 0) * 0.8);
            em.setValue(BS_OU, (em.getValue(BS_OU) ?? 0) * 0.8);
          }
        }
      }
    }

    const g = groupRef.current;
    if (g) {
      const t = state.clock.elapsedTime;
      const receivedDelta = (Date.now() - receivedAtRef.current) / 1000;
      const nod = receivedDelta < 0.6 ? (0.6 - receivedDelta) * 0.12 : 0;
      const targetYaw = pointer.x * 0.15 + nod;
      const targetPitch = -pointer.y * 0.1 - nod * 0.5;
      g.rotation.y += (targetYaw - g.rotation.y) * 0.08;
      g.rotation.x += (targetPitch - g.rotation.x) * 0.08;
      g.position.y = Math.sin(t * 0.5) * 0.008;
    }
  });

  return vrm ? (
    <group ref={groupRef} position={[0, -1.02, 0.2]}>
      <primitive object={vrm.scene} />
    </group>
  ) : null;
}

// ─── SimpleAvatarPlaceholder (used when useSimpleFallback=true) ───────────────

function SimpleAvatarPlaceholder() {
  const groupRef = useRef<THREE.Group>(null);
  const receivedAtRef = useRef<number>(0);
  const { pointer } = useThree();

  useEffect(() => {
    const onReceived = () => { receivedAtRef.current = Date.now(); };
    window.addEventListener('chat:received', onReceived);
    return () => window.removeEventListener('chat:received', onReceived);
  }, []);

  useFrame((state) => {
    const g = groupRef.current;
    if (!g) return;
    const t = state.clock.elapsedTime;
    const receivedDelta = (Date.now() - receivedAtRef.current) / 1000;
    const nod = receivedDelta < 0.6 ? (0.6 - receivedDelta) * 0.12 : 0;
    g.rotation.y += (pointer.x * 0.15 + nod - g.rotation.y) * 0.08;
    g.rotation.x += (-pointer.y * 0.1 - nod * 0.5 - g.rotation.x) * 0.08;
    g.position.y = Math.sin(t * 0.5) * 0.008;
  });

  return (
    <group ref={groupRef} position={[0, -1.02, 0.2]}>
      <mesh>
        <sphereGeometry args={[0.35, 32, 32]} />
        <meshStandardMaterial color="#4a90e2" />
      </mesh>
    </group>
  );
}

// ─── Public export ────────────────────────────────────────────────────────────

export interface BoardroomAvatarProps {
  vrmUrl?: string;
  scale?: number;
  onLoad?: () => void;
  onError?: (err: string) => void;
  useSimpleFallback?: boolean;
}

export default function VRMAvatar({
  vrmUrl = VRM_URL,
  scale = 1,
  onLoad,
  onError,
  useSimpleFallback = false,
}: BoardroomAvatarProps) {
  const [loadError, setLoadError] = useState<string | null>(null);

  const handleError = (err: string) => {
    setLoadError(err);
    onError?.(err);
  };

  if (useSimpleFallback || loadError) {
    return (
      <Float speed={1.2} rotationIntensity={0.1} floatIntensity={0.04} floatingRange={[-0.02, 0.02]}>
        <group scale={scale}>
          <SimpleAvatarPlaceholder />
        </group>
      </Float>
    );
  }

  return (
    <Float speed={1.2} rotationIntensity={0.1} floatIntensity={0.04} floatingRange={[-0.02, 0.02]}>
      <group scale={scale}>
        <VRMModel vrmUrl={vrmUrl} onLoad={onLoad} onError={handleError} />
      </group>
    </Float>
  );
}
