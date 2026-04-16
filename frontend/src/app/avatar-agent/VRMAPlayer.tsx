'use client';

/**
 * VRMAPlayer — مشغّل إيماءات VRMA الشامل.
 *
 * التدفق الأساسي:
 *   • `avatar:vrma:play` { url | path, name?: 'idle', durationMs, loop } — المسار الوحيد لتشغيل الـ mixer (UnifiedGestureEngine / window.VRM_ANIMATION).
 *   • `avatar:gesture` مع `motion: 'vrma'` لا يُحمّل الـ mixer هنا (تجنبًا لازدواجية مع `avatar:vrma:play` من UnifiedGestureEngine) — الرأس/الاتجاه في VRMSkeletonManager.
 *   • `avatar:gesture` بدون `motion: 'vrma'`: تحميل من GESTURE_VRMA_MAP (مسارات قديمة / اختبار فقط).
 *
 * ترتيب useFrame: priority -1 (قبل VRMSkeletonManager=0) → mixer + لقطة vrmaPoseRef دون ترك العظام على وضع الـ mixer.
 *
 * فيزياء منع الاختراق: مُستبعَدة أثناء VRMA — إيماءات VRMA المصمَّمة بشكل صحيح لا تخترق.
 * للإيماءات التي قد تُسبّب اختراقاً، اضبط قيم ARM_OFFSETS في armGestureReference.ts.
 */

import React, { useEffect, useRef } from 'react';
import {
  captureNormalizedHumanoidPose,
  restoreNormalizedHumanoidPose,
  type BonePoseMap,
} from './motion/PoseComposer';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { avatarDebug } from '@/app/avatar-agent/debugAvatar';
import { motionDebug } from '@/lib/avatar/motionDebug';
import {
  DEFAULT_BASE_LOOP_VRMA_URL,
  readVrmaPlayOnLoadUrl,
} from '@/config/avatar';
import { sanitizeVrmaAssetUrl } from '@/constants/gestures';
import {
  forceReleaseMotion,
  recordGesturePlayed,
  releaseMotion,
  setVrmaBaselineLayerActive,
  shouldBlockGestureRepeat,
  tryAcquireMotion,
} from '@/lib/avatar/motionAuthority';
import type { VRM } from '@pixiv/three-vrm';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  VRMAnimationLoaderPlugin,
  createVRMAnimationClip,
  type VRMAnimation,
} from '@pixiv/three-vrm-animation';
import { remapClipForVRM } from './vrmaFingerRemapper';

// ─── نوع الـ GLTF الموسّع بـ vrmAnimations ────────────────────────────────
type GLTFWithVRMAnimations = {
  userData: {
    vrmAnimations?: VRMAnimation[];
  };
};

