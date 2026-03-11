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
import { OrbitControls } from '@react-three/drei';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRM, VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { VRMAnimationLoaderPlugin, createVRMAnimationClip } from '@pixiv/three-vrm-animation';
import type { VRMAnimation } from '@pixiv/three-vrm-animation';
import styles from './AvatarCanvas.module.css';
import { perlinNoise, Easing, lerp } from './utils';
import { RoomShell, ROOM_BOUNDS } from './scene/RoomShell';
import { LightingRig }       from './scene/LightingRig';
import { OfficeSetLoader }   from './scene/OfficeSetLoader';
import { resolveIfEnabled }  from './physics/WorldColliders';
import { OfficeDebugHUD }    from './debug/OfficeDebugHUD';

// ── Constants ────────────────────────────────────────────────────────────────
const AVATAR_BASE_Y = -1.0;   // matches ROOM_BOUNDS.floorY — avatar feet on GLB floor
const BREATHE_AMP   = 0.06;
const BLINK_MIN     = 2.2;   // seconds
const BLINK_MAX     = 4.5;
const WAVE_DURATION = 3.5;   // seconds — greeting wave on load

// ── VRMA animation file map ───────────────────────────────────────────────────
const VRMA_IDLE  = ['Idle1', 'Idle2', 'Idle3', 'Idle4'].map(n => `/models/animations/${n}.vrma`);
const VRMA_PATHS: Record<string, string> = {
  sit:     '/models/animations/sitting.vrma',
  sitTalk: '/models/animations/SittingTalking.vrma',
  wave:    '/models/animations/Waving.vrma',
  think:   '/models/animations/Thinking.vrma',
  type:    '/models/animations/Typing.vrma',
  cheer:   '/models/animations/Standing%20Cheering.vrma',
  clap:    '/models/animations/Clapping.vrma',
  sad:     '/models/animations/Sad.vrma',
  angry:   '/models/animations/Angry.vrma',
  surprise:'/models/animations/Surprised.vrma',
  relax:   '/models/animations/Relax.vrma',
  goodbye: '/models/animations/Goodbye.vrma',
  beckon:  '/models/animations/Beckoning.vrma',
  point:   '/models/animations/Pointing.vrma',
  ack:     '/models/animations/Acknowledging.vrma',
  agree:   '/models/animations/Agreeing.vrma',
  blush:   '/models/animations/Blush.vrma',
  look:    '/models/animations/LookAround.vrma',
  look2:   '/models/animations/LookAround2.vrma',
  sleepy:      '/models/animations/Sleepy.vrma',
  jump:        '/models/animations/Jump.vrma',
  jumpHigh:    '/models/animations/JumpHigh.vrma',
  sitPoint:    '/models/animations/Sitting%20and%20pointing.vrma',
  sitDisappr:  '/models/animations/Sitting%20Disapproval.vrma',
  sitTalk2:    '/models/animations/Sitting%20%20and%20talking.vrma',
  pace:        '/models/animations/Pacing%20And%20Talking%20On%20A%20Phone.vrma',
  untitled:    '/models/animations/Untitled.vrma',
};

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
  // Sitting state
  const isSittingRef      = useRef(false);

  // ── VRMA animation system ────────────────────────────────────────────────
  const mixerRef      = useRef<THREE.AnimationMixer | null>(null);
  const vrmaActions   = useRef<Map<string, THREE.AnimationAction>>(new Map());
  const activeVrmaRef = useRef<string>('');
  const vrmaReadyRef  = useRef(false);
  const idleIdxRef    = useRef(0);
  const idleNextRef   = useRef(0);
  const wasWalkingRef = useRef(false);

  const playVRMA = useCallback((name: string, loop = true, fadeTime = 0.4) => {
    const mixer   = mixerRef.current;
    const actions = vrmaActions.current;
    if (!mixer || !actions.has(name) || activeVrmaRef.current === name) return;
    const prev = activeVrmaRef.current ? actions.get(activeVrmaRef.current) : null;
    if (prev) prev.fadeOut(fadeTime);
    const action = actions.get(name)!;
    action.reset();
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    action.clampWhenFinished = !loop;
    action.fadeIn(fadeTime);
    action.play();
    activeVrmaRef.current = name;
    console.log(`[VRMA] ▶ ${name} (loop=${loop})`);
  }, []);

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
          if ((o as THREE.Mesh).isMesh) {
            const mesh = o as THREE.Mesh;
            mesh.visible = true;
            mesh.renderOrder = 0;
            // Ensure materials are visible with correct settings
            const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            mats.forEach((m: THREE.Material) => {
              m.depthWrite = true;
              m.depthTest  = true;
              m.visible    = true;
              m.side       = THREE.DoubleSide;
              m.needsUpdate = true;
            });
            meshCount++;
          }
        });
        console.log(`%c[AvatarCanvas] ✅ VRM loaded — ${meshCount} meshes`, 'color:lime;font-weight:bold');

        // Greeting wave on load
        waveUntilRef.current = Date.now() + WAVE_DURATION * 1000;

        // Position/scale/rotation are controlled by the <group> wrapper in JSX
        // and updated every frame by useFrame — do NOT set them on vrm.scene here.
        // VRM 0.0 faces +Z by default (toward camera); no rotation flip needed.

        vrmRef.current = model;
        setVrm(model);   // triggers re-render → <primitive> appears
        onLoad();

        // ── VRMA animation system setup ────────────────────────────────────
        const mixer = new THREE.AnimationMixer(model.scene);
        mixerRef.current = mixer;
        // Load all VRMA files in background (non-blocking)
        const vrmaLoader = new GLTFLoader();
        vrmaLoader.register((p: unknown) => new VRMAnimationLoaderPlugin(p as never));
        const allAnims: [string, string][] = [
          ...VRMA_IDLE.map((url, i) => [`idle${i}`, url] as [string, string]),
          ...Object.entries(VRMA_PATHS),
        ];
        Promise.allSettled(
          allAnims.map(([key, url]) =>
            new Promise<void>((resolve) => {
              vrmaLoader.load(url, (gltf) => {
                const anims: VRMAnimation[] = gltf.userData.vrmAnimations ?? [];
                if (anims[0]) {
                  const clip   = createVRMAnimationClip(anims[0], model);
                  const action = mixer.clipAction(clip);
                  vrmaActions.current.set(key, action);
                  console.log(`[VRMA] ✅ ${key}`);
                }
                resolve();
              }, undefined, () => resolve());
            })
          )
        ).then(() => {
          vrmaReadyRef.current = true;
          idleNextRef.current  = Date.now() + 15000;
          playVRMA('idle0', true, 0.8);
          console.log('[VRMA] 🎬 Animation system ready');
        }).catch(() => {});
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

      const dur = (d.duration ?? 2.5) * 1000;
      if (gType === 'wave') {
        if (vrmaReadyRef.current) {
          playVRMA('wave', false, 0.3);
          setTimeout(() => {
            if (!isSittingRef.current) playVRMA(`idle${idleIdxRef.current}`, true, 0.45);
          }, dur + 400);
        } else {
          waveUntilRef.current = Date.now() + dur;
        }
        console.log('[BRAIN] Gesture received: wave');
      } else if (gType === 'point' || gType === 'openHand' || gType === 'beat') {
        if (vrmaReadyRef.current) {
          const vrmaGesture: Record<string, string> = { point: 'point', openHand: 'beckon', beat: 'ack' };
          playVRMA(vrmaGesture[gType] ?? 'ack', false, 0.3);
          setTimeout(() => {
            if (!isSittingRef.current) playVRMA(`idle${idleIdxRef.current}`, true, 0.45);
          }, dur + 400);
        } else {
          gestureRef.current = {
            type:       gType as 'point' | 'openHand' | 'beat',
            side:       (d.side ?? 'right') as 'left' | 'right' | 'both',
            startMs:    Date.now(),
            durationMs: dur,
          };
        }
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
      // VRMA body animation for strong emotions
      if (vrmaReadyRef.current) {
        const emotionAnim: Record<string, { name: string; loop: boolean; dur: number }> = {
          sad:         { name: 'sad',      loop: false, dur: 5000 },
          angry:       { name: 'angry',    loop: false, dur: 4000 },
          surprised:   { name: 'surprise', loop: false, dur: 3000 },
          relax:       { name: 'relax',    loop: true,  dur: 0    },
          thinking:    { name: 'think',    loop: true,  dur: 0    },
          celebration: { name: 'cheer',    loop: false, dur: 5000 },
          excited:     { name: 'clap',     loop: false, dur: 4000 },
          sleepy:      { name: 'sleepy',   loop: true,  dur: 0    },
        };
        const anim = emotionAnim[em];
        if (anim) {
          playVRMA(anim.name, anim.loop, 0.4);
          if (!anim.loop)
            setTimeout(() => { if (!isSittingRef.current) playVRMA(`idle${idleIdxRef.current}`, true, 0.5); }, anim.dur);
        }
      }
    };
    const onSpeakStart = () => {
      isTalkingRef.current   = true;
      talkElapsedRef.current = 0;
      if (isSittingRef.current && vrmaReadyRef.current) playVRMA('sitTalk', true, 0.3);
      console.log('[BRAIN] avatar:speak:start — lip-sync active');
    };
    const onSpeakEnd   = () => {
      isTalkingRef.current = false;
      azureVisemeActive.current = false;
      azureVisemeRef.current = { aa: 0, ih: 0, ou: 0 };
      emotionRef.current = 'neutral';
      if (isSittingRef.current && vrmaReadyRef.current) playVRMA('sit', true, 0.4);
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
      isSittingRef.current = sitting;
      if (sitting) {
        headPitchRef.current  = -0.05;
        headUntilRef.current  = Date.now() + 60_000;
        spineBreathRef.current = 0.10;
        playVRMA('sit', true, 0.5);
        console.log('[BRAIN] Avatar sit → playing sitting.vrma');
      } else {
        headPitchRef.current  = 0;
        headUntilRef.current  = Date.now() + 1000;
        spineBreathRef.current = 0;
        playVRMA(`idle${idleIdxRef.current}`, true, 0.5);
        console.log('[BRAIN] Avatar stand → returning to idle');
      }
    };
    // avatar:play — play any clip by key from VRMA_PATHS
    const onPlay = (e: Event) => {
      const clip = (e as CustomEvent<{ clip?: string }>).detail?.clip ?? '';
      if (clip && VRMA_PATHS[clip]) {
        playVRMA(clip, false, 0.4);
        console.log(`[BRAIN] avatar:play → ${clip}`);
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
    window.addEventListener('avatar:play',          onPlay);

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
      window.removeEventListener('avatar:play',         onPlay);
    };
  }, []);

  // ── Click-to-move state (2D: X + Z) ────────────────────────────────────
  const targetAvatarXRef  = useRef(0);
  const currentAvatarXRef = useRef(0);
  const targetAvatarZRef  = useRef(-2.0);   // in front of desk
  const currentAvatarZRef = useRef(-2.0);

  // ── Render loop ──────────────────────────────────────────────────────────
  const { pointer, camera, gl } = useThree();

  // Click listener — maps screen click to world (X, Z) floor position
  useEffect(() => {
    const raycaster = new THREE.Raycaster();
    // Horizontal floor plane at y = -1.0 (AVATAR_BASE_Y)
    const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 1.0);
    const handleClick = (e: MouseEvent) => {
      if (e.button !== 2) return; // right click only
      e.preventDefault();
      const rect = gl.domElement.getBoundingClientRect();
      const ndcX = ((e.clientX - rect.left) / rect.width)  * 2 - 1;
      const ndcY = -((e.clientY - rect.top)  / rect.height) * 2 + 1;
      raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
      const hit = new THREE.Vector3();
      if (!raycaster.ray.intersectPlane(floorPlane, hit)) return;
      // Clamp click target inside room bounds
      targetAvatarXRef.current = Math.max(ROOM_BOUNDS.minX + 0.3, Math.min(ROOM_BOUNDS.maxX - 0.3, hit.x));
      targetAvatarZRef.current = Math.max(ROOM_BOUNDS.minZ + 0.3, Math.min(ROOM_BOUNDS.maxZ - 0.3, hit.z));
      // Walk duration based on 2D distance
      const dist = Math.hypot(
        hit.x - currentAvatarXRef.current,
        hit.z - currentAvatarZRef.current,
      );
      const walkSec = Math.max(0.5, dist * 1.6);
      walkUntilRef.current = Date.now() + walkSec * 1000;
    };
    const suppressContextMenu = (e: Event) => e.preventDefault();
    gl.domElement.addEventListener('mousedown', handleClick);
    gl.domElement.addEventListener('contextmenu', suppressContextMenu);
    return () => {
      gl.domElement.removeEventListener('mousedown', handleClick);
      gl.domElement.removeEventListener('contextmenu', suppressContextMenu);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, camera]);

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
    // Click-to-move: lerp current (X, Z) toward target
    const lerpSpeed = isWalkingNow ? delta * 2.5 : delta * 6;
    currentAvatarXRef.current = lerp(currentAvatarXRef.current, targetAvatarXRef.current, lerpSpeed);
    currentAvatarZRef.current = lerp(currentAvatarZRef.current, targetAvatarZRef.current, lerpSpeed);
    const avatarX = currentAvatarXRef.current + (isLaughingNow ? Math.sin(t * 13) * 0.015 : 0);

    // 2D movement: avatar walks in X and Z freely around the desk
    const isSittingNow = isSittingRef.current;
    // When sitting, snap avatar to chair position (behind desk) and lower hips to seat height
    const CHAIR_Z = -3.0;   // chair behind the main desk (world Z)
    const CHAIR_X = 0.0;
    // Seat world Y: floor(-1.0) + seat(0.46) * scale(1.5) = -0.31 → hips at seat, avatar group (feet) = seat - hipH(0.9) ≈ -1.21
    const SIT_Y   = -1.21;
    const sitZLerp = lerp(currentAvatarZRef.current, isSittingNow ? CHAIR_Z : currentAvatarZRef.current, delta * 4);
    const sitXLerp = lerp(avatarX, isSittingNow ? CHAIR_X : avatarX, delta * 4);
    const sitYLerp = lerp(
      AVATAR_BASE_Y + walkBounce + laughShake + idleBodyOffsetRef.current,
      SIT_Y,
      isSittingNow ? Math.min(1, delta * 3 + (group.position.y < SIT_Y + 0.05 ? 1 : 0)) : 0
    );

    group.position.set(
      isSittingNow ? sitXLerp : avatarX,
      isSittingNow ? lerp(group.position.y, SIT_Y, delta * 3) : AVATAR_BASE_Y + walkBounce + laughShake + idleBodyOffsetRef.current,
      isSittingNow ? lerp(group.position.z, CHAIR_Z, delta * 3) : currentAvatarZRef.current,
    );
    // Box3 collision — floor snap + wall clamp + desk separation (disabled when sitting)
    if (!isSittingNow) resolveIfEnabled(group.position);

    if (!v) return;

    // ── VRMA mixer update ────────────────────────────────────────────────────
    if (mixerRef.current) {
      // Smoothly mute VRMA weight during walking (manual walk cycle takes over)
      if (vrmaReadyRef.current && activeVrmaRef.current) {
        const vrmaAction = vrmaActions.current.get(activeVrmaRef.current);
        if (vrmaAction) {
          const targetW = isWalkingNow ? 0 : 1;
          vrmaAction.setEffectiveWeight(lerp(vrmaAction.getEffectiveWeight(), targetW, delta * 5));
        }
      }
      mixerRef.current.update(delta);
    }
    // Detect walk-end → restore idle VRMA
    if (wasWalkingRef.current && !isWalkingNow && vrmaReadyRef.current && !isSittingRef.current) {
      playVRMA(`idle${idleIdxRef.current}`, true, 0.5);
    }
    wasWalkingRef.current = isWalkingNow;
    // Idle cycling every 12-20 seconds
    if (vrmaReadyRef.current && !isSittingNow && !isWalkingNow && activeVrmaRef.current.startsWith('idle')) {
      if (now > idleNextRef.current) {
        const ni = (idleIdxRef.current + 1) % 4;
        idleIdxRef.current  = ni;
        idleNextRef.current = now + 12000 + Math.random() * 8000;
        playVRMA(`idle${ni}`, true, 0.7);
      }
    }

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
        if (spineBone) {
          // Additive when VRMA drives skeleton; absolute otherwise
          if (vrmaReadyRef.current) spineBone.rotation.x += spineBreathRef.current * 0.4 + nodArc * 0.12;
          else spineBone.rotation.x = spineBreathRef.current + nodArc * 0.14;
        }
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

    // 8. Arm/leg pose — manual override; runs only during walk or as VRMA fallback
    const humanoid = v.humanoid;
    if (humanoid && (!vrmaReadyRef.current || isWalkingNow)) {
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
        // ── Natural idle OR sitting ──
        const sway    = Math.sin(t * 0.4) * 0.06;
        const breathZ = spineBreathRef.current * 0.15;
        const rua  = humanoid.getRawBoneNode('rightUpperArm' as never);
        const lua  = humanoid.getRawBoneNode('leftUpperArm'  as never);
        const rla  = humanoid.getRawBoneNode('rightLowerArm' as never);
        const lla  = humanoid.getRawBoneNode('leftLowerArm'  as never);
        const rul  = humanoid.getRawBoneNode('rightUpperLeg' as never);
        const lul  = humanoid.getRawBoneNode('leftUpperLeg'  as never);
        const rll  = humanoid.getRawBoneNode('rightLowerLeg' as never);
        const lll  = humanoid.getRawBoneNode('leftLowerLeg'  as never);

        if (isSittingNow) {
          // ── Sitting pose: thighs forward, calves hanging down, arms on thighs ──
          // Group is rotated 180° on Y → X-axis is flipped → use +1.5 to push thighs FORWARD
          if (rul) rul.rotation.set( 1.5, 0, 0.05, 'XYZ');
          if (lul) lul.rotation.set( 1.5, 0, -0.05, 'XYZ');
          // Lower legs: -1.5 to fold calf straight down from knee
          if (rll) rll.rotation.set(-1.5, 0, 0, 'XYZ');
          if (lll) lll.rotation.set(-1.5, 0, 0, 'XYZ');
          // Arms resting naturally at sides/on thighs — down close to body
          if (rua) rua.rotation.set(-0.15 + sway * 0.15, 0.08, -1.1, 'XYZ');
          if (lua) lua.rotation.set(-0.15 - sway * 0.15, -0.08,  1.1, 'XYZ');
          // Forearms angled slightly forward (resting on lap)
          if (rla) rla.rotation.set( 0.5, 0, 0, 'XYZ');
          if (lla) lla.rotation.set( 0.5, 0, 0, 'XYZ');
        } else {
          // ── Natural standing idle ──
          if (rua) rua.rotation.set( sway, 0, -1.3 + breathZ, 'XYZ');
          if (lua) lua.rotation.set(-sway, 0,  1.3 - breathZ, 'XYZ');
          if (rla) rla.rotation.set(0.07, 0, 0, 'XYZ');
          if (lla) lla.rotation.set(0.07, 0, 0, 'XYZ');
          if (rul) rul.rotation.set(0, 0, 0, 'XYZ');
          if (lul) lul.rotation.set(0, 0, 0, 'XYZ');
          if (rll) rll.rotation.set(0, 0, 0, 'XYZ');
          if (lll) lll.rotation.set(0, 0, 0, 'XYZ');
        }
      }
    }
  });

  return (
    <>
      {/* ALWAYS render a <group> so groupRef is stable and useFrame can position it.
          Scale 1.0 = natural VRM height (~1.7m in-world).
          rotation-y={Math.PI} flips avatar to face camera (VRM 0.0 faces +Z, camera is at +Z looking -Z). */}
      <group ref={groupRef} position={[0, AVATAR_BASE_Y, -2.0]} rotation={[0, Math.PI, 0]} scale={[1.35, 1.35, 1.35]}>
        {vrm && <primitive object={vrm.scene} />}
      </group>
    </>
  );
}

