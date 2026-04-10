'use client';

import React, {
  useState,
  useRef,
  useCallback,
  useEffect,
  Suspense,
  type MutableRefObject,
  type RefObject,
} from 'react';
import * as THREE from 'three';
import { Canvas } from '@react-three/fiber';
import {
  ContactShadows,
  PerspectiveCamera,
  OrbitControls,
} from '@react-three/drei';
import {
  GLTFLoader,
  type GLTF,
  type GLTFParser,
} from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRM, VRMUtils } from '@pixiv/three-vrm';
import { useBrainStore } from '@/store/useBrainStore';
import { initBrainPersistence, flushBrainPersistence } from '@/lib/brainPersistence';
import { initAvatarVoiceListener } from '@/ai/io/tts';
import { startSpontaneousBehavior, stopSpontaneousBehavior } from '@/lib/behavior/SpontaneousBehavior';
import { CameraUpLock } from './CameraUpLock';
import ComfortLightingRig from '@/components/ComfortLightingRig';
import LipSyncManager, { type VisemeCue } from './LipSyncManager';
import { AnimationController } from './AnimationController';
import { VRMSkeletonManager } from './VRMSkeletonManager';
import { MouseGestureCalibrator } from './MouseGestureCalibrator';
import { GenerativeGestureManager } from './GenerativeGestureManager';
import { useAvatarEventBridge } from '@/hooks/useAvatarEventBridge';
import { initGestureNormalizer } from '@/lib/gestureNormalizer';
import { dispatchAvatar } from '@/utils/events/normalizeAvatarEvents';
import {
  AVATAR_OFFICE_SCENE_DEFAULTS,
  getAvatarOfficeScenePosition,
  OFFICE_GLB_PUBLIC_PATH,
} from '@/config/avatar';
import { OfficeEnvironment } from './OfficeEnvironment';
import { createAvatarPerformanceHandler } from '@/app/avatar-agent/avatarPerformanceBridge';
import { VRMAPlayer } from './VRMAPlayer';

type AvatarCanvasProps = {
  vrmUrl?: string;
  /** عرض نموذج المكتب خلف الأفاتار */
  showOfficeEnvironment?: boolean;
  /** مسار GLB للمكتب (افتراضي من `OFFICE_GLB_PUBLIC_PATH`) */
  officeGlbUrl?: string;
  /** إزاحة/حجم المكتب — اضبطهما إذا حجب الأفاتار (افتراضي: `AVATAR_OFFICE_SCENE_DEFAULTS`) */
  officePosition?: [number, number, number];
  officeScale?: number;
  /** جذر الأفاتار (VRM) — مع المكتب: أرضية الغرفة وليس سطح المكتب (انظر `getAvatarOfficeScenePosition`) */
  avatarPosition?: [number, number, number];
  avatarScale?: number;
  visemeCueQueueRef?: MutableRefObject<VisemeCue[]>;
  audioElementRef?: RefObject<HTMLAudioElement | null>;
  analyserRef?: MutableRefObject<AnalyserNode | null>;
  /** عند التعريف: يُستدعى مع نص `agent:message` (مثلاً Azure SDK من الأب). */
  onAgentSpeak?: (text: string) => void | Promise<void>;
  /** true = WebSocket مستقل للجسر (تجنّبه مع useAgentAgent على نفس الـ URL) */
  agentBridgeConnectWebSocket?: boolean;
  agentBridgeWsUrl?: string;
  /** ربط الجسر بسوكيت الوكيل الحالي بدل فتح اتصال ثانٍ */
  getSharedWebSocket?: () => WebSocket | null;
  /** WebSocket إيماءات توليدية (MIBURI/RIDGE) — اختياري؛ انظر NEXT_PUBLIC_GENERATIVE_GESTURE_WS */
  generativeGestureWsUrl?: string;
};

function LoadingFallback() {
  return (
    <div className="flex items-center justify-center w-full h-full bg-[#0a0a12]">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        <div className="text-sm text-gray-400">Loading Avatar Environment...</div>
      </div>
    </div>
  );
}

