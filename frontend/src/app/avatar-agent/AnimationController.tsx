'use client';

import React, { type MutableRefObject, type RefObject, useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import { lerp } from './utils';
import { useBrainStore } from '@/store/useBrainStore';

const TAB_SAFE_MAX_DELTA = 0.1;

/** وزن تعبيرات VRM من تسمية المشاعر (قيم نسبية 0..1 قبل ضرب الشدة). */
const EMOTION_PRESET: Record<string, Partial<Record<string, number>>> = {
  neutral: {},
  happy: { happy: 0.55 },
  friendly: { happy: 0.45 },
  excited: { happy: 0.62, surprised: 0.22 },
  celebrating: { happy: 0.68, surprised: 0.18 },
  celebrate: { happy: 0.68, surprised: 0.18 },
  proud: { happy: 0.5 },
  encouraging: { happy: 0.48 },
  surprised: { surprised: 0.58 },
  curious: { surprised: 0.38 },
  thinking: { relaxed: 0.25 },
  sad: { sad: 0.52 },
  concerned: { sad: 0.35 },
  empathetic: { sad: 0.32 },
  angry: { angry: 0.52 },
  strict: { angry: 0.35 },
  anxious: { surprised: 0.22, sad: 0.2 },
  bored: { relaxed: 0.2 },
  sleepy: { relaxed: 0.35 },
  calm: { relaxed: 0.4 },
  relaxed: { relaxed: 0.45 },
  attentive: { surprised: 0.15 },
};

const EXPR_KEYS = ['happy', 'sad', 'angry', 'surprised', 'relaxed'] as const;

type ExprKey = (typeof EXPR_KEYS)[number];

/**
 * عند الدخول في عاطفة: دفعة تعبير قصيرة تذوب (ومضة سياقية).
 * القيم نسبية؛ تُضرب بـ intensity الواردة من الحدث.
 */
const EMOTION_ENTER_FLASH: Record<string, Partial<Record<ExprKey, number>>> = {
  happy: { happy: 0.2 },
  friendly: { happy: 0.16 },
  excited: { happy: 0.22, surprised: 0.26 },
  celebrating: { happy: 0.26, surprised: 0.2 },
  celebrate: { happy: 0.26, surprised: 0.2 },
  proud: { happy: 0.18 },
  encouraging: { happy: 0.17 },
  surprised: { surprised: 0.38 },
  curious: { surprised: 0.24 },
  thinking: { relaxed: 0.12 },
  sad: { sad: 0.22 },
  concerned: { sad: 0.16 },
  empathetic: { sad: 0.15 },
  angry: { angry: 0.24 },
  strict: { angry: 0.16 },
  anxious: { surprised: 0.18 },
  bored: { relaxed: 0.1 },
  sleepy: { relaxed: 0.14 },
  calm: { relaxed: 0.12 },
  relaxed: { relaxed: 0.14 },
  attentive: { surprised: 0.14 },
};

const _eyeWorldScratch = new THREE.Vector3();
const _avatarWorldScratch = new THREE.Vector3();
const _toCamScratch = new THREE.Vector3();

function exprGet(em: VRM['expressionManager'], name: string): number {
  if (!em) return 0;
  try {
    const g = (em as { getValue?: (n: string) => number }).getValue;
    if (typeof g === 'function') return g.call(em, name) ?? 0;
  } catch {
    /* */
  }
  return 0;
}

function exprSet(em: NonNullable<VRM['expressionManager']>, name: string, v: number) {
  try {
    em.setValue(name as never, v);
  } catch {
    /* morph missing */
  }
}

export type AnimationControllerProps = {
  vrm: VRM | null;
  isTalkingRef: MutableRefObject<boolean>;
  neckGazeYawRef: MutableRefObject<number>;
  neckGazePitchRef: MutableRefObject<number>;
  groupRef: RefObject<THREE.Group | null>;
};

/**
 * الوعي الإجرائي: رمش طبيعي، تتبع نظرة مع نبضات صغيرة (saccade-like)،
 * و lookAt للعينين + مشاعر happy/surprised حسب الكلام.
 * لا يستدعي vrm.update — يحدّث refs الرقبة والتعبيرات فقط.
 */
export function AnimationController({
  vrm,
  isTalkingRef,
  neckGazeYawRef,
  neckGazePitchRef,
  groupRef,
}: AnimationControllerProps): null {
  const { camera, pointer } = useThree();

  const blinkPhaseRef = useRef(0);
  const nextBlinkAtRef = useRef(0);
  const blinkCountRef = useRef(1);

  const saccadeNextPickRef = useRef(0);
  const saccadeYawOffRef = useRef(0);
  const saccadePitchOffRef = useRef(0);

  const eyeAccumRef = useRef(new THREE.Vector3(0, 1.55, 1.2));
  const vrmFirstFrameRef = useRef(true);

  /** يكسر التردد الواحد لـ sin(t) على ارتفاع هدف العين */
  const eyeBobPhaseARef = useRef(Math.random() * Math.PI * 2);
  const eyeBobPhaseBRef = useRef(Math.random() * Math.PI * 2);
  const eyeBobJitterNextRef = useRef(0);

  // ── Gaze override (from avatar:gaze / SpontaneousBehavior look_away) ────────
  /** Target yaw override; fades back to pointer after durationMs */
  const gazeOverrideYawRef   = useRef(0);
  const gazeOverridePitchRef = useRef(0);
  const gazeOverrideBlendRef = useRef(0);  // 0=none 1=full
  const gazeOverrideUntilMsRef = useRef(0);

  /** Emphasis flash for expression (co-speech emphasis events) */
  const emphasisFlashRef = useRef<{ happy: number; surprised: number }>({ happy: 0, surprised: 0 });
  /** Blink style override from AgentDirector (slow/normal) */
  const blinkStyleRef = useRef<'normal' | 'slow'>('normal');

  // ── Smooth emotional transitions — prevents jarring jumps ────────────────
  /** Previous emotion target for smoothing (key = ExprKey) */
  const prevEmotionTargetsRef = useRef<Record<ExprKey, number>>({ happy: 0, sad: 0, angry: 0, surprised: 0, relaxed: 0 });
  /** Transition speed multiplier — slows during emotional shifts */
  const emotionTransitionSpeedRef = useRef(1.0);
  const lastEmotionChangeTimeRef = useRef(0);

  const agentEmotionRef = useRef<{ emotion: string; intensity: number }>({
    emotion: 'neutral',
    intensity: 0.5,
  });
  const lastAgentEmotionKeyRef = useRef<string>('neutral');
  const flashExprRef = useRef<Record<ExprKey, number>>({
    happy: 0,
    sad: 0,
    angry: 0,
    surprised: 0,
    relaxed: 0,
  });

  // PAD state for expression intensity scaling (read once per frame, cheap)
  const padArousalRef  = useRef(0);
  const padPleasureRef = useRef(0);
  const isThinkingBrainRef = useRef(false);

  useEffect(() => {
    // Subscribe to PAD without causing re-renders (ref-only writes)
    const unsub = useBrainStore.subscribe(
      (s) => ({ arousal: s.pad.arousal, pleasure: s.pad.pleasure, thinking: s.thinking }),
      ({ arousal, pleasure, thinking }) => {
        padArousalRef.current  = arousal;
        padPleasureRef.current = pleasure;
        isThinkingBrainRef.current = thinking;
      },
    );
    return unsub;
  }, []);

  useEffect(() => {
    vrmFirstFrameRef.current = true;
  }, [vrm]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const onEmphasis = (e: Event) => {
      const d = (e as CustomEvent<Record<string, unknown>>).detail ?? {};
      const kind = (typeof d.kind === 'string' ? d.kind : typeof d.type === 'string' ? d.type : '').toLowerCase();
      if (kind === 'eyebrow' || kind === 'eyebrow_raise') {
        emphasisFlashRef.current.surprised = Math.min(1, emphasisFlashRef.current.surprised + 0.32);
      } else if (kind === 'question_tilt') {
        emphasisFlashRef.current.surprised = Math.min(1, emphasisFlashRef.current.surprised + 0.18);
      }
    };
    window.addEventListener('avatar:speech:emphasis', onEmphasis as EventListener);
    window.addEventListener('avatar:micro:gesture', onEmphasis as EventListener);

    const onAvatarBlink = (e: Event) => {
      const d = (e as CustomEvent<Record<string, unknown>>).detail ?? {};
      const style = typeof d.style === 'string' ? d.style : 'normal';
      blinkStyleRef.current = style === 'slow' ? 'slow' : 'normal';
    };
    window.addEventListener('avatar:blink', onAvatarBlink as EventListener);

    const onGaze = (e: Event) => {
      const d = (e as CustomEvent<Record<string, unknown>>).detail ?? {};
      const yaw   = typeof d.yaw   === 'number' ? d.yaw   : 0;
      const pitch = typeof d.pitch === 'number' ? d.pitch : 0;
      const dur   = typeof d.durationMs === 'number' && d.durationMs > 0 ? d.durationMs : 1000;
      gazeOverrideYawRef.current   = THREE.MathUtils.clamp(yaw,   -0.6, 0.6);
      gazeOverridePitchRef.current = THREE.MathUtils.clamp(pitch, -0.3, 0.3);
      gazeOverrideBlendRef.current = 1;
      gazeOverrideUntilMsRef.current = performance.now() + dur;
    };
    window.addEventListener('avatar:gaze', onGaze as EventListener);

    const onEmotion = (e: Event) => {
      const d = (e as CustomEvent<Record<string, unknown>>).detail ?? {};
      const raw =
        typeof d.emotion === 'string'
          ? d.emotion
          : typeof d.name === 'string'
            ? d.name
            : 'neutral';
      const intensityRaw =
        typeof d.strength === 'number'
          ? d.strength
          : typeof d.intensity === 'number'
            ? d.intensity
            : 0.55;
      agentEmotionRef.current = {
        emotion: raw.toLowerCase().trim() || 'neutral',
        intensity: THREE.MathUtils.clamp(intensityRaw, 0, 1),
      };
    };
    window.addEventListener('avatar:emotion', onEmotion as EventListener);
    return () => {
      window.removeEventListener('avatar:speech:emphasis', onEmphasis as EventListener);
      window.removeEventListener('avatar:micro:gesture', onEmphasis as EventListener);
      window.removeEventListener('avatar:blink', onAvatarBlink as EventListener);
      window.removeEventListener('avatar:gaze', onGaze as EventListener);
      window.removeEventListener('avatar:emotion', onEmotion as EventListener);
    };
  }, []);

  useFrame((state, delta) => {
    if (!vrm?.expressionManager) return;

    const safeDelta = Math.min(Math.max(delta, 0), TAB_SAFE_MAX_DELTA);
    const t = state.clock.elapsedTime;
    const nowMs = performance.now();
    const em = vrm.expressionManager;

    const phaseTalking = isTalkingRef.current;
    const skGesture =
      typeof window !== 'undefined'
        ? (window as Window & { __avatarSkeletonGesture?: string }).__avatarSkeletonGesture ?? 'idle'
        : 'idle';
    const stabilizeGaze = skGesture === 'agree' || skGesture === 'think' || skGesture === 'explain';

    // ── Gaze override decay ────────────────────────────────────────────────────
    const gazeOverrideActive = nowMs < gazeOverrideUntilMsRef.current;
    if (!gazeOverrideActive && gazeOverrideBlendRef.current > 0.01) {
      gazeOverrideBlendRef.current = THREE.MathUtils.lerp(gazeOverrideBlendRef.current, 0, Math.min(1, safeDelta * 2.5));
    } else if (!gazeOverrideActive) {
      gazeOverrideBlendRef.current = 0;
    }

    // أثناء الكلام: حركة رأس ملحوظة؛ خارج الكلام: تتبع أوضح للمؤشر.
    let gazeScale = phaseTalking ? 0.18 : 0.28;
    if (stabilizeGaze) gazeScale *= 0.22;
    let desireYaw = -pointer.x * gazeScale * 0.55;
    let desirePitch = pointer.y * gazeScale * 0.38;

    // Blend in gaze override (look_away / spontaneous gaze shift)
    if (gazeOverrideBlendRef.current > 0.01) {
      const b = gazeOverrideBlendRef.current;
      desireYaw   = THREE.MathUtils.lerp(desireYaw,   gazeOverrideYawRef.current,   b);
      desirePitch = THREE.MathUtils.lerp(desirePitch, gazeOverridePitchRef.current, b);
    }

    if (!stabilizeGaze && nowMs > saccadeNextPickRef.current) {
      // Natural saccade rhythm: 900–2800ms between jumps (was 180–660ms — too jittery)
      saccadeYawOffRef.current = (Math.random() - 0.5) * 0.12;
      saccadePitchOffRef.current = (Math.random() - 0.5) * 0.08;
      saccadeNextPickRef.current = nowMs + 900 + Math.random() * 1900;
    }
    if (stabilizeGaze) {
      saccadeYawOffRef.current = THREE.MathUtils.lerp(saccadeYawOffRef.current, 0, Math.min(1, safeDelta * 5));
      saccadePitchOffRef.current = THREE.MathUtils.lerp(saccadePitchOffRef.current, 0, Math.min(1, safeDelta * 5));
    }
    desireYaw += saccadeYawOffRef.current;
    desirePitch += saccadePitchOffRef.current;
    if (stabilizeGaze) {
      desireYaw = THREE.MathUtils.lerp(desireYaw, 0, Math.min(1, safeDelta * 4.5));
      desirePitch = THREE.MathUtils.lerp(desirePitch, 0, Math.min(1, safeDelta * 4.5));
    }

    const cap = 0.34;
    desireYaw = THREE.MathUtils.clamp(desireYaw, -cap, cap);
    desirePitch = THREE.MathUtils.clamp(desirePitch, -cap, cap);

    const gazeLerp = Math.min(1, safeDelta * 3.8);
    if (vrmFirstFrameRef.current) {
      vrmFirstFrameRef.current = false;
      neckGazeYawRef.current = desireYaw;
      neckGazePitchRef.current = desirePitch;
    } else {
      neckGazeYawRef.current = lerp(neckGazeYawRef.current, desireYaw, gazeLerp);
      neckGazePitchRef.current = lerp(neckGazePitchRef.current, desirePitch, gazeLerp);
    }

    // ── Blink — speed varies by style (slow = calm/sad/thinking, normal = default) ──
    const blinkSlow = blinkStyleRef.current === 'slow';
    const blinkSpeed     = blinkSlow ? 7  : 11;   // rad/s close speed
    const blinkLerpSpeed = blinkSlow ? 12 : 18;
    const blinkIntervalMin = blinkSlow ? 2800 : 1800;
    const blinkIntervalVar = blinkSlow ? 4200 : 3200;

    if (nextBlinkAtRef.current === 0) {
      nextBlinkAtRef.current = nowMs + blinkIntervalMin + Math.random() * blinkIntervalVar;
    }
    if (blinkPhaseRef.current <= 0 && nowMs >= nextBlinkAtRef.current) {
      blinkPhaseRef.current = 0.001;
      blinkCountRef.current = Math.random() < 0.18 ? 2 : 1;
    }
    if (blinkPhaseRef.current > 0) {
      blinkPhaseRef.current += safeDelta * blinkSpeed;
      const w = blinkPhaseRef.current < Math.PI ? Math.sin(blinkPhaseRef.current) : 0;
      const cur = exprGet(em, 'blink');
      exprSet(em, 'blink', lerp(cur, w, Math.min(1, safeDelta * blinkLerpSpeed)));
      if (blinkPhaseRef.current > Math.PI * 1.02) {
        blinkPhaseRef.current = 0;
        exprSet(em, 'blink', 0);
        if (blinkCountRef.current > 1) {
          blinkCountRef.current -= 1;
          nextBlinkAtRef.current = nowMs + 90;
        } else {
          nextBlinkAtRef.current = nowMs + blinkIntervalMin + Math.random() * blinkIntervalVar;
        }
      }
    } else {
      const curB = exprGet(em, 'blink');
      if (curB > 0.002) {
        exprSet(em, 'blink', lerp(curB, 0, Math.min(1, safeDelta * 10)));
      }
    }

    const ag = agentEmotionRef.current;
    const preset = EMOTION_PRESET[ag.emotion] ?? {};
    const isNeutralAgent = !ag.emotion || ag.emotion === 'neutral';

    // ── PAD-driven intensity scale ─────────────────────────────────────────
    // High arousal → more expressive face; low arousal → subdued
    const arousal  = padArousalRef.current;
    const pleasure = padPleasureRef.current;
    const padIntensityScale = 1 + THREE.MathUtils.clamp(arousal, -0.5, 0.5) * 0.35; // 0.82–1.18
    const scaledIntensity   = THREE.MathUtils.clamp(ag.intensity * padIntensityScale, 0, 1);

    if (ag.emotion !== lastAgentEmotionKeyRef.current) {
      lastAgentEmotionKeyRef.current = ag.emotion;
      const bump = EMOTION_ENTER_FLASH[ag.emotion];
      const f = flashExprRef.current;
      if (bump) {
        for (const key of EXPR_KEYS) {
          const add = bump[key];
          if (typeof add === 'number' && add > 0) {
            // Flash amplitude also scaled by arousal
            f[key] = Math.max(f[key], add * scaledIntensity);
          }
        }
      }
    }

    // Slower flash decay → emotion flash lasts ~0.8s instead of ~0.4s
    const flashDecay = Math.exp(-safeDelta * 3.8);
    const fFlash = flashExprRef.current;
    for (const key of EXPR_KEYS) {
      fFlash[key] *= flashDecay;
    }

    // Emphasis flash (from co-speech eyebrow/question events)
    const emph = emphasisFlashRef.current;
    if (emph.surprised > 0.005) {
      fFlash.surprised = Math.max(fFlash.surprised, emph.surprised);
      emph.surprised *= Math.exp(-safeDelta * 5.5); // fast decay ~180ms
    } else {
      emph.surprised = 0;
    }
    if (emph.happy > 0.005) {
      fFlash.happy = Math.max(fFlash.happy, emph.happy);
      emph.happy *= Math.exp(-safeDelta * 4.0);
    } else {
      emph.happy = 0;
    }

    // ── Thinking state: relaxed/focused expression ──────────────────────────
    const isThinking = isThinkingBrainRef.current;

    for (const key of EXPR_KEYS) {
      let target =
        (preset[key as keyof typeof preset] ?? 0) * scaledIntensity + fFlash[key];

      // During thinking: add a slight relaxed+curious overlay
      if (isThinking) {
        if (key === 'relaxed')   target = Math.max(target, 0.22);
        if (key === 'surprised') target = Math.max(target, 0.08); // slight eyebrow raise
      }

      // Pleasure drives baseline warmth: higher pleasure → warmer smile floor
      if (isNeutralAgent && key === 'happy') {
        const pleasureFloor = THREE.MathUtils.clamp(pleasure * 0.28, 0, 0.22);
        target = Math.max(target, pleasureFloor);
      }

      target = THREE.MathUtils.clamp(target, 0, 1);
      if (phaseTalking && isNeutralAgent) {
        // Alive engaged expression while speaking (neutral agent only)
        // Reduced from 0.48/0.22 to softer values so it doesn't look manically happy
        if (key === 'happy')    target = Math.max(target, 0.30 + pleasure * 0.15);
        if (key === 'surprised') target = Math.max(target, 0.14); // alive eyebrows
      }
      const cur = exprGet(em, key);

      // ── Smooth emotional transitions — prevents jarring jumps ───────────────
      // When emotion changes, slow down transition for 800ms (natural human pace)
      const prevTarget = prevEmotionTargetsRef.current[key] ?? 0;
      const emoDiff = Math.abs(target - prevTarget);
      if (emoDiff > 0.25 && ag.emotion !== lastAgentEmotionKeyRef.current) {
        // Large shift = a new emotion just arrived → slow blend for naturalness
        lastEmotionChangeTimeRef.current = nowMs;
        emotionTransitionSpeedRef.current = 0.45; // very slow start
      } else if (nowMs - lastEmotionChangeTimeRef.current > 800) {
        // After 800ms, return to normal speed
        emotionTransitionSpeedRef.current = 1.0;
      } else {
        // Gradual speedup: ease from 0.45 → 1.0 over 800ms
        const elapsed = nowMs - lastEmotionChangeTimeRef.current;
        emotionTransitionSpeedRef.current = 0.45 + 0.55 * Math.min(1, elapsed / 800);
      }
      prevEmotionTargetsRef.current[key] = target;

      const baseSpd = phaseTalking ? 3.2 : 1.8;
      const spd = baseSpd * emotionTransitionSpeedRef.current;
      exprSet(em, key, lerp(cur, target, Math.min(1, safeDelta * spd)));
    }

    const group = groupRef.current;
    if (group) {
      group.getWorldPosition(_avatarWorldScratch);
      _toCamScratch.copy(camera.position).sub(_avatarWorldScratch);
      if (_toCamScratch.lengthSq() > 1e-8) _toCamScratch.normalize();
      else _toCamScratch.set(0, 0, 1);
      _eyeWorldScratch.copy(_avatarWorldScratch).addScaledVector(_toCamScratch, 2.2);

      if (nowMs >= eyeBobJitterNextRef.current) {
        eyeBobPhaseARef.current += (Math.random() - 0.5) * 0.85;
        eyeBobPhaseBRef.current += (Math.random() - 0.5) * 1.1;
        eyeBobJitterNextRef.current = nowMs + 3200 + Math.random() * 9000;
      }
      const bob = stabilizeGaze
        ? 0
        : Math.sin(t * 0.71 + eyeBobPhaseARef.current) * 0.0135 +
          Math.sin(t * 1.17 + eyeBobPhaseBRef.current) * 0.0085 +
          Math.sin(t * 0.29) * Math.cos(t * 0.53 + eyeBobPhaseARef.current * 0.5) * 0.0055;
      _eyeWorldScratch.y += 0.12 + bob;

      const eyeSpd = Math.min(1, safeDelta * 10);
      eyeAccumRef.current.lerp(_eyeWorldScratch, eyeSpd);
    }

    const lookAt = (vrm as { lookAt?: { autoUpdate?: boolean; lookAt?: (p: THREE.Vector3) => void } }).lookAt;
    if (lookAt?.lookAt && group) {
      lookAt.autoUpdate = false;
      if (stabilizeGaze) {
        group.getWorldPosition(_avatarWorldScratch);
        _toCamScratch.copy(camera.position).sub(_avatarWorldScratch);
        if (_toCamScratch.lengthSq() > 1e-8) _toCamScratch.normalize();
        else _toCamScratch.set(0, 0, 1);
        _eyeWorldScratch.copy(_avatarWorldScratch).addScaledVector(_toCamScratch, 2.2);
        _eyeWorldScratch.y += 0.12;
        lookAt.lookAt(_eyeWorldScratch);
      } else {
        lookAt.lookAt(eyeAccumRef.current);
      }
    }
  }, -2);

  return null;
}
