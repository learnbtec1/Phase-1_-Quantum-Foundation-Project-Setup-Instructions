'use client';

/**
 * @deprecated VRMAvatar.tsx is the LEGACY avatar component and must NOT be used.
 *
 * The canonical VRM renderer is AvatarCanvas.tsx (avatar-agent/AvatarCanvas.tsx).
 * AvatarCanvas is a self-contained R3F canvas that loads /models/teach.vrm directly
 * and reacts to window avatar:* events dispatched by useAvatarAgent.ts.
 *
 * VRMAvatar.tsx is retained only as a historical reference; it will be removed in
 * Sprint 2. Any new feature work MUST target AvatarCanvas.tsx exclusively.
 *
 * DO NOT import, mount, or extend this file.
 */

import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Float } from '@react-three/drei';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRM, VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { Howl } from 'howler';
import { speakWithTTS, stopTTS, type WordTiming } from '@/ai/io/tts';
import { inferResponsePlan, parseVeronaResponse } from '@/ai/avatar/brain';
import { dispatchGestureFromActionText } from '@/ai/avatar/actions';
import { EMOTION_BLENDSHAPES } from '@/ai/avatar/state';
import { proceduralViseme, decayViseme, type VisemeWeights } from '@/ai/lipsync/viseme';
import { timingsToVisemeAt, lerpViseme } from '@/ai/lipsync/timing';
import { EmotionManager } from '@/ai/avatar/managers/EmotionManager';
import { PhonemeManager } from '@/ai/avatar/managers/PhonemeManager';

const VRM_URL = '/models/teach.vrm';
const HUM_URL = '/audio/voices/teacher/hum.mp3';
const HUM_URL_ALT = '/audio/ambience/boardroom.mp3';

const BS_AA = 'aa';
const BS_IH = 'ih';
const BS_OU = 'ou';

const HEAD_YAW_LIMIT = 0.5;
const HEAD_PITCH_LIMIT = 0.35;
const HEAD_SENSITIVITY_YAW = 0.65;
const HEAD_SENSITIVITY_PITCH = 0.5;
const NOD_DURATION = 1.2;
const NOD_INTENSITY = 0.15;
const USER_SENT_ACK_DURATION = 0.6;
const USER_SENT_ACK_INTENSITY = 0.08;
const BLINK_INTERVAL_MIN = 2.2;
const BLINK_INTERVAL_MAX = 4.5;
const AVATAR_BASE_Y = -0.5;
const IDLE_SWAY_AMOUNT = 0.04;
const BREATHE_AMPLITUDE = 0;
const WAVE_DURATION = 4;
const HEAD_LERP = 0.28;

/** DEBUG: set true to verify useFrame runs (avatar rotates slowly); set false for production */
const DEBUG_ROTATION = false;

function useChatReceivedTimestamp() {
  const receivedAtRef = useRef<number>(0);
  useEffect(() => {
    const onReceived = () => { receivedAtRef.current = Date.now(); };
    window.addEventListener('chat:received', onReceived);
    return () => window.removeEventListener('chat:received', onReceived);
  }, []);
  return receivedAtRef;
}

function useChatSentTimestamp() {
  const sentAtRef = useRef<number>(0);
  useEffect(() => {
    const onSent = () => { sentAtRef.current = Date.now(); };
    window.addEventListener('chat:sent', onSent);
    return () => window.removeEventListener('chat:sent', onSent);
  }, []);
  return sentAtRef;
}

function useListeningState() {
  const listeningRef = useRef(false);
  useEffect(() => {
    const _evtSeen_ls = new Set<string>();
    const onListening = (e: Event) => {
      if (process.env.NODE_ENV === 'development' && !_evtSeen_ls.has('avatar:listening')) {
        _evtSeen_ls.add('avatar:listening');
        console.log('[EVT][RIG]', 'avatar:listening', { keys: Object.keys((e as CustomEvent).detail ?? {}), sample: (e as CustomEvent).detail });
      }
      listeningRef.current = (e as CustomEvent<{ active?: boolean }>).detail?.active ?? false;
    };
    window.addEventListener('avatar:listening', onListening);
    return () => window.removeEventListener('avatar:listening', onListening);
  }, []);
  return listeningRef;
}

function useHeadTracking(
  groupRef: React.RefObject<THREE.Group | null>,
  _listeningRef?: React.RefObject<boolean>,
  opts?: { waveUntilRef?: React.RefObject<number>; postureLeanRef?: React.RefObject<number>; isTalkingRef?: React.RefObject<boolean> }
) {
  const yOscLoggedRef = useRef(false);
  useFrame(() => {
    if (!yOscLoggedRef.current) {
      console.log('[HUMANIZE][IDLE] Whole-body Y oscillation: disabled');
      yOscLoggedRef.current = true;
    }
    const g = groupRef.current;
    if (!g) return;
    g.position.set(0, AVATAR_BASE_Y, 0.2);
    g.updateMatrix();
  });
}

