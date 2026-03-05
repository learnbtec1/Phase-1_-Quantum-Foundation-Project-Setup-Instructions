'use client';

/**
 * AvatarCanvas — Self-contained R3F canvas for the /evaluate page.
 *
 * DESIGN: Uses an inline VRMScene (zero import from VRMAvatar.tsx).
 * This avoids the complex VRMAvatarInner import chain (EmotionManager,
 * PhonemeManager, Howl, VRMA animations) which can silently fail under
 * Next.js dynamic() and cause the avatar to disappear.
 *
 * Features: VRM load, breathing, blink, wave, lip-sync, TTS, emotions.
 * teach.vrm is VRM 0.0, pre-oriented toward camera — do NOT call rotateVRM0.
 */

import React, {
  useRef, useCallback, useState, useEffect, Suspense,
} from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRM, VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import styles from './AvatarCanvas.module.css';

// ─── Public interface ────────────────────────────────────────────────────────
export interface AvatarCanvasRef {
  speak: (text: string) => void;
}

// ─── Constants ───────────────────────────────────────────────────────────────
const AVATAR_BASE_Y   = -1.0;   // خُفِّض لإظهار الرأس كاملاً
const BREATHE_AMP     = 0.06;
const BLINK_MIN       = 2.2;   // seconds
const BLINK_MAX       = 4.5;
const WAVE_DURATION   = 3.5;   // seconds on load greeting wave

// ─── Zoom limits ────────────────────────────────────────────────────────────
const ZOOM_MIN        = 1.2;   // أقرب نقطة
const ZOOM_MAX        = 5.5;   // أبعد نقطة
const ZOOM_SPEED      = 0.18;  // حساسية السكرول

// ─── Fallback: Web Speech API ────────────────────────────────────────────────
function fallbackSpeak(
  text: string,
  onStart?: () => void,
  onEnd?: () => void,
): void {
  if (typeof window === 'undefined' || !window.speechSynthesis) { onEnd?.(); return; }
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang  = 'ar-SA';
    u.rate  = 0.9;
    u.onstart = () => onStart?.();
    u.onend   = () => onEnd?.();
    u.onerror = () => onEnd?.();
    window.speechSynthesis.speak(u);
  } catch { onEnd?.(); }
}

// ─── Lightweight Verona parser (no external dep) ────────────────────────────
function parseVerona(raw: string): { text: string; emotion: string; action: string } {
  let text   = raw;
  let emotion = 'neutral';
  let action  = '';
  try {
    const mAction = text.match(/\*([^*]+)\*/);
    if (mAction) { action = mAction[1]; text = text.replace(/\*[^*]+\*/g, '').trim(); }
    const mEmotion = text.match(/\[EMOTION:([^\]]+)\]/i);
    if (mEmotion) { emotion = mEmotion[1].toLowerCase(); text = text.replace(/\[EMOTION:[^\]]+\]/gi, '').trim(); }
  } catch { /* never fatal */ }
  return { text: text || raw, emotion, action };
}

function inferEmotion(text: string): string {
  if (/ممتاز|رائع|أحسنت|صحيح|تمام|عظيم/i.test(text)) return 'friendly';
  if (/خطأ|ناقص|راجع|غير صحيح|لا يكفي/i.test(text)) return 'thinking';
  return 'neutral';
}

function actionToGestureDetail(action: string): Record<string, unknown> {
  if (/wave|تلويح|تحية|وداع/i.test(action))  return { type: 'wave',      side: 'right', duration: 2.5 };
  if (/point|إشارة|انظر/i.test(action))       return { type: 'point',     side: 'right', duration: 1.5 };
  if (/nod|موافق|هز الرأس/i.test(action))     return { type: 'beat',      side: 'both',  duration: 1.2 };
  if (/open.*hand|يد مفتوحة/i.test(action))   return { type: 'openHand',  side: 'right', duration: 1.8 };
  return { type: 'wave', side: 'right', duration: 1.2 };
}

// ─────────────────────────────────────────────────────────────────────────────
// VRMScene — lives *inside* the Canvas
// ─────────────────────────────────────────────────────────────────────────────
interface VRMSceneProps {
  vrmUrl: string;
  speakRef: React.MutableRefObject<((text: string) => void) | null>;
  onLoad: () => void;
}