// ─── خريطة الإيماءة → مسارات VRMA (تُجرَّب بالترتيب — الأول المتاح يُستخدم) ────
const GESTURE_VRMA_MAP: Readonly<Record<string, readonly string[]>> = {
  // ── تفكير ──────────────────────────────────────────────────────────────
  think:           ['/models/animations/Thinking.vrma'],
  thinking:        ['/models/animations/Thinking.vrma'],

  // ── تلويح / تحية ──────────────────────────────────────────────────────
  wave:            ['/models/animations/Waving.vrma', '/models/animations/greeting.vrma'],
  waving:          ['/models/animations/Waving.vrma'],
  greeting:        ['/models/animations/greeting.vrma', '/models/animations/Waving.vrma'],

  // ── تصفيق ──────────────────────────────────────────────────────────────
  clap:            ['/models/animations/Clapping.vrma', '/models/animations/standing-clapping.vrma'],
  clapping:        ['/models/animations/Clapping.vrma'],
  'standing-clapping': ['/models/animations/standing-clapping.vrma'],

  // ── موافقة ──────────────────────────────────────────────────────────────
  agree:           ['/models/animations/Agreeing.vrma'],
  agreeing:        ['/models/animations/Agreeing.vrma'],

  // ── إقرار / إشارة ──────────────────────────────────────────────────────
  acknowledge:     ['/models/animations/Acknowledging.vrma'],
  acknowledging:   ['/models/animations/Acknowledging.vrma'],

  // ── إشارة ──────────────────────────────────────────────────────────────
  point:           ['/models/animations/Pointing.vrma'],
  pointing:        ['/models/animations/Pointing.vrma'],

  // ── شرح ───────────────────────────────────────────────────────────────
  explain:         ['/models/animations/explan.vrma'],
  explan:          ['/models/animations/explan.vrma'],
  board:           ['/models/animations/board.vrma'],

  // ── وداع ───────────────────────────────────────────────────────────────
  goodbye:         ['/models/animations/Goodbye.vrma'],
  bye:             ['/models/animations/Goodbye.vrma'],

  // ── إيموشنال ───────────────────────────────────────────────────────────
  sad:             ['/models/animations/Sad.vrma'],
  angry:           ['/models/animations/Angry.vrma'],
  surprised:       ['/models/animations/Surprised.vrma'],
  surprise:        ['/models/animations/Surprised.vrma'],
  blush:           ['/models/animations/Blush.vrma'],
  sleepy:          ['/models/animations/Sleepy.vrma'],
  sleep:           ['/models/animations/Sleepy.vrma'],
  thankful:        ['/models/animations/thankful.vrma'],

  // ── استرخاء / خامل ──────────────────────────────────────────────────────
  relax:           ['/models/animations/Relax.vrma'],
  idle1:           ['/models/animations/Idle1.vrma'],
  idle2:           ['/models/animations/Idle2.vrma'],
  idle3:           ['/models/animations/Idle3.vrma'],
  idle4:           ['/models/animations/Idle4.vrma'],
  beckon:          ['/models/animations/Beckoning.vrma'],
  beckoning:       ['/models/animations/Beckoning.vrma'],

  // ── حركة / نشاط ──────────────────────────────────────────────────────
  walk:            ['/models/animations/Acknowledging.vrma'],
  walking:         ['/models/animations/Acknowledging.vrma'],
  jump:            ['/models/animations/Acknowledging.vrma'],
  jumping:         ['/models/animations/Acknowledging.vrma'],
  'jump-high':     ['/models/animations/Acknowledging.vrma'],
  jumphigh:        ['/models/animations/Acknowledging.vrma'],
  'stop-walking':  ['/models/animations/Acknowledging.vrma'],
  stopwalking:     ['/models/animations/Acknowledging.vrma'],
  pacing:          ['/models/animations/Acknowledging.vrma'],
  'pacing-and-talking-on-a-phone': ['/models/animations/Acknowledging.vrma'],
  typing:          ['/models/animations/Acknowledging.vrma'],
  type:            ['/models/animations/Acknowledging.vrma'],
  talking:         ['/models/animations/talking.vrma'],
  cheer:           ['/models/animations/Clapping.vrma'],
  cheering:        ['/models/animations/Clapping.vrma'],
  'standing-cheering': ['/models/animations/Clapping.vrma'],

  // ── جلوس ──────────────────────────────────────────────────────────────
  sit:             ['/models/animations/sitting.vrma'],
  sitting:         ['/models/animations/sitting.vrma'],
  'sitting-and-talking':  ['/models/animations/sitting-and-talking.vrma'],
  sittingtalking:         ['/models/animations/sitting-and-talking.vrma'],
  'sitting-and-pointing': ['/models/animations/sitting-and-pointing.vrma'],
  sittingpointing:        ['/models/animations/sitting-and-pointing.vrma'],
  'sitting-disapproval':  ['/models/animations/sitting-disapproval.vrma'],
  sittingdisapproval:     ['/models/animations/sitting-disapproval.vrma'],
  'sitting-talking':      ['/models/animations/sitting-talking.vrma'],
  'sitting-victory':      ['/models/animations/sitting-victory.vrma'],

  // ── النظر حول ────────────────────────────────────────────────────────
  'look-around':   ['/models/animations/look-around.vrma'],
  lookaround:      ['/models/animations/look-around.vrma'],
  'look-around2':  ['/models/animations/look-around2.vrma'],
  lookaround2:     ['/models/animations/look-around2.vrma'],

  // ── اجتماع ────────────────────────────────────────────────────────────
  havingameeting:  ['/models/animations/havingameeting.vrma'],

  // ── حزم VRMA ──────────────────────────────────────────────────────────
  vrma_01:   ['/models/animations/VRMA_MotionPack/vrma/VRMA_02.vrma'],
  vrma01:    ['/models/animations/VRMA_MotionPack/vrma/VRMA_02.vrma'],
  vrma_02:   ['/models/animations/VRMA_MotionPack/vrma/VRMA_02.vrma'],
  vrma02:    ['/models/animations/VRMA_MotionPack/vrma/VRMA_02.vrma'],
  vrma_03:   ['/models/animations/VRMA_MotionPack/vrma/VRMA_02.vrma'],
  vrma03:    ['/models/animations/VRMA_MotionPack/vrma/VRMA_02.vrma'],
  vrma_04:   ['/models/animations/VRMA_MotionPack/vrma/VRMA_02.vrma'],
  vrma04:    ['/models/animations/VRMA_MotionPack/vrma/VRMA_02.vrma'],
  vrma_05:   ['/models/animations/VRMA_MotionPack/vrma/VRMA_02.vrma'],
  vrma05:    ['/models/animations/VRMA_MotionPack/vrma/VRMA_02.vrma'],
  vrma_06:   ['/models/animations/VRMA_MotionPack/vrma/VRMA_02.vrma'],
  vrma06:    ['/models/animations/VRMA_MotionPack/vrma/VRMA_02.vrma'],
  vrma_07:   ['/models/animations/VRMA_MotionPack/vrma/VRMA_02.vrma'],
  vrma07:    ['/models/animations/VRMA_MotionPack/vrma/VRMA_02.vrma'],
} as const;

