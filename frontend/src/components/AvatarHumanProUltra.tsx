'use client';

import React, {
  forwardRef,
  useRef,
  useEffect,
  useImperativeHandle,
} from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  VRM,
  VRMUtils,
  VRMLoaderPlugin,
  VRMExpressionPresetName,
} from '@pixiv/three-vrm';

// ===========================================================
// Human‑Pro‑Ultra + Auto‑Behavior + Audio Analyzer
// ===========================================================

export type UltraEmotion =
  | 'happy'
  | 'curious'
  | 'encouraging'
  | 'thinking'
  | 'surprised'
  | 'sad'
  | 'relaxed'
  | 'neutral';

export type UltraGesture = 'wave' | 'openHands' | 'point' | 'think' | 'teaching';

export interface AvatarUltraHandle {
  playAudioAndAnalyze: (audioUrl: string) => Promise<void>;
  stopAudio: () => void;
  setEmotion: (e: UltraEmotion, intensity?: number, durationMs?: number) => void;
  triggerGesture: (g: UltraGesture, intensity?: number, durationMs?: number) => void;
  setLipSync: (data: Partial<Record<'aa' | 'ee' | 'oh' | 'ih' | 'ou', number>> & { amplitude?: number }) => void;
}

export interface AvatarUltraProps {
  url: string;
}

const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const damp = (cur: number, tgt: number, a: number) => cur + (tgt - cur) * clamp(a, 0, 1);