// DeskModel removed — replaced by <OfficeSetLoader /> which also registers
// the desk with WorldColliders for Box3 collision.

// ── ZoomController — lives inside <Canvas> ──────────────────────────────────
function ZoomController() {
  const { camera, gl } = useThree();
  const zRef = useRef((camera as THREE.PerspectiveCamera).position.z);

  useEffect(() => {
    const canvas = gl.domElement;
    const onWheel = (e: WheelEvent) => {
      // Let OrbitControls handle scroll zoom — do not preventDefault
      zRef.current = zRef.current + e.deltaY * 0.018;
    };
    canvas.addEventListener('wheel', onWheel, { passive: true });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [gl]);

  useFrame(() => {
    // ZoomController disabled — OrbitControls handles all camera movement freely
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
  const [okOffice,  setOkOffice]  = useState(false);
  const OFFICE_URL = '/assets/office.glb';
  const OFFICE_TARGET_Z: [number, number, number] = [0, 0, -2.0];

  const handleLoad  = useCallback(() => setLoaded(true), []);
  const handleError = useCallback((err: string) => setLoadError(err), []);
  const handleOfficeReady = useCallback(() => setOkOffice(true), []);

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
      {process.env.NODE_ENV === 'development' && (
        <OfficeDebugHUD okOffice={okOffice} url={OFFICE_URL} pos={OFFICE_TARGET_Z} />
      )}
      <Canvas
        dpr={[1, 2]}
        shadows={true}
        camera={{ position: [0, 1.6, 3.5], fov: 55, near: 0.01, far: 500 }}
        gl={{ antialias: true, alpha: false }}
        onCreated={({ gl }) => {
          gl.setClearColor(0x000000, 1);
          gl.outputColorSpace = THREE.SRGBColorSpace;
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.6;
        }}
        style={{ width: '100%', height: '100%', display: 'block' }}
      >
        {/* Interior ambient — soft base lighting inside the office */}
        <ambientLight intensity={0.25} />
        <hemisphereLight args={['#ffeedd', '#0a0c10', 0.30]} />
        {/* Avatar key lights — near avatar at Z=-2.5 */}
        <pointLight position={[0.8, 1.5, -1.5]} intensity={18} distance={8} decay={2} color="#fff8f0" />
        <pointLight position={[-0.8, 1.0, -1.5]} intensity={12} distance={8} decay={2} color="#d8e8ff" />
        {/* Room depth lights */}
        <pointLight position={[0, 2.0, -4.0]} intensity={8} distance={10} decay={2} color="#ffe0a0" />
        <pointLight position={[0, 2.0, -7.0]} intensity={5} distance={10} decay={2} color="#ffcc80" />

        <Suspense fallback={null}>
          <VRMScene vrmUrl={vrmUrl} onLoad={handleLoad} onError={handleError} />
          {/* RoomShell disabled — GLB provides room geometry; shell caused overlit white walls */}
          {/* <RoomShell /> */}
          {/* Office set loader — room as backdrop behind avatar */}
          <OfficeSetLoader
            url={OFFICE_URL}
            targetZ={OFFICE_TARGET_Z[2]}
            scaleFix={1.5}
            debug={process.env.NODE_ENV === 'development'}
            onReady={handleOfficeReady}
          />
        </Suspense>

        {/* OrbitControls — full 360° rotation, no distance/wall limits */}
        <OrbitControls
          makeDefault
          target={[0, 0.8, -2.5]}
          minDistance={0.05}
          maxDistance={50}
          minPolarAngle={0}
          maxPolarAngle={Math.PI}
          minAzimuthAngle={-Infinity}
          maxAzimuthAngle={Infinity}
          enableDamping
          dampingFactor={0.08}
        />
      </Canvas>
    </div>
  );
}