// ─── إيماءات تُشغَّل في حلقة حتى تُقاطَع ──────────────────────────────────
const LOOP_GESTURES = new Set<string>([
  'idle1', 'idle2', 'idle3', 'idle4', 'relax',
  'sit', 'sitting', 'sitting-and-talking', 'sittingtalking', 'sitting-talking',
]);

// ─── مدد افتراضية لكل إيماءة (ms) ────────────────────────────────────────
const GESTURE_DURATION_MS: Readonly<Record<string, number>> = {
  think: 3000, thinking: 3000,
  wave: 2500, waving: 2500,
  greeting: 3000,
  clap: 2500, clapping: 2500,
  'standing-clapping': 3000,
  agree: 2000, agreeing: 2000,
  acknowledge: 2000, acknowledging: 2000,
  point: 2500, pointing: 2500,
  explain: 3000, explan: 3000,
  board: 4000,
  goodbye: 2500, bye: 2500,
  sad: 3500, angry: 3000,
  surprised: 2000, surprise: 2000,
  blush: 2500, sleepy: 4000, sleep: 4000,
  thankful: 3000,
  relax: 3500,
  beckon: 2500, beckoning: 2500,
  jump: 1500, jumping: 1500,
  'jump-high': 2000, jumphigh: 2000,
  'stop-walking': 1500, stopwalking: 1500,
  cheer: 3000, cheering: 3000, 'standing-cheering': 3000,
  'look-around': 3500, lookaround: 3500,
  'look-around2': 3500, lookaround2: 3500,
  'sitting-and-pointing': 3000, sittingpointing: 3000,
  'sitting-disapproval': 3000, sittingdisapproval: 3000,
  'sitting-victory': 3000,
};

const DEFAULT_DURATION_MS = 2500;

/** Minimum crossfade (s) — keep ≥ 0.25 for stable VRMA handoff. */
const VRMA_CROSSFADE_SEC = 0.26;

/** When false: never run looping baseline VRMA (prevents root drift / 600s authority lock). Procedural + gestures own idle. */
const VRMA_BASELINE_PLAYBACK_ENABLED = false;

/** Documented sample path — asset not in repo; player maps to `DEFAULT_BASE_LOOP_VRMA_URL`. */
const VRMA_IDLE_REQUESTED_PATH =
  '/models/animations/VRMA_MotionPack/vrma/VRMA_Idle.vrma';

function resolveVrmaPlayUrl(detail: VRMAPlayEventDetail): string {
  const raw = (detail.url ?? detail.path ?? '').trim();
  if (
    raw === VRMA_IDLE_REQUESTED_PATH ||
    raw.endsWith('/VRMA_Idle.vrma')
  ) {
    return sanitizeVrmaAssetUrl(DEFAULT_BASE_LOOP_VRMA_URL);
  }
  if (raw) return sanitizeVrmaAssetUrl(raw);
  const name = (detail.name ?? '').trim().toLowerCase();
  if (name === 'idle') return sanitizeVrmaAssetUrl(DEFAULT_BASE_LOOP_VRMA_URL);
  return '';
}

/** Looping baseline idle VRMA — mixer runs but does not block other motion systems. */
function isBaselineIdleVrma(detail: VRMAPlayEventDetail, resolvedUrl: string, loop: boolean): boolean {
  return loop && resolvedUrl === DEFAULT_BASE_LOOP_VRMA_URL;
}

// ─── نوع حدث التشغيل المباشر ─────────────────────────────────────────────
export type VRMAPlayEventDetail = {
  /** مسار مباشر لملف VRMA */
  url?: string;
  /** مرادف لـ `url` (مثال: مسارات من حدث مخصّص) */
  path?: string;
  /** عند `idle` بدون url/path يُستخدم المقطع الافتراضي الحلقي */
  name?: string;
  durationMs?: number;
  loop?: boolean;
  /** Engine stem (optional) — for logging / dedupe hints. */
  vrmaStem?: string;
  /** Brain contract urgency 0–1 → crossFade duration 0.4−0.2×u */
  urgency?: number;
  /** Phase 5 — slower crossfade when cognitive load high */
  cognitiveLoad?: number;
  /** داخلي — عدّ محاولات إعادة التحميل بعد الفشل */
  _retry?: number;
};