const VRM_BONE_LABELS_AR: Record<string, string> = {
  hips: 'الوركان (Hips)',
  spine: 'العمود الفقري (Spine)',
  chest: 'الصدر (Chest)',
  upperChest: 'أعلى الصدر (UpperChest)',
  neck: 'الرقبة (Neck)',
  head: 'الرأس (Head)',
  leftShoulder: 'الكتف الأيسر',
  rightShoulder: 'الكتف الأيمن',
  leftUpperArm: 'الذراع الأيسر العلوي (العضد)',
  leftLowerArm: 'الساعد الأيسر',
  leftHand: 'اليد اليسرى',
  rightUpperArm: 'الذراع الأيمن العلوي (العضد)',
  rightLowerArm: 'الساعد الأيمن',
  rightHand: 'اليد اليمنى',
  leftUpperLeg: 'الفخذ الأيسر',
  leftLowerLeg: 'الساق الأيسر',
  leftFoot: 'القدم اليسرى',
  leftToes: 'أصابع القدم اليسرى',
  rightUpperLeg: 'الفخذ الأيمن',
  rightLowerLeg: 'الساق الأيمن',
  rightFoot: 'القدم اليمنى',
  rightToes: 'أصابع القدم اليمنى',
  leftThumbProximal: 'إبهام يسار — قاعدة',
  leftThumbIntermediate: 'إبهام يسار — وسط',
  leftThumbDistal: 'إبهام يسار — طرف',
  leftIndexProximal: 'سبابة يسار — قاعدة',
  leftIndexIntermediate: 'سبابة يسار — وسط',
  leftIndexDistal: 'سبابة يسار — طرف',
  leftMiddleProximal: 'وسطى يسار — قاعدة',
  leftMiddleIntermediate: 'وسطى يسار — وسط',
  leftMiddleDistal: 'وسطى يسار — طرف',
  leftRingProximal: 'بنصر يسار — قاعدة',
  leftRingIntermediate: 'بنصر يسار — وسط',
  leftRingDistal: 'بنصر يسار — طرف',
  leftLittleProximal: 'خنصر يسار — قاعدة',
  leftLittleIntermediate: 'خنصر يسار — وسط',
  leftLittleDistal: 'خنصر يسار — طرف',
  rightThumbProximal: 'إبهام يمين — قاعدة',
  rightThumbIntermediate: 'إبهام يمين — وسط',
  rightThumbDistal: 'إبهام يمين — طرف',
  rightIndexProximal: 'سبابة يمين — قاعدة',
  rightIndexIntermediate: 'سبابة يمين — وسط',
  rightIndexDistal: 'سبابة يمين — طرف',
  rightMiddleProximal: 'وسطى يمين — قاعدة',
  rightMiddleIntermediate: 'وسطى يمين — وسط',
  rightMiddleDistal: 'وسطى يمين — طرف',
  rightRingProximal: 'بنصر يمين — قاعدة',
  rightRingIntermediate: 'بنصر يمين — وسط',
  rightRingDistal: 'بنصر يمين — طرف',
  rightLittleProximal: 'خنصر يمين — قاعدة',
  rightLittleIntermediate: 'خنصر يمين — وسط',
  rightLittleDistal: 'خنصر يمين — طرف',
};

function useProceduralBlink(vrmRef: React.RefObject<VRM | null>) {
  const nextBlinkRef = useRef(Date.now() + (BLINK_INTERVAL_MIN + Math.random() * (BLINK_INTERVAL_MAX - BLINK_INTERVAL_MIN)) * 1000);
  const blinkPhaseRef = useRef(0);
  const blinkSupportedRef = useRef<boolean | null>(null);

  useFrame((_, delta) => {
    try {
      const v = vrmRef.current;
      const em = v?.expressionManager;
      if (!em) return;

      const now = Date.now();

      if (blinkPhaseRef.current > 0) {
        blinkPhaseRef.current += delta * 14;
        const phase = blinkPhaseRef.current;
        const blinkVal = phase < Math.PI ? Math.sin(phase) : 0;
        if (blinkSupportedRef.current !== false) {
          try {
            em.setValue('blink' as never, Math.min(1, blinkVal));
            blinkSupportedRef.current = true;
          } catch {
            try {
              em.setValue('blinkLeft' as never, Math.min(1, blinkVal));
              em.setValue('blinkRight' as never, Math.min(1, blinkVal));
              blinkSupportedRef.current = true;
            } catch {
              blinkSupportedRef.current = false;
            }
          }
        }
        if (phase > Math.PI * 2) {
          blinkPhaseRef.current = 0;
          if (blinkSupportedRef.current) {
            try {
              em.setValue('blink' as never, 0);
            } catch {
              try {
                em.setValue('blinkLeft' as never, 0);
                em.setValue('blinkRight' as never, 0);
              } catch {
                /* ignore */
              }
            }
          }
          nextBlinkRef.current = now + (BLINK_INTERVAL_MIN + Math.random() * (BLINK_INTERVAL_MAX - BLINK_INTERVAL_MIN)) * 1000;
        }
      } else if (now >= nextBlinkRef.current) {
        blinkPhaseRef.current = 0.001;
      }
    } catch {
      /* never crash the avatar */
    }
  });
}

