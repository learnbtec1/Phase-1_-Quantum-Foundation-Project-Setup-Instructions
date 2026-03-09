'use client';

/**
 * AvatarCanvas — Self-contained R3F canvas for the /avatar-agent page.
 *
 * DESIGN: Uses an inline VRMScene (zero import from VRMAvatar.tsx).
 * Avoids the complex import chain (Howl, EmotionManager, PhonemeManager)
 * which silently fails under Next.js dynamic() → avatar disappears.
 *
 * The VRMScene reacts to window events dispatched by useAvatarAgent:
 *   avatar:speak:start / avatar:speak:end / avatar:stopSpeaking
 *   avatar:emotion / avatar:gesture
 */

import React, { Suspense, useCallback, useRef, useState, useEffect } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRM, VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import styles from './AvatarCanvas.module.css';
import { perlinNoise, Easing, lerp } from './utils';

// ── Constants ────────────────────────────────────────────────────────────────
const AVATAR_BASE_Y = -1.0;
const BREATHE_AMP   = 0.06;
const BLINK_MIN     = 2.2;   // seconds
const BLINK_MAX     = 4.5;
const WAVE_DURATION = 3.5;   // seconds — greeting wave on load

// ── VRMScene — lives inside <Canvas> ────────────────────────────────────────
function VRMScene({
  vrmUrl,
  onLoad,
  onError,
}: {
  vrmUrl: string;
  onLoad: () => void;
  onError: (err: string) => void;
}) {
  const [vrm, setVrm]     = useState<VRM | null>(null);
  const vrmRef            = useRef<VRM | null>(null);
  const groupRef          = useRef<THREE.Group>(null);

  const isTalkingRef      = useRef(false);
  const talkElapsedRef    = useRef(0);
  const emotionRef        = useRef<string>('neutral');
  // Smooth emotion blending (lerp from prev to target)
  const emotionBlendRef   = useRef<Record<string, number>>({});
  // Phase 2: real viseme weights from edge-tts word-boundary events
  const azureVisemeRef    = useRef<{ aa: number; ih: number; ou: number }>({ aa: 0, ih: 0, ou: 0 });
  const azureVisemeActive = useRef(false); // true while real visemes are scheduled
  // Current rendered lip weights (for smooth lerp without reading from VRM)
  const lipWeightsRef     = useRef<{ aa: number; ih: number; ou: number }>({ aa: 0, ih: 0, ou: 0 });
  const waveUntilRef      = useRef(0);
  const gestureRef        = useRef<{
    type: 'point' | 'openHand' | 'beat';
    side: 'left' | 'right' | 'both';
    startMs: number;
    durationMs: number;
  } | null>(null);
  const nextBlinkRef      = useRef(Date.now() + 3000);
  const blinkPhaseRef     = useRef(0);
  // Double-blink for surprise/excited
  const blinkCountRef     = useRef(0);
  const walkUntilRef      = useRef(0);
  const nodUntilRef       = useRef(0);
  const nodStartRef       = useRef(0);    // timestamp when current nod began
  const nodDurationRef    = useRef(1500); // ms — duration of current nod
  const laughUntilRef     = useRef(0);
  const voiceRateRef      = useRef(1.0);
  // Head-pose lerp targets (set by avatar:headpose events)
  const headYawRef        = useRef(0);
  const headPitchRef      = useRef(0);
  const headUntilRef      = useRef(0);
  // Perlin-noise idle offsets
  const idleBodyOffsetRef = useRef(0);
  const idleHeadOffsetRef = useRef(0);
  // Spine breathing rotation (human-like chest rise)
  const spineBreathRef    = useRef(0);
  // Micro-expression refs
  const microExprUntilRef = useRef(0);
  const microExprTypeRef  = useRef<'eyebrowRaise'|'squint'|'halfSmile'|'none'>('none');
  // Gesture variety: track last gesture type to prevent repetition
  const lastGestureTypeRef = useRef<string>('');
  const lastGestureTimeRef = useRef(0);

  // ── Load VRM ────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const loader = new GLTFLoader();
    loader.register((parser: unknown) => new VRMLoaderPlugin(parser as never));

    // Suppress noisy LookAtDegreeMap warnings from three-vrm
    const origWarn = console.warn;
    console.warn = (...a: unknown[]) => {
      if (String(a[0] ?? '').includes('LookAtDegreeMap')) return;
      origWarn.apply(console, a);
    };

    loader.load(
      vrmUrl,
      (gltf) => {
        if (cancelled) { setTimeout(() => { console.warn = origWarn; }, 0); return; }
        setTimeout(() => { console.warn = origWarn; }, 0);

        const model = gltf.userData.vrm as VRM;
        if (!model?.scene) {
          console.warn('[AvatarCanvas] ❌ No VRM in gltf.userData.vrm:', vrmUrl);
          onError('No VRM data in file');
          return;
        }

        // Optimise (non-fatal)
        try { VRMUtils.removeUnnecessaryVertices(model.scene); } catch (e) { console.warn('[AvatarCanvas] removeUnnecessaryVertices skipped:', e); }
        try { VRMUtils.combineSkeletons(model.scene); }          catch (e) { console.warn('[AvatarCanvas] combineSkeletons skipped:', e); }
        // ⚠️ rotateVRM0 is intentionally NOT called:
        // teach.vrm is VRM 0.0 and is already facing the camera.
        // rotateVRM0 would flip it 180° → invisible.

        let meshCount = 0;
        model.scene.traverse((o) => {
          o.frustumCulled = false;
          if ((o as THREE.Mesh).isMesh) { (o as THREE.Mesh).visible = true; meshCount++; }
        });
        console.log(`%c[AvatarCanvas] ✅ VRM loaded — ${meshCount} meshes`, 'color:lime;font-weight:bold');

        // Greeting wave on load
        waveUntilRef.current = Date.now() + WAVE_DURATION * 1000;

        vrmRef.current = model;
        setVrm(model);   // triggers re-render → <primitive> appears
        onLoad();
      },
      undefined,
      (err) => {
        if (!cancelled) {
          console.warn = origWarn;
          console.error('[AvatarCanvas] ❌ VRM load error:', (err as Error)?.message ?? err);
          onError(String((err as Error)?.message ?? err));
        }
      },
    );

    return () => {
      cancelled = true;
      console.warn = origWarn;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vrmUrl]);

  // ── Window events from useAvatarAgent ────────────────────────────────────
  useEffect(() => {
    const onGesture = (e: Event) => {
      const d = (e as CustomEvent).detail as { type?: string; side?: string; duration?: number };
      if (!d?.type) return;
      const now = Date.now();
      // Gesture variety: if same gesture fires within 4s, swap to alternate
      let gType = d.type;
      if (gType === lastGestureTypeRef.current && now - lastGestureTimeRef.current < 4000) {
        const alts: Record<string, string> = { point: 'openHand', openHand: 'beat', beat: 'point' };
        gType = alts[gType] ?? gType;
        console.log(`[BRAIN] Gesture variety swap: ${d.type} → ${gType}`);
      }
      lastGestureTypeRef.current = gType;
      lastGestureTimeRef.current = now;

      if (gType === 'wave') {
        waveUntilRef.current = Date.now() + (d.duration ?? 2.5) * 1000;
        console.log('[BRAIN] Gesture received: wave');
      } else if (gType === 'point' || gType === 'openHand' || gType === 'beat') {
        gestureRef.current = {
          type:       gType as 'point' | 'openHand' | 'beat',
          side:       (d.side ?? 'right') as 'left' | 'right' | 'both',
          startMs:    Date.now(),
          durationMs: (d.duration ?? 2) * 1000,
        };
        console.log(`[BRAIN] Gesture received: ${gType} (${d.side ?? 'right'})`);
      }
    };
    const onEmotion = (e: Event) => {
      const em = (e as CustomEvent<{ emotion?: string }>).detail?.emotion;
      if (!em) return;
      emotionRef.current = em;
      console.log(`[BRAIN] Emotion received: ${em}`);

      // Trigger micro-expression based on emotion
      const microMap: Record<string, typeof microExprTypeRef.current> = {
        curious:     'eyebrowRaise',
        thinking:    'eyebrowRaise',
        surprised:   'eyebrowRaise',
        sad:         'squint',
        concerned:   'squint',
        empathetic:  'squint',
        happy:       'halfSmile',
        friendly:    'halfSmile',
        celebration: 'halfSmile',
        excited:     'halfSmile',
        encouraging: 'halfSmile',
        proud:       'halfSmile',
        strict:      'squint',
        anxious:     'squint',
      };
      const micro = microMap[em];
      if (micro) {
        setTimeout(() => {
          microExprTypeRef.current  = micro;
          microExprUntilRef.current = Date.now() + 600;
          console.log(`[BRAIN] Micro-expression: ${micro} for ${em}`);
        }, 80 + Math.random() * 100);
      }
    };
    const onSpeakStart = () => {
      isTalkingRef.current = true;
      talkElapsedRef.current = 0;
      console.log('[BRAIN] avatar:speak:start — lip-sync active');
    };
    const onSpeakEnd   = () => {
      isTalkingRef.current = false;
      azureVisemeActive.current = false;
      azureVisemeRef.current = { aa: 0, ih: 0, ou: 0 };
      emotionRef.current = 'neutral';
      console.log('[BRAIN] avatar:speak:end — resetting to neutral');
    };
    // avatar:viseme:start — real visemes are incoming; switch from procedural
    const onVisemeStart = () => { azureVisemeActive.current = true; };
    // avatar:viseme — update target weights from real phoneme data
    const onViseme = (e: Event) => {
      const d = (e as CustomEvent<{ id?: number; weights?: { aa: number; ih: number; ou: number } }>).detail;
      if (d?.weights) {
        azureVisemeRef.current = d.weights;
      }
    };
    const onWalk  = (e: Event) => { walkUntilRef.current  = Date.now() + ((e as CustomEvent<{ duration?: number }>).detail?.duration ?? 3) * 1000; };
    const onNod   = (e: Event) => {
      const dur = ((e as CustomEvent<{ duration?: number }>).detail?.duration ?? 1.5) * 1000;
      nodStartRef.current    = Date.now();
      nodDurationRef.current = Math.max(100, dur);
      nodUntilRef.current    = Date.now() + dur;
      console.log(`[BRAIN] Head nod triggered — duration ${dur}ms`);
    };
    const onLaugh = (e: Event) => {
      laughUntilRef.current = Date.now() + ((e as CustomEvent<{ duration?: number }>).detail?.duration ?? 2) * 1000;
      emotionRef.current = 'happy';
      console.log('[BRAIN] Laugh triggered');
    };
    const onVoice = (e: Event) => { const d = (e as CustomEvent<{ rate?: number }>).detail; voiceRateRef.current = d?.rate ?? 1.0; };
    const onBlink = (e: Event) => {
      const d = (e as CustomEvent<{ style?: string; count?: number }>).detail;
      blinkPhaseRef.current = 0.001;
      nextBlinkRef.current  = 0;
      // Double blink for surprise/excited
      blinkCountRef.current = (d?.count === 2) ? 2 : 1;
    };
    const onHeadpose = (e: Event) => {
      const d = (e as CustomEvent).detail as { yaw?: number; pitch?: number; duration?: number };
      headYawRef.current   = d?.yaw   ?? 0;
      headPitchRef.current = d?.pitch ?? 0;
      headUntilRef.current = Date.now() + (d?.duration ?? 2000);
    };
    const onSit = (e: Event) => {
      const sitting = (e as CustomEvent<{ sitting?: boolean }>).detail?.sitting ?? true;
      // Simulate sit posture: lower body and tilt spine forward
      if (sitting) {
        // Apply sit pose via head pose + spin tilt events
        headPitchRef.current = -0.08;
        headUntilRef.current = Date.now() + 60_000; // hold until stand
        spineBreathRef.current = 0.18; // forward lean
        console.log('[BRAIN] Avatar sit — posture applied');
      } else {
        headPitchRef.current = 0;
        headUntilRef.current = Date.now() + 1000;
        spineBreathRef.current = 0;
        console.log('[BRAIN] Avatar stand — posture reset');
      }
    };
    // avatar:speak:text — TTS via Web Speech API; also parses sentence boundaries for nods
    const onSpeakText = (e: Event) => {
      const text = (e as CustomEvent<{ text?: string }>).detail?.text ?? '';
      if (!text) return;
      window.dispatchEvent(new CustomEvent('avatar:speak:start'));
      try {
        const u = new SpeechSynthesisUtterance(text);
        u.lang  = /[\u0600-\u06FF]/.test(text) ? 'ar-SA' : 'en-US';
        u.rate  = voiceRateRef.current;
        u.onend = () => window.dispatchEvent(new CustomEvent('avatar:speak:end'));
        window.speechSynthesis?.speak(u);
      } catch {
        setTimeout(() => window.dispatchEvent(new CustomEvent('avatar:speak:end')), 3000);
      }
      // Sentence boundary nods: count sentences and schedule nods
      const sentences = text.split(/[.!?؟،\n]+/).filter(s => s.trim().length > 3);
      const nodDelay  = Math.max(600, (text.length / 20) * 100); // rough timing
      sentences.slice(1).forEach((_, idx) => {
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('avatar:nod', { detail: { duration: 1.2 } }));
          console.log(`[BRAIN] Sentence-boundary nod ${idx + 1}`);
        }, nodDelay * (idx + 1));
      });
    };

    window.addEventListener('avatar:gesture',       onGesture);
    window.addEventListener('avatar:emotion',       onEmotion);
    window.addEventListener('avatar:speak:start',   onSpeakStart);
    window.addEventListener('avatar:speak:end',     onSpeakEnd);
    window.addEventListener('avatar:stopSpeaking',  onSpeakEnd);
    window.addEventListener('avatar:viseme:start',  onVisemeStart);
    window.addEventListener('avatar:viseme',        onViseme);
    window.addEventListener('avatar:walk',          onWalk);
    window.addEventListener('avatar:nod',           onNod);
    window.addEventListener('avatar:laugh',         onLaugh);
    window.addEventListener('avatar:voice',         onVoice);
    window.addEventListener('avatar:blink',         onBlink);
    window.addEventListener('avatar:headpose',      onHeadpose);
    window.addEventListener('avatar:sit',           onSit);
    window.addEventListener('avatar:stand',         (e) => onSit(new CustomEvent('avatar:sit', { detail: { sitting: false } })));
    window.addEventListener('avatar:speak:text',    onSpeakText);

    return () => {
      window.removeEventListener('avatar:gesture',      onGesture);
      window.removeEventListener('avatar:emotion',      onEmotion);
      window.removeEventListener('avatar:speak:start',  onSpeakStart);
      window.removeEventListener('avatar:speak:end',    onSpeakEnd);
      window.removeEventListener('avatar:stopSpeaking', onSpeakEnd);
      window.removeEventListener('avatar:viseme:start', onVisemeStart);
      window.removeEventListener('avatar:viseme',       onViseme);
      window.removeEventListener('avatar:walk',         onWalk);
      window.removeEventListener('avatar:nod',          onNod);
      window.removeEventListener('avatar:laugh',        onLaugh);
      window.removeEventListener('avatar:voice',        onVoice);
      window.removeEventListener('avatar:blink',        onBlink);
      window.removeEventListener('avatar:headpose',     onHeadpose);
      window.removeEventListener('avatar:sit',          onSit);
      window.removeEventListener('avatar:speak:text',   onSpeakText);
    };
  }, []);

  // ── Render loop ──────────────────────────────────────────────────────────
  const { pointer, camera } = useThree();

  useFrame((state, delta) => {
    const v     = vrmRef.current;
    const group = groupRef.current;
    if (!group) return;

    const t   = state.clock.elapsedTime;
    const now = Date.now();

    // 1. Breathing + walk bounce + laugh shake + idle body sway
    const idleBodyTarget = perlinNoise(t * 0.1, 0, 0) * 0.02 - 0.01;
    idleBodyOffsetRef.current = lerp(idleBodyOffsetRef.current, idleBodyTarget, 0.05);

    const breatheVal    = Math.sin(t * 0.9) * BREATHE_AMP;
    const isWalkingNow  = now < walkUntilRef.current;
    const isLaughingNow = now < laughUntilRef.current;
    const walkBounce = isWalkingNow  ? Math.abs(Math.sin(t * 5.5)) * 0.055 : 0;
    const laughShake = isLaughingNow ? Math.sin(t * 14) * 0.02 : 0;
    group.position.set(
      isWalkingNow ? Math.sin(t * 5.5) * 0.02 : (isLaughingNow ? Math.sin(t * 13) * 0.015 : 0),
      AVATAR_BASE_Y + walkBounce + laughShake + idleBodyOffsetRef.current,
      0.2,
    );

    if (!v) return;

    // 2. Blink — smooth phase, double-blink support
    const em = v.expressionManager;
    if (em) {
      if (blinkPhaseRef.current > 0) {
        blinkPhaseRef.current += delta * 12;
        const bv = blinkPhaseRef.current < Math.PI ? Math.sin(blinkPhaseRef.current) : 0;
        try { em.setValue('blink' as never, Math.min(1, bv)); } catch {
          try { em.setValue('blinkLeft' as never, Math.min(1, bv)); em.setValue('blinkRight' as never, Math.min(1, bv)); } catch {}
        }
        if (blinkPhaseRef.current > Math.PI * 2) {
          blinkPhaseRef.current = 0;
          try { em.setValue('blink' as never, 0); } catch {
            try { em.setValue('blinkLeft' as never, 0); em.setValue('blinkRight' as never, 0); } catch {}
          }
          // Double blink: schedule immediate second blink
          if (blinkCountRef.current > 1) {
            blinkCountRef.current--;
            nextBlinkRef.current = now + 120;
          } else {
            blinkCountRef.current = 1;
            nextBlinkRef.current = now + (BLINK_MIN + Math.random() * (BLINK_MAX - BLINK_MIN)) * 1000;
          }
        }
      } else if (now >= nextBlinkRef.current) {
        blinkPhaseRef.current = 0.001;
      }

      // 3. Lip-sync: real visemes (Phase 2) or procedural fallback
      if (isTalkingRef.current) {
        talkElapsedRef.current += delta;
        const lw = lipWeightsRef.current;
        if (azureVisemeActive.current) {
          // ── Real phoneme-driven lip sync (edge-tts word-boundary timing) ──
          const { aa, ih, ou } = azureVisemeRef.current;
          const spd = delta * 18; // fast blend for tight sync
          lw.aa = lerp(lw.aa, aa, spd);
          lw.ih = lerp(lw.ih, ih, spd);
          lw.ou = lerp(lw.ou, ou, spd);
          try { em.setValue('aa' as never, lw.aa); } catch {}
          try { em.setValue('ih' as never, lw.ih); } catch {}
          try { em.setValue('ou' as never, lw.ou); } catch {}
          try { em.setValue('oh' as never, 0); } catch {}
        } else {
          // ── Procedural fallback: sine-wave when no real timing available ──
          const fastJaw = 0.5 * Math.sin(talkElapsedRef.current * 9.1);
          const slowJaw = 0.2 * Math.sin(talkElapsedRef.current * 3.7);
          const jaw = Math.max(0, Math.min(1, 0.35 + fastJaw + slowJaw));
          lw.aa = jaw; lw.ih = 0; lw.ou = 0;
          try { em.setValue('aa' as never, jaw); } catch {}
          const oh = Math.max(0, Math.min(0.4, 0.15 * Math.sin(talkElapsedRef.current * 5.3 + 1)));
          try { em.setValue('oh' as never, oh); } catch {}
        }
      } else {
        // Mouth closed: decay all lip shapes to zero using tracked weights
        const lw = lipWeightsRef.current;
        const spd = delta * 10;
        lw.aa = lerp(lw.aa, 0, spd);
        lw.ih = lerp(lw.ih, 0, spd);
        lw.ou = lerp(lw.ou, 0, spd);
        try { em.setValue('aa' as never, lw.aa); } catch {}
        try { em.setValue('ih' as never, lw.ih); } catch {}
        try { em.setValue('ou' as never, lw.ou); } catch {}
        try { em.setValue('oh' as never, 0); } catch {}
      }

      // 4. Emotion blendshapes — smooth lerp between states
      const emo = emotionRef.current;
      const isNodding  = now < nodUntilRef.current;
      const isLaughing = now < laughUntilRef.current;

      // Target values for each expression
      const positive = emo === 'friendly' || emo === 'happy' || emo === 'celebration'
        || emo === 'excited' || emo === 'encouraging' || emo === 'proud'
        || emo === 'empathetic' || isLaughing;
      const targets: Record<string, number> = {
        happy:     positive ? (emo === 'celebration' || isLaughing ? 1.0 : emo === 'excited' || emo === 'proud' ? 0.9 : emo === 'empathetic' ? 0.55 : 0.7) : 0,
        sad:       (emo === 'sad' || emo === 'concerned') ? (emo === 'concerned' ? 0.4 : 0.6) : 0,
        angry:     (emo === 'angry' || emo === 'strict') ? (emo === 'strict' ? 0.25 : 0.5) : 0,
        relaxed:   (emo === 'neutral' || emo === 'relax' || emo === 'thinking'
                    || emo === 'calm' || emo === 'curious' || emo === 'empathetic')
                    ? (emo === 'relax' ? 0.6 : emo === 'calm' ? 0.25 : emo === 'empathetic' ? 0.35 : 0.3) : 0,
        surprised: (emo === 'surprised' || emo === 'anxious') ? (emo === 'anxious' ? 0.35 : 0.7) : 0,
      };

      // Smooth blend with per-emotion speed
      const blendSpeeds: Record<string, number> = {
        excited: 7, surprised: 8, sad: 1.5, calm: 2, relax: 2, empathetic: 3, default: 4,
      };
      const blendSpeed = blendSpeeds[emo] ?? blendSpeeds.default;

      Object.entries(targets).forEach(([key, target]) => {
        const current = emotionBlendRef.current[key] ?? 0;
        const next    = lerp(current, target, delta * blendSpeed);
        emotionBlendRef.current[key] = next;
        try { em.setValue(key as never, next); } catch {}
      });

      // Micro-expressions overlay
      if (now < microExprUntilRef.current) {
        const mProgress = 1 - (microExprUntilRef.current - now) / 600;
        const mIntensity = Math.sin(mProgress * Math.PI) * 0.5;
        const mType = microExprTypeRef.current;
        if (mType === 'eyebrowRaise') {
          try { em.setValue('lookUp' as never, mIntensity * 0.3); } catch {}
          try { em.setValue('surprised' as never, (emotionBlendRef.current['surprised'] ?? 0) + mIntensity * 0.3); } catch {}
        } else if (mType === 'squint') {
          // Subtle squint via angry blend
          try { em.setValue('angry' as never, (emotionBlendRef.current['angry'] ?? 0) + mIntensity * 0.15); } catch {}
        } else if (mType === 'halfSmile') {
          try { em.setValue('happy' as never, (emotionBlendRef.current['happy'] ?? 0) + mIntensity * 0.2); } catch {}
        }
      } else if (microExprTypeRef.current !== 'none') {
        microExprTypeRef.current = 'none';
        try { em.setValue('lookUp' as never, 0); } catch {}
      }

      // Head nod — single smooth arch on spine + neck
      if (v.humanoid) {
        const nodArc    = isNodding ? Math.sin(Math.min(1, (now - nodStartRef.current) / nodDurationRef.current) * Math.PI) : 0;
        // Spine breathing — actual rotation (chest rise, not just position)
        const spineBreathTarget = Math.sin(t * 0.9) * 0.025;
        spineBreathRef.current  = lerp(spineBreathRef.current, spineBreathTarget, delta * 2);
        const spineBone = v.humanoid.getRawBoneNode('spine' as never);
        const neckBone  = v.humanoid.getRawBoneNode('neck'  as never);
        if (spineBone) spineBone.rotation.x = spineBreathRef.current + nodArc * 0.14;
        if (neckBone)  neckBone.rotation.x  = nodArc * 0.18;
      }

      em.update();
    }

    // 5. LookAt
    const lookAt = (v as { lookAt?: { autoUpdate?: boolean; lookAt?: (p: THREE.Vector3) => void } }).lookAt;
    if (lookAt?.lookAt) {
      lookAt.autoUpdate = false;
      const target = new THREE.Vector3(pointer.x, pointer.y, 0.4).unproject(camera);
      lookAt.lookAt(target);
    }

    // 6. VRM internals update
    v.update(delta);

    // 7. Head-pose lerp — driven by avatar:headpose events from AgentDirector
    if (v.humanoid) {
      const headBone = v.humanoid.getRawBoneNode('head' as never);
      if (headBone) {
        const active      = headUntilRef.current > now;
        const idleHeadYawTarget   = perlinNoise(t * 0.3, 1, 0) * 0.04 - 0.02;
        const idleHeadPitchTarget = perlinNoise(t * 0.3, 2, 0) * 0.03 - 0.015;
        idleHeadOffsetRef.current = lerp(idleHeadOffsetRef.current, idleHeadYawTarget, 0.03);

        const targetYaw   = active ? headYawRef.current   : idleHeadOffsetRef.current;
        const targetPitch = active ? headPitchRef.current : idleHeadPitchTarget;

        headBone.rotation.y = lerp(headBone.rotation.y, targetYaw,   0.07);
        headBone.rotation.x = lerp(headBone.rotation.x, targetPitch, 0.07);
      }
    }

    // 8. Arm pose — wave / extended gesture / idle sway
    const humanoid = v.humanoid;
    if (humanoid) {
      const isWaving   = now < waveUntilRef.current;
      const gs         = gestureRef.current;
      if (gs && now > gs.startMs + gs.durationMs) gestureRef.current = null;
      const hasGesture = !!gestureRef.current;

      if (isWaving && !hasGesture) {
        const waveProgress = (now - (waveUntilRef.current - WAVE_DURATION * 1000)) / (WAVE_DURATION * 1000);
        const waveEase = Easing.easeInOutSine(Math.min(1, waveProgress));
        const waveAng = Math.sin(t * 6) * 1.0 * waveEase;
        const rua = humanoid.getRawBoneNode('rightUpperArm' as never);
        const rla = humanoid.getRawBoneNode('rightLowerArm' as never);
        if (rua) rua.rotation.set(-0.9,  0.2, waveAng,       'XYZ');
        if (rla) rla.rotation.set(-0.7,  0,   waveAng * 1.2, 'XYZ');
        const lua = humanoid.getRawBoneNode('leftUpperArm' as never);
        const lla = humanoid.getRawBoneNode('leftLowerArm' as never);
        // Left arm hangs naturally at side during wave (not T-pose)
        if (lua) lua.rotation.set(0, 0,  1.3, 'XYZ');
        if (lla) lla.rotation.set(0.06, 0, 0, 'XYZ');

      } else if (hasGesture && gestureRef.current) {
        const progress = Math.min(1, (now - gestureRef.current.startMs) / gestureRef.current.durationMs);
        const curve    = Easing.easeOutQuad(progress);
        const gType    = gestureRef.current.type;
        const gSide    = gestureRef.current.side;

        const applyArm = (prefix: 'left' | 'right') => {
          const dir = prefix === 'right' ? 1 : -1;
          const ua  = humanoid.getRawBoneNode(`${prefix}UpperArm` as never);
          const la  = humanoid.getRawBoneNode(`${prefix}LowerArm` as never);
          const ha  = humanoid.getRawBoneNode(`${prefix}Hand`     as never);
          if (gType === 'point') {
            if (ua) ua.rotation.set(-0.55 * curve,          0, dir *  0.1 * curve, 'YXZ');
            if (la) la.rotation.set(-0.35 * curve,          0, 0,                  'YXZ');
            if (ha) ha.rotation.set(0, 0, 0, 'YXZ');
          } else if (gType === 'openHand') {
            if (ua) ua.rotation.set(-0.45 * curve, dir * 0.15 * curve, dir * 0.08 * curve, 'YXZ');
            if (la) la.rotation.set(-0.25 * curve,          0, 0,                          'YXZ');
            if (ha) ha.rotation.set(0, dir * 0.25 * curve,  0,                             'YXZ');
          } else if (gType === 'beat') {
            const beat = Math.sin(progress * Math.PI * 5) * 0.28 * curve;
            if (ua) ua.rotation.set(-(curve * 0.35 + beat * 0.5), 0, dir * 0.12, 'YXZ');
            if (la) la.rotation.set(-0.2 + beat,                  0, 0,          'YXZ');
            if (ha) ha.rotation.set(0,                            0, beat * 0.6, 'YXZ');
          }
        };

        if (gSide === 'right' || gSide === 'both') applyArm('right');
        if (gSide === 'left'  || gSide === 'both') applyArm('left');

      } else if (isWalkingNow) {
        // ── Real walk cycle: arms swing + legs swing + knee bend ──
        const swing = Math.sin(t * 5.5);  // -1..1
        const rua   = humanoid.getRawBoneNode('rightUpperArm' as never);
        const lua   = humanoid.getRawBoneNode('leftUpperArm'  as never);
        const rla   = humanoid.getRawBoneNode('rightLowerArm' as never);
        const lla   = humanoid.getRawBoneNode('leftLowerArm'  as never);
        // Arms swing forward/back with Z base offset so they hang, not T-pose
        if (rua) rua.rotation.set(-swing * 0.45, 0, -1.1, 'XYZ');
        if (lua) lua.rotation.set( swing * 0.45, 0,  1.1, 'XYZ');
        // Elbow bends slightly when arm swings forward
        if (rla) rla.rotation.set(Math.max(0, -swing * 0.35), 0, 0, 'XYZ');
        if (lla) lla.rotation.set(Math.max(0,  swing * 0.35), 0, 0, 'XYZ');
        // ── Leg swing (opposite phase to same-side arm) ──
        const rul = humanoid.getRawBoneNode('rightUpperLeg' as never);
        const lul = humanoid.getRawBoneNode('leftUpperLeg'  as never);
        const rll = humanoid.getRawBoneNode('rightLowerLeg' as never);
        const lll = humanoid.getRawBoneNode('leftLowerLeg'  as never);
        // Right arm forward (swing<0) → right leg back (swing>0) and vice versa
        if (rul) rul.rotation.set( swing * 0.45, 0, 0, 'XYZ');
        if (lul) lul.rotation.set(-swing * 0.45, 0, 0, 'XYZ');
        // Knee bends when leg is behind the body
        if (rll) rll.rotation.set(swing > 0 ? swing * 0.38 : 0, 0, 0, 'XYZ');
        if (lll) lll.rotation.set(swing < 0 ? -swing * 0.38 : 0, 0, 0, 'XYZ');

      } else if (isLaughingNow) {
        const shoulBounce = Math.sin(t * 14) * 0.15;
        const rua = humanoid.getRawBoneNode('rightUpperArm' as never);
        const lua = humanoid.getRawBoneNode('leftUpperArm'  as never);
        const rla = humanoid.getRawBoneNode('rightLowerArm' as never);
        const lla = humanoid.getRawBoneNode('leftLowerArm'  as never);
        // Keep arms at natural down position during laugh, just bounce shoulders
        if (rua) rua.rotation.set( shoulBounce, 0, -1.3, 'XYZ');
        if (lua) lua.rotation.set(-shoulBounce, 0,  1.3, 'XYZ');
        if (rla) rla.rotation.set(0.08, 0, 0, 'XYZ');
        if (lla) lla.rotation.set(0.08, 0, 0, 'XYZ');
        // Reset legs to neutral when not walking
        const rul = humanoid.getRawBoneNode('rightUpperLeg' as never);
        const lul = humanoid.getRawBoneNode('leftUpperLeg' as never);
        const rll = humanoid.getRawBoneNode('rightLowerLeg' as never);
        const lll = humanoid.getRawBoneNode('leftLowerLeg' as never);
        if (rul) rul.rotation.set(0, 0, 0, 'XYZ');
        if (lul) lul.rotation.set(0, 0, 0, 'XYZ');
        if (rll) rll.rotation.set(0, 0, 0, 'XYZ');
        if (lll) lll.rotation.set(0, 0, 0, 'XYZ');

      } else {
        // ── Natural idle: arms hang at sides, NOT T-pose ──
        // Z rotation brings arms from horizontal (T-pose=0) to natural downward hang
        // -1.3 rad ≈ 74° below T-pose horizontal for right arm
        //  1.3 rad ≈ 74° below T-pose horizontal for left arm
        const sway    = Math.sin(t * 0.4) * 0.06;   // subtle forward/back micro-sway
        const breathZ = spineBreathRef.current * 0.15; // breathing slightly opens arms
        const rua  = humanoid.getRawBoneNode('rightUpperArm' as never);
        const lua  = humanoid.getRawBoneNode('leftUpperArm'  as never);
        const rla  = humanoid.getRawBoneNode('rightLowerArm' as never);
        const lla  = humanoid.getRawBoneNode('leftLowerArm'  as never);
        if (rua) rua.rotation.set( sway, 0, -1.3 + breathZ, 'XYZ');
        if (lua) lua.rotation.set(-sway, 0,  1.3 - breathZ, 'XYZ');
        // Slight elbow micro-bend (more natural than perfectly straight arms)
        if (rla) rla.rotation.set(0.07, 0, 0, 'XYZ');
        if (lla) lla.rotation.set(0.07, 0, 0, 'XYZ');
        // Ensure legs stay neutral in idle
        const rul = humanoid.getRawBoneNode('rightUpperLeg' as never);
        const lul = humanoid.getRawBoneNode('leftUpperLeg'  as never);
        const rll = humanoid.getRawBoneNode('rightLowerLeg' as never);
        const lll = humanoid.getRawBoneNode('leftLowerLeg'  as never);
        if (rul) rul.rotation.set(0, 0, 0, 'XYZ');
        if (lul) lul.rotation.set(0, 0, 0, 'XYZ');
        if (rll) rll.rotation.set(0, 0, 0, 'XYZ');
        if (lll) lll.rotation.set(0, 0, 0, 'XYZ');
      }
    }
  });

  return (
    <group ref={groupRef} rotation={[0, Math.PI, 0]}>
      {vrm && <primitive object={vrm.scene} />}
    </group>
  );
}

