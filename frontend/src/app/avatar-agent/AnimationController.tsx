'use client';

import React, { type MutableRefObject, type RefObject, useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import { DEBUG_AVATAR } from '@/app/avatar-agent/debugAvatar';
import { lerp } from './utils';
import { useBrainStore } from '@/store/useBrainStore';
import { getIntentPresentation } from '@/ai/avatar/avatarIntent';
import { getPersonality } from '@/ai/avatar/avatarPersonality';
import { tickMicroExpressions } from '@/ai/avatar/microExpressionLayer';
import { getEyeEmotionMods, PRE_SPEECH_DECAY_SEC } from '@/lib/avatar/eyeIntelligence';
import {
  computeThinkingGazeBias,
  explainingContextualBias,
  gazeConnectionHold,
  getEyeIntentionScalars,
} from '@/lib/avatar/eyeIntention';
import { getUserMirrorMicroAdds } from '@/lib/avatar/userEmotionMirror';
import { getEmbodimentHints } from '@/lib/avatar/emotionalMemory';
import { getGazeIntentionPersonalityMods } from '@/lib/avatar/personalityEvolution';

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
 * VRM 1.0 canonical expression names (cogni.vrm — converted from 195_Uta01 via UniVRM).
 * three-vrm v3.5.1 maps VRM0 presets → VRM1 names internally, so we use VRM1 names directly.
 * No VRM 0.x fallbacks needed — model is canonical VRM 1.0.
 *
 * Available in cogni.vrm: happy, angry, sad, relaxed, aa, ih, oh, ou, ee,
 *   blink, blinkLeft, blinkRight, lookUp, lookDown, lookLeft, lookRight, neutral
 * NOTE: 'surprised' not present as preset — use 'happy+blinkLeft+blinkRight' composite if needed.
 */
const EXPR_DUAL_NAMES: Record<string, readonly string[]> = {
  happy:     ['happy'],
  sad:       ['sad'],
  angry:     ['angry'],
  surprised: ['happy'],    // VRM 1.0 cogni.vrm has no 'surprised' preset → map to happy
  relaxed:   ['relaxed'],
  blink:     ['blink'],
} as const;

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
const _camAnchorScratch = new THREE.Vector3();
const _fusedEyeScratch = new THREE.Vector3();

/**
 * Try the canonical name first, then all dual-alias alternatives.
 * Returns the first non-zero value found, or 0 if none respond.
 */
function exprGet(em: VRM['expressionManager'], name: string): number {
  if (!em) return 0;
  const g = (em as { getValue?: (n: string) => number }).getValue;
  if (typeof g !== 'function') return 0;
  const aliases = EXPR_DUAL_NAMES[name] ?? [name];
  for (const alias of aliases) {
    try {
      const v = g.call(em, alias);
      if (typeof v === 'number' && v > 0) return v;
    } catch { /* morph missing */ }
  }
  return 0;
}

/**
 * Try the canonical name first, then all dual-alias alternatives.
 * Sets the value on the FIRST alias that succeeds (no error thrown).
 * Silently skips if all aliases are missing (avoids console spam).
 */
function exprSet(em: NonNullable<VRM['expressionManager']>, name: string, v: number) {
  const aliases = EXPR_DUAL_NAMES[name] ?? [name];
  for (const alias of aliases) {
    try {
      em.setValue(alias as never, v);
      return; // success — stop after first working alias
    } catch { /* try next alias */ }
  }
}

/** One-time audit flag — runs expression probe on first VRM load */
let _exprAuditDone = false;

/**
 * One-time audit for VRM 1.0 expressions (cogni.vrm).
 * Expected: happy✅ sad✅ angry✅ relaxed✅ blink✅ blinkLeft✅ blinkRight✅
 *           aa✅ ih✅ oh✅ ou✅ ee✅ lookUp✅ lookDown✅ lookLeft✅ lookRight✅
 * Not present: surprised (no preset in this model)
 */
function runExprAudit(em: NonNullable<VRM['expressionManager']>): void {
  if (_exprAuditDone || process.env.NODE_ENV !== 'development') return;
  _exprAuditDone = true;
  const probe = (n: string): string => {
    try {
      (em as { getValue?: (n: string) => number }).getValue?.call(em, n);
      return '✅';
    } catch { return '❌'; }
  };
  const audit: Record<string, string> = {};
  const all = ['happy','sad','angry','relaxed','blink','blinkLeft','blinkRight',
               'aa','ih','oh','ou','ee','lookUp','lookDown','lookLeft','lookRight','neutral'];
  for (const n of all) audit[n] = probe(n);
  if (DEBUG_AVATAR) {
    console.table(audit);
    console.log('[AnimationController] VRM 1.0 expression audit complete.');
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
  /** Full close-open cycle length (s), randomized per blink — ~100–200 ms */
  const blinkDurationSecRef = useRef(0.14);

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

  /** Smooth 0→1 when user has the floor (bypasses interactionIntent debounce). */
  const userFocusBlendRef = useRef(0);

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

  /** 1 = just fired cogni:pre_speech — thinking-before-speaking window */
  const preSpeechStrengthRef = useRef(0);
  /** Eyes lead: inner gaze tracks target fast; neck follows inner with lag (~80–120 ms feel) */
  const innerGazeYawRef = useRef(0);
  const innerGazePitchRef = useRef(0);
  /** Slow attention drift (3–6 s) — soft gaze shift, not saccade */
  const attnDriftYawSmRef = useRef(0);
  const attnDriftPitchSmRef = useRef(0);
  const attnDriftYawTgtRef = useRef(0);
  const attnDriftPitchTgtRef = useRef(0);
  const nextAttentionDriftAtRef = useRef(0);

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

    const onPreSpeech = (): void => {
      preSpeechStrengthRef.current = 1;
    };
    window.addEventListener('cogni:pre_speech', onPreSpeech as EventListener);

    return () => {
      window.removeEventListener('avatar:speech:emphasis', onEmphasis as EventListener);
      window.removeEventListener('avatar:micro:gesture', onEmphasis as EventListener);
      window.removeEventListener('avatar:blink', onAvatarBlink as EventListener);
      window.removeEventListener('avatar:gaze', onGaze as EventListener);
      window.removeEventListener('avatar:emotion', onEmotion as EventListener);
      window.removeEventListener('cogni:pre_speech', onPreSpeech as EventListener);
    };
  }, []);

  useFrame((state, delta) => {
    if (!vrm?.expressionManager) return;

    const safeDelta = Math.min(Math.max(delta, 0), TAB_SAFE_MAX_DELTA);
    const t = state.clock.elapsedTime;
    const nowMs = performance.now();
    const em = vrm.expressionManager;

    // One-time expression audit (dev only) — reveals which VRM alias names work
    runExprAudit(em);

    const brainEarly = useBrainStore.getState();
    const userEngagedEarly = brainEarly.isUserSpeaking || brainEarly.physical.isListening;
    const mirrorAdds = getUserMirrorMicroAdds(brainEarly.userMirrorEmotion, userEngagedEarly);
    const microExpr = tickMicroExpressions(safeDelta, nowMs);
    const eyeMods = getEyeEmotionMods(agentEmotionRef.current.emotion);

    if (preSpeechStrengthRef.current > 0.002) {
      preSpeechStrengthRef.current *= Math.exp(-safeDelta / PRE_SPEECH_DECAY_SEC);
    } else {
      preSpeechStrengthRef.current = 0;
    }

    const phaseTalking = isTalkingRef.current;
    const skGesture =
      typeof window !== 'undefined'
        ? (window as Window & { __avatarSkeletonGesture?: string }).__avatarSkeletonGesture ?? 'idle'
        : 'idle';
    const brain = brainEarly;
    const interactionIntent = brain.interactionIntent;
    const pres = getIntentPresentation(interactionIntent);
    const { curiosity, calm } = getPersonality();
    const userEngaged = brain.isUserSpeaking || brain.physical.isListening;
    const userFocusRaw = userEngaged || interactionIntent === 'listening';
    userFocusBlendRef.current = THREE.MathUtils.lerp(
      userFocusBlendRef.current,
      userFocusRaw ? 1 : 0,
      Math.min(1, safeDelta * 2.85),
    );
    const structuralStabilize =
      skGesture === 'agree' || skGesture === 'think' || skGesture === 'explain';
    /** 1 = full address camera / damp drift; user path eases via userFocusBlendRef. */
    const stabilizeMix = Math.max(structuralStabilize ? 1 : 0, userFocusBlendRef.current);

    if (
      typeof process !== 'undefined' &&
      process.env.NEXT_PUBLIC_MOTION_PIPELINE_DEBUG === 'true' &&
      typeof window !== 'undefined'
    ) {
      (window as Window & { __cogniStabilizeMix?: number }).__cogniStabilizeMix = stabilizeMix;
    }

    const cognitionEye = getEyeIntentionScalars({
      intent: interactionIntent,
      isUserSpeaking: brain.isUserSpeaking,
      isListening: brain.physical.isListening,
      phaseTalking,
      preSpeechStrength: preSpeechStrengthRef.current,
      comprehensionConfidence: brain.comprehensionConfidence,
      emotionLabel: agentEmotionRef.current.emotion,
      userMirrorEmotion: brain.userMirrorEmotion,
    });
    const peGaze = getGazeIntentionPersonalityMods();
    cognitionEye.driftMul *= peGaze.driftMul;
    cognitionEye.gazeDirectAdd += peGaze.gazeDirectAdd;
    const embLt = getEmbodimentHints();
    const connectionHold =
      gazeConnectionHold(t, stabilizeMix, userEngaged) * embLt.gazeConnectionMul;

    // ── Gaze override decay ────────────────────────────────────────────────────
    const gazeOverrideActive = nowMs < gazeOverrideUntilMsRef.current;
    if (!gazeOverrideActive && gazeOverrideBlendRef.current > 0.01) {
      gazeOverrideBlendRef.current = THREE.MathUtils.lerp(gazeOverrideBlendRef.current, 0, Math.min(1, safeDelta * 2.5));
    } else if (!gazeOverrideActive) {
      gazeOverrideBlendRef.current = 0;
    }

    // أثناء الكلام: حركة رأس ملحوظة؛ خارج الكلام: تتبع أوضح للمؤشر.
    let gazeScale = (phaseTalking ? 0.18 : 0.28) * pres.animationGazeScaleMul;
    gazeScale *= THREE.MathUtils.lerp(1, 0.2, stabilizeMix);
    let desireYaw = -pointer.x * gazeScale * 0.55;
    let desirePitch = pointer.y * gazeScale * 0.38;

    const thinkCtx =
      interactionIntent === 'thinking' || isThinkingBrainRef.current ? 1 : 0;
    if (thinkCtx > 0) {
      const off = Math.sin(t * 0.35 + eyeBobPhaseARef.current) * 0.048 * curiosity;
      const pitchW = Math.cos(t * 0.27 + eyeBobPhaseBRef.current) * 0.024 * curiosity;
      const dampThink = thinkCtx * (1 - stabilizeMix * 0.45);
      desireYaw += off * dampThink * 0.52;
      desirePitch += pitchW * dampThink * 0.52;
    }
    const thinkIntentionActive =
      (interactionIntent === 'thinking' || isThinkingBrainRef.current) && !phaseTalking;
    const tb = computeThinkingGazeBias(t, thinkIntentionActive);
    const pszEarly = preSpeechStrengthRef.current;
    const tbBlend =
      (1 - stabilizeMix * 0.48) * (1 - THREE.MathUtils.clamp(pszEarly, 0, 1) * 0.88);
    desireYaw += tb.yaw * tbBlend;
    desirePitch += tb.pitch * tbBlend;
    if (interactionIntent === 'explaining' && phaseTalking) {
      const pull = Math.min(1, safeDelta * 2.4);
      desireYaw = THREE.MathUtils.lerp(desireYaw, -pointer.x * gazeScale * 0.35, pull * 0.55);
      desirePitch = THREE.MathUtils.lerp(desirePitch, pointer.y * gazeScale * 0.28, pull * 0.5);
    }
    {
      const exb = explainingContextualBias(t, interactionIntent === 'explaining' && phaseTalking);
      const exDamp = 1 - stabilizeMix * 0.55;
      desireYaw += exb.yaw * exDamp;
      desirePitch += exb.pitch * exDamp;
    }
    const idleEnv =
      interactionIntent === 'idle' && !userFocusRaw && !phaseTalking ? 1 : 0;
    if (idleEnv > 0) {
      desireYaw += Math.sin(t * 0.19 + eyeBobPhaseBRef.current) * 0.062 * curiosity * idleEnv;
      desirePitch += Math.cos(t * 0.23) * 0.028 * curiosity * idleEnv;
    }

    // ── Attention drift (3–6 s): slow gaze shift, damped when addressing user / speaking ──
    if (nextAttentionDriftAtRef.current === 0) {
      nextAttentionDriftAtRef.current = nowMs + 3000 + Math.random() * 3000;
    }
    if (nowMs >= nextAttentionDriftAtRef.current) {
      attnDriftYawTgtRef.current = (Math.random() - 0.5) * 0.09;
      attnDriftPitchTgtRef.current = (Math.random() - 0.5) * 0.06;
      nextAttentionDriftAtRef.current = nowMs + 3000 + Math.random() * 3000;
    }
    const driftK = THREE.MathUtils.clamp(safeDelta * 3.2, 0.08, 0.18);
    attnDriftYawSmRef.current = THREE.MathUtils.lerp(
      attnDriftYawSmRef.current,
      attnDriftYawTgtRef.current,
      driftK,
    );
    attnDriftPitchSmRef.current = THREE.MathUtils.lerp(
      attnDriftPitchSmRef.current,
      attnDriftPitchTgtRef.current,
      driftK,
    );
    const driftVis =
      THREE.MathUtils.clamp(1 - stabilizeMix * 0.92, 0, 1) *
      (phaseTalking ? 0.4 : 1) *
      cognitionEye.driftMul;
    desireYaw += attnDriftYawSmRef.current * driftVis * 0.48;
    desirePitch += attnDriftPitchSmRef.current * driftVis * 0.48;

    // Blend in gaze override (look_away / spontaneous gaze shift)
    if (gazeOverrideBlendRef.current > 0.01) {
      const b = gazeOverrideBlendRef.current;
      desireYaw   = THREE.MathUtils.lerp(desireYaw,   gazeOverrideYawRef.current,   b);
      desirePitch = THREE.MathUtils.lerp(desirePitch, gazeOverridePitchRef.current, b);
    }

    // Pre-speech (~150–300 ms): slight “gathering thought” — eyes up/narrow, defer blink
    const psz = preSpeechStrengthRef.current;
    if (psz > 0.01) {
      desirePitch += 0.034 * psz;
      desireYaw *= THREE.MathUtils.lerp(1, 0.94, psz);
      nextBlinkAtRef.current = Math.max(nextBlinkAtRef.current, nowMs + 180 * psz);
    }

    if (stabilizeMix < 0.82 && nowMs > saccadeNextPickRef.current) {
      // Sparse micro-saccades (low frequency, small amplitude)
      saccadeYawOffRef.current = (Math.random() - 0.5) * 0.1;
      saccadePitchOffRef.current = (Math.random() - 0.5) * 0.07;
      saccadeNextPickRef.current = nowMs + 1200 + Math.random() * 2400;
    }
    const saccadeDamp = Math.min(1, safeDelta * 5) * stabilizeMix;
    saccadeYawOffRef.current = THREE.MathUtils.lerp(saccadeYawOffRef.current, 0, saccadeDamp);
    saccadePitchOffRef.current = THREE.MathUtils.lerp(saccadePitchOffRef.current, 0, saccadeDamp);
    const saccadeVis =
      pres.animationSaccadeMul *
      (1 - stabilizeMix * 0.92) *
      eyeMods.saccadeMul *
      cognitionEye.saccadeMul;
    desireYaw += saccadeYawOffRef.current * saccadeVis;
    desirePitch += saccadePitchOffRef.current * saccadeVis;
    const centerPull =
      Math.min(1, safeDelta * 4.2) * stabilizeMix * cognitionEye.centerPullMul;
    desireYaw = THREE.MathUtils.lerp(desireYaw, 0, centerPull);
    desirePitch = THREE.MathUtils.lerp(desirePitch, 0, centerPull);

    const cap = 0.34;
    desireYaw = THREE.MathUtils.clamp(desireYaw, -cap, cap);
    desirePitch = THREE.MathUtils.clamp(desirePitch, -cap, cap);

    // Eyes lead, neck follows (~80–120 ms equivalent via slower neck lerp)
    let eyeMul = THREE.MathUtils.clamp(safeDelta * 5.5, 0.15, 0.22);
    if (interactionIntent === 'thinking') {
      eyeMul *= THREE.MathUtils.lerp(1, 0.82, calm * 0.95);
    }
    if (brain.userMirrorEmotion === 'confused') eyeMul *= 0.93;
    if (brain.userMirrorEmotion === 'excited') eyeMul *= 1.04;
    const neckMul = THREE.MathUtils.clamp(safeDelta * 3.9, 0.1, 0.16);
    if (vrmFirstFrameRef.current) {
      vrmFirstFrameRef.current = false;
      innerGazeYawRef.current = desireYaw;
      innerGazePitchRef.current = desirePitch;
      neckGazeYawRef.current = desireYaw;
      neckGazePitchRef.current = desirePitch;
    } else {
      innerGazeYawRef.current = lerp(innerGazeYawRef.current, desireYaw, eyeMul);
      innerGazePitchRef.current = lerp(innerGazePitchRef.current, desirePitch, eyeMul);
      neckGazeYawRef.current = lerp(neckGazeYawRef.current, innerGazeYawRef.current, neckMul);
      neckGazePitchRef.current = lerp(neckGazePitchRef.current, innerGazePitchRef.current, neckMul);
    }

    // ── Blink — natural interval 2–5 s, closure ~100–200 ms; slow style stretches both ──
    const blinkSlow = blinkStyleRef.current === 'slow';
    const blinkLerpSpeed = blinkSlow ? 12 : 18;
    const blinkIntervalMin =
      (blinkSlow ? 3200 : 2000) *
      microExpr.blinkIntervalScale *
      mirrorAdds.blinkIntervalScaleMul *
      eyeMods.blinkIntervalMul *
      cognitionEye.blinkIntervalMul;
    const blinkIntervalVar =
      (blinkSlow ? 4800 : 3000) *
      microExpr.blinkIntervalScale *
      mirrorAdds.blinkIntervalScaleMul *
      eyeMods.blinkIntervalMul *
      cognitionEye.blinkIntervalMul;

    if (nextBlinkAtRef.current === 0) {
      nextBlinkAtRef.current = nowMs + blinkIntervalMin + Math.random() * blinkIntervalVar;
    }
    if (blinkPhaseRef.current <= 0 && nowMs >= nextBlinkAtRef.current) {
      blinkPhaseRef.current = 0.001;
      blinkCountRef.current = Math.random() < 0.14 ? 2 : 1;
      blinkDurationSecRef.current =
        (blinkSlow ? 0.14 : 0.12) + Math.random() * (blinkSlow ? 0.12 : 0.06);
    }
    const blinkRadPerSec = Math.PI / Math.max(0.08, blinkDurationSecRef.current);

    if (blinkPhaseRef.current > 0) {
      blinkPhaseRef.current += safeDelta * blinkRadPerSec;
      const w = blinkPhaseRef.current < Math.PI ? Math.sin(blinkPhaseRef.current) : 0;
      const cur = exprGet(em, 'blink');
      exprSet(em, 'blink', lerp(cur, w, Math.min(1, safeDelta * blinkLerpSpeed)));
      if (blinkPhaseRef.current > Math.PI * 1.02) {
        blinkPhaseRef.current = 0;
        exprSet(em, 'blink', 0);
        if (blinkCountRef.current > 1) {
          blinkCountRef.current -= 1;
          nextBlinkAtRef.current = nowMs + 70 + Math.random() * 55;
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

      if (phaseTalking && isNeutralAgent) {
        // Alive engaged expression while speaking (neutral agent only)
        // Reduced from 0.48/0.22 to softer values so it doesn't look manically happy
        if (key === 'happy')    target = Math.max(target, 0.30 + pleasure * 0.15);
        if (key === 'surprised') target = Math.max(target, 0.14); // alive eyebrows
      }
      if (key === 'happy') target += microExpr.happyAdd + mirrorAdds.happyAdd;
      if (key === 'surprised') target += microExpr.surprisedAdd + mirrorAdds.surprisedAdd;
      target = THREE.MathUtils.clamp(target, 0, 1);
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
      const alpha = THREE.MathUtils.clamp(safeDelta * spd, 0.08, 0.22);
      exprSet(em, key, lerp(cur, target, alpha));
    }

    // Subtle brow / eyes-up micro-layer (VRM lookUp morph; additive, capped)
    {
      const luCur = exprGet(em, 'lookUp');
      const pszLu = preSpeechStrengthRef.current;
      const luTgt = THREE.MathUtils.clamp(
        microExpr.lookUpAdd +
          mirrorAdds.lookUpAdd +
          eyeMods.lookUpBias +
          (pszLu > 0.01 ? 0.045 * pszLu : 0),
        0,
        0.14,
      );
      const luSpd = phaseTalking ? 4.0 : 2.5;
      exprSet(em, 'lookUp', lerp(luCur, luTgt, Math.min(1, safeDelta * luSpd)));
    }

    {
      const ihCur = exprGet(em, 'ih');
      const ouCur = exprGet(em, 'ou');
      const lipSpd = 2.8;
      exprSet(
        em,
        'ih',
        lerp(ihCur, mirrorAdds.ihTension, Math.min(1, safeDelta * lipSpd)),
      );
      exprSet(
        em,
        'ou',
        lerp(ouCur, mirrorAdds.ouTension, Math.min(1, safeDelta * lipSpd)),
      );
    }

    const lookAt = (vrm as { lookAt?: { autoUpdate?: boolean; lookAt?: (p: THREE.Vector3) => void } }).lookAt;
    const group = groupRef.current;
    if (group) {
      group.getWorldPosition(_avatarWorldScratch);
      _toCamScratch.copy(camera.position).sub(_avatarWorldScratch);
      if (_toCamScratch.lengthSq() > 1e-8) _toCamScratch.normalize();
      else _toCamScratch.set(0, 0, 1);
      _camAnchorScratch.copy(_avatarWorldScratch).addScaledVector(_toCamScratch, 2.2);
      _camAnchorScratch.y += 0.12;

      _eyeWorldScratch.copy(_avatarWorldScratch).addScaledVector(_toCamScratch, 2.2);

      if (nowMs >= eyeBobJitterNextRef.current) {
        eyeBobPhaseARef.current += (Math.random() - 0.5) * 0.85;
        eyeBobPhaseBRef.current += (Math.random() - 0.5) * 1.1;
        eyeBobJitterNextRef.current = nowMs + 3200 + Math.random() * 9000;
      }
      const bobMul = THREE.MathUtils.clamp(1 - stabilizeMix * 1.05, 0, 1);
      const bob =
        bobMul *
        (Math.sin(t * 0.71 + eyeBobPhaseARef.current) * 0.0135 +
          Math.sin(t * 1.17 + eyeBobPhaseBRef.current) * 0.0085 +
          Math.sin(t * 0.29) * Math.cos(t * 0.53 + eyeBobPhaseARef.current * 0.5) * 0.0055);
      _eyeWorldScratch.y += 0.12 + bob;

      const directBlend = THREE.MathUtils.clamp(
        stabilizeMix * (0.62 + 0.38 * eyeMods.gazeDirectMul) +
          (phaseTalking ? 0.1 : 0) +
          cognitionEye.gazeDirectAdd +
          connectionHold,
        0,
        1,
      );
      _fusedEyeScratch.copy(_eyeWorldScratch).lerp(_camAnchorScratch, directBlend);
      const eyeSpd = Math.min(
        1,
        safeDelta * THREE.MathUtils.lerp(11, 6.2, THREE.MathUtils.clamp(directBlend, 0, 1)),
      );
      eyeAccumRef.current.lerp(_fusedEyeScratch, eyeSpd);
    }

    if (lookAt?.lookAt && group) {
      lookAt.autoUpdate = false;
      lookAt.lookAt(eyeAccumRef.current);
    }
  }, -2);

  return null;
}