export interface VRMAvatarRef {
  speak: (text: string) => void;
  setEmotion: (emotion: string) => void;
}

function fallbackSpeakWebSpeech(
  text: string,
  onStart?: () => void,
  onEnd?: () => void
): boolean {
  if (typeof window === 'undefined' || !window.speechSynthesis) return false;
  try {
    window.speechSynthesis.cancel();

    const lang     = /[\u0600-\u06FF]/.test(text) ? 'ar-SA' : 'en-US';
    const langBase = lang.split('-')[0];

    let launched = false;
    const doSpeak = () => {
      if (launched) return;
      launched = true;
      const voices   = window.speechSynthesis.getVoices();
      const preferred =
        voices.find(v => v.lang === lang) ??
        voices.find(v => v.lang.startsWith(langBase)) ??
        null;

      if (!preferred) {
        console.warn('[TTS:VRMfallback] No voice for', lang, '— audio skipped');
        onEnd?.();
        window.dispatchEvent(new CustomEvent('avatar:speak:end'));
        return;
      }

      console.log('[TTS:VRMfallback] ✅ voice selected:', preferred.name, preferred.lang);

      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang;
      u.rate = 0.9;
      u.voice = preferred;
      u.onstart = () => {
        onStart?.();
        window.dispatchEvent(new CustomEvent('avatar:speak:start'));
      };
      u.onend = () => {
        onEnd?.();
        window.dispatchEvent(new CustomEvent('avatar:speak:end'));
      };
      u.onerror = () => {
        onEnd?.();
        window.dispatchEvent(new CustomEvent('avatar:speak:end'));
      };
      window.speechSynthesis.speak(u);
    };

    if (window.speechSynthesis.getVoices().length > 0) {
      doSpeak();
    } else {
      window.speechSynthesis.onvoiceschanged = () => { doSpeak(); };
      setTimeout(() => {
        if (window.speechSynthesis.getVoices().length > 0) doSpeak();
      }, 800);
    }
    return true;
  } catch {
    return false;
  }
}

const EMOTION_HEAD_REACTIONS: Readonly<Record<string, { dx?: number; dy?: number; durationMs: number }>> = {
  proud:       { dy: -0.22, durationMs: 1400 },
  curious:     { dx: -0.18, durationMs: 1600 },
  concerned:   { dy:  0.18, durationMs: 1300 },
  attentive:   { dy: -0.12, durationMs: 1100 },
  surprised:   { dy: -0.24, durationMs:  700 },
  excited:     { dy: -0.14, durationMs:  900 },
  celebration: { dy: -0.20, durationMs: 1000 },
  celebrate:   { dy: -0.20, durationMs: 1000 },
  happy:       { dy: -0.10, durationMs: 1000 },
  thinking:    { dx:  0.16, durationMs: 2000 },
  sad:         { dy:  0.22, durationMs: 2200 },
  angry:       { dy:  0.08, durationMs: 1200 },
  sleepy:      { dy:  0.15, durationMs: 2500 },
  goodbye:     { dx: -0.10, durationMs: 1000 },
};