function ErrorFallback() {
  return (
    <div className="flex items-center justify-center w-full h-full bg-[#0a0a12]">
      <div className="flex flex-col items-center gap-2 text-center px-4">
        <div className="text-red-400 text-lg">⚠️</div>
        <div className="text-sm text-gray-400">Failed to load avatar</div>
      </div>
    </div>
  );
}

export default function AvatarCanvas({
  vrmUrl = '/models/cogni.vrm',
  showOfficeEnvironment = true,
  officeGlbUrl = OFFICE_GLB_PUBLIC_PATH,
  officePosition = [...AVATAR_OFFICE_SCENE_DEFAULTS.officePosition],
  officeScale = AVATAR_OFFICE_SCENE_DEFAULTS.officeScale,
  avatarPosition = getAvatarOfficeScenePosition(),
  avatarScale = AVATAR_OFFICE_SCENE_DEFAULTS.avatarScale,
  visemeCueQueueRef: visemeCueQueueProp,
  audioElementRef: audioElementProp,
  analyserRef: analyserProp,
  agentBridgeConnectWebSocket = false,
  agentBridgeWsUrl,
  getSharedWebSocket,
  generativeGestureWsUrl,
  onAgentSpeak,
}: AvatarCanvasProps) {
  const [vrm, setVrm] = useState<VRM | null>(null);
  const [error, setError] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);

  // Shared Refs for Managers
  const isTalkingRef = useRef<boolean>(false);
  const neckGazeYawRef = useRef<number>(0);
  const neckGazePitchRef = useRef<number>(0);
  const groupRef = useRef<THREE.Group | null>(null);

  /**
   * PAD→motor bridge: maps brain arousal to physical animation energy.
   * - arousal > 0.3  → energetic (1.25×)
   * - arousal < -0.3 → subdued  (0.65×)
   * - neutral        → normal  (1.0×)
   * Written here, consumed by VRMSkeletonManager.
   */
  const motorSpeedMulRef = useRef<number>(1);
  const isListeningRef = useRef<boolean>(false);
  const isThinkingRef = useRef<boolean>(false);
  
  const visemeCueQueueInternalRef = useRef<VisemeCue[]>([]);
  const audioElementInternalRef = useRef<HTMLAudioElement | null>(null);
  const analyserInternalRef = useRef<AnalyserNode | null>(null);

  const visemeCueQueueRef = visemeCueQueueProp ?? visemeCueQueueInternalRef;
  const audioElementRef = audioElementProp ?? audioElementInternalRef;
  const analyserRef = analyserProp ?? analyserInternalRef;

  // ── Web Audio context (created lazily, shared for lifetime of component) ──
  const audioCtxRef = useRef<AudioContext | null>(null);
  // Track which audio element is currently wired into the analyser so we avoid re-wiring
  const analyserSourceAudioRef = useRef<HTMLAudioElement | null>(null);

  /**
   * R3F connects pointer events in `onCreated` via `connect(eventSource ?? divRef.current)`.
   * With React 19 + async `configure()`, the inner `divRef` can still be null → null.addEventListener.
   * A stable outer ref (parent of `<Canvas />`) is set before the child fiber root runs.
   */
  const r3fEventSourceRef = useRef<HTMLDivElement>(null);

  /** مرجع مشترك: VRMAPlayer يكتبه، VRMSkeletonManager يقرأه لتوقيف الإيماءات الإجرائية */
  const vrmaActiveRef = useRef<boolean>(false);

  useEffect(() => {
    initGestureNormalizer();
    initBrainPersistence();
    initAvatarVoiceListener(); // wire avatar:voice → TTS rate/pitch
    startSpontaneousBehavior({
      isTalkingRef,
      isThinkingRef,
      motorSpeedMulRef,
      isListeningRef, // propagate so SpontaneousBehavior suppresses heavy gestures while student speaks
    });
    // Flush on unmount too (SPA navigation)
    return () => {
      flushBrainPersistence();
      stopSpontaneousBehavior();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // PAD → motorSpeedMulRef bridge (no re-render; direct ref writes)
  useEffect(() => {
    const unsub = useBrainStore.subscribe(
      (s) => ({ arousal: s.pad.arousal, thinking: s.thinking, isListening: s.physical.isListening }),
      ({ arousal, thinking, isListening }) => {
        // Arousal [-1..1] → motor multiplier [0.55..1.4]
        const clamped = Math.max(-1, Math.min(1, arousal));
        const mul = clamped >= 0
          ? 1 + clamped * 0.4          // excited: up to 1.4×
          : 1 + clamped * 0.45;        // bored/sad: down to 0.55×
        motorSpeedMulRef.current = Math.max(0.55, Math.min(1.4, mul));
        isThinkingRef.current = thinking;
        isListeningRef.current = isListening;
      },
      { equalityFn: (a, b) =>
          Math.abs(a.arousal - b.arousal) < 0.04 &&
          a.thinking === b.thinking &&
          a.isListening === b.isListening
      },
    );
    return unsub;
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !vrm) return;
    const handler = createAvatarPerformanceHandler(
      () => vrm,
      (em, key, value) => {
        try {
          em.setValue(
            key as never,
            THREE.MathUtils.clamp(value, 0, 1) as never,
          );
        } catch {
          /* morph missing */
        }
      },
    );
    window.addEventListener('avatar:performance', handler);
    return () => window.removeEventListener('avatar:performance', handler);
  }, [vrm]);

  const handleLoad = useCallback((gltf: GLTF, isCancelled: () => boolean) => {
      if (isCancelled()) return;

      const loadedVrm = (gltf.userData.vrm as VRM | undefined) ?? null;

      if (!loadedVrm) {
        if (!isCancelled()) {
          setError(true);
          setLoading(false);
        }
        return;
      }

      try {
        VRMUtils.removeUnnecessaryVertices(gltf.scene);
        VRMUtils.combineSkeletons(gltf.scene);
      } catch (err) {
        console.warn('[AvatarCanvas] VRM optimization warning:', err);
      }

      // Fix materials for shadows
      gltf.scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.castShadow = true;
          obj.receiveShadow = true;
          if (obj.material) {
            if (Array.isArray(obj.material)) {
              obj.material.forEach((mat) => { mat.needsUpdate = true; });
            } else {
              obj.material.needsUpdate = true;
            }
          }
        }
      });

      if (isCancelled()) return;
      // Do NOT set autoUpdateHumanBones = false here.
      // VRMSkeletonManager uses normalized bones; vrm.update() propagates them to raw.

      // ── DIAGNOSTIC: humanoid + skeleton integrity ────────────────────────
      console.log('[AvatarCanvas] 🔍 Pre-setVrm check:');
      console.log('  humanoid present:', !!loadedVrm.humanoid);
      console.log('  autoUpdateHumanBones:', loadedVrm.humanoid?.autoUpdateHumanBones);
      const testBone = loadedVrm.humanoid?.getRawBoneNode('rightUpperArm' as never);
      console.log('  rightUpperArm (post-combineSkeletons):', testBone);
      console.log('  hips:', loadedVrm.humanoid?.getRawBoneNode('hips' as never));

      // ── DIAGNOSTIC: all available humanoid bones in THIS model ──────────
      if (loadedVrm.humanoid) {
        const hb = loadedVrm.humanoid.humanBones;
        const presentBones = Object.keys(hb).filter(
          (k) => (hb as Record<string, { node?: unknown }>)[k]?.node != null,
        );
        const nullBones = Object.keys(hb).filter(
          (k) => (hb as Record<string, { node?: unknown }>)[k]?.node == null,
        );
        console.log('[AvatarCanvas] ✅ Present bones:', presentBones);
        console.log('[AvatarCanvas] ❌ Null bones:', nullBones);
      }

      setVrm(loadedVrm);
      setLoading(false);
      console.log(
        '[AvatarCanvas] VRM loaded; scene in Canvas next frame. humanoid:',
        !!loadedVrm.humanoid,
        'autoUpdateHumanBones=',
        loadedVrm.humanoid?.autoUpdateHumanBones,
        '— expect [VRMSkeletonManager] logs once R3F mounts managers.',
      );
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    setVrm(null);
    setError(false);
    setLoading(true);

    const loader = new GLTFLoader();
    // autoUpdateHumanBones: true (default) — VRMSkeletonManager writes to NORMALIZED bones;
    // humanoid.update() inside vrm.update() handles normalized→raw conversion correctly.
    loader.register((parser: GLTFParser) => new VRMLoaderPlugin(parser));

    loader.load(
      vrmUrl,
      (gltf: GLTF) => {
        if (cancelled) return;
        handleLoad(gltf, () => cancelled);
      },
      undefined,
      (err: unknown) => {
        if (cancelled) return;
        console.error('[AvatarCanvas] Load Error:', err);
        setError(true);
        setLoading(false);
      },
    );

    return () => { cancelled = true; };
  }, [vrmUrl, handleLoad]);

  // ── Web Audio: create / resume context lazily on first user interaction ──
  const ensureAudioContext = (): AudioContext | null => {
    if (typeof window === 'undefined') return null;
    if (!audioCtxRef.current) {
      try {
        const Ctx = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (Ctx) audioCtxRef.current = new Ctx();
      } catch { /* SSR or locked browser */ }
    }
    const ctx = audioCtxRef.current;
    if (ctx && ctx.state === 'suspended') {
      void ctx.resume().catch(() => { /* ignore */ });
    }
    return ctx ?? null;
  };

  /**
   * Wire `audio` element into a shared Web Audio analyser so LipSyncManager
   * can drive the mouth from energy when viseme cues are absent.
   *
   * CRITICAL: `crossOrigin` must be set to 'anonymous' before the audio
   * src is loaded; if it wasn't, `createMediaElementSource` throws a
   * SecurityError. We patch it here defensively (no-op if already set).
   */
  const wireAnalyser = (audio: HTMLAudioElement): void => {
    if (analyserSourceAudioRef.current === audio) return; // already wired
    const ctx = ensureAudioContext();
    if (!ctx) return;

    // Ensure crossOrigin is set — required for MediaElementSource API
    if (!audio.crossOrigin) {
      audio.crossOrigin = 'anonymous';
    }

    try {
      const src = ctx.createMediaElementSource(audio);
      const analyser = ctx.createAnalyser();
      analyser.fftSize        = 512;  // more bins → better mouth resolution
      analyser.smoothingTimeConstant = 0.65;
      src.connect(analyser);
      analyser.connect(ctx.destination);
      analyserRef.current          = analyser;
      analyserSourceAudioRef.current = audio;
      if (process.env.NODE_ENV === 'development') {
        console.log('[AvatarCanvas] ✅ Analyser wired — lip energy drive active');
      }
    } catch (e) {
      // MediaElementSource can only be created once per element;
      // CORS errors also land here — log clearly in dev.
      if (process.env.NODE_ENV === 'development') {
        console.error('[AvatarCanvas] wireAnalyser failed (CORS or already created):', e);
      } else {
        console.warn('[AvatarCanvas] wireAnalyser skipped:', (e as Error).message);
      }
    }
  };

  // Audio Event Listeners + viseme bridge for server-audio path
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onSpeakStart = () => {
      isTalkingRef.current = true;
      ensureAudioContext(); // unblock AudioContext on first speech
    };

    // Server audio path (playServerTTSAudio) dispatches this with the live Audio element.
    // We also use this event from useTTSWithVisemes (Azure client path) after our recent fix.
    const onAudioElement = (e: Event) => {
      const d = (e as CustomEvent<{ audio?: HTMLAudioElement }>).detail;
      if (!d?.audio) return;
      // Update audioElementRef so LipSyncManager tracks currentTime correctly.
      // MUST happen before avatar:speak:start if possible — the event ordering from
      // playServerTTSAudio means they both arrive in the same onplay turn.
      (audioElementRef as React.MutableRefObject<HTMLAudioElement | null>).current = d.audio;
      wireAnalyser(d.audio);
    };

    // Server audio path dispatches viseme timeline separately.
    const onVisemesTimeline = (e: Event) => {
      const d = (e as CustomEvent<{ cues?: unknown[] }>).detail;
      if (!Array.isArray(d?.cues) || d.cues.length === 0) return;
      // Accept both { t, id } (VisemeCue) and raw WS shapes — cast to shared contract
      const validated = (d.cues as Array<{ t?: unknown; id?: unknown }>)
        .filter(c => typeof c.t === 'number' && typeof c.id === 'number')
        .map(c => ({ t: c.t as number, id: c.id as number }));
      if (validated.length > 0) {
        visemeCueQueueRef.current = validated;
      }
    };

    // Clear viseme queue and reset LipSync state at end of utterance
    const onVisemesClear = () => {
      visemeCueQueueRef.current = [];
    };

    const onSpeakEnd = () => {
      isTalkingRef.current = false;
      onVisemesClear();          // also clear visemes on every speak:end
    };

    // avatar:audio:element is registered FIRST so it fires before avatar:speak:start
    // when both dispatch in the same microtask (onplay handler in playServerTTSAudio).
    window.addEventListener('avatar:audio:element', onAudioElement as EventListener);
    window.addEventListener('avatar:speak:start', onSpeakStart);
    window.addEventListener('avatar:speak:end', onSpeakEnd);
    window.addEventListener('avatar:visemes:timeline', onVisemesTimeline as EventListener);
    window.addEventListener('avatar:visemes:clear', onVisemesClear);
    return () => {
      window.removeEventListener('avatar:audio:element', onAudioElement as EventListener);
      window.removeEventListener('avatar:speak:start', onSpeakStart);
      window.removeEventListener('avatar:speak:end', onSpeakEnd);
      window.removeEventListener('avatar:visemes:timeline', onVisemesTimeline as EventListener);
      window.removeEventListener('avatar:visemes:clear', onVisemesClear);
      // Clean up AudioContext on unmount
      if (audioCtxRef.current) {
        void audioCtxRef.current.close().catch(() => { /* ignore */ });
        audioCtxRef.current = null;
        analyserSourceAudioRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useAvatarEventBridge({
    enabled: true,
    connectWebSocket: agentBridgeConnectWebSocket,
    wsUrl: agentBridgeWsUrl,
    isTalkingRef,
    visemeCueQueueRef,
    audioElementRef,
    analyserRef,
    neckGazeYawRef,
    neckGazePitchRef,
    getSharedWebSocket,
    listenWindowEvent: true,
    windowEventName: 'cogni-agent-bridge:message',
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onAgentMessage = (e: Event) => {
      const d = (e as CustomEvent<Record<string, unknown>>).detail ?? {};
      const text = typeof d.text === 'string' ? d.text : '';
      const emotion = typeof d.emotion === 'string' ? d.emotion : '';
      const gesture = typeof d.gesture === 'string' ? d.gesture : '';

      if (gesture) {
        dispatchAvatar('avatar:gesture', { type: gesture, duration: 2 });
      }
      if (emotion) {
        dispatchAvatar('avatar:emotion', { emotion, strength: 0.58 });
      }
      if (text?.trim() && typeof onAgentSpeak === 'function') {
        void Promise.resolve(onAgentSpeak(text.trim()));
      }
    };
    window.addEventListener('agent:message', onAgentMessage as EventListener);
    return () => window.removeEventListener('agent:message', onAgentMessage as EventListener);
  }, [onAgentSpeak]);

  if (loading && !error) return <LoadingFallback />;
  if (error) return <ErrorFallback />;

  const cameraPosition: [number, number, number] = showOfficeEnvironment
    ? [...AVATAR_OFFICE_SCENE_DEFAULTS.cameraPosition]
    : [0, 1.38, -2.65];
  const orbitTarget: [number, number, number] = showOfficeEnvironment
    ? [...AVATAR_OFFICE_SCENE_DEFAULTS.orbitTarget]
    : [0, 1.28, 0];

  return (
    <div ref={r3fEventSourceRef} className="relative w-full h-full bg-[#0a0a12]">
      <Canvas
        eventSource={r3fEventSourceRef as React.RefObject<HTMLElement>}
        shadows
        gl={{ powerPreference: 'high-performance', alpha: false, antialias: true }}
        style={{ width: '100%', height: '100%', display: 'block' }}
        onCreated={({ gl }) => {
          gl.outputColorSpace = THREE.SRGBColorSpace;
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.0;
        }}
      >
        {/* كاميرا أمام الأفاتار (جهة −Z) مع رؤية المكتب خلفه */}
        <PerspectiveCamera
          makeDefault
          position={cameraPosition}
          fov={45}
          near={0.05}
          far={120}
        />

        <CameraUpLock />
        {/*
          ComfortLightingRig يوفر:
            • ambientLight + hemisphereLight + pointLight
            • directionalLight (key) مع castShadow + shadow-mapSize 2048×2048
            • directionalLight fill + rim (castShadow=false)
            • Environment preset="city"
          → لا نُكرّر أياً منها هنا لتجنّب ضوءَي shadow-casting في نفس الـ Canvas،
            وهو ما تسبّب في "undefined.shadowIntensity" (فشل تهيئة directionalLightShadows).
        */}
        <ComfortLightingRig />

        {/* ظل الأقدام (يمنع الطفوان) */}
        <ContactShadows
          position={[0, 0.008, 0]}
          opacity={0.75}
          scale={10}
          blur={2.5}
          far={1.2}
          color="#000000"
        />

        {!showOfficeEnvironment && (
          <gridHelper args={[20, 20, '#333333', '#1a1a1a']} position={[0, -0.01, 0]} />
        )}

        <color attach="background" args={['#0a0a12']} />
        <fog attach="fog" args={['#0a0a12', 4, 22]} />

        <OrbitControls
          enablePan={false}
          enableZoom={true}
          enableRotate={true}
          minDistance={0.5}
          maxDistance={6}
          target={orbitTarget}
          minPolarAngle={Math.PI / 3}
          maxPolarAngle={Math.PI / 2 + 0.1}
          minAzimuthAngle={-Math.PI / 4}
          maxAzimuthAngle={Math.PI / 4}
        />

        <Suspense fallback={null}>
          {showOfficeEnvironment && (
            <OfficeEnvironment
              url={officeGlbUrl}
              position={officePosition}
              scale={officeScale}
            />
          )}
        </Suspense>

        <Suspense fallback={null}>
          {vrm && (
            <group
              ref={groupRef}
              name="AvatarRoot"
              position={avatarPosition}
              scale={avatarScale}
            >
              <primitive object={vrm.scene} />

              <AnimationController
                vrm={vrm}
                isTalkingRef={isTalkingRef}
                neckGazeYawRef={neckGazeYawRef}
                neckGazePitchRef={neckGazePitchRef}
                groupRef={groupRef}
              />

              <LipSyncManager
                vrm={vrm}
                isTalkingRef={isTalkingRef}
                visemeCueQueueRef={visemeCueQueueRef}
                audioElementRef={audioElementRef}
                analyserRef={analyserRef}
              />

              <VRMSkeletonManager
                vrm={vrm}
                neckGazeYawRef={neckGazeYawRef}
                neckGazePitchRef={neckGazePitchRef}
                isTalkingRef={isTalkingRef}
                analyserRef={analyserRef}
                motorSpeedMulRef={motorSpeedMulRef}
                isListeningRef={isListeningRef}
                isThinkingRef={isThinkingRef}
                vrmaActiveRef={vrmaActiveRef}
              />

              {/*
                VRMAPlayer: يُشغّل ملفات .vrma عند توفّرها.
                عند الفشل → النظام الإجرائي في VRMSkeletonManager يعمل تلقائياً.
                يعمل عند priority 5 (بعد VRMSkeletonManager=0).
              */}
              <VRMAPlayer vrm={vrm} vrmaActiveRef={vrmaActiveRef} />

              <GenerativeGestureManager
                vrm={vrm}
                isTalkingRef={isTalkingRef}
                wsUrl={generativeGestureWsUrl}
              />
            </group>
          )}
        </Suspense>
      </Canvas>

      {process.env.NODE_ENV === 'development' && vrm ? (
        <MouseGestureCalibrator vrm={vrm} />
      ) : null}
    </div>
  );
}
