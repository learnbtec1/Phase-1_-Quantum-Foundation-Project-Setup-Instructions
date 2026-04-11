'use client';

/**
 * VRMAPlayer — مشغّل إيماءات VRMA الشامل.
 *
 * التدفق:
 *   1. يستمع لحدث `avatar:gesture` → يحدد VRMA المقابل من GESTURE_VRMA_MAP.
 *   2. يُحاول تحميل الملف (تسلسل URL مع cache) → يُشغّل عبر AnimationMixer.
 *   3. عند الفشل (ملف غير موجود): يبقى `vrmaActiveRef = false` → النظام الإجرائي يعمل.
 *   4. يُعيّن `vrmaActiveRef.current = true` أثناء التشغيل → يُوقف الإيماءات الإجرائية.
 *   5. يدعم `avatar:vrma:play` لتشغيل ملف VRMA مباشرةً بمساره.
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
import type { VRM } from '@pixiv/three-vrm';
import {
  GLTFLoader,
  type GLTFParser,
} from 'three/examples/jsm/loaders/GLTFLoader.js';
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
  walk:            ['/models/animations/Walking.vrma'],
  walking:         ['/models/animations/Walking.vrma'],
  jump:            ['/models/animations/Jump.vrma'],
  jumping:         ['/models/animations/Jump.vrma'],
  'jump-high':     ['/models/animations/jump-high.vrma'],
  jumphigh:        ['/models/animations/jump-high.vrma'],
  'stop-walking':  ['/models/animations/stop-walking.vrma'],
  stopwalking:     ['/models/animations/stop-walking.vrma'],
  pacing:          ['/models/animations/pacing-and-talking-on-a-phone.vrma'],
  'pacing-and-talking-on-a-phone': ['/models/animations/pacing-and-talking-on-a-phone.vrma'],
  typing:          ['/models/animations/Typing.vrma'],
  type:            ['/models/animations/Typing.vrma'],
  talking:         ['/models/animations/talking.vrma'],
  cheer:           ['/models/animations/standing-cheering.vrma'],
  cheering:        ['/models/animations/standing-cheering.vrma'],
  'standing-cheering': ['/models/animations/standing-cheering.vrma'],

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
  vrma_01:   ['/models/animations/VRMA_MotionPack/vrma/VRMA_01.vrma'],
  vrma01:    ['/models/animations/VRMA_MotionPack/vrma/VRMA_01.vrma'],
  vrma_02:   ['/models/animations/VRMA_MotionPack/vrma/VRMA_02.vrma'],
  vrma02:    ['/models/animations/VRMA_MotionPack/vrma/VRMA_02.vrma'],
  vrma_03:   ['/models/animations/VRMA_MotionPack/vrma/VRMA_03.vrma'],
  vrma03:    ['/models/animations/VRMA_MotionPack/vrma/VRMA_03.vrma'],
  vrma_04:   ['/models/animations/VRMA_MotionPack/vrma/VRMA_04.vrma'],
  vrma04:    ['/models/animations/VRMA_MotionPack/vrma/VRMA_04.vrma'],
  vrma_05:   ['/models/animations/VRMA_MotionPack/vrma/VRMA_05.vrma'],
  vrma05:    ['/models/animations/VRMA_MotionPack/vrma/VRMA_05.vrma'],
  vrma_06:   ['/models/animations/VRMA_MotionPack/vrma/VRMA_06.vrma'],
  vrma06:    ['/models/animations/VRMA_MotionPack/vrma/VRMA_06.vrma'],
  vrma_07:   ['/models/animations/VRMA_MotionPack/vrma/VRMA_07.vrma'],
  vrma07:    ['/models/animations/VRMA_MotionPack/vrma/VRMA_07.vrma'],
} as const;

// ─── إيماءات تُشغَّل في حلقة حتى تُقاطَع ──────────────────────────────────
const LOOP_GESTURES = new Set<string>([
  'idle1', 'idle2', 'idle3', 'idle4', 'relax',
  'sit', 'sitting', 'sitting-and-talking', 'sittingtalking', 'sitting-talking',
  'typing', 'type',
  'walk', 'walking',
  'pacing', 'pacing-and-talking-on-a-phone',
  'havingameeting', 'talking',
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

// ─── نوع حدث التشغيل المباشر ─────────────────────────────────────────────
export type VRMAPlayEventDetail = {
  /** مسار مباشر لملف VRMA */
  url: string;
  durationMs?: number;
  loop?: boolean;
};

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
    _loader.register((parser: GLTFParser) => new VRMAnimationLoaderPlugin(parser));
  }
  return _loader;
}

/** URL → clip مخزَّن (null = الملف غير موجود أو به خطأ) */
const clipCache = new Map<string, THREE.AnimationClip | null>();