function VRMModel({
  vrmUrl,
  onLoad,
  onError,
  onSpeakReady,
  walkStateRef,
}: {
  vrmUrl: string;
  onLoad?: () => void;
  onError?: (err: string) => void;
  onSpeakReady?: (speak: (text: string) => void) => void;
  walkStateRef?: React.RefObject<{ isWalking: boolean; walkPhase: number } | null>;
}) {
  const [vrm, setVrm] = useState<VRM | null>(null);
  const vrmRef = useRef<VRM | null>(null);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const groupRef = useRef<THREE.Group>(null);

  const isTalkingRef = useRef(false);
  const talkStartRef = useRef(0);
  const visemeRef = useRef<VisemeWeights>({ aa: 0, ih: 0, ou: 0 });
  const timingsRef = useRef<WordTiming[] | null>(null);
  const audioStartTimeRef = useRef<number>(0);
  const lipSyncFlagSetRef = useRef(false);
  const emotionRef = useRef<string>('neutral');
  const postureLeanRef = useRef(0);

  const emotionManagerRef = useRef<EmotionManager | null>(null);
  const phonemeManagerRef = useRef<PhonemeManager | null>(null);
  const frameCounterRef = useRef(0);

  const internalWalkRef = useRef<{ isWalking: boolean; walkPhase: number }>({ isWalking: false, walkPhase: 0 });
  const activeWalkRef = walkStateRef ?? internalWalkRef;

  useEffect(() => {
    const onWalk = (e: Event) => {
      const isWalking = (e as CustomEvent<{ isWalking?: boolean }>).detail?.isWalking ?? true;
      console.log('%c[V30] 📨 avatar:walk received', 'color:cyan', '| isWalking:', isWalking, '| activeWalkRef:', activeWalkRef.current);
      const cur = activeWalkRef.current ?? { isWalking: false, walkPhase: 0 };
      activeWalkRef.current = { ...cur, isWalking };
    };
    const onStop = () => {
      const cur = activeWalkRef.current;
      if (cur) cur.isWalking = false;
    };
    window.addEventListener('avatar:walk', onWalk);
    window.addEventListener('avatar:stop', onStop);
    return () => {
      window.removeEventListener('avatar:walk', onWalk);
      window.removeEventListener('avatar:stop', onStop);
    };
  }, [activeWalkRef]);

  const listeningRef = useListeningState();
  useHeadTracking(groupRef, listeningRef, {
    postureLeanRef,
    isTalkingRef,
  });
  useProceduralBlink(vrmRef);

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const handler = () => {
      emotionRef.current = 'thinking';
      postureLeanRef.current = 0.03;
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        if (!isTalkingRef.current) {
          emotionRef.current = 'neutral';
          postureLeanRef.current = 0;
        }
        timeoutId = null;
      }, 3000);
    };
    window.addEventListener('chat:sent', handler);
    return () => {
      window.removeEventListener('chat:sent', handler);
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, []);

  useEffect(() => {
    const _evtSeen_em = new Set<string>();
    const onEmotion = (e: Event) => {
      const em = (e as CustomEvent<{ emotion?: string }>).detail?.emotion;
      if (process.env.NODE_ENV === 'development' && !_evtSeen_em.has('avatar:emotion')) {
        _evtSeen_em.add('avatar:emotion');
        console.log('[EVT][RIG]', 'avatar:emotion', { keys: Object.keys((e as CustomEvent).detail ?? {}), sample: (e as CustomEvent).detail });
      }
      console.log('%c[V30] 📨 avatar:emotion received', 'color:cyan', '| emotion:', em, '| EmotionManager:', emotionManagerRef.current ? '✅ ready' : '❌ NULL');
      if (em) {
        emotionRef.current = em;
        if (em !== 'neutral') postureLeanRef.current = 0.02;
        emotionManagerRef.current?.setEmotion(em);
        const reaction = EMOTION_HEAD_REACTIONS[em];
        if (reaction) {
          const orig = lookAtTargetRef.current.clone();
          if (reaction.dx) lookAtTargetRef.current.x += reaction.dx;
          if (reaction.dy) lookAtTargetRef.current.y += reaction.dy;
          setTimeout(() => lookAtTargetRef.current.copy(orig), reaction.durationMs);
        }
      }
    };
    window.addEventListener('avatar:emotion', onEmotion);
    return () => window.removeEventListener('avatar:emotion', onEmotion);
  }, []);

  useEffect(() => {
    const onUserReact = (e: Event) => {
      const type = (e as CustomEvent<{ type?: string }>).detail?.type;
      switch (type) {
        case 'greeting':
          emotionManagerRef.current?.setEmotion('goodbye');
          emotionRef.current = 'friendly';
          break;
        case 'praise':
          emotionManagerRef.current?.setEmotion('friendly');
          emotionRef.current = 'encouraging';
          break;
        case 'farewell':
          emotionManagerRef.current?.setEmotion('goodbye');
          emotionRef.current = 'friendly';
          break;
        case 'question':
          emotionRef.current = 'thinking';
          postureLeanRef.current = 0.04;
          break;
        case 'listening':
          postureLeanRef.current = 0.03;
          break;
      }
    };
    window.addEventListener('avatar:userreact', onUserReact);
    return () => window.removeEventListener('avatar:userreact', onUserReact);
  }, []);

  useEffect(() => {
    const _evtSeen_gs = new Set<string>();
    const onGesture = (e: Event) => {
      const d = (e as CustomEvent<{ type?: string; side?: string; duration?: number; intensity?: number }>).detail;
      if (process.env.NODE_ENV === 'development' && !_evtSeen_gs.has('avatar:gesture')) {
        _evtSeen_gs.add('avatar:gesture');
        console.log('[EVT][RIG]', 'avatar:gesture', { keys: Object.keys(d ?? {}), sample: d });
      }
      if (!d?.type) return;
      const type = d.type;
      const duration = d.duration ?? 2.5;
      const intensity = d.intensity ?? 1;
      if (type === 'wave') {
        // Wave → play Goodbye.vrma via EmotionManager
        emotionManagerRef.current?.setEmotion('goodbye');
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('avatar:waved', { detail: {} }));
        }
      } else if (type === 'beat' || type === 'openHand') {
        emotionManagerRef.current?.setEmotion('friendly');
      } else if (type === 'point') {
        emotionManagerRef.current?.setEmotion('thinking');
      } else if (type === 'head_down') {
        // head_down: lookAt Y offset (no bone manipulation)
        const origY = lookAtTargetRef.current.y;
        lookAtTargetRef.current.y -= intensity * 0.25;
        setTimeout(() => { lookAtTargetRef.current.y = origY; }, duration * 1000);
      }
      if (process.env.NODE_ENV === 'development') {
        console.debug(`[VRMAvatar] Gesture → EmotionManager: ${type} ${duration}s`);
      }
    };
    let headTurnTimeout: NodeJS.Timeout | null = null;
    const onHeadTurn = (e: Event) => {
      const d = (e as CustomEvent<{ direction?: string; angle?: number; duration?: number }>).detail;
      const angle = typeof d.angle === 'number' ? d.angle : 0.5;
      const duration = typeof d.duration === 'number' ? d.duration : 1.2;
      const originalTarget = lookAtTargetRef.current.clone();
      lookAtTargetRef.current.x += d.direction === 'left' ? -angle : angle;
      if (headTurnTimeout) clearTimeout(headTurnTimeout);
      headTurnTimeout = setTimeout(() => {
        lookAtTargetRef.current.copy(originalTarget);
      }, duration * 1000);
      if (process.env.NODE_ENV === 'development') {
        console.debug(`[VRMAvatar] Head turn: ${d.direction} angle=${angle} duration=${duration}s`);
      }
    };
    window.addEventListener('avatar:gesture', onGesture);
    window.addEventListener('avatar:headturn', onHeadTurn);
    return () => {
      window.removeEventListener('avatar:gesture', onGesture);
      window.removeEventListener('avatar:headturn', onHeadTurn);
      if (headTurnTimeout) clearTimeout(headTurnTimeout);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
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
        if (cancelled) return;
        setTimeout(() => { console.warn = origWarn; }, 0);

        const vrmModel = gltf.userData.vrm as VRM;
        if (!vrmModel?.scene) {
          console.warn('[VRMAvatar] No VRM data in gltf.userData.vrm — file may not be a valid VRM');
          onError?.('Invalid VRM — no scene');
          return;
        }

        try { VRMUtils.removeUnnecessaryVertices(vrmModel.scene); } catch (e) { console.warn('[VRM] removeUnnecessaryVertices failed (ok):', e); }
        try { VRMUtils.combineSkeletons(vrmModel.scene); } catch (e) { console.warn('[VRM] combineSkeletons failed (ok):', e); }
        // rotateVRM0 intentionally omitted — teach.vrm is already oriented toward the camera.

        const ENV_NAMES = /floor|stage|desk|chair|table|wall|ceiling|prop|room|env|ground|platform/i;
        let meshCount = 0, skinnedCount = 0;
        vrmModel.scene.traverse((o) => {
          o.frustumCulled = false;
          const sm = o as THREE.SkinnedMesh;
          if ((o as THREE.Mesh).isMesh) {
            meshCount++;
            (o as THREE.Mesh).frustumCulled = false;
            if (sm.isSkinnedMesh) {
              skinnedCount++;
              (o as THREE.Mesh).visible = true;
            } else if (ENV_NAMES.test(o.name)) {
              (o as THREE.Mesh).visible = false;
            }
          }
        });
        console.log(`%c[VRM] ✅ SCENE READY  meshCount=${meshCount}  skinnedMeshes=${skinnedCount}`, 'color:lime;font-weight:bold');

        if (process.env.NODE_ENV === 'development') {
          const hb = vrmModel.humanoid;
          if (hb) {
            const boneReport = Object.keys(VRM_BONE_LABELS_AR)
              .map(bName => {
                const node = hb.getRawBoneNode(bName as never);
                return node ? `  ✅ ${VRM_BONE_LABELS_AR[bName]} → "${node.name}"` : null;
              })
              .filter(Boolean)
              .join('\n');
            console.log('%c[أفاتار] 🦴 خريطة العظام الكاملة:', 'color:#a5d6a7;font-weight:bold', `\n${boneReport}`);
          }
        }
        vrmRef.current = vrmModel;
        setVrm(vrmModel);
        onLoad?.();

        try {
          mixerRef.current = new THREE.AnimationMixer(vrmModel.scene);
          emotionManagerRef.current = new EmotionManager(vrmModel, mixerRef.current);
          phonemeManagerRef.current = new PhonemeManager(vrmModel);
          emotionManagerRef.current?.setEmotion('friendly');
          console.log('[VRM] managers ready — Emotion ✅  Phoneme ✅  expressionMgr:', !!vrmModel.expressionManager);
        } catch (managerErr) {
          console.warn('[VRM] manager init failed (non-fatal — avatar still renders):', managerErr);
        }
      },
      undefined,
      (error) => {
        if (cancelled) return;
        console.warn = origWarn;
        const msg = (error as Error)?.message || 'VRM network error';
        console.warn('[VRMAvatar] Failed to fetch VRM file:', msg, '— URL was:', vrmUrl);
        onError?.(msg);
      }
    );
    return () => {
      cancelled = true;
      console.warn = origWarn;
    };
  }, [vrmUrl, onLoad, onError]);

  const onSpeakEnd = useCallback(() => {
    isTalkingRef.current = false;
    timingsRef.current = null;
    lipSyncFlagSetRef.current = false;
    emotionRef.current = 'neutral';
    postureLeanRef.current = 0;
    visemeRef.current = { aa: 0, ih: 0, ou: 0 };
    phonemeManagerRef.current?.stop();
    const v = vrmRef.current;
    if (v?.expressionManager) {
      v.expressionManager.setValue(BS_AA, 0);
      v.expressionManager.setValue(BS_IH, 0);
      v.expressionManager.setValue(BS_OU, 0);
      v.expressionManager.setValue('happy' as never, 0);
      v.expressionManager.setValue('angry' as never, 0);
      v.expressionManager.setValue('sad' as never, 0);
      v.expressionManager.setValue('relaxed' as never, 0);
    }
  }, []);

  const doSpeak = useCallback((rawText: string) => {
    if (!rawText?.trim()) return;

    const { dialogue: cleanDialogue, emotion: parsedEmotion, action } = parseVeronaResponse(rawText);
    const text = cleanDialogue || rawText;

    if (action) dispatchGestureFromActionText(action);

    const plan = inferResponsePlan(text);
    emotionRef.current = parsedEmotion !== 'neutral' ? parsedEmotion : plan.emotion;
    postureLeanRef.current = plan.posture.lean === 'listen' ? 0.03 : plan.posture.lean === 'emphasize' ? -0.02 : 0;
    console.log('[V29] 💬 doSpeak → emotion:', emotionRef.current, '| text:', text.slice(0, 60));
    // EmotionManager plays the .vrma clip for the detected emotion (celebration, friendly, etc.)
    // No separate gesture dispatch needed — the animation IS the gesture.
    emotionManagerRef.current?.setEmotion(emotionRef.current);
    const ttsOnStart = () => {
      isTalkingRef.current = true;
      talkStartRef.current = 0;
      if (!timingsRef.current?.length) phonemeManagerRef.current?.startProcedural();
    };
    speakWithTTS(text, { onStart: ttsOnStart, onEnd: onSpeakEnd }).then((ok) => {
      if (!ok) {
        const started = fallbackSpeakWebSpeech(text, ttsOnStart, onSpeakEnd);
        if (!started) {
          ttsOnStart();
          const est = Math.max(2000, text.length * 60);
          setTimeout(onSpeakEnd, est);
        }
      }
    });
  }, [onSpeakEnd]);

  useEffect(() => {
    onSpeakReady?.(doSpeak);
  }, [onSpeakReady, doSpeak]);

  useEffect(() => {
    const handleStopSpeaking = () => {
      stopTTS();
      onSpeakEnd();
    };
    window.addEventListener('avatar:stopSpeaking', handleStopSpeaking);
    return () => window.removeEventListener('avatar:stopSpeaking', handleStopSpeaking);
  }, [onSpeakEnd]);

  useEffect(() => {
    if (typeof window === 'undefined' || !vrm) return;
    const avatarDebug = {
      get emotionManager() { return emotionManagerRef.current; },
      get phonemeManager() { return phonemeManagerRef.current; },
      get vrm() { return vrmRef.current; },
      get emotion() { return emotionRef.current; },
      get isTalking() { return isTalkingRef.current; },
      get mixer() { return mixerRef.current; },
      testEmotion: (e: string) => {
        console.log('[V29] 🧪 testEmotion:', e);
        window.dispatchEvent(new CustomEvent('avatar:emotion', { detail: { emotion: e } }));
      },
      testSpeak: (t: string) => {
        console.log('[V29] 🧪 testSpeak:', t.slice(0, 50));
        window.dispatchEvent(new CustomEvent('avatar:speak', { detail: { text: t } }));
      },
      testWalk: (on = true) => {
        console.log('[V29] 🧪 testWalk:', on);
        window.dispatchEvent(new CustomEvent(on ? 'avatar:walk' : 'avatar:stop', { detail: { isWalking: on } }));
      },
      getAllBones: () => {
        const bones: string[] = [];
        vrmRef.current?.scene.traverse((o) => {
          const m = o as THREE.SkinnedMesh;
          if (m.skeleton) m.skeleton.bones.forEach((b) => bones.push(b.name));
        });
        return bones;
      },
    };
    (window as unknown as Record<string, unknown>).__avatarDebug = avatarDebug;
    console.log('[V29] 🔧 window.__avatarDebug ready. Try:\n  __avatarDebug.testEmotion("happy")\n  __avatarDebug.testEmotion("excited")\n  __avatarDebug.testSpeak("مرحباً!")\n  __avatarDebug.testWalk()\n  __avatarDebug.getAllBones()');
  }, [vrm]);

  const { pointer, camera } = useThree();
  const lookAtTargetRef = useRef(new THREE.Vector3());

  useFrame((state, delta) => {
    frameCounterRef.current += 1;
    if (frameCounterRef.current % 300 === 1) {
      console.log(
        '%c[V30] 🔄 useFrame alive', 'color:orange',
        '| frame:', frameCounterRef.current,
        '| vrm:', !!vrmRef.current,
        '| mixer:', !!mixerRef.current,
        '| emotionMgr:', !!emotionManagerRef.current,
        '| phonemeMgr:', !!phonemeManagerRef.current,
        '| isTalking:', isTalkingRef.current,
        '| isWalking:', activeWalkRef.current?.isWalking,
      );
    }
    // EmotionManager.update() ticks the shared AnimationMixer AND blends face
    // expressions. Do NOT also call mixerRef.current.update(delta) here —
    // it is the same mixer instance; calling it twice advances all VRMA clips
    // at 2× speed.
    emotionManagerRef.current?.update(delta);
    const currentVrm = vrmRef.current;
    if (currentVrm) {
      const lookAt = (currentVrm as { lookAt?: { autoUpdate?: boolean; lookAt: (p: THREE.Vector3) => void } }).lookAt;
      if (lookAt) {
        lookAt.autoUpdate = false;
        lookAtTargetRef.current.set(pointer.x, pointer.y, 0.4).unproject(camera);
        lookAt.lookAt(lookAtTargetRef.current);
      }
      currentVrm.update(delta);

      phonemeManagerRef.current?.update(delta, isTalkingRef.current);

      const ws = activeWalkRef.current;
      if (ws?.isWalking) {
        ws.walkPhase = ((ws.walkPhase ?? 0) + delta * 4) % (Math.PI * 2);
      }

      const em = currentVrm.expressionManager;
      if (em) {
        if (isTalkingRef.current) {
          if (talkStartRef.current === 0) talkStartRef.current = state.clock.elapsedTime;
          const timings = timingsRef.current;
          const elapsedMs = timings?.length && audioStartTimeRef.current > 0
            ? Date.now() - audioStartTimeRef.current
            : (state.clock.elapsedTime - talkStartRef.current) * 1000;
          if (timings?.length) {
            const target = timingsToVisemeAt(timings, elapsedMs);
            visemeRef.current = lerpViseme(visemeRef.current, target, delta);
            if (!lipSyncFlagSetRef.current && typeof window !== 'undefined') {
              lipSyncFlagSetRef.current = true;
              try {
                (window as unknown as { __lipSyncStarted?: boolean }).__lipSyncStarted = true;
                if (process.env.NODE_ENV === 'development') console.debug('[VRMAvatar] __lipSyncStarted = true (timings)');
              } catch { }
            }
          } else {
            const t = state.clock.elapsedTime - talkStartRef.current;
            visemeRef.current = proceduralViseme(t);
            if (!lipSyncFlagSetRef.current && typeof window !== 'undefined') {
              lipSyncFlagSetRef.current = true;
              try {
                (window as unknown as { __lipSyncStarted?: boolean }).__lipSyncStarted = true;
                if (process.env.NODE_ENV === 'development') console.debug('[VRMAvatar] __lipSyncStarted = true (procedural)');
              } catch { }
            }
          }
          em.setValue(BS_AA, visemeRef.current.aa);
          em.setValue(BS_IH, visemeRef.current.ih);
          em.setValue(BS_OU, visemeRef.current.ou);
        } else {
          visemeRef.current = decayViseme(visemeRef.current);
          em.setValue(BS_AA, visemeRef.current.aa);
          em.setValue(BS_IH, visemeRef.current.ih);
          em.setValue(BS_OU, visemeRef.current.ou);
        }
        const emotionBlend = EMOTION_BLENDSHAPES[emotionRef.current as keyof typeof EMOTION_BLENDSHAPES];
        if (emotionBlend) {
          if (emotionBlend.joy != null) em.setValue('happy' as never, emotionBlend.joy);
          if (emotionBlend.angry != null) em.setValue('angry' as never, emotionBlend.angry);
          if (emotionBlend.sorrow != null) em.setValue('sad' as never, emotionBlend.sorrow);
          if (emotionBlend.fun != null) em.setValue('relaxed' as never, emotionBlend.fun);
        }
      }
    }
  });

  const handlePointerDown = useCallback((e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    emotionManagerRef.current?.setEmotion('goodbye');
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('avatar:waved', { detail: {} }));
    }
  }, []);

  return vrm ? (
    <group
      ref={groupRef}
      position={[0, 0, 0]}
      onPointerDown={handlePointerDown}
      onPointerOver={(e) => {
        e.stopPropagation();
        if (typeof document !== 'undefined') document.body.style.cursor = 'pointer';
      }}
      onPointerOut={(e) => {
        e.stopPropagation();
        if (typeof document !== 'undefined') document.body.style.cursor = 'auto';
      }}
    >
      <primitive object={vrm.scene} />
    </group>
  ) : null;
}