function VRMScene({ vrmUrl, speakRef, onLoad }: VRMSceneProps) {
  const [vrm, setVrm] = useState<VRM | null>(null);
  const vrmRef        = useRef<VRM | null>(null);
  const groupRef      = useRef<THREE.Group>(null);

  // Talking / procedural lip-sync
  const isTalkingRef    = useRef(false);
  const talkElapsedRef  = useRef(0);

  // Emotion
  const emotionRef      = useRef<string>('neutral');

  // Wave gesture (active while timestamp in future)
  const waveUntilRef    = useRef(0);

  // Extended gestures (point / openHand / beat)
  const gestureRef = useRef<{
    type: 'point' | 'openHand' | 'beat';
    side: 'left' | 'right' | 'both';
    startMs: number;
    durationMs: number;
  } | null>(null);

  // Blink
  const nextBlinkRef  = useRef(Date.now() + 3000);
  const blinkPhaseRef = useRef(0);

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
          console.warn('[AvatarCanvas] ❌ No VRM in gltf.userData.vrm — invalid file:', vrmUrl);
          return;
        }

        // Optimise (non-fatal)
        try { VRMUtils.removeUnnecessaryVertices(model.scene); } catch (e) { console.warn('[AvatarCanvas] removeUnnecessaryVertices skipped:', e); }
        try { VRMUtils.combineSkeletons(model.scene);           } catch (e) { console.warn('[AvatarCanvas] combineSkeletons skipped:', e); }
        // ⚠️ rotateVRM0 is intentionally NOT called:
        // teach.vrm is VRM 0.0 and is already facing the camera.
        // rotateVRM0 would flip it 180° → invisible.

        // Ensure all meshes are visible and not frustum-culled
        let meshCount = 0;
        model.scene.traverse((o) => {
          o.frustumCulled = false;
          if ((o as THREE.Mesh).isMesh) {
            (o as THREE.Mesh).visible = true;
            meshCount++;
          }
        });
        console.log(`%c[AvatarCanvas] ✅ VRM loaded — ${meshCount} meshes, url: ${vrmUrl}`, 'color:lime;font-weight:bold');

        // Greeting wave on load
        waveUntilRef.current = Date.now() + WAVE_DURATION * 1000;

        vrmRef.current = model;
        setVrm(model);   // ← triggers React re-render → <primitive> appears
        onLoad();
      },
      undefined,
      (err) => {
        if (!cancelled) {
          console.warn = origWarn;
          console.error('[AvatarCanvas] ❌ VRM load error:', (err as Error)?.message ?? err, '| url:', vrmUrl);
        }
      },
    );

    return () => {
      cancelled = true;
      console.warn = origWarn;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vrmUrl]);

  // ── Register speak() handle ─────────────────────────────────────────────
  useEffect(() => {
    speakRef.current = (rawText: string) => {
      if (!rawText?.trim()) return;

      const { text, emotion, action } = parseVerona(rawText);
      emotionRef.current = emotion !== 'neutral' ? emotion : inferEmotion(text);

      // Dispatch gesture from *action* marker
      if (action) {
        try {
          window.dispatchEvent(new CustomEvent('avatar:gesture', {
            detail: actionToGestureDetail(action),
          }));
        } catch { /* ignore */ }
      }

      const onStart = () => {
        isTalkingRef.current   = true;
        talkElapsedRef.current = 0;
        window.dispatchEvent(new CustomEvent('avatar:speak:start'));
      };
      const onEnd = () => {
        isTalkingRef.current   = false;
        emotionRef.current     = 'neutral';
        window.dispatchEvent(new CustomEvent('avatar:speak:end'));
      };

      // Try speakWithTTS — lazy-import so a module failure doesn't break rendering
      import('@/ai/io/tts')
        .then(({ speakWithTTS }) =>
          speakWithTTS(text, { onStart, onEnd }).then((ok) => {
            if (!ok) fallbackSpeak(text, onStart, onEnd);
          }),
        )
        .catch(() => fallbackSpeak(text, onStart, onEnd));
    };

    return () => { speakRef.current = null; };
  }, [speakRef]);

  // ── Event listeners (avatar:gesture, avatar:emotion, avatar:speak) ───────
  useEffect(() => {
    const onGesture = (e: Event) => {
      const d = (e as CustomEvent).detail as {
        type?: string; side?: string; duration?: number; intensity?: number;
      };
      if (!d?.type) return;

      if (d.type === 'wave') {
        waveUntilRef.current = Date.now() + (d.duration ?? 2.5) * 1000;
      } else if (d.type === 'point' || d.type === 'openHand' || d.type === 'beat') {
        gestureRef.current = {
          type:       d.type as 'point' | 'openHand' | 'beat',
          side:       (d.side ?? 'right') as 'left' | 'right' | 'both',
          startMs:    Date.now(),
          durationMs: (d.duration ?? 2) * 1000,
        };
      }
    };

    const onEmotion = (e: Event) => {
      const em = (e as CustomEvent<{ emotion?: string }>).detail?.emotion;
      if (em) emotionRef.current = em;
    };

    const onSpeakStart = () => { isTalkingRef.current = true;  talkElapsedRef.current = 0; };
    const onSpeakEnd   = () => { isTalkingRef.current = false; emotionRef.current = 'neutral'; };

    window.addEventListener('avatar:gesture',     onGesture);
    window.addEventListener('avatar:emotion',     onEmotion);
    window.addEventListener('avatar:speak:start', onSpeakStart);
    window.addEventListener('avatar:speak:end',   onSpeakEnd);

    return () => {
      window.removeEventListener('avatar:gesture',     onGesture);
      window.removeEventListener('avatar:emotion',     onEmotion);
      window.removeEventListener('avatar:speak:start', onSpeakStart);
      window.removeEventListener('avatar:speak:end',   onSpeakEnd);
    };
  }, []);

  // ── Render loop ─────────────────────────────────────────────────────────
  const { pointer, camera } = useThree();

  useFrame((state, delta) => {
    const v     = vrmRef.current;
    const group = groupRef.current;
    if (!group) return;

    const t   = state.clock.elapsedTime;
    const now = Date.now();

    // 1. Breathing — position avatar
    const breathe = Math.sin(t * 0.9) * BREATHE_AMP;
    group.position.set(0, AVATAR_BASE_Y + breathe, 0.2);

    if (!v) return; // VRM not yet loaded — keep group at rest position

    // 2. Blink
    const em = v.expressionManager;
    if (em) {
      if (blinkPhaseRef.current > 0) {
        blinkPhaseRef.current += delta * 12;
        const bv = blinkPhaseRef.current < Math.PI ? Math.sin(blinkPhaseRef.current) : 0;
        try { em.setValue('blink' as never, Math.min(1, bv)); } catch {
          try {
            em.setValue('blinkLeft'  as never, Math.min(1, bv));
            em.setValue('blinkRight' as never, Math.min(1, bv));
          } catch { /* expression not available */ }
        }
        if (blinkPhaseRef.current > Math.PI * 2) {
          blinkPhaseRef.current = 0;
          try { em.setValue('blink' as never, 0); } catch {
            try { em.setValue('blinkLeft' as never, 0); em.setValue('blinkRight' as never, 0); } catch {}
          }
          nextBlinkRef.current = now + (BLINK_MIN + Math.random() * (BLINK_MAX - BLINK_MIN)) * 1000;
        }
      } else if (now >= nextBlinkRef.current) {
        blinkPhaseRef.current = 0.001;
      }

      // 3. Procedural lip-sync while talking
      if (isTalkingRef.current) {
        talkElapsedRef.current += delta;
        const jaw = Math.max(0, Math.min(1, 0.45 + 0.5 * Math.sin(talkElapsedRef.current * 9.1)));
        try { em.setValue('aa' as never, jaw); } catch {}
      } else {
        try { em.setValue('aa' as never, 0); } catch {}
      }

      // 4. Emotion blendshapes
      const emo = emotionRef.current;
      try {
        em.setValue('happy'   as never, emo === 'friendly' || emo === 'happy'   ? 0.7 : 0);
        em.setValue('sad'     as never, emo === 'sad'                            ? 0.6 : 0);
        em.setValue('angry'   as never, emo === 'angry'    || emo === 'strictEvaluation' ? 0.5 : 0);
        em.setValue('relaxed' as never, emo === 'neutral'  || emo === 'thinking' ? 0.3 : 0);
      } catch { /* some blendshapes may be absent */ }

      em.update();
    }

    // 5. LookAt — eye tracking toward pointer
    const lookAt = (v as { lookAt?: { autoUpdate?: boolean; lookAt?: (p: THREE.Vector3) => void } }).lookAt;
    if (lookAt?.lookAt) {
      lookAt.autoUpdate = false;
      const target = new THREE.Vector3(pointer.x, pointer.y, 0.4).unproject(camera);
      lookAt.lookAt(target);
    }

    // 6. VRM internals update
    v.update(delta);

    // 7. Arm pose — wave / extended gesture / idle sway
    const humanoid = v.humanoid;
    if (humanoid) {
      const isWaving = now < waveUntilRef.current;
      const gs = gestureRef.current;
      if (gs && now > gs.startMs + gs.durationMs) gestureRef.current = null;
      const hasGesture = !!gestureRef.current;

      if (isWaving && !hasGesture) {
        // Wave greeting
        const waveAng = Math.sin(t * 6) * 1.0;
        const rua = humanoid.getRawBoneNode('rightUpperArm' as never);
        const rla = humanoid.getRawBoneNode('rightLowerArm' as never);
        if (rua) { rua.rotation.set(-0.9,  0.2, waveAng,       'XYZ'); }
        if (rla) { rla.rotation.set(-0.7,  0,   waveAng * 1.2, 'XYZ'); }
        const lua = humanoid.getRawBoneNode('leftUpperArm' as never);
        const lla = humanoid.getRawBoneNode('leftLowerArm' as never);
        if (lua) { lua.rotation.set(0, 0, 0, 'XYZ'); }
        if (lla) { lla.rotation.set(0, 0, 0, 'XYZ'); }

      } else if (hasGesture && gestureRef.current) {
        const progress = Math.min(1, (now - gestureRef.current.startMs) / gestureRef.current.durationMs);
        const curve    = Math.sin(progress * Math.PI);
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
            if (ha) ha.rotation.set(0,                      0, 0,                  'YXZ');
          } else if (gType === 'openHand') {
            if (ua) ua.rotation.set(-0.45 * curve, dir * 0.15 * curve, dir * 0.08 * curve, 'YXZ');
            if (la) la.rotation.set(-0.25 * curve,          0, 0,                           'YXZ');
            if (ha) ha.rotation.set(0,              dir * 0.25 * curve, 0,                  'YXZ');
          } else if (gType === 'beat') {
            const beat = Math.sin(progress * Math.PI * 5) * 0.28 * curve;
            if (ua) ua.rotation.set(-(curve * 0.35 + beat * 0.5), 0, dir * 0.12, 'YXZ');
            if (la) la.rotation.set(-0.2 + beat,                  0, 0,          'YXZ');
            if (ha) ha.rotation.set(0,                            0, beat * 0.6,  'YXZ');
          }
        };

        if (gSide === 'right' || gSide === 'both') applyArm('right');
        if (gSide === 'left'  || gSide === 'both') applyArm('left');

      } else {
        // Idle sway
        const sway = Math.sin(t * 0.4) * 0.08;
        const rua  = humanoid.getRawBoneNode('rightUpperArm' as never);
        const lua  = humanoid.getRawBoneNode('leftUpperArm'  as never);
        if (rua) rua.rotation.set( sway, 0, 0, 'XYZ');
        if (lua) lua.rotation.set(-sway, 0, 0, 'XYZ');
      }
    }
  });

  return (
    <group ref={groupRef} rotation={[0, Math.PI, 0]}>
      {vrm && <primitive object={vrm.scene} />}
    </group>
  );
}