declare global {
  interface Window {
    /** Single entry for VRMA mixer playback (same as `avatar:vrma:play`). */
    VRM_ANIMATION?: {
      playVRMA: (url: string, opts?: { durationMs?: number; loop?: boolean }) => void;
    };
  }
}

export type VRMAPlayerProps = {
  vrm: VRM | null;
  /** مرجع مشترك مع VRMSkeletonManager — true أثناء تشغيل VRMA */
  vrmaActiveRef: React.MutableRefObject<boolean>;
  /** لقطة عظام مطبّعة من الـ mixer — يستهلكها PoseComposer في VRMSkeletonManager */
  vrmaPoseRef?: React.MutableRefObject<{ seq: number; bones: BonePoseMap } | null>;
};

// ─── أداة التحميل (singleton) + cache ───────────────────────────────────────
let _loader: GLTFLoader | null = null;
function getLoader(): GLTFLoader {
  if (!_loader) {
    _loader = new GLTFLoader();
    // Duplicate @types/three trees break GLTFLoader.register typing; runtime is correct.
    (_loader as { register: (fn: (parser: unknown) => unknown) => void }).register(
      (parser: unknown) => new VRMAnimationLoaderPlugin(parser as never),
    );
  }
  return _loader;
}

/** URL → clip — يُخزَّن فقط عند النجاح حتى تعمل إعادة المحاولة بعد فشل الشبكة/التحميل */
const clipCache = new Map<string, THREE.AnimationClip>();

/** محاولة تحميل مسار VRMA واحد — تُعيد null عند الفشل (بدون throw) */
async function tryLoadClip(url: string, vrm: VRM): Promise<THREE.AnimationClip | null> {
  const cached = clipCache.get(url);
  if (cached) return cached;
  try {
    const gltf = await getLoader().loadAsync(url) as unknown as GLTFWithVRMAnimations;
    const anims = gltf.userData.vrmAnimations;
    if (!anims || anims.length === 0) {
      return null;
    }
    let clip = createVRMAnimationClip(anims[0], vrm) as THREE.AnimationClip;
    // أصلح أسماء عظام الأصابع ومحاور الإحداثيات (يحل مشكلة تشوّه الأصابع في VRMA)
    clip = remapClipForVRM(clip, vrm) as THREE.AnimationClip;
    clipCache.set(url, clip);
    if (process.env.NODE_ENV === 'development') {
      console.log(`[VRMAPlayer] ✅ Loaded: ${url} (${clip.duration.toFixed(2)}s)`);
    }
    return clip;
  } catch {
    return null;
  }
}

/**
 * يُحمِّل أول VRMA متاح من قائمة URL-s — الباقي يُخزَّن كـ null.
 * يُعيد null إذا فشلت جميع المحاولات (النظام الإجرائي يعمل كاحتياط).
 */
async function loadFirstAvailableClip(
  urls: readonly string[],
  vrm: VRM,
): Promise<THREE.AnimationClip | null> {
  for (const url of urls) {
    const clip = await tryLoadClip(url, vrm);
    if (clip) return clip;
  }
  return null;
}

// ─── المكوّن الرئيسي ─────────────────────────────────────────────────────────
/**
 * مكوّن R3F يُشغّل ملفات VRMA على نموذج VRM.
 * يجب تضمينه داخل `<Canvas>` بعد VRMSkeletonManager.
 */