function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const check = () => setMobile(window.innerWidth < 768 || /Mobi|Android/i.test(navigator.userAgent));
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);
  return mobile;
}

const NEVER_TALKING_REF = { current: false };

function SimpleAvatarPlaceholder() {
  const groupRef = useRef<THREE.Group>(null);
  const mobile = useIsMobile();
  const listeningRef = useListeningState();
  const waveUntilRef = useRef(0);
  useHeadTracking(groupRef, listeningRef, { waveUntilRef, isTalkingRef: NEVER_TALKING_REF });
  const segments = mobile ? 16 : 32;

  const handlePointerDown = useCallback((e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    waveUntilRef.current = Date.now() + WAVE_DURATION * 1000;
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('avatar:waved', { detail: {} }));
    }
  }, []);

  return (
    <group
      ref={groupRef}
      position={[0, AVATAR_BASE_Y, 0.2]}
      matrixAutoUpdate={false}
      onPointerDown={handlePointerDown}
      onPointerOver={(e) => {
        e.stopPropagation();
        if (typeof document !== 'undefined') document.body.style.cursor = 'pointer';
      }}
      onPointerOut={(e) => {
        e.stopPropagation();
        if (typeof document !== 'undefined') document.body.style.cursor = 'auto';
      }}
    >
      <group rotation={[0, Math.PI, 0]}>
        <mesh>
          <sphereGeometry args={[0.35, segments, segments]} />
          <meshStandardMaterial color="#4a90e2" />
        </mesh>
      </group>
    </group>
  );
}