// ── ZoomController — lives inside <Canvas> ──────────────────────────────────
function ZoomController() {
  const { camera, gl } = useThree();
  const zRef = useRef((camera as THREE.PerspectiveCamera).position.z);

  useEffect(() => {
    const canvas = gl.domElement;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zRef.current = Math.min(5.5, Math.max(1.2, zRef.current + e.deltaY * 0.018));
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [gl]);

  useFrame(() => {
    const cam = camera as THREE.PerspectiveCamera;
    cam.position.z += (zRef.current - cam.position.z) * 0.12;
  });

  return null;
}

// ── Status dot ───────────────────────────────────────────────────────────────
function StatusDot({ connected, processing }: { connected: boolean; processing: boolean }) {
  const color = !connected
    ? 'bg-red-500'
    : processing
    ? 'bg-yellow-400 animate-pulse'
    : 'bg-emerald-400';
  const label = !connected ? 'غير متصل' : processing ? 'يفكر...' : 'جاهز';
  return (
    <div className="flex items-center gap-2">
      <span className={`inline-block w-2.5 h-2.5 rounded-full ${color}`} />
      <span className="text-xs text-gray-400">{label}</span>
    </div>
  );
}

// ── Main component (pure VRM renderer — no WS hook, no HUD) ─────────────────
// HUD and WS state management live in AvatarAgentClient.tsx.
// This component only renders the R3F canvas and reacts to window avatar:* events.

export default function AvatarCanvas({
  vrmUrl = '/models/teach.vrm',
}: {
  vrmUrl?: string;
}) {
  const [loaded,    setLoaded]    = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const handleLoad  = useCallback(() => setLoaded(true), []);
  const handleError = useCallback((err: string) => setLoadError(err), []);

  // Dev-only console debug API (fires window events — no WS required)
  useEffect(() => {
    if (typeof window === 'undefined' || process.env.NODE_ENV !== 'development') return;
    const w = window as typeof window & { __avatarDebug?: unknown };
    w.__avatarDebug = {
      testEmotion:  (emotion = 'happy') =>
        window.dispatchEvent(new CustomEvent('avatar:emotion',  { detail: { emotion } })),
      testGesture:  (type = 'wave', side = 'right', duration = 2.5) =>
        window.dispatchEvent(new CustomEvent('avatar:gesture',  { detail: { type, side, duration } })),
      testNod:      () =>
        window.dispatchEvent(new CustomEvent('avatar:nod',      { detail: { duration: 1.5 } })),
      testLaugh:    () =>
        window.dispatchEvent(new CustomEvent('avatar:laugh',    { detail: { duration: 2 } })),
      testBlink:    () =>
        window.dispatchEvent(new CustomEvent('avatar:blink')),
      testHeadpose: (yaw = 0.15, pitch = 0, duration = 3000) =>
        window.dispatchEvent(new CustomEvent('avatar:headpose', { detail: { yaw, pitch, duration } })),
      testWalk:     (duration = 5) =>
        window.dispatchEvent(new CustomEvent('avatar:walk',    { detail: { duration } })),
      testSpeak:    (text = 'مرحباً بك في نظام التعلم التفاعلي') =>
        window.dispatchEvent(new CustomEvent('avatar:speak:text', { detail: { text } })),
    };
    return () => { delete w.__avatarDebug; };
  }, []);

  return (
    <div className="relative w-full h-full bg-[#0a0a12]">
      {!loaded && !loadError && (
        <div className={styles.loadingOverlay}>جاري تحميل الدكتور حمزة…</div>
      )}
      {loadError && (
        <div className={styles.errorOverlay}>⚠️ تعذّر تحميل الأفاتار</div>
      )}
      <Canvas
        dpr={[1, 2]}
        shadows={false}
        camera={{ position: [0, 0.6, 3.2], fov: 50, near: 0.01, far: 100 }}
        gl={{ antialias: true, alpha: false }}
        onCreated={({ gl }) => {
          gl.setClearColor(0x202533, 1);
          gl.outputColorSpace = THREE.SRGBColorSpace;
          gl.toneMapping = THREE.ACESFilmicToneMapping;
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

        <ZoomController />
      </Canvas>
    </div>
  );
}