export function VRMAPlayer({ vrm, vrmaActiveRef, vrmaPoseRef }: VRMAPlayerProps): null {
  const mixerRef           = useRef<THREE.AnimationMixer | null>(null);
  const currentActionRef   = useRef<THREE.AnimationAction | null>(null);
  const actionEndMsRef     = useRef<number>(0);
  const isLoopingRef       = useRef<boolean>(false);
  const vrmaPoseSeqRef     = useRef(0);
  /** Motion gate: edge-dispatch `avatar:vrma:active` for UnifiedGestureEngine */
  const prevVrmaActiveRef  = useRef(false);
  /** DOM timer ids (`setTimeout` returns `number` in browser typings). */
  const vrmaRetryTimeoutsRef = useRef<number[]>([]);
  const lastPlayingClipUuidRef = useRef<string | null>(null);
  /** baseline = looping default idle only — does not claim motion authority (gestures may enqueue). */
  const lastAuthorityTierRef = useRef<'baseline' | 'full'>('full');
  /** Debounce forced baseline resume when mixer has no active clip (stops authority flicker gaps). */
  const lastForceBaselineAtRef = useRef(0);

  // ── أنشئ/دمّر الـ mixer عند تغيُّر الـ VRM ──────────────────────────────
  useEffect(() => {
    if (!vrm) {
      mixerRef.current?.stopAllAction();
      mixerRef.current        = null;
      currentActionRef.current = null;
      lastPlayingClipUuidRef.current = null;
      lastAuthorityTierRef.current = 'full';
      setVrmaBaselineLayerActive(false);
      releaseMotion('VRMA');
      vrmaActiveRef.current   = false;
      if (prevVrmaActiveRef.current) {
        prevVrmaActiveRef.current = false;
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('avatar:vrma:active', { detail: { active: false } }));
        }
      }
      return;
    }
    const mixer = new THREE.AnimationMixer(vrm.scene);
    mixerRef.current = mixer;
    return () => {
      mixer.stopAllAction();
      vrmaActiveRef.current = false;
      setVrmaBaselineLayerActive(false);
      releaseMotion('VRMA');
    };
  }, [vrm, vrmaActiveRef]);

  // Single public API — mirrors `avatar:vrma:play` (no duplicate procedural path).
  useEffect(() => {
    if (!vrm || typeof window === 'undefined') return;
    window.VRM_ANIMATION = {
      playVRMA: (url: string, opts?: { durationMs?: number; loop?: boolean }) => {
        window.dispatchEvent(
          new CustomEvent<VRMAPlayEventDetail>('avatar:vrma:play', {
            detail: { url, durationMs: opts?.durationMs, loop: opts?.loop },
          }),
        );
      },
    };
    return () => {
      if (window.VRM_ANIMATION) delete window.VRM_ANIMATION;
    };
  }, [vrm]);

  /** Optional one-shot `avatar:vrma:play` after load — `NEXT_PUBLIC_VRMA_PLAY_ON_LOAD` (trigger-only smoke test). */
  useEffect(() => {
    const url = readVrmaPlayOnLoadUrl();
    if (!vrm || !url || typeof window === 'undefined') return;
    const t = window.setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent<VRMAPlayEventDetail>('avatar:vrma:play', {
          detail: {
            url,
            durationMs: 5000,
            loop: false,
          },
        }),
      );
      if (process.env.NODE_ENV === 'development') {
        avatarDebug('[VRMAPlayer] on-load smoke test:', url);
      }
    }, 500);
    return () => clearTimeout(t);
  }, [vrm]);

  // ── دالة التشغيل (تُحدَّث كل render بدون إنشاء مستمع جديد) ──────────────
  const playClipRef = useRef<
    (
      clip: THREE.AnimationClip,
      durationMs: number,
      loop: boolean,
      authorityTier?: 'baseline' | 'full',
      urgency?: number,
      cognitiveLoad?: number,
    ) => boolean
  >(() => false);

  playClipRef.current = (
    clip: THREE.AnimationClip,
    durationMs: number,
    loop: boolean,
    authorityTier: 'baseline' | 'full' = 'full',
    urgency?: number,
    cognitiveLoad?: number,
  ): boolean => {
    const mixer = mixerRef.current;
    if (!mixer) {
      motionDebug('VRMA IGNORED:', 'no-mixer', clip.name);
      return false;
    }

    if (!VRMA_BASELINE_PLAYBACK_ENABLED && authorityTier === 'baseline') {
      motionDebug('VRMA IGNORED:', 'baseline-tier-disabled');
      return false;
    }

    lastAuthorityTierRef.current = authorityTier;

    const cur = currentActionRef.current;
    if (cur && cur.isRunning() && lastPlayingClipUuidRef.current === clip.uuid) {
      if (process.env.NODE_ENV === 'development') {
        avatarDebug(`[VRMAPlayer] skip — same clip already playing (${clip.name || clip.uuid})`);
      }
      motionDebug('VRMA IGNORED:', 'same-clip-already-playing', clip.name);
      return false;
    }

    if (authorityTier === 'baseline') {
      // Hard VRMA lock: baseline holds the VRMA authority tier so REACTION/GESTURE cannot flicker in.
      void tryAcquireMotion('VRMA', 600_000);
    } else {
      const lockMs = (loop ? 600_000 : durationMs) + VRMA_CROSSFADE_SEC * 1000 + 240;
      if (!tryAcquireMotion('VRMA', lockMs)) {
        if (process.env.NODE_ENV === 'development') {
          avatarDebug('[VRMAPlayer] motion authority — blocked full VRMA play');
        }
        motionDebug('VRMA IGNORED:', 'tryAcquireMotion-VRMA-failed', clip.name);
        return false;
      }
    }

    const cl =
      typeof cognitiveLoad === 'number' ? THREE.MathUtils.clamp(cognitiveLoad, 0, 1) : 0;
    const fadeSec = THREE.MathUtils.clamp(
      (typeof urgency === 'number' ? 0.4 - urgency * 0.2 : VRMA_CROSSFADE_SEC) * (1 + cl * 0.6),
      0.2,
      0.95,
    );

    const nextAction = mixer.clipAction(clip);
    nextAction.reset();
    nextAction.setLoop(
      loop ? THREE.LoopRepeat : THREE.LoopOnce,
      loop ? Infinity : 1,
    );
    nextAction.clampWhenFinished = !loop;

    if (cur && cur.isRunning()) {
      cur.crossFadeTo(nextAction, fadeSec, false);
    } else {
      nextAction.fadeIn(fadeSec).play();
    }

    currentActionRef.current = nextAction;
    lastPlayingClipUuidRef.current = clip.uuid;
    actionEndMsRef.current   = (typeof performance !== 'undefined' ? performance.now() : Date.now()) + durationMs;
    isLoopingRef.current     = loop;

    if (process.env.NODE_ENV === 'development') {
      avatarDebug(
        `[VRMAPlayer] ▶️ "${clip.name}" | ${durationMs}ms | loop=${loop}`,
      );
    }
    motionDebug('VRMA START:', clip.name, 'durationMs=', durationMs, 'loop=', loop, 'tier=', authorityTier);
    return true;
  };

  // ── استماع لـ avatar:gesture ─────────────────────────────────────────────
  useEffect(() => {
    if (!vrm) return;

    const onGesture = async (e: Event) => {
      const detail = (e as CustomEvent<Record<string, unknown>>).detail ?? {};
      // Engine already fired `avatar:vrma:play` — do not load VRMA again from this event.
      if (detail.motion === 'vrma') {
        motionDebug('VRMA IGNORED:', 'avatar:gesture-detail-motion-vrma');
        return;
      }

      // استخرج اسم الإيماءة بالترتيب: gesture → vrmaStem → type → name
      const rawGesture =
        (typeof detail.gesture   === 'string' && detail.gesture.trim())   ||
        (typeof detail.vrmaStem  === 'string' && detail.vrmaStem.trim())  ||
        (typeof detail.type      === 'string' && detail.type.trim())      ||
        (typeof detail.name      === 'string' && detail.name.trim())      ||
        '';
      if (!rawGesture) {
        motionDebug('VRMA IGNORED:', 'avatar:gesture-empty-name');
        return;
      }

      const key = rawGesture.toLowerCase().replace(/\s+/g, '-');

      if (shouldBlockGestureRepeat(key)) {
        if (process.env.NODE_ENV === 'development') {
          avatarDebug(`[VRMAPlayer] skip — same gesture VRMA recently: "${key}"`);
        }
        motionDebug('VRMA IGNORED:', 'gesture-repeat', key);
        return;
      }

      // الإيماءة الخاملة (idle) تُعالَج في VRMSkeletonManager — لا VRMA هنا
      if (key === 'idle') {
        motionDebug('VRMA IGNORED:', 'idle-procedural-path', key);
        return;
      }

      // إجرائي فقط: يتجاهل VRMA ويترك VRMSkeletonManager يطبّق ARM_OFFSETS
      const srcRaw = typeof detail.source === 'string' ? detail.source.trim().toLowerCase() : '';
      if (srcRaw === 'procedural') {
        if (process.env.NODE_ENV === 'development') {
          avatarDebug(`[VRMAPlayer] source=procedural — skipping VRMA for "${key}"`);
        }
        motionDebug('VRMA IGNORED:', 'source-procedural', key);
        return;
      }

      const urls = GESTURE_VRMA_MAP[key];
      if (!urls || urls.length === 0) {
        // اسم الإيماءة غير موجود في الخريطة → استخدام الإجرائي
        if (process.env.NODE_ENV === 'development') {
          avatarDebug(`[VRMAPlayer] ℹ️ No VRMA for "${key}" — procedural fallback`);
        }
        motionDebug('VRMA IGNORED:', 'no-url-map', key);
        return;
      }

      const clip = await loadFirstAvailableClip(urls, vrm);
      if (!clip) {
        if (process.env.NODE_ENV === 'development') {
          avatarDebug(`[VRMAPlayer] ⚠️ VRMA not found for "${key}" — procedural fallback`);
        }
        motionDebug('VRMA IGNORED:', 'loadFirstAvailableClip-null', key);
        return;
      }

      // احسب المدة (دائماً: duration من الحدث أو الثابت أو مدة الـ clip × 1.05)
      const loop = LOOP_GESTURES.has(key);
      const detailDurationMs =
        typeof detail.durationMs === 'number' && detail.durationMs > 0
          ? detail.durationMs
          : typeof detail.duration === 'number' && detail.duration > 0
            ? detail.duration < 100 ? detail.duration * 1000 : detail.duration
            : 0;
      const durationMs = detailDurationMs
        || GESTURE_DURATION_MS[key]
        || (clip.duration > 0 ? clip.duration * 1050 : DEFAULT_DURATION_MS);

      const played = playClipRef.current(clip, durationMs, loop, 'full');
      if (played) {
        recordGesturePlayed(key);
      } else {
        motionDebug('VRMA IGNORED:', 'playClip-returned-false', key, clip.name);
      }
    };

    window.addEventListener('avatar:gesture', onGesture);
    return () => window.removeEventListener('avatar:gesture', onGesture);
  }, [vrm]);

  // ── استماع لـ avatar:vrma:play (تشغيل مباشر بمسار) ──────────────────────
  useEffect(() => {
    if (!vrm) return;

    const VRMA_PLAY_RETRY_CAP = 24;

    const scheduleRetry = (
      detail: VRMAPlayEventDetail,
      url: string,
      attempt: number,
    ) => {
      if (attempt >= VRMA_PLAY_RETRY_CAP) return;
      const tid = window.setTimeout(() => {
        vrmaRetryTimeoutsRef.current = vrmaRetryTimeoutsRef.current.filter((x) => x !== tid);
        window.dispatchEvent(
          new CustomEvent<VRMAPlayEventDetail>('avatar:vrma:play', {
            detail: {
              ...detail,
              url,
              path: undefined,
              name: undefined,
              _retry: attempt + 1,
            },
          }),
        );
      }, 1000);
      vrmaRetryTimeoutsRef.current.push(tid);
    };

    const onPlay = async (e: Event) => {
      const detail = (e as CustomEvent<VRMAPlayEventDetail>).detail;
      if (!detail) {
        motionDebug('VRMA IGNORED:', 'avatar:vrma:play-no-detail');
        return;
      }
      const url = resolveVrmaPlayUrl(detail);
      if (!url) {
        motionDebug('VRMA IGNORED:', 'resolveVrmaPlayUrl-null', detail);
        return;
      }
      const loop = detail.loop ?? false;
      if (!VRMA_BASELINE_PLAYBACK_ENABLED && isBaselineIdleVrma(detail, url, loop)) {
        motionDebug('VRMA IGNORED:', 'baseline-loop-not-loaded');
        return;
      }
      const attempt = detail._retry ?? 0;
      const clip = await tryLoadClip(url, vrm);
      if (!clip) {
        if (process.env.NODE_ENV === 'development') {
          avatarDebug(
            `[VRMAPlayer] VRMA load failed — retry in 1s: ${url} (attempt ${attempt})`,
          );
        }
        motionDebug('VRMA IGNORED:', 'tryLoadClip-null', url, 'attempt', attempt);
        scheduleRetry(detail, url, attempt);
        return;
      }
      const durationMs =
        detail.durationMs ??
        (clip.duration > 0 ? clip.duration * 1050 : DEFAULT_DURATION_MS);
      const tier = isBaselineIdleVrma(detail, url, loop) ? 'baseline' : 'full';
      const ok = playClipRef.current(
        clip,
        durationMs,
        loop,
        tier,
        detail.urgency,
        detail.cognitiveLoad,
      );
      if (!ok) {
        motionDebug('VRMA IGNORED:', 'playClip-false-after-load', clip.name, url);
      }
    };

    const onBargeIn = (): void => {
      forceReleaseMotion('avatar:vrma:barge-in');
      const mixer = mixerRef.current;
      const cur = currentActionRef.current;
      if (!mixer || !cur) return;
      const fade = Math.max(VRMA_CROSSFADE_SEC, 0.36);
      cur.fadeOut(fade);
      currentActionRef.current = null;
      lastPlayingClipUuidRef.current = null;
      isLoopingRef.current = false;
      actionEndMsRef.current = performance.now();
      const resumeMs = Math.round(fade * 1000) + 90;
      const tid = window.setTimeout(() => {
        vrmaRetryTimeoutsRef.current = vrmaRetryTimeoutsRef.current.filter((x) => x !== tid);
        if (!VRMA_BASELINE_PLAYBACK_ENABLED) return;
        window.dispatchEvent(
          new CustomEvent<VRMAPlayEventDetail>('avatar:vrma:play', {
            detail: {
              name: 'idle',
              path: VRMA_IDLE_REQUESTED_PATH,
              loop: true,
              durationMs: 600_000,
            },
          }),
        );
      }, resumeMs);
      vrmaRetryTimeoutsRef.current.push(tid);
    };

    window.addEventListener('avatar:vrma:play', onPlay as EventListener);
    window.addEventListener('avatar:vrma:barge-in', onBargeIn);
    return () => {
      window.removeEventListener('avatar:vrma:play', onPlay as EventListener);
      window.removeEventListener('avatar:vrma:barge-in', onBargeIn);
      for (const t of vrmaRetryTimeoutsRef.current) window.clearTimeout(t);
      vrmaRetryTimeoutsRef.current = [];
    };
  }, [vrm]);

  /**
   * Base motion: always dispatch looping idle VRMA after VRM is ready so `vrmaActiveRef` /
   * `vrmaPoseRef` stay driven. If `NEXT_PUBLIC_VRMA_PLAY_ON_LOAD` is set, delay until after
   * the one-shot smoke clip so it does not replace this loop mid-debug.
   */
  useEffect(() => {
    if (!vrm || typeof window === 'undefined' || !VRMA_BASELINE_PLAYBACK_ENABLED) return;
    const envUrl = readVrmaPlayOnLoadUrl();
    const delayMs = envUrl ? 6000 : 350;
    const tid = window.setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent<VRMAPlayEventDetail>('avatar:vrma:play', {
          detail: {
            name: 'idle',
            path: VRMA_IDLE_REQUESTED_PATH,
            loop: true,
            durationMs: 600_000,
          },
        }),
      );
    }, delayMs);
    return () => window.clearTimeout(tid);
  }, [vrm]);

  // ── حلقة الإطارات — قبل VRMSkeletonManager: عيّن mixer ثم لقطة وضعية فقط ──
  useFrame((_, delta) => {
    const mixer = mixerRef.current;
    if (!mixer) {
      vrmaActiveRef.current = false;
      setVrmaBaselineLayerActive(false);
      releaseMotion('VRMA');
      if (vrmaPoseRef) vrmaPoseRef.current = null;
      return;
    }

    const nowMs     = performance.now();
    const looping   = isLoopingRef.current;
    const hasAction = currentActionRef.current !== null;

    const isActive =
      hasAction &&
      currentActionRef.current!.isRunning() &&
      (looping || nowMs < actionEndMsRef.current + 600);

    if (!isActive && hasAction) {
      currentActionRef.current!.fadeOut(Math.max(VRMA_CROSSFADE_SEC, 0.35));
      currentActionRef.current = null;
      lastPlayingClipUuidRef.current = null;
      isLoopingRef.current     = false;
    }

    vrmaActiveRef.current = isActive;

    const tier = lastAuthorityTierRef.current;
    setVrmaBaselineLayerActive(Boolean(isActive && looping && tier === 'baseline'));

    const noMixerClip = currentActionRef.current === null;

    if (prevVrmaActiveRef.current !== isActive) {
      const was = prevVrmaActiveRef.current;
      prevVrmaActiveRef.current = isActive;
      if (was && !isActive) {
        motionDebug('VRMA END');
      }
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('avatar:vrma:active', { detail: { active: isActive } }),
        );
      }
    }

    // Never release VRMA authority from this frame loop — prevents REACTION/VRMA fight (flicker).
    // Authority clears only on mixer teardown, barge-in, or explicit release elsewhere.

    if (
      VRMA_BASELINE_PLAYBACK_ENABLED
      && !isActive
      && noMixerClip
      && typeof window !== 'undefined'
    ) {
      const n = performance.now();
      if (n - lastForceBaselineAtRef.current > 520) {
        lastForceBaselineAtRef.current = n;
        window.dispatchEvent(
          new CustomEvent<VRMAPlayEventDetail>('avatar:vrma:play', {
            detail: {
              name: 'idle',
              path: VRMA_IDLE_REQUESTED_PATH,
              loop: true,
              durationMs: 600_000,
            },
          }),
        );
      }
    }

    if (!isActive) {
      if (vrmaPoseRef) vrmaPoseRef.current = null;
      return;
    }

    const safeDelta = Math.min(delta, 0.1);
    const humanoid = vrm?.humanoid;
    if (vrmaPoseRef && humanoid) {
      const snap: BonePoseMap = new Map();
      captureNormalizedHumanoidPose(humanoid, snap);
      mixer.update(safeDelta);
      const posed: BonePoseMap = new Map();
      captureNormalizedHumanoidPose(humanoid, posed);
      restoreNormalizedHumanoidPose(humanoid, snap);
      vrmaPoseSeqRef.current += 1;
      vrmaPoseRef.current = { seq: vrmaPoseSeqRef.current, bones: posed };
    } else {
      mixer.update(safeDelta);
    }
  }, -1);

  return null;
}