export interface BoardroomAvatarProps {
  vrmUrl?: string;
  scale?: number;
  onLoad?: () => void;
  onError?: (err: string) => void;
  useSimpleFallback?: boolean;
  walkStateRef?: React.RefObject<{ isWalking: boolean; walkPhase: number } | null>;
  height?: string;
  showChat?: boolean;
}

const VRMAvatarInner = forwardRef<VRMAvatarRef, BoardroomAvatarProps>(function VRMAvatarInner(
  { vrmUrl = VRM_URL, scale = 1, onLoad, onError, useSimpleFallback = false, walkStateRef },
  ref
) {
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => { setLoadError(null); }, [vrmUrl]);
  const speakFnRef = useRef<((text: string) => void) | null>(null);
  const humRef = useRef<Howl | null>(null);
  const humResetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const emotionRef = useRef<string>('neutral');
  const emotionManagerRef = useRef<{ setEmotion: (e: string) => void } | null>(null);

  useImperativeHandle(ref, () => ({
    speak: (text: string) => {
      if (speakFnRef.current) speakFnRef.current(text);
      else fallbackSpeakWebSpeech(text);
    },
    setEmotion: (emotion: string) => {
      emotionRef.current = emotion;
      emotionManagerRef.current?.setEmotion(emotion);
      window.dispatchEvent(new CustomEvent('avatar:emotion', { detail: { emotion } }));
    },
  }));

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
          src: [HUM_URL, HUM_URL_ALT],
          volume: 0.02,
          loop: true,
          html5: true,
          onloaderror: () => { hum = null; humRef.current = null; },
        });
        humRef.current = hum;
        hum.play();
      } catch {
        humRef.current = null;
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

  useEffect(() => {
    const onReceived = () => {
      const h = humRef.current;
      if (!h) return;
      if (humResetTimeoutRef.current) clearTimeout(humResetTimeoutRef.current);
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

  const handleError = useCallback((err: string) => {
    setLoadError(err);
    onError?.(err);
  }, [onError]);

  const handleSpeakReady = useCallback((fn: (text: string) => void) => {
    speakFnRef.current = fn;
  }, []);

  if (useSimpleFallback || loadError) {
    return (
      <Float speed={1.5} rotationIntensity={0} floatIntensity={0.08} floatingRange={[-0.04, 0.04]}>
        <group scale={scale}>
          <SimpleAvatarPlaceholder />
        </group>
      </Float>
    );
  }

  return (
    <group>
      <group scale={scale}>
        <VRMModel
          vrmUrl={vrmUrl}
          onLoad={onLoad}
          onError={handleError}
          onSpeakReady={handleSpeakReady}
          walkStateRef={walkStateRef}
        />
      </group>
    </group>
  );
});

const __LEGACY_ERR__ = '[VRMAvatar] LEGACY component mounted. Use AvatarCanvas.tsx instead.';

export default function VRMAvatarDisabled() {
  if (process.env.NODE_ENV === 'development') { throw new Error(__LEGACY_ERR__); }
  console.error(__LEGACY_ERR__);
  return null as unknown as React.ReactElement;
}