/** محاولة تحميل مسار VRMA واحد — تُعيد null عند الفشل (بدون throw) */
async function tryLoadClip(url: string, vrm: VRM): Promise<THREE.AnimationClip | null> {
  if (clipCache.has(url)) return clipCache.get(url) ?? null;
  try {
    const gltf = await getLoader().loadAsync(url) as unknown as GLTFWithVRMAnimations;
    const anims = gltf.userData.vrmAnimations;
    if (!anims || anims.length === 0) {
      clipCache.set(url, null);
      return null;
    }
    let clip = createVRMAnimationClip(anims[0], vrm);
    // أصلح أسماء عظام الأصابع ومحاور الإحداثيات (يحل مشكلة تشوّه الأصابع في VRMA)
    clip = remapClipForVRM(clip, vrm);
    clipCache.set(url, clip);
    if (process.env.NODE_ENV === 'development') {
      console.log(`[VRMAPlayer] ✅ Loaded: ${url} (${clip.duration.toFixed(2)}s)`);
    }
    return clip;
  } catch {
    clipCache.set(url, null);
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

  // ── أنشئ/دمّر الـ mixer عند تغيُّر الـ VRM ──────────────────────────────
  useEffect(() => {
    if (!vrm) {
      mixerRef.current?.stopAllAction();
      mixerRef.current        = null;
      currentActionRef.current = null;
      vrmaActiveRef.current   = false;
      return;
    }
    const mixer = new THREE.AnimationMixer(vrm.scene);
    mixerRef.current = mixer;
    return () => {
      mixer.stopAllAction();
      vrmaActiveRef.current = false;
    };
  }, [vrm, vrmaActiveRef]);

  // ── دالة التشغيل (تُحدَّث كل render بدون إنشاء مستمع جديد) ──────────────
  const playClipRef = useRef<
    (clip: THREE.AnimationClip, durationMs: number, loop: boolean) => void
  >(() => {});

  playClipRef.current = (
    clip: THREE.AnimationClip,
    durationMs: number,
    loop: boolean,
  ) => {
    const mixer = mixerRef.current;
    if (!mixer) return;

    // أوقف الإيماءة السابقة بتلاشٍ سلس
    if (currentActionRef.current) {
      currentActionRef.current.fadeOut(0.25);
    }

    const action = mixer.clipAction(clip);
    action.reset();
    action.setLoop(
      loop ? THREE.LoopRepeat : THREE.LoopOnce,
      loop ? Infinity : 1,
    );
    action.clampWhenFinished = !loop;
    action.fadeIn(0.25).play();

    currentActionRef.current = action;
    actionEndMsRef.current   = performance.now() + durationMs;
    isLoopingRef.current     = loop;

    if (process.env.NODE_ENV === 'development') {
      console.log(
        `[VRMAPlayer] ▶️ "${clip.name}" | ${durationMs}ms | loop=${loop}`,
      );
    }
  };

  // ── استماع لـ avatar:gesture ─────────────────────────────────────────────
  useEffect(() => {
    if (!vrm) return;

    const onGesture = async (e: Event) => {
      const detail = (e as CustomEvent<Record<string, unknown>>).detail ?? {};

      // استخرج اسم الإيماءة بالترتيب: gesture → vrmaStem → type → name
      const rawGesture =
        (typeof detail.gesture   === 'string' && detail.gesture.trim())   ||
        (typeof detail.vrmaStem  === 'string' && detail.vrmaStem.trim())  ||
        (typeof detail.type      === 'string' && detail.type.trim())      ||
        (typeof detail.name      === 'string' && detail.name.trim())      ||
        '';
      if (!rawGesture) return;

      const key = rawGesture.toLowerCase().replace(/\s+/g, '-');

      // الإيماءة الخاملة (idle) تُعالَج في VRMSkeletonManager — لا VRMA هنا
      if (key === 'idle') return;

      // إجرائي فقط: يتجاهل VRMA ويترك VRMSkeletonManager يطبّق ARM_OFFSETS
      const srcRaw = typeof detail.source === 'string' ? detail.source.trim().toLowerCase() : '';
      if (srcRaw === 'procedural') {
        if (process.env.NODE_ENV === 'development') {
          console.log(`[VRMAPlayer] source=procedural — skipping VRMA for "${key}"`);
        }
        return;
      }

      const urls = GESTURE_VRMA_MAP[key];
      if (!urls || urls.length === 0) {
        // اسم الإيماءة غير موجود في الخريطة → استخدام الإجرائي
        if (process.env.NODE_ENV === 'development') {
          console.log(`[VRMAPlayer] ℹ️ No VRMA for "${key}" — procedural fallback`);
        }
        return;
      }

      const clip = await loadFirstAvailableClip(urls, vrm);
      if (!clip) {
        if (process.env.NODE_ENV === 'development') {
          console.log(`[VRMAPlayer] ⚠️ VRMA not found for "${key}" — procedural fallback`);
        }
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

      playClipRef.current(clip, durationMs, loop);
    };

    window.addEventListener('avatar:gesture', onGesture);
    return () => window.removeEventListener('avatar:gesture', onGesture);
  }, [vrm]);

  // ── استماع لـ avatar:vrma:play (تشغيل مباشر بمسار) ──────────────────────
  useEffect(() => {
    if (!vrm) return;

    const onPlay = async (e: Event) => {
      const detail = (e as CustomEvent<VRMAPlayEventDetail>).detail;
      if (!detail?.url) return;
      const clip = await tryLoadClip(detail.url, vrm);
      if (!clip) return;
      const durationMs =
        detail.durationMs ??
        (clip.duration > 0 ? clip.duration * 1050 : DEFAULT_DURATION_MS);
      playClipRef.current(clip, durationMs, detail.loop ?? false);
    };

    window.addEventListener('avatar:vrma:play', onPlay as EventListener);
    return () => window.removeEventListener('avatar:vrma:play', onPlay as EventListener);
  }, [vrm]);

  // ── حلقة الإطارات — قبل VRMSkeletonManager: عيّن mixer ثم لقطة وضعية فقط ──
  useFrame((_, delta) => {
    const mixer = mixerRef.current;
    if (!mixer) {
      vrmaActiveRef.current = false;
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
      currentActionRef.current!.fadeOut(0.35);
      currentActionRef.current = null;
      isLoopingRef.current     = false;
    }

    vrmaActiveRef.current = isActive;

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