// ─── ZoomController — يعيش داخل Canvas ويتحكم في zoom الكاميرا ──────────────
function ZoomController() {
  const { camera, gl } = useThree();
  const zRef = useRef((camera as THREE.PerspectiveCamera).position.z);

  useEffect(() => {
    const canvas = gl.domElement;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zRef.current = Math.min(
        ZOOM_MAX,
        Math.max(ZOOM_MIN, zRef.current + e.deltaY * ZOOM_SPEED * 0.01),
      );
    };

    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [gl]);

  useFrame(() => {
    const cam = camera as THREE.PerspectiveCamera;
    // Smooth lerp toward target Z
    cam.position.z += (zRef.current - cam.position.z) * 0.12;
    cam.updateProjectionMatrix();
  });

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// AvatarCanvas — exported, loaded via dynamic() with ssr: false
// ─────────────────────────────────────────────────────────────────────────────
interface AvatarCanvasProps {
  vrmUrl?: string;
  onReady?: (ref: AvatarCanvasRef) => void;
}

export default function AvatarCanvas({ vrmUrl = '/models/teach.vrm', onReady }: AvatarCanvasProps) {
  const speakRef   = useRef<((text: string) => void) | null>(null);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  const handleLoad = useCallback(() => {
    onReadyRef.current?.({ speak: (text: string) => speakRef.current?.(text) });
  }, []);

  return (
    <div className={styles.avatarMount}>
      <Canvas
        dpr={[1, 2]}
        shadows={false}
        camera={{ position: [0, 0.3, 3.2], fov: 50, near: 0.01, far: 100 }}
        gl={{ antialias: true, alpha: false }}
        onCreated={({ gl }) => {
          gl.setClearColor(0x0c1222, 1);
          gl.outputColorSpace = THREE.SRGBColorSpace;
          console.log('[AvatarCanvas] 🎬 Canvas created — camera pos [0, 1.0, 2.8]');
        }}
        style={{ width: '100%', height: '100%', display: 'block' }}
      >
        <ambientLight     intensity={2.5} />
        <directionalLight position={[1, 3, 2]} intensity={2.5} />
        <ZoomController />
        <Suspense fallback={null}>
          <VRMScene
            vrmUrl={vrmUrl!}
            speakRef={speakRef}
            onLoad={handleLoad}
          />
        </Suspense>
      </Canvas>
    </div>
  );
}