const AvatarHumanProUltra = forwardRef<AvatarUltraHandle, AvatarUltraProps>(function AvatarHumanProUltra(
  { url },
  ref
) {
  const groupRef = useRef<THREE.Group>(null);
  const vrmRef = useRef<VRM | null>(null);
  const { scene } = useThree();

  const lookRef = useRef(new THREE.Object3D());

  // Blink
  const blinkRef = useRef({ next: 2 + Math.random() * 3, t: 0, isBlink: false, weight: 0 });

  // Emotions
  const emoRef = useRef({
    name: 'neutral' as UltraEmotion,
    weight: 0,
    target: 0,
    started: 0,
    fadeInMs: 250,
    durationMs: 1600,
  });

  // Gestures
  const gestureRef = useRef({
    name: 'wave' as UltraGesture,
    active: false,
    t: 0,
    duration: 0.9,
    intensity: 0.9,
  });

  // LipSync manual fallback
  const lipRef = useRef<{ [k in 'aa' | 'ee' | 'oh' | 'ih' | 'ou']?: number } & { amplitude?: number }>({});

  // Audio Analyzer
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const fftRef = useRef<Uint8Array | null>(null);

  // ===========================================================
  // Expose control API
  // ===========================================================
  useImperativeHandle(ref, () => ({
    async playAudioAndAnalyze(audioUrl: string) {
      stopAudio();

      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      const ctx = audioCtxRef.current;

      const el = new Audio();
      el.src = audioUrl;
      el.crossOrigin = 'anonymous';
      el.preload = 'auto';
      audioElRef.current = el;

      const src = ctx.createMediaElementSource(el);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;

      src.connect(analyser);
      analyser.connect(ctx.destination);

      sourceRef.current = src;
      analyserRef.current = analyser;
      fftRef.current = new Uint8Array(analyser.frequencyBinCount);

      el.addEventListener('ended', stopAudio, { once: true });
      await el.play().catch(() => stopAudio());
    },

    stopAudio,

    setEmotion(e, intensity = 1, durationMs = 1800) {
      emoRef.current = {
        name: e,
        weight: 0,
        target: clamp(intensity),
        started: performance.now(),
        fadeInMs: 250,
        durationMs,
      };
    },

    triggerGesture(g, intensity = 1, durationMs = 900) {
      gestureRef.current = {
        name: g,
        active: true,
        t: 0,
        duration: durationMs / 1000,
        intensity: clamp(intensity),
      };
    },

    setLipSync(data) {
      lipRef.current = { ...lipRef.current, ...data };
    },
  }));

  function stopAudio() {
    try {
      audioElRef.current?.pause();
      if (sourceRef.current) sourceRef.current.disconnect();
      if (analyserRef.current) analyserRef.current.disconnect();
    } catch {}
    audioElRef.current = null;
    sourceRef.current = null;
    analyserRef.current = null;
    fftRef.current = null;
  }

  // ===========================================================
  // Load VRM
  // ===========================================================
  useEffect(() => {
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));

    loader.load(
      url,
      (gltf) => {
        VRMUtils.removeUnnecessaryVertices(gltf.scene);
        VRMUtils.removeUnnecessaryJoints(gltf.scene);

        const vrm = gltf.userData.vrm as VRM;
        vrmRef.current = vrm;

        scene.add(lookRef.current);
        if (vrm.lookAt) vrm.lookAt.target = lookRef.current;

        if (groupRef.current) groupRef.current.add(vrm.scene);
      },
      undefined,
      (e) => console.error('[VRM Load Error]', e)
    );

    return () => {
      stopAudio();
      if (vrmRef.current) {
        scene.remove(lookRef.current);
        (vrmRef.current as unknown as { dispose?: () => void }).dispose?.();
        vrmRef.current = null;
      }
    };
  }, [url, scene]);

  // ===========================================================
  // FRAME LOOP — Human Behavior
  // ===========================================================
  useFrame((state, delta) => {
    const vrm = vrmRef.current;
    if (!vrm) return;

    const t = state.clock.elapsedTime;
    const em = vrm.expressionManager;
    const humanoid = vrm.humanoid;

    // ---------------------------------------------------------
    // 1) Natural Breathing + Micro Sway
    // ---------------------------------------------------------
    if (humanoid) {
      const chest = humanoid.getNormalizedBoneNode('chest');
      const spine = humanoid.getNormalizedBoneNode('spine');
      const head = humanoid.getNormalizedBoneNode('head');

      if (chest) chest.rotation.x = Math.sin(t * 1.5) * 0.02;
      if (spine) spine.rotation.y = Math.sin(t * 0.8) * 0.015;
      if (head) head.rotation.z = Math.sin(t * 1.3) * 0.01;
    }

    // ---------------------------------------------------------
    // 2) Blinking
    // ---------------------------------------------------------
    if (em) {
      const b = blinkRef.current;
      b.next -= delta;
      if (b.next <= 0 && !b.isBlink) {
        b.isBlink = true;
        b.t = 0;
      }
      if (b.isBlink) {
        b.t += delta;
        if (b.t < 0.1) b.weight = b.t / 0.1;
        else if (b.t < 0.2) b.weight = 1 - (b.t - 0.1) / 0.1;
        else {
          b.isBlink = false;
          b.next = 2 + Math.random() * 4;
          b.weight = 0;
        }
      }
      em.setValue('blink', clamp(b.weight));
    }

    // ---------------------------------------------------------
    // 3) LookAt + Micro Jitter
    // ---------------------------------------------------------
    const jx = Math.sin(t * 2.1) * 0.02;
    const jy = Math.sin(t * 1.7) * 0.015;

    lookRef.current.position.set(
      state.pointer.x * 2 + jx,
      state.pointer.y * 2 + 1.35 + jy,
      2
    );

    if (humanoid) {
      const neck = humanoid.getNormalizedBoneNode('neck');
      const head = humanoid.getNormalizedBoneNode('head');
      const tx = -state.pointer.y * 0.3;
      const ty = state.pointer.x * 0.4;
      if (neck) {
        neck.rotation.x = damp(neck.rotation.x, tx, 0.1);
        neck.rotation.y = damp(neck.rotation.y, ty, 0.12);
      }
      if (head) {
        head.rotation.x = damp(head.rotation.x, tx, 0.1);
        head.rotation.y = damp(head.rotation.y, ty, 0.12);
      }
    }

    // ===============================================================
    // 4) Audio Analyzer → LipSync
    // ===============================================================
    if (analyserRef.current && fftRef.current && em) {
      analyserRef.current.getByteFrequencyData(fftRef.current as Uint8Array<ArrayBuffer>);
      const arr = fftRef.current;
      const n = arr.length;
      let low = 0, mid = 0, high = 0;

      for (let i = 0; i < n; i++) {
        if (i < n * 0.33) low += arr[i];
        else if (i < n * 0.66) mid += arr[i];
        else high += arr[i];
      }

      const L = clamp(low / (255 * n * 0.33));
      const M = clamp(mid / (255 * n * 0.33));
      const H = clamp(high / (255 * n * 0.33));

      em.setValue('aa', L);
      em.setValue('ee', M);
      em.setValue('oh', H);
    }

    // ===============================================================
    // 5) Emotion blending
    // ===============================================================
    if (em) {
      const e = emoRef.current;
      const elapsed = performance.now() - e.started;
      const fadeIn = clamp(elapsed / e.fadeInMs);
      const fadeOut = elapsed > e.durationMs ? clamp(1 - (elapsed - e.durationMs) / 800) : 1;
      const W = (e.weight = damp(e.weight, e.target * fadeIn * fadeOut, 0.25));

      const map = (name: VRMExpressionPresetName, v: number) =>
        em.setValue(name, clamp(v));

      switch (e.name) {
        case 'happy':
          map('happy', W);
          break;
        case 'curious':
          map('relaxed', W * 0.8);
          map('surprised', W * 0.25);
          break;
        case 'thinking':
          map('relaxed', W * 0.5);
          map('sad', W * 0.25);
          break;
        case 'encouraging':
          map('happy', W * 0.75);
          map('relaxed', W * 0.25);
          break;
        case 'sad':
          map('sad', W);
          break;
        case 'surprised':
          map('surprised', W);
          break;
        case 'relaxed':
          map('relaxed', W);
          break;
        default:
          map('relaxed', damp(em.getValue('relaxed') ?? 0, 0.08, 0.05));
      }
    }

    // ===============================================================
    // 6) Gestures
    // ===============================================================
    if (humanoid) {
      const g = gestureRef.current;

      const RU = humanoid.getNormalizedBoneNode('rightUpperArm');
      const RL = humanoid.getNormalizedBoneNode('rightLowerArm');
      const LU = humanoid.getNormalizedBoneNode('leftUpperArm');
      const LL = humanoid.getNormalizedBoneNode('leftLowerArm');

      const reset = (b: THREE.Object3D | null | undefined) => {
        if (!b) return;
        b.rotation.x = damp(b.rotation.x, 0, 0.08);
        b.rotation.y = damp(b.rotation.y, 0, 0.08);
        b.rotation.z = damp(b.rotation.z, 0, 0.08);
      };
      [RU, RL, LU, LL].forEach(reset);

      if (g.active) {
        g.t += delta;
        const k = clamp(g.t / g.duration);
        const ease = k < 0.5 ? 2 * k * k : -1 + (4 - 2 * k) * k;
        const w = ease * g.intensity;

        switch (g.name) {
          case 'wave':
            if (RU) RU.rotation.z += 0.9 * w;
            if (RL) RL.rotation.z += 0.6 * w;
            break;
          case 'openHands':
            if (LU) LU.rotation.x -= 0.4 * w;
            if (RU) RU.rotation.x -= 0.4 * w;
            break;
          case 'point':
            if (RU) RU.rotation.x -= 0.6 * w;
            break;
          case 'think':
            if (LU) LU.rotation.y += 0.2 * w;
            break;
          case 'teaching':
            if (RU) RU.rotation.x -= 0.35 * w;
            if (RL) RL.rotation.x -= 0.25 * w;
            break;
        }

        if (g.t >= g.duration) g.active = false;
      }
    }

    // ===============================================================
    // 7) AUTO‑BEHAVIOR ENGINE
    // ===============================================================

    // Auto micro‑emotion every 7–12 seconds
    if (!gestureRef.current.active && emoRef.current.name === 'neutral') {
      if (Math.random() < 0.0013) {
        const list: UltraEmotion[] = ['relaxed', 'curious', 'thinking', 'surprised'];
        const pick = list[Math.floor(Math.random() * list.length)];
        emoRef.current = {
          name: pick,
          weight: 0,
          target: 0.4 + Math.random() * 0.4,
          started: performance.now(),
          fadeInMs: 250,
          durationMs: 1600 + Math.random() * 1200,
        };
      }
    }

    // Auto gesture occasionally (idle)
    if (!gestureRef.current.active) {
      if (Math.random() < 0.0009) {
        const gList: UltraGesture[] = ['think', 'openHands', 'wave'];
        const g = gList[Math.floor(Math.random() * gList.length)];
        gestureRef.current = {
          name: g,
          active: true,
          t: 0,
          duration: 0.6 + Math.random() * 0.6,
          intensity: 0.5 + Math.random() * 0.4,
        };
      }
    }

    // Auto gaze drift    
    lookRef.current.position.x += Math.sin(t * 0.5) * 0.003;
    lookRef.current.position.y += Math.cos(t * 0.4) * 0.004;

    // update VRM
    vrm.update(delta);
  });

  return <group ref={groupRef} />;
});

export default AvatarHumanProUltra;