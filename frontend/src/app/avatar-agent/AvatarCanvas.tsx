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

import React, { Suspense, useCallback, useMemo, useRef, useState, useEffect } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, SpotLight, SoftShadows, ContactShadows, OrbitControls, PerspectiveCamera, useTexture, useGLTF } from '@react-three/drei';

import { useControls, Leva } from 'leva';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { VRM, VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import {
  VRMAnimationLoaderPlugin,
  VRMLookAtQuaternionProxy,
  createVRMAnimationClip,
} from '@pixiv/three-vrm-animation';
import type { VRMAnimation } from '@pixiv/three-vrm-animation';
import styles from './AvatarCanvas.module.css';
import { CameraUpLock } from './CameraUpLock';
import { createNoise3D } from 'simplex-noise';
import { Easing, lerp } from './utils';
import {
  VRM_FALLBACKS,
  BREATHE_BASE_HZ,
  PHYSICS_CONFIG,
  BLINK_MIN_SEC,
  BLINK_MAX_SEC,
  GAZE_FIXATE_IDLE_MIN_MS,
  GAZE_FIXATE_IDLE_MAX_MS,
  LONG_HEAD_TILT_RAD,
  SHOULDER_DROP_RAD,
  FOOT_IDLE_YAW_RAD,
  MICRO_EXPR_MIN_MS,
  MICRO_EXPR_MAX_MS,
  IDLE_VRMA_MIN_MS,
  IDLE_VRMA_MAX_MS,
  PROC_LIFE_DURING_VRMA_GESTURE,
  HAND_SEPARATION_PULSE_MS,
  IDLE_MICRO_GESTURE_MIN_MS,
  IDLE_MICRO_GESTURE_COOLDOWN_MIN_MS,
  IDLE_MICRO_GESTURE_COOLDOWN_MAX_MS,
  WALK_SPEED_MPS,
  WALK_CYCLE_RAD_PER_S,
  WALK_DEFAULT_DISTANCE_METERS,
  WALK_WRIST_MIN_SEP_M,
  readAvatarStandYOffsetEnv,
  readAvatarFacingYawBaseEnv,
  AVATAR_BREATHE_SCALE_VRM1,
  SIT_UPPER_LEG_X_VRM0,
  SIT_UPPER_LEG_X_VRM1,
  SIT_LOWER_LEG_X_SEATED,
  readAvatarSitWorldYOffsetEnv,
  readAvatarDebugForceStandEnv,
  readRugWalkSurfaceYExtraEnv,
  SIT_WORLD_Y_TRIM_VRM1,
  BREATHE_AMP_STANDING_VRM1,
  BREATHE_AMP_SITTING_VRM1,
  BREATHE_AMP_STANDING,
  BREATHE_AMP_SITTING,
  getMimeMode,
} from '@/config/avatar';
import { breathSpineAmount, breathGroupBounce } from './proceduralLife';
import {
  RoomShell,
  ROOM_BOUNDS,
  ROOM_BOUNDS_DEFAULT,
  type RoomBounds,
  getDefaultStandXZ,
  getCameraPosZ,
  getRoomZCenter,
  buildPatrolWaypoints,
} from './scene/RoomShell';
import { createGroundLock } from '@/engine/ground/GroundLock';
import { FeetFixer, pruneFootTracksFromClip } from '@/engine/rig/FeetFixer';
import { computeRugSurfaceWorld, readRugExtraEnv } from './utils/carpetFloor';

/** V54/V55 — وقوف افتراضي من حدود السجادة/الغرفة (يُحدَّث عند استيراد AABB السجادة) */
const _initStand = getDefaultStandXZ();
const AVATAR_DEFAULT_STAND_X = _initStand.x;
const AVATAR_DEFAULT_STAND_Z = _initStand.z;

/** كاميرا ثابتة: نفس البُعد بين الكاميرا وهدف المدار (الأفاتار) لـ OrbitControls */
const CAMERA_OFFSET_Y = 2.78;
const CAMERA_TARGET_OFFSET_Y = 1.55;

function getCameraOrbitDistance(bounds: RoomBounds = ROOM_BOUNDS): number {
  const stand = getDefaultStandXZ(bounds);
  return Math.hypot(
    CAMERA_OFFSET_Y - CAMERA_TARGET_OFFSET_Y,
    getCameraPosZ(bounds) - stand.z,
  );
}

/** V54 — هدف OrbitControls (يُحدَّث كل إطار من VRMScene؛ يُتبع بـ lerp في OrbitTargetFollower) */
const v54OrbitLookAtWorld = new THREE.Vector3(
  AVATAR_DEFAULT_STAND_X,
  ROOM_BOUNDS.floorY + CAMERA_TARGET_OFFSET_Y,
  AVATAR_DEFAULT_STAND_Z,
);
/** Keep orbit look-at XZ inside the playable rectangle so the camera rig stays in the room volume. */
const ORBIT_TARGET_ROOM_MARGIN = 0.32;
function clampOrbitLookAtToRoomXZ(v: THREE.Vector3): void {
  const r = ROOM_BOUNDS;
  const mx = ORBIT_TARGET_ROOM_MARGIN;
  v.x = THREE.MathUtils.clamp(v.x, r.minX + mx, r.maxX - mx);
  v.z = THREE.MathUtils.clamp(v.z, r.minZ + mx, r.maxZ - mx);
}

/**
 * NOTE: legacy `applyCarpetFloorYFromWorldBox` is not used from AvatarCanvas — GroundLock V2 routes all
 * carpet/room floor updates through `tryApplyFloorY(..., applyAvatarGroundOffset)` only.
 */
/** V56 — small settle after `room:carpetBounds` before applying floor (transient AABB / matrix settle). */
const CARPET_FLOOR_SETTLE_MS = 150;

/** Snapshot of rug walk extra at module load (matches RoomShell `applyCarpetFloorYFromWorldBox` semantics). */
const RUG_WALK_SURFACE_Y_EXTRA =
  typeof readRugWalkSurfaceYExtraEnv === 'function' ? readRugWalkSurfaceYExtraEnv() : 0.1;

/** V57 — throttle heavy dev diagnostics in `useFrame` (was 1 Hz; lower main-thread pressure). */
const V54_DEV_LOG_INTERVAL_SEC = 5;

let _v54TeleportLogPending = false;

/**
 * Register VRMC_vrm_animation plugin on a GLTFLoader (one pattern for Cogni + idle batch).
 * `@pixiv/three-vrm-animation@3.5.x` exposes `constructor(parser: GLTFParser)` only; a future object/options
 * constructor would go here if the package adds `VRMAnimationLoaderPluginOptions`.
 */
function registerVRMAnimationLoaderPlugin(loader: GLTFLoader): void {
  loader.register((parser: unknown) => new VRMAnimationLoaderPlugin(parser as never));
}

/** Suppress known noisy three-vrm-animation loader warnings when we cannot fix binary assets. */
function shouldSuppressVrmaLoaderWarn(first: unknown): boolean {
  const s = String(first ?? '');
  return (
    s.includes('specVersion of the VRMA')
    || s.includes('Using a draft spec version')
    || s.includes('violate the VRM T-pose')
    || s.includes('rest hips position')
  );
}

/** Ensure one named proxy exists so `createVRMAnimationClip` does not warn / allocate every clip. */
function ensureVRMLookAtQuaternionProxyForVrm(model: VRM): void {
  if (!model.lookAt) return;
  const has = model.scene.children.some((o) => o instanceof VRMLookAtQuaternionProxy);
  if (has) return;
  const proxy = new VRMLookAtQuaternionProxy(model.lookAt);
  proxy.name = 'VRMLookAtQuaternionProxy';
  model.scene.add(proxy);
}

import { getRoomMaterial } from './scene/BackdropTheme';
// Decor disabled — minimal scene
// import { CarpetLoader }      from './scene/CarpetLoader';
// import { CabinetLoader }     from './scene/CabinetLoader';
// import { GlobeLoader }       from './scene/GlobeLoader';
import { EffectComposer, SSAO } from '@react-three/postprocessing';
import ComfortLightingRig    from '@/components/ComfortLightingRig';
// import RoyalDecoProps         from '@/components/RoyalDecoProps';
// import RoyalMaterialsOverride from '@/components/RoyalMaterialsOverride';
import {
  resolveIfEnabled,
  clearDeskScene,
  setDeskScene,
  computeChairAnchor,
  getDeskBox,
  getChairAnchorVector3,
  initRapierWorld,
  resetRapierAvatarState,
  pulseHandSeparationWindow,
  isHandSeparationPulseActive,
} from './physics/WorldColliders';

import { getRandomAnimationPath } from '@/ai/avatar/animationMap';
import { motionLogger, type BlendshapeSnapshot, type BoneSnapshot, type QuatTuple } from '@/utils/MotionLogger';
import { getStableWebSpeechVoice, ensureWebSpeechVoicesChangeHook } from '@/ai/io/webSpeechVoice';
import { createAvatarPerformanceHandler } from './avatarPerformanceBridge';

// ── V52 — multi-VRM diagnostics & bone probe (Cogni-AVatar vs teach.vrm) ─────
function getHumanoidBoneOrNull(vrm: VRM, boneName: string): THREE.Object3D | null {
  const h = vrm.humanoid;
  if (!h) return null;
  try {
    const n = h.getRawBoneNode(boneName as never);
    return n ?? null;
  } catch {
    return null;
  }
}

/** §8 — resolve raw humanoid bone; warn once per bone name if missing (V52). */
const _v52Section8BoneWarned = new Set<string>();
function rawBone8(humanoid: NonNullable<VRM['humanoid']>, boneName: string): THREE.Object3D | null {
  let n: THREE.Object3D | null = null;
  try {
    n = humanoid.getRawBoneNode(boneName as never) ?? null;
  } catch {
    n = null;
  }
  if (!n && !_v52Section8BoneWarned.has(boneName)) {
    _v52Section8BoneWarned.add(boneName);
    console.warn('[V52][§8] Missing bone — rotation skipped:', boneName);
  }
  return n;
}

/** Returns true when metaVersion indicates VRM 1.0; logs skeleton summary once per load. */
function detectAndLogV52Vrm(model: VRM, url: string): boolean {
  const meta = (model as unknown as { meta?: { metaVersion?: string | number } }).meta;
  const mv = meta?.metaVersion;
  const isVRM1 = mv === '1' || mv === 1 || String(mv) === '1';
  console.log('%c[V52][VRM diagnostic]', 'color:#a78bfa;font-weight:bold', {
    url,
    metaVersion: mv ?? '(unknown)',
    inferredVRM1: isVRM1,
  });
  const h = model.humanoid;
  if (!h) {
    console.warn('[V52] humanoid missing — motion will be limited');
    return isVRM1;
  }
  const probe = [
    'hips', 'spine', 'chest', 'upperChest', 'neck', 'head',
    'leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm',
    'leftHand', 'rightHand',
    'leftUpperLeg', 'rightUpperLeg', 'leftLowerLeg', 'rightLowerLeg',
    'leftFoot', 'rightFoot',
    'leftIndexProximal', 'rightIndexProximal',
  ];
  const missing: string[] = [];
  for (const k of probe) {
    if (!getHumanoidBoneOrNull(model, k)) missing.push(k);
  }
  if (missing.length) {
    console.warn('[V52] Missing humanoid bones (VRM 0/1 naming mismatch?):', missing.join(', '));
  } else {
    console.log('[V52] Core humanoid bones present');
  }
  const hips = getHumanoidBoneOrNull(model, 'hips');
  if (hips) {
    console.log(
      '[V52] hips bind (local)',
      hips.position.x.toFixed(4),
      hips.position.y.toFixed(4),
      hips.position.z.toFixed(4),
    );
    try {
      model.scene.updateMatrixWorld(true);
      const w = new THREE.Vector3();
      hips.getWorldPosition(w);
      console.log(
        '[V52] hips world (scene root, pre-React mount)',
        w.x.toFixed(4),
        w.y.toFixed(4),
        w.z.toFixed(4),
      );
    } catch {
      /* ignore */
    }
  }
  const hNorm = h as unknown as { getNormalizedBoneNode?: (n: string) => THREE.Object3D | null };
  if (typeof hNorm.getNormalizedBoneNode === 'function') {
    const normProbe = [
      'hips', 'spine', 'head',
      'leftUpperArm', 'rightUpperArm',
      'leftLowerLeg', 'rightLowerLeg',
    ] as const;
    const normStatus: Record<string, string> = {};
    for (const k of normProbe) {
      try {
        const node = hNorm.getNormalizedBoneNode(k as never);
        normStatus[k] = node ? 'ok' : 'null';
      } catch {
        normStatus[k] = 'err';
      }
    }
    console.log('[V52] getNormalizedBoneNode (key bones):', normStatus);
  }
  return isVRM1;
}

// ── Strict OLD embedded-furniture purge (VRM / GLTF roots from GLTFLoader) ─────
/** After GLTFLoader loads the main avatar (VRM), strip embedded desk-room junk by mesh name. */
const STRICT_DESK_MESH_NAME_RE = /desk|table|office|chair/i;

function disposeMaterialDeep(mat: THREE.Material | null | undefined): void {
  if (!mat) return;
  const m = mat as THREE.MeshStandardMaterial & {
    map?: THREE.Texture | null;
    normalMap?: THREE.Texture | null;
    roughnessMap?: THREE.Texture | null;
    metalnessMap?: THREE.Texture | null;
    aoMap?: THREE.Texture | null;
    emissiveMap?: THREE.Texture | null;
    envMap?: THREE.Texture | null;
    lightMap?: THREE.Texture | null;
    bumpMap?: THREE.Texture | null;
    displacementMap?: THREE.Texture | null;
    alphaMap?: THREE.Texture | null;
  };
  [
    m.map,
    m.normalMap,
    m.roughnessMap,
    m.metalnessMap,
    m.aoMap,
    m.emissiveMap,
    m.envMap,
    m.lightMap,
    m.bumpMap,
    m.displacementMap,
    m.alphaMap,
  ].forEach((t) => {
    if (t && typeof (t as THREE.Texture).dispose === 'function') (t as THREE.Texture).dispose();
  });
  m.dispose();
}

/**
 * Strict purge: (b) visibility off → remove from parent → dispose geometry + materials.
 * Run on any loaded GLTF root that might embed stray furniture meshes.
 */
function strictPurgeDeskLikeMeshes(root: THREE.Object3D): number {
  const victims: THREE.Mesh[] = [];
  root.traverse((o) => {
    if (!(o as THREE.Mesh).isMesh) return;
    const mesh = o as THREE.Mesh;
    const n = `${mesh.name || ''}`.toLowerCase();
    if (!STRICT_DESK_MESH_NAME_RE.test(n)) return;
    mesh.visible = false;
    victims.push(mesh);
  });
  let removed = 0;
  for (const mesh of victims) {
    const p = mesh.parent;
    if (p) p.remove(mesh);
    mesh.geometry?.dispose();
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mats.forEach(disposeMaterialDeep);
    removed += 1;
  }
  if (removed > 0) {
    console.warn(`[AvatarCanvas] STRICT_DESK_PURGE: detached & disposed ${removed} mesh(es).`);
  }
  return removed;
}

/**
 * V120 — Strip UpperLeg/LowerLeg/Foot/Toes tracks from an animation clip.
 * Apply to idle clips only — walk/gesture/locomotion clips must keep full lower-body control.
 */
function filterLowerBodyTracks(clip: THREE.AnimationClip): THREE.AnimationClip {
  const tracks = clip.tracks.filter(t => {
    const n = t.name || '';
    return !(
      n.includes('UpperLeg') ||
      n.includes('LowerLeg') ||
      n.includes('Foot')     ||
      n.includes('Toes')
    );
  });
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

/*
 * ═══════════════════════════════════════════════════════════════════════════
 * EDUVERSE_SCENE_CHECKPOINT_v1 — نقطة استعادة لهذا الإعداد
 * ───────────────────────────────────────────────────────────────────────────
 * للرجوع: ابحث في الملف عن هذا المعرف أو أعد التعيين حسب الثوابت أدناه
 * (triptych + أرضية نسيج + EDUVERSE_BACKDROP_Y_SHIFT + EDUVERSE_VERTICAL_SHRINK_M
 *  + EDUVERSE_FULL_IMAGE_Y_LIFT_M + EDUVERSE_FLOOR_PARQUET_UV_SHIFT + EDUVERSE_FLOOR_MODE).
 * التاريخ المرجعي: 2026-03-22
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** ملف الخلفية في `public/images/` — نسبة العرض/الارتفاع تُؤخذ من أبعاد الصورة الفعلية */
const EDUVERSE_BG_URL = '/images/edu.verse-bg.png' as const;


/** ضرب لوني خفيف للصورة (قريب من 1 = ألوان طبيعية) */
const EDUVERSE_BACKDROP_TINT = '#ffffff';

/** سقف — بيج دافئ */
const ENVELOPE_CEIL_HEX = '#e4dcd2';

/**
 * حدود تقسيم الصورة أفقياً على محور U (0→1) — يطابق برومبت البانوراما:
 * يسار 30% | وسط 42% (زجاج من الأرض للسقف + حديقة + أفق عمان) | يمين 28%.
 * [0]=بداية اليسار، [1]=نهاية اليسار/بداية الوسط، [2]=نهاية الوسط/بداية اليمين، [3]=النهاية.
 * انظر `docs/EDUVERSE_PANORAMA_PROMPT.md`.
 */
const EDUVERSE_U_SPLIT = [0, 0.3, 0.72, 1] as const;

/**
 * شريحة عمودية (0→1) لأرضية من **نسيج البانوراما** — تُستخدم عند EDUVERSE_FLOOR_MODE === 'panorama_slice'.
 */
const EDUVERSE_FLOOR_V_SPLIT = [0.62, 1.0] as const;

/**
 * أرضية الصلب حول/تحت السجادة — أغمق لتباين أوضح مع السجادة والضوء.
 */
const EDUVERSE_FLOOR_TILE_COLOR_HEX = '#5C4A3D';

/** ارتفاع أرضية النسيج فوق المنطقية (م) — يقلّل التداخل مع أي مستوى أبيض من نموذج المكتب */
const EDUVERSE_FLOOR_EPSILON_Y = 0.055;

/** فواصل — خطوط منتصف الشبكة */
const EDUVERSE_GRID_COLOR_CENTER = '#3D3028';
/** مربعات الشبكة */
const EDUVERSE_GRID_COLOR_CELL = '#5C4A3D';
const EDUVERSE_GRID_SIZE = 30;
const EDUVERSE_GRID_DIVISIONS = 30;
/** فوق مستوى أرضية Eduverse قليلاً لتفادي Z-fighting مع المستوى الصلب */
const EDUVERSE_GRID_Y_ABOVE_FLOOR = 0.004;
/** عرض شبكة أرضية خفيفة (دمج بصري مع صورة الغرفة) */
const EDUVERSE_FLOOR_GRID_VISIBLE = true;

/**
 * مصدر أرضية المشهد — انظر `docs/EDUVERSE_FLOOR_PARQUET_PROMPT.md`.
 * - neutral: لون صلب
 * - panorama_slice: شريحة UV من EDUVERSE_BG_URL (وسط البانوراما)
 * - dedicated_file: نسيج باركيه منفصل (Honey oak / image_0) — ضع الملف تحت public/images/
 * - carpet_glb: سجادة من `carpet.glb` بعرض/عمق الغرفة
 */
type EduverseFloorMode = 'neutral' | 'panorama_slice' | 'dedicated_file' | 'carpet_glb';

const EDUVERSE_FLOOR_MODE: EduverseFloorMode = 'carpet_glb';

/** مسار سجادة GLB — يُقيَّس لملء أرضية الغرفة (roomW × zLen) */
const EDUVERSE_CARPET_GLB_PATH = '/assets/carpet.glb' as const;

/**
 * إن كانت السجادة مُصدَّرة مستوية على XY بدل XZ، جرّب `[ -Math.PI / 2, 0, 0 ]`.
 */
const EDUVERSE_CARPET_EULER_EXTRA: [number, number, number] = [0, 0, 0];

/** مسار نسيج الباركيه المخصص (بعد التصدير من البرومبت أو نسخ image_0 كـ PNG) */
const EDUVERSE_FLOOR_DEDICATED_URL = '/images/eduverse-floor-parquet.png' as const;

/** تكرار النسيج (تقريب عدد «لوح» لكل متر على المستوى) — عاين حسب دقة الصورة */
const EDUVERSE_FLOOR_TILES_PER_METER = 0.45;

/**
 * تنزيل جدران/سقف الصورة (متر) لمواءمة أرضية المكتب مع الصورة.
 * أرضية الأفاتار لا تُغيّر؛ أرضية نسيج الصورة تبقى عند floorY+ε.
 */
const EDUVERSE_BACKDROP_Y_SHIFT = 2.0;

/**
 * رفع الصورة كاملة (متر): الجدران + السقف + نسيج الأرضية يتحركان للأعلى معاً.
 * أرضية النسيج تبقى عند مستوى أقدام الأفاتار عبر تعويض المحور Y المحلي (لا يُرفع الأفاتار).
 */
/** رفع موحّد للخلفية؛ أرضية النسيج تُعوَّض بـ −هذه القيمة فلا يتحرك الأفاتار */
const EDUVERSE_FULL_IMAGE_Y_LIFT_M = 0.65;

/**
 * إزاحة شريحة أرضية الصورة على محور V (0→1) لإظهار الباركيه من الصورة بعد الرفع.
 * قيم سالبة تميل لسحب العيّنة نحو أسفل الصورة (باركيه غالباً هناك).
 */
const EDUVERSE_FLOOR_PARQUET_UV_SHIFT = -0.08;

/**
 * تصغير عمودي للصورة (متر): قص من الأسفل نحو الأعلى — ارتفاع الجدران المرئي أقل + قص UV من أسفل.
 * لا يحرك أرضية الأفاتار.
 */
const EDUVERSE_VERTICAL_SHRINK_M = 0.5;

/** قص شريحة جدار أفقياً + إزاحة V من الأسفل (نسبة 0→1 من ارتفاع النسيج الكامل) */
function cloneSliceTextureCropBottom(
  base: THREE.Texture,
  uMin: number,
  uMax: number,
  vCropBottom01: number,
): THREE.Texture {
  const t = base.clone();
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  const du = uMax - uMin;
  const dv = Math.max(0.05, 1 - vCropBottom01);
  t.repeat.set(du, dv);
  t.offset.set(uMin, vCropBottom01);
  t.needsUpdate = true;
  return t;
}

function cloneSliceTexture(base: THREE.Texture, uMin: number, uMax: number): THREE.Texture {
  return cloneSliceTextureCropBottom(base, uMin, uMax, 0);
}

/** مستطيل في UV (للأرضية: نفس عرض الوسط، الجزء السفلي من الصورة) */
function cloneRectTexture(
  base: THREE.Texture,
  u0: number,
  u1: number,
  v0: number,
  v1: number,
): THREE.Texture {
  const t = base.clone();
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.repeat.set(u1 - u0, v1 - v0);
  t.offset.set(u0, v0);
  t.needsUpdate = true;
  return t;
}

/** أرضية باركيه من ملف منفصل (تكرار + لون أبيض للحفاظ على درجة العسل من الصورة) */
function EduverseParquetFloorPlane({
  url,
  roomW,
  zLen,
  position,
}: {
  url: string;
  roomW: number;
  zLen: number;
  position: [number, number, number];
}) {
  const src = useTexture(url);
  const { material } = useMemo(() => {
    const t = src.clone();
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(
      Math.max(2, roomW * EDUVERSE_FLOOR_TILES_PER_METER),
      Math.max(2, zLen * EDUVERSE_FLOOR_TILES_PER_METER),
    );
    t.anisotropy = 8;
    t.needsUpdate = true;
    const m = new THREE.MeshBasicMaterial({
      map: t,
      color: new THREE.Color(EDUVERSE_FLOOR_TILE_COLOR_HEX),
      side: THREE.FrontSide,
      depthWrite: true,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    return { material: m };
  }, [src, roomW, zLen, EDUVERSE_FLOOR_TILE_COLOR_HEX]);

  useEffect(() => {
    const mapClone = material.map as THREE.Texture | null;
    return () => {
      material.dispose();
      mapClone?.dispose();
    };
  }, [material]);

  return (
    <mesh
      name="EduverseFloor"
      position={position}
      rotation={[-Math.PI / 2, 0, 0]}
      receiveShadow
      frustumCulled={false}
      renderOrder={-2005}
      material={material}
    >
      <planeGeometry args={[roomW, zLen]} />
    </mesh>
  );
}

/**
 * تعتيم سجادة GLB — قيمة أقل = أغمق (يُلاحظ بوضوح تحت إضاءة قوية).
 */
const EDUVERSE_CARPET_ALBEDO_DIM = 0.48;

/**
 * يعتم سجادة GLB بشكل واضح: تقليل وهج البيئة، لون أغمق، أقل emissive.
 */
function enhanceCarpetMaterialsForClarity(root: THREE.Object3D): void {
  const woolWarmth = new THREE.Color(1.02, 1.0, 0.98);
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mats.forEach((raw) => {
      const m = raw as THREE.Material;
      if (m instanceof THREE.MeshStandardMaterial || m instanceof THREE.MeshPhysicalMaterial) {
        m.roughness = THREE.MathUtils.clamp(m.roughness * 1.12, 0.22, 1);
        m.metalness = THREE.MathUtils.clamp(m.metalness * 0.35, 0, 0.35);
        m.envMapIntensity = (m.envMapIntensity ?? 1) * 0.72;
        m.color.multiplyScalar(0.98);
        m.color.multiply(woolWarmth);
        m.color.multiplyScalar(EDUVERSE_CARPET_ALBEDO_DIM);
        if (m.map) {
          m.map.colorSpace = THREE.SRGBColorSpace;
          m.map.needsUpdate = true;
        }
        m.emissive.copy(m.color).multiplyScalar(0.012);
        m.emissiveIntensity = 0.03;
        m.needsUpdate = true;
      } else if (m instanceof THREE.MeshBasicMaterial) {
        m.color.multiply(woolWarmth);
        m.color.multiplyScalar(EDUVERSE_CARPET_ALBEDO_DIM);
        m.toneMapped = false;
        if (m.map) {
          m.map.colorSpace = THREE.SRGBColorSpace;
          m.map.needsUpdate = true;
        }
        m.needsUpdate = true;
      } else if (m instanceof THREE.MeshLambertMaterial) {
        m.color.multiplyScalar(0.98);
        m.color.multiply(woolWarmth);
        m.color.multiplyScalar(EDUVERSE_CARPET_ALBEDO_DIM);
        if (m.map) m.map.colorSpace = THREE.SRGBColorSpace;
        m.needsUpdate = true;
      } else if (m instanceof THREE.MeshToonMaterial) {
        m.color.multiplyScalar(0.98);
        m.color.multiply(woolWarmth);
        m.color.multiplyScalar(EDUVERSE_CARPET_ALBEDO_DIM);
        if (m.map) m.map.colorSpace = THREE.SRGBColorSpace;
        m.needsUpdate = true;
      }
    });
  });
}

/** سجادة GLB — تُقيَّس لتغطية نفس مساحة أرضية الغرفة (roomW × zLen) */
function EduverseCarpetGlbFloor({
  roomW,
  zLen,
  zCenter,
  localY,
}: {
  roomW: number;
  zLen: number;
  zCenter: number;
  localY: number;
}) {
  const { scene } = useGLTF(EDUVERSE_CARPET_GLB_PATH) as { scene: THREE.Group };
  const object = useMemo(() => {
    const root = scene.clone(true);
    root.name = 'EduverseCarpetGlbFloor';
    const [rx, ry, rz] = EDUVERSE_CARPET_EULER_EXTRA;
    root.rotation.set(rx, ry, rz);
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    const size = new THREE.Vector3();
    box.getSize(size);
    const sx = roomW / Math.max(size.x, 1e-5);
    const sz = zLen / Math.max(size.z, 1e-5);
    const sy = (sx + sz) * 0.5;
    root.scale.set(sx, sy, sz);
    root.updateMatrixWorld(true);
    const b2 = new THREE.Box3().setFromObject(root);
    const c = new THREE.Vector3();
    b2.getCenter(c);
    root.position.set(-c.x, localY - b2.min.y, zCenter - c.z);
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    enhanceCarpetMaterialsForClarity(root);
    root.renderOrder = -2005;
    return root;
  }, [scene, roomW, zLen, zCenter, localY]);

  useEffect(() => {
    return () => {
      object.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.geometry?.dispose();
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          mats.forEach((m) => {
            if (m && typeof (m as THREE.Material).dispose === 'function') (m as THREE.Material).dispose();
          });
        }
      });
    };
  }, [object]);

  /** V57 — fire `room:carpetBounds` once per carpet mesh lifetime (stops rAF remeasure loops). */
  const carpetBoundsDispatchedRef = useRef(false);

  useEffect(() => {
    if (carpetBoundsDispatchedRef.current) return;
    /** Double rAF (V55/V100): carpet under EduverseRoomBackdrop — world matrices before `setFromObject` AABB. */
    let cancelled = false;
    let innerRaf = 0;
    const outerRaf = requestAnimationFrame(() => {
      innerRaf = requestAnimationFrame(() => {
        if (cancelled || carpetBoundsDispatchedRef.current) return;
        object.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(object);
        carpetBoundsDispatchedRef.current = true;
        if (process.env.NODE_ENV === 'development') {
          console.info('[V55] EduverseCarpetGlbFloor world AABB (once)', {
            min: box.min.toArray().map((v) => +v.toFixed(4)),
            max: box.max.toArray().map((v) => +v.toFixed(4)),
            ROOM_BOUNDS_snapshot: { ...ROOM_BOUNDS },
          });
        }
        window.dispatchEvent(new CustomEvent('room:carpetBounds', { detail: { box: box.clone() } }));
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(outerRaf);
      cancelAnimationFrame(innerRaf);
    };
  }, [object]);

  return <primitive object={object} />;
}

/**
 * ثلاثة جدران بزوايا الغرفة: يسار / خلف (زجاج) / يمين — كل جدار يعرض شريحة من نفس الصورة.
 */
function EduverseRoomBackdrop({
  bounds,
  groundLockedRef,
}: {
  bounds: RoomBounds;
  groundLockedRef?: React.MutableRefObject<boolean>;
}) {
  const tex = useTexture(EDUVERSE_BG_URL);

  const roomW = bounds.maxX - bounds.minX;
  const roomH = bounds.ceilY - bounds.floorY;
  const wallHVis = Math.max(0.5, roomH - EDUVERSE_VERTICAL_SHRINK_M);
  const wallYVis = bounds.floorY + wallHVis / 2;
  /** نسبة قص UV من أسفل نسيج الجدران (تقريب: نصف متر من ارتفاع الغرفة) */
  const vCropWall = Math.min(0.45, EDUVERSE_VERTICAL_SHRINK_M / Math.max(0.01, roomH));
  const zLen = Math.abs(bounds.maxZ - bounds.minZ);
  const zCenter = (bounds.maxZ + bounds.minZ) / 2;
  const backZ = bounds.minZ + 0.08;
  const sideX = 0.06;

  const { texL, texC, texR, texF, matL, matC, matR, matF } = useMemo(() => {
    const u = EDUVERSE_U_SPLIT;
    const tL = cloneSliceTextureCropBottom(tex, u[0], u[1], vCropWall);
    const tC = cloneSliceTextureCropBottom(tex, u[1], u[2], vCropWall);
    const tR = cloneSliceTextureCropBottom(tex, u[2], u[3], vCropWall);

    const commonWall = {
      color: new THREE.Color(EDUVERSE_BACKDROP_TINT),
      side: THREE.FrontSide as const,
      depthWrite: false,
      toneMapped: false,
    };

    let texF: THREE.Texture | null = null;
    let matF: THREE.MeshBasicMaterial | undefined;

    if (EDUVERSE_FLOOR_MODE === 'panorama_slice') {
      const fv = EDUVERSE_FLOOR_V_SPLIT;
      const band = fv[1] - fv[0];
      const vFloorCrop = Math.min(band * 0.4, (EDUVERSE_VERTICAL_SHRINK_M / Math.max(0.01, roomH)) * band);
      let v0f = fv[0] + vFloorCrop + EDUVERSE_FLOOR_PARQUET_UV_SHIFT;
      let v1f = fv[1] + EDUVERSE_FLOOR_PARQUET_UV_SHIFT;
      v0f = THREE.MathUtils.clamp(v0f, 0, 0.98);
      v1f = THREE.MathUtils.clamp(v1f, v0f + 0.02, 1);
      texF = cloneRectTexture(tex, u[1], u[2], v0f, v1f);
      matF = new THREE.MeshBasicMaterial({
        map: texF,
        color: new THREE.Color(EDUVERSE_FLOOR_TILE_COLOR_HEX),
        side: THREE.FrontSide,
        depthWrite: true,
        toneMapped: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      });
    } else if (EDUVERSE_FLOOR_MODE === 'neutral') {
      matF = new THREE.MeshBasicMaterial({
        color: new THREE.Color(EDUVERSE_FLOOR_TILE_COLOR_HEX),
        side: THREE.FrontSide,
        depthWrite: true,
        toneMapped: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      });
    }
    /* dedicated_file / carpet_glb: matF غير مستخدم */

    return {
      texL: tL,
      texC: tC,
      texR: tR,
      texF,
      matL: new THREE.MeshBasicMaterial({ ...commonWall, map: tL }),
      matC: new THREE.MeshBasicMaterial({ ...commonWall, map: tC }),
      matR: new THREE.MeshBasicMaterial({ ...commonWall, map: tR }),
      matF,
    };
  }, [tex, vCropWall, roomH, EDUVERSE_FLOOR_TILE_COLOR_HEX, EDUVERSE_FLOOR_MODE]);

  useEffect(() => {
    return () => {
      matL.dispose();
      matC.dispose();
      matR.dispose();
      matF?.dispose();
      texL.dispose();
      texC.dispose();
      texR.dispose();
      texF?.dispose();
    };
  }, [matL, matC, matR, matF, texL, texC, texR, texF]);

  const ceilMat = useMemo(() => {
    const m = getRoomMaterial(ENVELOPE_CEIL_HEX, 0.92, 0.02).clone();
    m.side = THREE.DoubleSide;
    return m;
  }, []);

  return (
    <group name="EduverseRoomBackdrop" position={[0, EDUVERSE_FULL_IMAGE_Y_LIFT_M, 0]}>
      {/* الجدران والسقف تُنزَّل — أرضية النسيج: تعويض Y = −الرفع حتى تبقى عند أقدام الأفاتار */}
      <group position={[0, -EDUVERSE_BACKDROP_Y_SHIFT, 0]}>
        <mesh
          material={ceilMat}
          position={[0, bounds.ceilY - 0.03, zCenter]}
          rotation={[-Math.PI / 2, 0, 0]}
          receiveShadow
          renderOrder={-1998}
        >
          <planeGeometry args={[roomW, zLen]} />
        </mesh>

        {/* جدار خلفي: شريحة الوسط — الزجاج والأشجار خلف الأفاتار */}
        <mesh
          name="EduverseBackdropCenter"
          position={[0, wallYVis, backZ]}
          frustumCulled={false}
          renderOrder={-2000}
          material={matC}
        >
          <planeGeometry args={[roomW, wallHVis]} />
        </mesh>

        <mesh
          name="EduverseBackdropLeft"
          position={[bounds.minX + sideX, wallYVis, zCenter]}
          rotation={[0, Math.PI / 2, 0]}
          frustumCulled={false}
          renderOrder={-2000}
          material={matL}
        >
          <planeGeometry args={[zLen, wallHVis]} />
        </mesh>

        <mesh
          name="EduverseBackdropRight"
          position={[bounds.maxX - sideX, wallYVis, zCenter]}
          rotation={[0, -Math.PI / 2, 0]}
          frustumCulled={false}
          renderOrder={-2000}
          material={matR}
        >
          <planeGeometry args={[zLen, wallHVis]} />
        </mesh>
      </group>

      {/* أرضية: سجادة GLB | باركيه صورة | لون صلب — تعويض Y مع الأب = أقدام الأفاتار */}
      {EDUVERSE_FLOOR_MODE === 'carpet_glb' ? (
        <EduverseCarpetGlbFloor
          roomW={roomW}
          zLen={zLen}
          zCenter={zCenter}
          localY={bounds.floorY + EDUVERSE_FLOOR_EPSILON_Y - EDUVERSE_FULL_IMAGE_Y_LIFT_M}
        />
      ) : EDUVERSE_FLOOR_MODE === 'dedicated_file' ? (
        <EduverseParquetFloorPlane
          url={EDUVERSE_FLOOR_DEDICATED_URL}
          roomW={roomW}
          zLen={zLen}
          position={[0, bounds.floorY + EDUVERSE_FLOOR_EPSILON_Y - EDUVERSE_FULL_IMAGE_Y_LIFT_M, zCenter]}
        />
      ) : (
        <mesh
          name="EduverseFloor"
          position={[0, bounds.floorY + EDUVERSE_FLOOR_EPSILON_Y - EDUVERSE_FULL_IMAGE_Y_LIFT_M, zCenter]}
          rotation={[-Math.PI / 2, 0, 0]}
          receiveShadow
          frustumCulled={false}
          renderOrder={-2005}
          material={matF!}
        >
          <planeGeometry args={[roomW, zLen]} />
        </mesh>
      )}
    </group>
  );
}

/** New desk asset — `useGLTF` (drei); path is under `public/assets/`. */
const OFFICE_DESK_GLB_PATH = '/assets/office_desk.glb' as const;
/**
 * المكتب في وسط الغرفة (X=0، مركز Z = ROOM_Z_CENTER). الكاميرا عند +Z تنظر نحو −Z.
 */
/** طول المكتب في العالم (م) — أطول بُعد أفقي (X أو Z) بعد التحجيم الأولي */
const OFFICE_DESK_TARGET_LENGTH_M = 2.95;
/** تكبير إضافي موحّد بعد ضبط الطول (عرض/عمق/ارتفاع) */
const OFFICE_DESK_SIZE_BOOST = 1.15;
/** دوران المكتب حول Y — 0 = وضع افتراضي متمركز؛ غيّر لاحقاً إن رغبت */
const OFFICE_DESK_ROTATION: [number, number, number] = [0, 0, 0];
/** إزاحة المكتب فقط نحو الزجاج (الخلف، −Z) بالمتر — لا تُغيّر الأفاتار ولا الكاميرا */
const OFFICE_DESK_TOWARD_GLASS_M = 1.0;
/** قياسات تحجيم GLB — أطول بُعد أفقي يُكمَّل إلى `OFFICE_DESK_TARGET_LENGTH_M` بعد قياس الـ bbox */
const OFFICE_DESK_SCALE_X = (2.0 / 3.5) * 0.25 * 0.25 * 0.5;
const OFFICE_DESK_SCALE_Y = 1.2 * 0.25 * 0.25 * 0.5;
const OFFICE_DESK_SCALE_Z_BASE = (1.0 / 1.8) * 0.25 * 0.25 * 0.5;
/** تكبير/تصغير إضافي للكرسي الأسود داخل الـ GLB (محلي على العقدة فقط). */
const OFFICE_CHAIR_NAME_RE = /chair|black_chair|seating/i;
const OFFICE_CHAIR_EXTRA_SCALE = 0.7;

/**
 * Loads `office_desk.glb` via `useGLTF`, clones for this scene instance, registers collider anchor.
 * The OLD embedded desk/table/chair geometry is removed only from the VRM root (see `strictPurgeDeskLikeMeshes` after `GLTFLoader`).
 */
function OfficeDeskFromGltf({
  floorY,
  zCenter,
  groundLockedRef,
}: {
  floorY: number;
  zCenter: number;
  groundLockedRef?: React.MutableRefObject<boolean>;
}) {
  const { scene } = useGLTF(OFFICE_DESK_GLB_PATH) as { scene: THREE.Group };
  /**
   * V57 — layout deps: `scene` + `zCenter` only. Using a fixed reference Y for bbox math avoids
   * rebuilding the cloned GLB whenever `floorY` ticks (carpet settle), which was re-registering colliders every frame.
   */
  const { deskRoot, px, pz } = useMemo((): {
    deskRoot: THREE.Group;
    px: number;
    pz: number;
  } => {
    const root = scene.clone(true);
    root.name = 'OfficeDeskGltfRoot';
    root.scale.set(1, 1, 1);

    root.traverse((o) => {
      const n = `${o.name || ''}`;
      if (OFFICE_CHAIR_NAME_RE.test(n)) {
        o.scale.multiplyScalar(OFFICE_CHAIR_EXTRA_SCALE);
      }
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });

    root.updateMatrixWorld(true);

    /** تكبير الطول: أطول بُعد بين X و Z يصبح = OFFICE_DESK_TARGET_LENGTH_M (م) — يحافظ على نسبة العرض/العمق */
    root.scale.set(OFFICE_DESK_SCALE_X, OFFICE_DESK_SCALE_Y, OFFICE_DESK_SCALE_Z_BASE);
    root.updateMatrixWorld(true);
    const bbox = new THREE.Box3().setFromObject(root);
    const size = new THREE.Vector3();
    bbox.getSize(size);
    const hMax = Math.max(size.x, size.z, 1e-6);
    const k = (OFFICE_DESK_TARGET_LENGTH_M / hMax) * OFFICE_DESK_SIZE_BOOST;
    root.scale.set(OFFICE_DESK_SCALE_X * k, OFFICE_DESK_SCALE_Y * OFFICE_DESK_SIZE_BOOST, OFFICE_DESK_SCALE_Z_BASE * k);
    root.updateMatrixWorld(true);

    /**
     * توسيط المكتب: مركز الـ AABB عند (0، ROOM_Z_CENTER) على مستوى الأرض.
     */
    const refFloorY = ROOM_BOUNDS_DEFAULT.floorY;
    root.rotation.set(OFFICE_DESK_ROTATION[0], OFFICE_DESK_ROTATION[1], OFFICE_DESK_ROTATION[2]);
    root.position.set(0, refFloorY, 0);
    root.updateMatrixWorld(true);
    const boxW = new THREE.Box3().setFromObject(root);
    const boxCenter = new THREE.Vector3();
    boxW.getCenter(boxCenter);
    const pxOut = -boxCenter.x;
    const pzOut = zCenter - boxCenter.z - OFFICE_DESK_TOWARD_GLASS_M;
    root.rotation.set(0, 0, 0);
    root.position.set(0, 0, 0);

    return {
      deskRoot: root,
      px: pxOut,
      pz: pzOut,
    };
  }, [scene, zCenter]);

  const deskPosition = useMemo(
    (): [number, number, number] => [px, floorY, pz],
    [px, pz, floorY],
  );

  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      console.info(
        '[OfficeDeskFromGltf] layout',
        deskRoot.scale.x,
        deskRoot.scale.y,
        deskRoot.scale.z,
        'px,pz',
        px,
        pz,
      );
    }
  }, [deskRoot, px, pz]);

  useEffect(() => {
    // GROUND LOCK V2 — skip only if already locked before first registration (edge/HMR).
    if (groundLockedRef?.current) return;
    setDeskScene(deskRoot);
    if (process.env.NODE_ENV === 'development') {
      console.info('[OfficeDeskFromGltf] desk scene registered for colliders (once per mesh)');
    }
    const raf = requestAnimationFrame(() => {
      computeChairAnchor();
    });
    return () => {
      cancelAnimationFrame(raf);
      clearDeskScene();
    };
    // groundLockedRef intentionally omitted — ref flip must not re-run cleanup (would clear desk colliders).
  }, [deskRoot]);

  return (
    <primitive object={deskRoot} position={deskPosition} rotation={OFFICE_DESK_ROTATION} />
  );
}

useGLTF.preload(OFFICE_DESK_GLB_PATH);
useGLTF.preload(EDUVERSE_CARPET_GLB_PATH);

// ── Reusable math temps (avoid per-frame new Euler/Quaternion in useFrame) ───
const _scratchEuler = new THREE.Euler();
const _scratchEuler2 = new THREE.Euler();
const _scratchEuler3 = new THREE.Euler();
const _scratchQuat = new THREE.Quaternion();
const _scratchQuat2 = new THREE.Quaternion();
const _scratchQuat3 = new THREE.Quaternion();
const _desireWorld = new THREE.Vector3();
const _eyeMicroZero = new THREE.Vector3(0, 0, 0);
const _wristSepWpA = new THREE.Vector3();
const _wristSepWpB = new THREE.Vector3();
const _eyeDesireScratch = new THREE.Vector3();
/** Local X axis for chest breathing (axis-angle) — forward/back pitch only */
const _V_AXIS_X = new THREE.Vector3(1, 0, 0);
/** Throttle [WALK] procedural debug logs (seconds, elapsedTime) */
let _lastWalkProcLogT = -1;

/** V53 — throttled placement / camera diagnostics (elapsedTime seconds) */
let _v53LastLogSec = -Infinity;
const _v53WorldPos = new THREE.Vector3();
const _v53CamPos = new THREE.Vector3();
const _v53Forward = new THREE.Vector3();
const _v53ToAvatar = new THREE.Vector3();
const _v53HeadWorld = new THREE.Vector3();
const _v54RawToAvatar = new THREE.Vector3();

// ── Constants ────────────────────────────────────────────────────────────────
/** ارتفاع وقوف الأفاتار على الأرض المنطقية (يتبع ROOM_BOUNDS.floorY) */
const AVATAR_BASE_Y = ROOM_BOUNDS.floorY;
const WAVE_DURATION = 3.5;   // seconds — greeting wave on load
/** Tab background → rAF throttling: unclamped delta can be seconds (neck/gaze lerp explodes). */
const TAB_SAFE_MAX_DELTA = 0.1;

// ── Organic noise engine — true simplex noise (replaces fake sine-hash perlinNoise) ──────
// createNoise3D() produces band-limited, non-repeating organic values in [-1, 1].
// Using a single persistent instance keeps the noise field coherent across frames.
const _noise3D = createNoise3D();

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
  walk:        '/models/animations/Walking.vrma',
  stopWalk:    '/models/animations/stop%20walking.vrma',
  pace:        '/models/animations/Pacing%20And%20Talking%20On%20A%20Phone.vrma',
  untitled:    '/models/animations/Untitled.vrma',
  // ── MotionPack (pixiv VRoid Project) ─────────────────────────────────────
  showBody:    '/models/animations/VRMA_MotionPack/vrma/VRMA_01.vrma',  // Show full body
  greet:       '/models/animations/VRMA_MotionPack/vrma/VRMA_02.vrma',  // Greeting
  peace:       '/models/animations/VRMA_MotionPack/vrma/VRMA_03.vrma',  // Peace sign
  shoot:       '/models/animations/VRMA_MotionPack/vrma/VRMA_04.vrma',  // Shoot
  spin:        '/models/animations/VRMA_MotionPack/vrma/VRMA_05.vrma',  // Spin
  pose:        '/models/animations/VRMA_MotionPack/vrma/VRMA_06.vrma',  // Model pose
  squat:       '/models/animations/VRMA_MotionPack/vrma/VRMA_07.vrma',  // Squat
};

// ── Azure Viseme ID → VRM morph-target weight map ───────────────────────────
// All 22 Azure Speech Viseme IDs mapped to the 5 standard VRM expression keys.
// IDs 0-21 cover silence + every phoneme group the Azure Neural TTS engine emits.
// VRM keys: aa (wide-open), ih (narrow/smile), ou (round/purse), ee (mid-front), oh (round-open)
const AZURE_VISEME_TO_VRM: ReadonlyArray<Partial<{ aa: number; ih: number; ou: number; ee: number; oh: number }>> = [
  /* 0  silence  */ {},
  /* 1  æ/ə/ʌ   */ { aa: 0.10 },
  /* 2  æ (cat)  */ { aa: 0.70 },
  /* 3  ɑ (hot)  */ { aa: 0.90 },
  /* 4  ɔ (law)  */ { aa: 0.30, oh: 0.50 },
  /* 5  ɛ (bet)  */ { ee: 0.70 },
  /* 6  iː (bee) */ { ih: 0.90 },
  /* 7  ɪ (bit)  */ { ih: 0.55 },
  /* 8  eɪ (day) */ { ee: 0.65, ih: 0.20 },
  /* 9  uː (boot)*/ { ou: 0.90 },
  /* 10 ʊ (book) */ { ou: 0.65 },
  /* 11 oʊ (go)  */ { ou: 0.55, oh: 0.30 },
  /* 12 aɪ (kite)*/ { aa: 0.75, ih: 0.20 },
  /* 13 aʊ (now) */ { aa: 0.65, ou: 0.35 },
  /* 14 ɔɪ (boy) */ { oh: 0.50, ih: 0.30 },
  /* 15 j (yes)  */ { ih: 0.35, ee: 0.30 },
  /* 16 w (wet)  */ { ou: 0.50 },
  /* 17 r (red)  */ { aa: 0.20 },
  /* 18 l (lip)  */ { ih: 0.15 },
  /* 19 n/m/ng   */ { aa: 0.08 },
  /* 20 t/d/s/z  */ { ih: 0.10 },
  /* 21 b/p/m    */ {},
];

// ── VRM version-agnostic blendshape key mapping ───────────────────────────────
// When a VRM 1.0 key (left) is not found in the expression manager, the loader
// falls back to its VRM 0.x equivalent (right).  Keys are probed once per session
// and the result is cached in resolvedKeysRef so subsequent frames pay zero cost.
const VRM1_TO_VRM0: Readonly<Record<string, string>> = {
  aa:        'A',
  ih:        'I',
  ou:        'U',
  ee:        'E',
  oh:        'O',
  happy:     'Joy',
  sad:       'Sorrow',
  angry:     'Angry',
  relaxed:   'Relaxed',
  surprised: 'Surprised',
  lookUp:    'LookUp',
};

// ── Shortest-path angle lerp — prevents 360° spin at ±π boundary ─────────────
const lerpAngle = (a: number, b: number, t: number): number => {
  let d = b - a;
  while (d >  Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
};

// ── SimpleAvatarPlaceholder — rendered when all VRM candidates fail ────────
function SimpleAvatarPlaceholder(): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center w-full h-full bg-[radial-gradient(ellipse_at_center,#1a1a2e_0%,#0a0a14_100%)] text-gray-400">
      <div className="text-6xl mb-4">🤖</div>
      <div className="text-lg opacity-80">Cogni (EDUVERSE)</div>
      <div className="text-sm opacity-50 mt-2">3D model unavailable</div>
    </div>
  );
}

// ── V121 FLOOR LOCK HELPER FUNCTIONS ─────────────────────────────────────────

/**
 * V121 — Create LIFT_NODE: isolates vertical floor correction from navigation.
 * The liftNode is reparented between groupRef (container) and vrm.scene.
 * This decouples the "walking/positioning" frame from the "feet-floor-alignment" frame,
 * preventing late-frame Y writes during calibration from overwriting foot AABB measurements.
 */
function createLiftNode(vrm: VRM): THREE.Group {
  const lift = new THREE.Group();
  lift.name = 'LIFT_NODE_V121';
  // Move vrm.scene under liftNode; liftNode will be placed under groupRef in JSX
  vrm.scene.parent?.remove(vrm.scene);
  lift.add(vrm.scene);
  return lift;
}

/**
 * V121 — Apply foot–floor calibration to liftNode.position.y.
 * Measures leftFoot/rightFoot AABB from current group position, computes drift from floor,
 * writes correction ONLY to liftNode.y.
 * Keeps group XZ clean for walk/sit positioning — only Y is adjusted here.
 */
function applyFootFloorCalib({
  vrm,
  liftNode,
  group,
  carpetName = 'EduverseCarpetGlbFloor',
  gap = 0.015,
}: {
  vrm: VRM;
  liftNode: THREE.Group;
  group: THREE.Group;
  carpetName?: string;
  gap?: number;
}): void {
  if (!vrm.humanoid || !liftNode.parent) return;
  
  group.updateMatrixWorld(true);
  liftNode.updateMatrixWorld(true);
  
  // Get feet bones (normalized or raw)
  const get = (name: string) =>
    (vrm.humanoid as any)?.getNormalizedBoneNode(name) ??
    (vrm.humanoid as any)?.getRawBoneNode(name);
  
  const leftFoot  = get('leftFoot') as THREE.Object3D | undefined;
  const rightFoot = get('rightFoot') as THREE.Object3D | undefined;
  if (!leftFoot || !rightFoot) return;
  
  // Measure feet world positions
  const lfWorld = new THREE.Vector3();
  const rfWorld = new THREE.Vector3();
  leftFoot.getWorldPosition(lfWorld);
  rightFoot.getWorldPosition(rfWorld);
  const avgFeetY = (lfWorld.y + rfWorld.y) * 0.5;
  
  // Target floor = room floor + extra (from env or constant) + gap
  const extra = readRugExtraEnv() ?? RUG_WALK_SURFACE_Y_EXTRA;
  const targetFloorY = ROOM_BOUNDS.floorY + extra + gap;
  
  // Correction: how much to raise liftNode.y
  const correction = targetFloorY - avgFeetY;
  
  // Apply — only if non-trivial (prevent micro-jitter)
  if (Math.abs(correction) > 0.0001) {
    liftNode.position.y += correction;
    if (process.env.NODE_ENV === 'development') {
      console.log(
        '%c[V121] applyFootFloorCalib',
        'color:#a78bfa;font-weight:bold',
        {
          avgFeetY: avgFeetY.toFixed(4),
          targetFloorY: targetFloorY.toFixed(4),
          correction: correction.toFixed(4),
          liftNode_y_after: liftNode.position.y.toFixed(4),
        }
      );
    }
  }
}

/**
 * V121 — Arm floor-lock watchdog: monitors drift and recalibrates every 800 ms.
 * Runs once per session (check __FLOORLOCK_ARMED__ to prevent HMR re-arm).
 * Sets up listeners for avatar-ready and room:bounds:applied events.
 */
function armCalibWatchdog(
  vrm: VRM,
  liftNode: THREE.Group,
  group: THREE.Group,
  scene: THREE.Scene,
): void {
  if ((window as any).__FLOORLOCK_ARMED__) return;
  (window as any).__FLOORLOCK_ARMED__ = true;
  
  let watchdogIntervalId: NodeJS.Timeout | null = null;
  let lastRecalibMs = 0;
  const DRIFT_CHECK_MS = 800;
  const MAX_DRIFT_M = 0.005;
  
  const doCheckDrift = () => {
    const now = Date.now();
    if (now - lastRecalibMs < DRIFT_CHECK_MS) return;
    lastRecalibMs = now;
    
    // Quick sanity: check if liftNode.y is drifiting from expected floor
    // This is a simple heuristic — more sophisticated version would remeasure feet
    const currentLiftY = liftNode.position.y;
    const get = (name: string) =>
      (vrm.humanoid as any)?.getNormalizedBoneNode(name) ??
      (vrm.humanoid as any)?.getRawBoneNode(name);
    
    const leftFoot = get('leftFoot') as THREE.Object3D | undefined;
    const rightFoot = get('rightFoot') as THREE.Object3D | undefined;
    if (!leftFoot || !rightFoot) return;
    
    const lfWorld = new THREE.Vector3();
    const rfWorld = new THREE.Vector3();
    leftFoot.getWorldPosition(lfWorld);
    rightFoot.getWorldPosition(rfWorld);
    const avgFeetY = (lfWorld.y + rfWorld.y) * 0.5;
    
    const extra = readRugExtraEnv() ?? RUG_WALK_SURFACE_Y_EXTRA;
    const targetFloorY = ROOM_BOUNDS.floorY + extra + 0.015;
    const drift = Math.abs(avgFeetY - targetFloorY);
    
    if (drift > MAX_DRIFT_M) {
      if (process.env.NODE_ENV === 'development') {
        console.warn(`[V121] Drift detected: ${drift.toFixed(4)} m — recalibrating...`);
      }
      applyFootFloorCalib({ vrm, liftNode, group });
    }
  };
  
  // Start drift watchdog
  watchdogIntervalId = setInterval(doCheckDrift, DRIFT_CHECK_MS);
  
  // Recalibrate on room bounds change
  const onBoundsApplied = () => applyFootFloorCalib({ vrm, liftNode, group });
  window.addEventListener('room:bounds:applied', onBoundsApplied);
  
  // Cleanup on unmount (not typical for this component, but safe)
  const cleanup = () => {
    if (watchdogIntervalId) clearInterval(watchdogIntervalId);
    window.removeEventListener('room:bounds:applied', onBoundsApplied);
  };
  
  (window as any).__FLOORLOCK_CLEANUP__ = cleanup;
}

// ── VRMScene — lives inside <Canvas> ────────────────────────────────────────
function VRMScene({
  vrmUrl,
  onLoad,
  onError,
  groundLockedRef,
  fixFeet,
  pruneFeetTracks,
}: {
  vrmUrl: string;
  onLoad: () => void;
  onError: (err: string) => void;
  /** GROUND LOCK V2 — suppress stand reset / foot logs when floor is fused. */
  groundLockedRef?: React.MutableRefObject<boolean>;
  /** `?fixFeet=1` — foot rotation clamp after VRMA (does not touch GroundLock). */
  fixFeet?: boolean;
  /** `?pruneFeet=1` — strip foot/toe tracks from VRMA clips at load (diagnostic). */
  pruneFeetTracks?: boolean;
}) {
  // 🔥 TRACER BULLET — confirms this file/version is the one being executed
  if (typeof window !== 'undefined' && !(window as typeof window & { __TRACER_LOGGED__?: boolean }).__TRACER_LOGGED__) {
    (window as typeof window & { __TRACER_LOGGED__?: boolean }).__TRACER_LOGGED__ = true;
    console.log('🔥 [SYSTEM] NEW SOVEREIGN CANVAS LOADED — F3 CLAMPING ACTIVE (±0.3 neck, ±0.45 head)');
  }

  const [vrm, setVrm]     = useState<VRM | null>(null);
  const vrmRef            = useRef<VRM | null>(null);
  /** V121 FLOOR LOCK — isolation node between container (groupRef) and vrm.scene */
  const liftNodeRef       = useRef<THREE.Group | null>(null);
  /** Dev console: same mutable object as module `ROOM_BOUNDS` — ref keeps getter stable for HMR. */
  const ROOM_BOUNDSRef    = useRef(ROOM_BOUNDS);
  /** V56 FeetFixer — after VRMA mixer; see `?fixFeet=1`. */
  const feetFixerRef      = useRef<FeetFixer | null>(null);
  const groupRef          = useRef<THREE.Group>(null);
  const physicsWorldRef   = useRef<Awaited<ReturnType<typeof initRapierWorld>>>(null);

  const isTalkingRef      = useRef(false);
  const talkElapsedRef    = useRef(0);
  const emotionRef        = useRef<string>('neutral');
  // Smooth emotion blending (lerp from prev to target)
  const emotionBlendRef   = useRef<Record<string, number>>({});
  // Phase 2: real viseme weights (legacy event-based path — kept for compat)
  const azureVisemeRef    = useRef<{ aa: number; ih: number; ou: number }>({ aa: 0, ih: 0, ou: 0 });
  const azureVisemeActive = useRef(false); // true while real visemes are available
  // Phase 3: full Azure temporal viseme cue queue + audio element reference
  const visemeCueQueueRef   = useRef<Array<{ t: number; id: number }>>([]);
  const lipSyncAudioRef     = useRef<HTMLAudioElement | null>(null);
  const lastLoggedVisemeRef = useRef(-1); // throttle [LipSync] debug logs
  // Current rendered lip weights — 5-shape (for smooth lerp without reading from VRM)
  const lipWeightsRef     = useRef<{ aa: number; ih: number; ou: number; ee: number; oh: number }>({ aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 });
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
  // Asymmetric blink: left/right eye close at slightly different phases (biologically realistic)
  // Value in [0, 0.25] rad — randomised on each new blink trigger.
  const blinkAsymRef      = useRef(0.08);
  const walkUntilRef      = useRef(Date.now() - 1);  // expired on mount — no auto-walk at startup
  const nodUntilRef       = useRef(0);
  const nodStartRef       = useRef(0);    // timestamp when current nod began
  const nodDurationRef    = useRef(1500); // ms — duration of current nod
  const autoNodNextRef    = useRef(Date.now() + 4000); // autonomous micro-nod scheduler (3–7 s)
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

  // ── §1 Saccadic gaze state machine ─────────────────────────────────────
  // FSM states: 'fixate' (hold gaze) | 'saccade' (fast snap to new target)
  const gazeStateRef      = useRef<'fixate' | 'saccade'>('fixate');
  // Current world-space gaze target (updated on each saccade)
  const gazeCurrRef       = useRef(new THREE.Vector3(0, 0.1, 3));
  const gazeTargetRef     = useRef(new THREE.Vector3(0, 0.1, 3));
  // Microsaccade drift from fixation point (sub-degree wandering)
  const gazeDriftRef      = useRef(new THREE.Vector3());
  // Timers (ms timestamps)
  const gazeFixateUntilRef  = useRef(0);   // stay in fixate until this time
  const gazeSaccadeUntilRef = useRef(0);   // saccade finishes at this time
  // Head/eye weight split: eyes lead 70 %, neck/head absorbs 30 %
  // Tracked separately so VRM lookAt drives eyes; bone overrides handle neck.
  const eyeWorldTargetRef = useRef(new THREE.Vector3(0, 0.1, 3)); // smoothed eye target
  const neckGazeYawRef    = useRef(0);   // current neck contribution (rad)
  const neckGazePitchRef  = useRef(0);
  const vrmFirstFrameRef  = useRef(true); // skip lerp on first frame after VRM load

  // ── §2 Procedural weight-shift driver (rotation-only on hips in §8 — no bone translation)
  const hipShiftRef       = useRef(0);   // noise driver → headRollRef (metres-equivalent scale)
  // Subtle idle head-roll (±2°) driven by opposite Perlin channel to sway
  const headRollRef        = useRef(0);
  const headRollEmotionRef = useRef(0); // emotion-driven roll tilt (friendly=-0.08, cleared by non-roll emotions)
  // ── Smooth head-pose refs — tracked INDEPENDENTLY of the VRMA bone register.
  // The previous pattern `lerp(headBone.rotation.y, target, 0.15)` read the bone
  // VALUE which the VRMA mixer resets to its keyframe every frame, causing the head
  // to never exceed ~15 % of the intended rotation (the rigid-loop trap).
  // Fix: lerp these refs, then direct-assign to the bone — same pattern as neckBone.
  const headYawSmoothRef   = useRef(0);
  const headPitchSmoothRef = useRef(0);
  const headRollSmoothRef  = useRef(0);
  // Micro-expression refs (V29 — extended ARKit-like types + peak intensity)
  const microExprUntilRef = useRef(0);
  const microExprStartAtRef = useRef(0);
  const microExprPeakRef    = useRef(0.18);
  const microExprTypeRef  = useRef<
    | 'eyebrowRaise' | 'squint' | 'halfSmile' | 'cheekPuff' | 'eyeWide'
    | 'browFurrow' | 'lipPress' | 'noseWrinkle' | 'eyeSquint' | 'none'
  >('none');
  // Auto-scheduled micro-expression / idle nod / gaze-break schedulers
  const autoMicroExprNextRef = useRef(
    Date.now() + MICRO_EXPR_MIN_MS + Math.random() * (MICRO_EXPR_MAX_MS - MICRO_EXPR_MIN_MS),
  );
  const idleNodNextRef       = useRef(Date.now() + 25000 + Math.random() * 20000); // fire every 25-45 s
  const gazeBreakNextRef     = useRef(Date.now() + 10000 + Math.random() * 15000); // look-away every 10-25 s
  const gazeBreakUntilRef    = useRef(0);
  const gazeBreakOffsetRef   = useRef(new THREE.Vector3());
  // V20 — weight shift, hip tilt, long head tilt, shoulder asymmetry, eye micro-bursts
  const lifeHipTiltZRef          = useRef(0);
  const lifeLongHeadTiltRef      = useRef(0);
  const lifeHeadTiltFlipNextRef  = useRef(Date.now() + 50_000);
  const lifeShoulderDropSideRef  = useRef<'left' | 'right'>('right');
  const lifeShoulderDropNextRef  = useRef(Date.now() + 26_000);
  const eyeMicroBurstUntilRef    = useRef(0);
  const eyeMicroOffsetRef        = useRef(new THREE.Vector3());
  const eyeMicroNextRef          = useRef(Date.now() + 700);
  // Gesture variety: track last gesture type to prevent repetition
  const lastGestureTypeRef = useRef<string>('');
  const lastGestureTimeRef = useRef(0);
  // Sitting vs standing — driven by avatar:sit / avatar:stand (UI + events)
  const isSittingRef      = useRef(false);
  // VRMA gesture sentinel — prevents §8 arm-bone overrides while a gesture VRMA is playing.
  // Without this, v.update(delta) bakes VRMA keyframes then §8 immediately overwrites them.
  const vrmaGestureUntilRef = useRef(0);
  /** Short procedural upper-body nudges (no VRMA clip) — §8 arm path reads these. */
  const shoulderShrugUntilRef = useRef(0);
  const handsUpUntilRef     = useRef(0);
  /** V30 — auto / event-driven idle micro-gestures (shoulder, tilt, finger tap) */
  const idleMicroGestureNextRef = useRef(0);
  const fingerTapUntilRef   = useRef(0);
  const fingerTapSideRef    = useRef<'left' | 'right'>('right');
  // Tracks when the current gesture VRMA clip has FINISHED playing (non-looping clips stop at
  // last frame). Once true, §8 is allowed to override arm bones even while the gesture WINDOW
  // is still open — this ends arm paralysis after a short clip (e.g. ack ≈1.5s) within a long
  // standing window (4–5s).
  const vrmaClipDoneRef = useRef(true);
  // V121 PHASE 3 — VRMA single-flight cache for Cogni dynamic gesture clips
  const vrmaPromiseCacheRef = useRef<Map<string, Promise<GLTF>>>(new Map());
  // V120 — lower-body bind-pose store + recalib throttle + one-shot foot-axis fix
  const bindLowerBodyRotationsRef = useRef<Map<string, THREE.Quaternion>>(new Map());
  const lastRecalibTsRef = useRef(0);
  const RECALIB_MIN_MS = 1000;
  const LOWER_BONES = ['leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'rightUpperLeg', 'rightLowerLeg', 'rightFoot'] as const;
  const footAxisFixedRef = useRef(false);
  /** Traffic light: dynamic Cogni VRMA clip from `animationMap` is actively playing. */
  const vrmaGestureNowRef = useRef(false);
  /** Multiplier for spine / chest / head / arm procedural layers (1 idle, 0.2 during cogni VRMA). */
  const procLifeDampRef = useRef(1.0);
  /** Non-preloaded clip action from `playCogniAnimation` — cleared when the clip finishes. */
  const cogniDynamicActionRef = useRef<THREE.AnimationAction | null>(null);
  /** Bumps on each `playCogniAnimation` call so stale GLTF responses cannot apply after a newer request. */
  const cogniLoadGenerationRef = useRef(0);
  /** V29 — smooth 0→1 blend for additive finger pose on VRMA `point` clips */
  const pointFingerBlendRef = useRef(0);
  // T-pose bind position of the hips bone — captured once after VRM loads (before any VRMA).
  // Used in §8 to restore hips to correct standing height when !isSittingEffective.
  // Setting hips.y = 0 is WRONG: T-pose hips.y ≈ 0.9m in teach.vrm, not 0.
  const hipsBindPosRef = useRef<THREE.Vector3 | null>(null);
  // ── Behavioral phase state machine ───────────────────────────────────────
  // Drives all physical-layer modulations: Idle / Listening / Thinking / Speaking.
  // Derived every frame from the combination of external flags; stored so JSX/events
  // can read it too (e.g. for future analytics / debug overlays).
  const avatarPhaseRef    = useRef<'idle' | 'listening' | 'thinking' | 'speaking'>('idle');
  const isListeningExtRef = useRef(false); // driven by avatar:listening window event

  // ── Transcribing / thinking state ───────────────────────────────────────
  // Set true while Whisper is transcribing; drives a subtle "thinking" pose
  // (raised gaze, relaxed blendshape, gentle head tilt) so the avatar looks
  // attentive rather than frozen during the STT latency window.
  const isTranscribingRef   = useRef(false);
  const savedEmotionRef     = useRef<string>('neutral'); // restored post-transcription

  // ── VRM blendshape probe cache ───────────────────────────────────────────
  // Maps canonical VRM 1.0 key → the actual key that the loaded model supports.
  // Populated lazily on first use; each key is probed at most once.
  const resolvedKeysRef   = useRef<Record<string, string>>({});

  // Smart expression setter: tries VRM 1.0 key first, falls back to VRM 0.x.
  // Uses the probe cache so the fallback probe only runs once per key per session.
  const setEM = useCallback((
    em: NonNullable<VRM['expressionManager']>,
    key: string,
    value: number,
  ) => {
    const cache = resolvedKeysRef.current;
    const resolved = cache[key];
    if (resolved !== undefined) {
      try { em.setValue(resolved as never, value); } catch { /* silent */ }
      return;
    }
    // First use: probe the VRM 1.0 key
    try {
      em.setValue(key as never, value);
      cache[key] = key;
    } catch {
      // VRM 1.0 key not present — try VRM 0.x fallback
      const fb = VRM1_TO_VRM0[key];
      if (fb) {
        try { em.setValue(fb as never, value); cache[key] = fb; return; } catch { /* silent */ }
      }
      cache[key] = key; // store original so we don't re-probe
    }
  }, []);

  // ── Phase 2: single source of truth for standing / seat height (Leva in dev) ─
  const { yOffset, sitHeightOffset } = useControls('Avatar Position', {
    /** V55: offset from `ROOM_BOUNDS.floorY` (updates when carpet AABB is applied) */
    yOffset:         { value: 0, min: -2, max: 2, step: 0.01, label: 'ΔY from floor (stand)' },
    sitHeightOffset: { value: 0.45, min: 0.15, max: 0.9, step: 0.01 },
  });
  const { walkForwardDistance, autoPatrol } = useControls('Avatar Locomotion', {
    walkForwardDistance: { value: 1.2, min: 0.3, max: 4, step: 0.1 },
    autoPatrol:          { value: false, label: 'Auto patrol (waypoints)' },
  });
  const walkForwardDistRef = useRef(walkForwardDistance);
  const autoPatrolRef = useRef(autoPatrol);
  walkForwardDistRef.current = walkForwardDistance;
  autoPatrolRef.current = autoPatrol;
  /** جلوس: أرض الغرفة + ارتفاع المقعد — كان sitHeightOffset وحده يضع الأفاتار قرب السقف فوق الكاميرا */
  const sitYWorld = ROOM_BOUNDS.floorY + sitHeightOffset;

  // ── VRMA animation system ────────────────────────────────────────────────
  const mixerRef      = useRef<THREE.AnimationMixer | null>(null);
  const vrmaActions   = useRef<Map<string, THREE.AnimationAction>>(new Map());
  const activeVrmaRef = useRef<string>('');
  const vrmaReadyRef  = useRef(false);
  const idleIdxRef    = useRef(0);
  const idleNextRef   = useRef(0);
  const wasWalkingRef     = useRef(false);
  const stopWalkUntilRef  = useRef(0);    // time to switch idle after stop-walk anim
  // ── Auto-patrol refs ─────────────────────────────────────────────────────
  const patrolIdxRef       = useRef(0);                         // current waypoint index
  const patrolWaitUntilRef = useRef(Date.now() + 1000);         // pause timer between waypoints

  // ── Click-to-move state (2D: X + Z) — must stay with other hooks (before useEffects) ──
  const targetAvatarXRef  = useRef(AVATAR_DEFAULT_STAND_X);
  const currentAvatarXRef = useRef(AVATAR_DEFAULT_STAND_X);
  const targetAvatarZRef  = useRef(AVATAR_DEFAULT_STAND_Z);
  const currentAvatarZRef = useRef(AVATAR_DEFAULT_STAND_Z);
  const avatarFacingRef   = useRef(Math.PI);
  /** V52 — yaw added to all body-facing targets (VRM 0.x ≈ π, VRM 1.0 ≈ 0). Synced on each successful VRM load. */
  const avatarFacingBaseRef = useRef(Math.PI);
  const vrmMetaIsV1Ref = useRef(false);
  /** One-shot: align scene AABB bottom to ROOM_BOUNDS.floorY (+ optional env trim). */
  const footToFloorYOffsetRef = useRef(0);
  const footCalibDoneRef = useRef(false);
  /** V122 — standing state lock: prevents sinking below calibrated standing floor baseline. */
  const lastStandClampLogAtRef = useRef(0);
  const patrolWpRef = useRef(buildPatrolWaypoints());
  const permaChairXRef = useRef(AVATAR_DEFAULT_STAND_X);
  const permaChairZRef = useRef(AVATAR_DEFAULT_STAND_Z);
  const v54DebugCamRef = useRef<THREE.PerspectiveCamera | null>(null);
  const v54DebugOrbitTargetRef = useRef<THREE.Vector3 | null>(null);

  const { pointer, camera, gl, controls, scene } = useThree();

  /** Skip redundant work when `room:bounds:applied` fires multiple times with the same floorY (V57). */
  const lastRoomBoundsFloorYRef = useRef<number | null>(null);

  /** V55 — carpet AABB applied: re-run foot–floor, Rapier statics, patrol loop, default stand XZ */
  useEffect(() => {
    const onApplied = () => {
      if (groundLockedRef?.current) {
        return;
      }
      const fy = ROOM_BOUNDS.floorY;
      if (
        lastRoomBoundsFloorYRef.current !== null
        && Math.abs(fy - lastRoomBoundsFloorYRef.current) < 0.02
      ) {
        if (process.env.NODE_ENV === 'development') {
          console.debug('[V57] room:bounds:applied — floorY unchanged, skipping heavy reset');
        }
        return;
      }
      lastRoomBoundsFloorYRef.current = fy;

      footCalibDoneRef.current = false;
      lastStandClampLogAtRef.current = 0;
      resetRapierAvatarState();
      patrolWpRef.current = buildPatrolWaypoints();
      patrolIdxRef.current = 0;
      const p = getDefaultStandXZ();
      permaChairXRef.current = p.x;
      permaChairZRef.current = p.z;
      currentAvatarXRef.current = p.x;
      targetAvatarXRef.current = p.x;
      currentAvatarZRef.current = p.z;
      targetAvatarZRef.current = p.z;
      if (process.env.NODE_ENV === 'development') {
        console.info('%c[V55] room bounds applied — stand reset + foot re-calibration', 'color:#22d3ee;font-weight:bold', {
          standXZ: [p.x, p.z],
          ROOM_BOUNDS: { ...ROOM_BOUNDS },
        });
      }
    };
    window.addEventListener('room:bounds:applied', onApplied);
    return () => window.removeEventListener('room:bounds:applied', onApplied);
  }, [groundLockedRef]);

  // V121 — smart carpet root: prefer known names, then search scene for flattest mesh
  // (AABB height ≤ 0.01 m). Caches hit in window.CARPET_MESH so repeated calls are O(1).
  const resolveCarpetRoot = useCallback((): THREE.Object3D | null => {
    const w: any = (typeof window !== 'undefined') ? window : {};
    // 1. Already cached this session
    if (w.CARPET_MESH) return w.CARPET_MESH as THREE.Object3D;
    // 2. Explicit global set by external code
    if (w.CARPET_ROOT) { w.CARPET_MESH = w.CARPET_ROOT; return w.CARPET_ROOT as THREE.Object3D; }
    // 3. Named lookup
    const byName =
      scene.getObjectByName('EduverseCarpetGlbFloor') ||
      scene.getObjectByName('carpet') ||
      null;
    if (byName) { w.CARPET_MESH = byName; return byName; }
    // 4. Fallback: find any Mesh whose AABB height ≤ 0.01 m (ultra-flat → carpet)
    let best: THREE.Mesh | null = null;
    let bestTop  = -Infinity;
    scene.traverse((o) => {
      if (!(o as THREE.Mesh).isMesh) return;
      const m = o as THREE.Mesh;
      const nm = (m.name || '').toLowerCase();
      if (/wall|ceiling|door|window|chair|desk|table|lamp/.test(nm)) return;
      const box = new THREE.Box3().setFromObject(m);
      const h = box.max.y - box.min.y;
      if (h > 0.01) return; // not flat enough
      if (box.max.y > bestTop) { bestTop = box.max.y; best = m; }
    });
    if (best) { w.CARPET_MESH = best; return best; }
    return null;
  }, [scene]);

  // V120 — capture raw bone quaternions for each lower-body bone at VRM load time.
  // These become the "truth" pose for resetLowerBodyToIdle instead of hard-coded angles.
  const captureLowerBodyBindPose = useCallback(() => {
    const vrm = vrmRef.current; if (!vrm) return;
    LOWER_BONES.forEach(name => {
      const b = (vrm.humanoid as any)?.getRawBoneNode(name);
      if (b) bindLowerBodyRotationsRef.current.set(name, (b as THREE.Object3D).quaternion.clone());
    });
  }, []);

  // V121 — smart recalibration:
  //   1. Raycast from each foot downward into carpet mesh (ground truth)
  //   2. Fallback: AABB max.y + extra when no raycast hit
  //   3. Clamp |delta| ≤ 0.35 m (guard against wild jumps)
  //   4. Sanity: reject floor that is above avatar's head or below plausible range
  const recalibrateFeet = useCallback(() => {
    const v = vrmRef.current;
    const root = groupRef.current;
    if (!v || !root) return;
    const rugRoot = resolveCarpetRoot();
    if (!rugRoot) return;

    const extra = readRugExtraEnv();
    const get = (n: string) =>
      (v.humanoid as any)?.getNormalizedBoneNode(n) ??
      (v.humanoid as any)?.getRawBoneNode(n);
    const l = get('leftFoot')  as THREE.Object3D | undefined;
    const r = get('rightFoot') as THREE.Object3D | undefined;
    if (!l || !r) return;

    // Head for sanity check
    const headNode = get('head') as THREE.Object3D | undefined;
    const headWorldY = headNode
      ? headNode.getWorldPosition(new THREE.Vector3()).y
      : root.getWorldPosition(new THREE.Vector3()).y + 1.7;

    // -- Primary: Raycast each foot downward into carpet mesh --
    const castDown = (origin: THREE.Vector3): number | null => {
      const src = origin.clone().add(new THREE.Vector3(0, 0.3, 0));
      const ray = new THREE.Raycaster(src, new THREE.Vector3(0, -1, 0), 0, 1.0);
      const hits = ray.intersectObject(rugRoot, true);
      return hits.length ? (hits[0].point.y ?? null) : null;
    };
    const lHitY = castDown(l.getWorldPosition(new THREE.Vector3()));
    const rHitY = castDown(r.getWorldPosition(new THREE.Vector3()));
    const rcHits = ([lHitY, rHitY] as (number | null)[]).filter((y): y is number => y !== null);

    let floorY: number;
    let method: string;
    if (rcHits.length > 0) {
      floorY = Math.max(...rcHits) + extra;
      method = 'raycast';
    } else {
      const { worldTopY } = computeRugSurfaceWorld(rugRoot);
      floorY = worldTopY + extra;
      method = 'aabb';
    }

    // -- Sanity guard --
    if (floorY >= headWorldY - 0.1) {
      console.warn('[V121 Recalib] SANITY: proposed floorY', +floorY.toFixed(3), '≥ headY', +headWorldY.toFixed(3), '— skipped');
      return;
    }
    if (floorY < headWorldY - 5.0) {
      console.warn('[V121 Recalib] SANITY: proposed floorY', +floorY.toFixed(3), 'too far below headY', +headWorldY.toFixed(3), '— skipped');
      return;
    }

    const lY  = l.getWorldPosition(new THREE.Vector3()).y;
    const rY  = r.getWorldPosition(new THREE.Vector3()).y;
    const avg = (lY + rY) / 2;
    const rawDelta = (floorY + 0.015) - avg;
    // -- Clamp --
    const safeDelta = Math.max(-0.35, Math.min(0.35, rawDelta));
    root.position.y += safeDelta;
    root.updateMatrixWorld(true);
    v.scene?.updateMatrixWorld(true);
    if (process.env.NODE_ENV === 'development') {
      console.log('[V121 RootRecalib]', {
        method,
        floorY: +floorY.toFixed(3),
        avgFeetY: +avg.toFixed(3),
        delta: +rawDelta.toFixed(3),
        applied: +safeDelta.toFixed(3),
        clamped: rawDelta !== safeDelta,
      });
    }
  }, [resolveCarpetRoot]);

  // V120 — throttle recalibration to at most once per RECALIB_MIN_MS (except first-on-mount)
  const throttledRecalibrateFeet = useCallback(() => {
    const now = performance.now();
    if (now - lastRecalibTsRef.current < RECALIB_MIN_MS) return;
    lastRecalibTsRef.current = now;
    recalibrateFeet();
  }, [recalibrateFeet]);

  // V120 — reset lower body to T-pose bind-pose quaternions (replaces hard-coded angles)
  const resetLowerBodyToIdle = useCallback(() => {
    const vrm = vrmRef.current; if (!vrm) return;
    const get = (n: string) => (vrm.humanoid as any)?.getRawBoneNode(n);
    LOWER_BONES.forEach(name => {
      const b = get(name) as THREE.Object3D | undefined;
      const q = bindLowerBodyRotationsRef.current.get(name);
      if (b && q) {
        (b as any).quaternion.copy(q);
        b.updateMatrixWorld(true);
      }
    });
    vrm.scene?.updateMatrixWorld(true);
  }, []);

  // V120 — one-shot foot-axis correction: if foot→toes vector is pitched too far up, apply −15° fix
  const fixFootAxisIfNeeded = useCallback(() => {
    if (footAxisFixedRef.current) return;
    const vrm = vrmRef.current; if (!vrm) return;
    const get = (n: string) =>
      (vrm.humanoid as any)?.getNormalizedBoneNode(n) ??
      (vrm.humanoid as any)?.getRawBoneNode(n);
    function fixOne(side: 'left' | 'right') {
      const foot = get(side + 'Foot');
      const toes = get(side + 'Toes');
      if (!foot || !toes) return;
      const wp = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3());
      const forward = wp(toes as THREE.Object3D).sub(wp(foot as THREE.Object3D)).normalize();
      const up = new THREE.Vector3(0, 1, 0);
      const angleUpDeg = THREE.MathUtils.radToDeg(
        Math.acos(Math.max(-1, Math.min(1, forward.dot(up))))
      );
      if (angleUpDeg < 40) return; // foot direction looks horizontal — no fix needed
      (foot as any).rotation.x += THREE.MathUtils.degToRad(-15);
      (foot as THREE.Object3D).updateMatrixWorld(true);
    }
    fixOne('left');
    fixOne('right');
    vrm.scene?.updateMatrixWorld(true);
    footAxisFixedRef.current = true;
  }, []);

  // V100 — debug Box3Helper: 4-second overlay, dev + RUG_DEBUG_BOX=1 only
  const showRugBoxHelperOnce = useCallback(() => {
    if (process.env.NODE_ENV !== 'development') return;
    const rugRoot = resolveCarpetRoot();
    if (!rugRoot) return;
    const { box } = computeRugSurfaceWorld(rugRoot);
    const helper = new THREE.Box3Helper(box, new THREE.Color(0x00ff99));
    scene.add(helper);
    setTimeout(() => {
      scene.remove(helper);
      (helper.geometry as THREE.BufferGeometry)?.dispose?.();
    }, 4000);
  }, [resolveCarpetRoot, scene]);

  /**
   * V100 / COGNI sub-floor — `room:footRecalib` recomputes V52 foot offset vs **current** `ROOM_BOUNDS.floorY`
   * AND performs root-only bone recalibration so feet land correctly on the rug surface.
   * Must run even when GroundLock is true (lock applies to floor Y writes, not foot–mesh solve).
   */
  useEffect(() => {
    const onFoot = () => {
      footCalibDoneRef.current = false;
      resetRapierAvatarState();
      throttledRecalibrateFeet();   // V120 — throttled after first-on-mount pass
      resetLowerBodyToIdle();
      fixFootAxisIfNeeded();        // V120 — re-check axis on each recalib event
    };
    window.addEventListener('room:footRecalib', onFoot);
    return () => window.removeEventListener('room:footRecalib', onFoot);
  }, [throttledRecalibrateFeet, resetLowerBodyToIdle, fixFootAxisIfNeeded]);

  // V100 — double-rAF stabilization: after mounting, run recalibration once the scene has settled
  useEffect(() => {
    let alive = true;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!alive) return;
      captureLowerBodyBindPose();   // V120 — 1. store bind-pose before any animation
      recalibrateFeet();            // V120 — 2. unthrottled first recalib
      resetLowerBodyToIdle();       // V120 — 3. restore bind-pose lower body
      fixFootAxisIfNeeded();        // V120 — 4. one-shot foot axis correction
      if (typeof window !== 'undefined' && (window as any).NEXT_PUBLIC_RUG_DEBUG_BOX === '1') {
        showRugBoxHelperOnce();
      }
    }));
    return () => { alive = false; };
  }, [captureLowerBodyBindPose, recalibrateFeet, resetLowerBodyToIdle, fixFootAxisIfNeeded, showRugBoxHelperOnce]);

  /**
   * V121 — `room:carpet:changed` fires when CarpetLoader places a new carpet in the scene.
   * Clears the CARPET_MESH cache so the next recalib resolves a fresh mesh, then
   * double-rAF waits for matrixWorld to settle before running a full recalib pass.
   */
  useEffect(() => {
    const onCarpetChanged = () => {
      carpetBoundsAppliedRef.current = false;
      footCalibDoneRef.current = false;
      // Invalidate carpet mesh cache so resolveCarpetRoot re-scans the scene
      if (typeof window !== 'undefined') (window as any).CARPET_MESH = undefined;
      if (process.env.NODE_ENV === 'development') {
        console.info('[V121] room:carpet:changed → cache cleared, scheduling double-rAF recalib');
      }
      // Double-rAF: wait two frames for scene matrixWorld to stabilise
      requestAnimationFrame(() => requestAnimationFrame(() => {
        throttledRecalibrateFeet();
        resetLowerBodyToIdle();
        fixFootAxisIfNeeded();
      }));
    };
    window.addEventListener('room:carpet:changed', onCarpetChanged);
    return () => window.removeEventListener('room:carpet:changed', onCarpetChanged);
  }, [throttledRecalibrateFeet, resetLowerBodyToIdle, fixFootAxisIfNeeded]);

  /**
   * Dev only — rug / foot height calibration from the browser console (0–2 cm target vs `ROOM_BOUNDS.floorY`).
   * Exposes: `window.__vrmRef()`, `window.THREE`, `window.ROOM_BOUNDS` (getter → live `ROOM_BOUNDSRef.current`).
   * No GroundLock changes. During calibration keep `?fixFeet=1` off.
   *
   * Console snippet (paste in dev):
   * ```js
   * (() => {
   *   const THREE = window.THREE;
   *   const vrm = window.__vrmRef?.();
   *   const rb  = window.ROOM_BOUNDS;
   *   if (!THREE || !vrm || !rb) return console.warn('THREE / VRM / ROOM_BOUNDS not ready (dev build only).');
   *   const get  = (n) => vrm.humanoid?.getNormalizedBoneNode(n) ?? vrm.humanoid?.getRawBoneNode(n);
   *   const wpos = (o) => o.getWorldPosition(new THREE.Vector3());
   *   const l = get('leftFoot'), r = get('rightFoot');
   *   if (!l || !r) return console.warn('Foot bones missing');
   *   const fy = rb.floorY;
   *   const dl = +(wpos(l).y - fy).toFixed(3);
   *   const dr = +(wpos(r).y - fy).toFixed(3);
   *   const avg = (dl + dr) / 2;
   *   const targetGap = 0.015;
   *   const suggest = Math.max(0, +(avg - targetGap).toFixed(3));
   *   console.log({ floorY: fy, left_m: dl, right_m: dr, avg_m: +avg.toFixed(3), suggest_extra_m: suggest });
   * })();
   * ```
   * If `avg_m` is negative, reduce extra: `new_extra = max(0, current_extra + avg_m - 0.015)`.
   */
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return;
    const w = window as unknown as {
      __vrmRef?: () => VRM | null;
      THREE?: typeof THREE;
      ROOM_BOUNDS?: RoomBounds;
      AVATAR_ROOT?: THREE.Object3D | null;
      scene?: THREE.Scene;
    };
    w.__vrmRef = () => vrmRef.current;
    w.THREE = THREE;
    // Expose the live Three.js scene so console snippets can traverse objects
    w.scene = scene;
    Object.defineProperty(w, 'ROOM_BOUNDS', {
      get: () => ROOM_BOUNDSRef.current,
      configurable: true,
    });
    // Getter → always returns the current groupRef so console recovery scripts
    // mutate the same root that recalibrateFeet() moves (groupRef, not vrm.scene).
    Object.defineProperty(w, 'AVATAR_ROOT', {
      get: () => groupRef.current,
      configurable: true,
    });
    console.info('[DEV] Exposed: window.__vrmRef(), window.THREE, window.scene, window.AVATAR_ROOT (getter), window.ROOM_BOUNDS (getter)');
    return () => {
      const safe = (key: string) => { try { delete (w as Record<string, unknown>)[key]; } catch { /* noop */ } };
      safe('__vrmRef');
      safe('THREE');
      safe('scene');
      safe('ROOM_BOUNDS');
      safe('AVATAR_ROOT');
    };
  }, [scene]);

  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return;
    const id = requestAnimationFrame(() => {
      const cam = camera as THREE.PerspectiveCamera;
      const fwd = new THREE.Vector3();
      cam.getWorldDirection(fwd);
      const tgt =
        controls && typeof controls === 'object' && 'target' in controls
          ? (controls as { target: THREE.Vector3 }).target
          : null;
      console.info('[V54] Initial rig', {
        camPos: cam.position.toArray(),
        camFwd: fwd.toArray(),
        orbitTarget: tgt?.toArray?.() ?? null,
      });
    });
    return () => cancelAnimationFrame(id);
  }, [camera, controls]);

  // V53 — dev: T teleports avatar to default stand XZ and re-runs V52 foot–floor calibration
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest?.('input, textarea, [contenteditable="true"]')) return;
      if (e.key === 'y' || e.key === 'Y') {
        const g = groupRef.current;
        const cam = v54DebugCamRef.current;
        const tgt = v54DebugOrbitTargetRef.current;
        const model = vrmRef.current;
        if (!g) {
          console.warn('[V54][Y] groupRef not ready');
          return;
        }
        g.getWorldPosition(_v53WorldPos);
        let headW: string | null = null;
        if (model?.humanoid) {
          const hn = model.humanoid.getRawBoneNode('head' as never);
          if (hn) {
            hn.getWorldPosition(_v53HeadWorld);
            headW = `${_v53HeadWorld.x.toFixed(3)},${_v53HeadWorld.y.toFixed(3)},${_v53HeadWorld.z.toFixed(3)}`;
          }
        }
        const fwd = new THREE.Vector3();
        if (cam) cam.getWorldDirection(fwd);
        console.log('[V54][Y] positions', {
          groupWorld: [_v53WorldPos.x, _v53WorldPos.y, _v53WorldPos.z],
          groupLocal: [g.position.x, g.position.y, g.position.z],
          camPos: cam ? cam.position.toArray() : null,
          camFwd: cam ? fwd.toArray() : null,
          orbitTarget: tgt ? tgt.toArray() : null,
          headWorld: headW,
        });
        return;
      }
      if (e.key !== 't' && e.key !== 'T') return;
      {
        const p = getDefaultStandXZ();
        currentAvatarXRef.current = p.x;
        targetAvatarXRef.current = p.x;
        currentAvatarZRef.current = p.z;
        targetAvatarZRef.current = p.z;
        footCalibDoneRef.current = false;
        _v54TeleportLogPending = true;
        console.log(
          '%c[V54] Teleport (T)',
          'color:#a78bfa;font-weight:bold',
          '→ stand X,Z =',
          p.x,
          p.z,
          '| foot calibration + snapshot next frame',
        );
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const playVRMA = useCallback((name: string, loop = true, fadeTime = 0.4) => {
    const mixer   = mixerRef.current;
    const actions = vrmaActions.current;
    if (!mixer || !actions.has(name) || activeVrmaRef.current === name) return;
    if (activeVrmaRef.current === '__cogni__' && cogniDynamicActionRef.current) {
      cogniDynamicActionRef.current.fadeOut(fadeTime);
      cogniDynamicActionRef.current = null;
      cogniLoadGenerationRef.current += 1; // drop any in-flight GLTF from playCogniAnimation
      vrmaGestureNowRef.current = false;
      procLifeDampRef.current = 1.0;
      vrmaClipDoneRef.current = true;
    }
    const prev =
      activeVrmaRef.current && activeVrmaRef.current !== '__cogni__'
        ? actions.get(activeVrmaRef.current)
        : null;
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

  /** Neutral traffic-light state when no Cogni VRMA gesture is active (procedural layers fully on). */
  const resetCogniGestureTrafficLights = useCallback(() => {
    vrmaGestureNowRef.current = false;
    vrmaClipDoneRef.current = true;
    procLifeDampRef.current = 1.0;
  }, []);

  /**
   * Load a baked `.vrma` by URL (intent map), cross-fade with current mixer action, non-looping.
   * Priority guards, stale-load protection, and failed-load traffic-light reset for production use.
   * V121 PHASE 3: Single-flight promise cache prevents concurrent duplicate GLTF loads of the same URL.
   */
  const playCogniAnimation = useCallback(
    (url: string) => {
      const model = vrmRef.current;
      const mixer = mixerRef.current;
      if (!model?.humanoid || !mixer) {
        console.warn('[VRMA Cogni] VRM or mixer not ready —', url);
        return;
      }

      const nowMs = Date.now();
      if (nowMs < walkUntilRef.current) {
        console.warn('Gesture blocked: Avatar is currently walking.');
        return;
      }
      if (isSittingRef.current) {
        console.warn('Gesture blocked: Avatar is seated; standing intent VRMA skipped.');
        return;
      }

      const loadGen = ++cogniLoadGenerationRef.current;
      const cache = vrmaPromiseCacheRef.current;
      
      // V121 PHASE 3: Single-flight check+store pattern
      const existingPromise = cache.get(url);
      if (existingPromise) {
        existingPromise
          .then((gltf) => {
            if (loadGen !== cogniLoadGenerationRef.current) return;
            strictPurgeDeskLikeMeshes(gltf.scene);
            const anims: VRMAnimation[] = gltf.userData.vrmAnimations ?? [];
            if (!anims[0]) {
              console.warn('[VRMA Cogni] Cached GLTF has no vrmAnimations — pls check file');
              resetCogniGestureTrafficLights();
              return;
            }
            let clip = createVRMAnimationClip(anims[0], model);
            if (pruneFeetTracks) {
              clip = pruneFootTracksFromClip(clip);
            }
            const action = mixer.clipAction(clip);
            // ... apply action (see below merged code)
            if (cogniDynamicActionRef.current && cogniDynamicActionRef.current !== action) {
              cogniDynamicActionRef.current.fadeOut(0.5);
            }
            cogniDynamicActionRef.current = action;
            action.reset();
            action.setLoop(THREE.LoopOnce, Infinity);
            action.clampWhenFinished = true;
            action.fadeIn(0.5);
            action.play();
            activeVrmaRef.current = '__cogni__';
            vrmaGestureNowRef.current = true;
            vrmaClipDoneRef.current = false;
            procLifeDampRef.current = 0.2;
            console.log('[VRMA Cogni] ▶ (cached)', url);
          })
          .catch((err) => {
            if (loadGen !== cogniLoadGenerationRef.current) return;
            console.error('[VRMA Cogni] Cached promise rejected —', url, err);
            cache.delete(url);
            resetCogniGestureTrafficLights();
          });
        return;
      }

      // New load — create promise and store
      const vrmaLoader = new GLTFLoader();
      registerVRMAnimationLoaderPlugin(vrmaLoader);
      const loadPromise = new Promise<GLTF>((resolve, reject) => {
        vrmaLoader.load(
          url,
          (gltf) => resolve(gltf),
          undefined,
          (err) => reject(err)
        );
      });
      cache.set(url, loadPromise);
      
      loadPromise
        .then((gltf) => {
          if (loadGen !== cogniLoadGenerationRef.current) return;
          strictPurgeDeskLikeMeshes(gltf.scene);
          const anims: VRMAnimation[] = gltf.userData.vrmAnimations ?? [];
          if (!anims[0]) {
            console.error(
              '[VRMA Cogni] Fallback: file loaded but no vrmAnimations — restoring neutral gesture state |',
              url,
            );
            resetCogniGestureTrafficLights();
            return;
          }

          let clip = createVRMAnimationClip(anims[0], model);
          if (pruneFeetTracks) {
            clip = pruneFootTracksFromClip(clip);
          }
          const action = mixer.clipAction(clip);
          const prevKey = activeVrmaRef.current;
          const prevFromMap = prevKey && prevKey !== '__cogni__' ? vrmaActions.current.get(prevKey) : null;
          if (prevFromMap) prevFromMap.fadeOut(0.5);
          if (cogniDynamicActionRef.current && cogniDynamicActionRef.current !== action) {
            cogniDynamicActionRef.current.fadeOut(0.5);
          }
          cogniDynamicActionRef.current = action;
          action.reset();
          action.setLoop(THREE.LoopOnce, Infinity);
          action.clampWhenFinished = true;
          action.fadeIn(0.5);
          action.play();
          activeVrmaRef.current = '__cogni__';
          vrmaGestureNowRef.current = true;
          vrmaClipDoneRef.current = false;
          procLifeDampRef.current = 0.2;
          console.log('[VRMA Cogni] ▶', url);
        })
        .catch((err) => {
          if (loadGen !== cogniLoadGenerationRef.current) return;
          console.error(
            '[VRMA Cogni] Fallback: load failed — restoring neutral gesture state |',
            url,
            '|',
            (err as Error)?.message ?? err,
          );
          resetCogniGestureTrafficLights();
        });
    },
    [resetCogniGestureTrafficLights, pruneFeetTracks],
  );

  // ── Load VRM ────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    /** Same `mixer` instance that owns `onMixerGestureClipFinished` — removed on effect cleanup. */
    let pendingMixerForFinished: THREE.AnimationMixer | null = null;
    let onMixerGestureClipFinished: ((ev: Event) => void) | null = null;

    // Build a deduped candidate list: prop url first, then global fallbacks.
    const seen = new Set<string>();
    const candidates: string[] = [];
    for (const u of [vrmUrl, ...VRM_FALLBACKS]) {
      if (u && !seen.has(u)) { seen.add(u); candidates.push(u); }
    }

    // Suppress noisy LookAtDegreeMap warnings from three-vrm
    const origWarn = console.warn;
    console.warn = (...a: unknown[]) => {
      if (String(a[0] ?? '').includes('LookAtDegreeMap')) return;
      origWarn.apply(console, a);
    };

    /** Try each candidate URL in order; call onError('allFailed') when exhausted. */
    function attemptLoad(idx: number): void {
      if (cancelled || idx >= candidates.length) {
        if (!cancelled) {
          console.warn = origWarn;
          console.error('[AvatarCanvas] ❌ All VRM URLs failed — mounting placeholder');
          onError('allFailed');
        }
        return;
      }
      const urlToTry = candidates[idx];
      console.log(`[AvatarCanvas] 🔍 Trying VRM URL (${idx + 1}/${candidates.length}): ${urlToTry}`);
      const loader = new GLTFLoader();
      /* Second `{}` satisfies VRMLoaderPluginOptions when sub-plugins expect an options bag (avoids
       * "deprecated parameters… pass a single object" from three-vrm / core init paths in r182+). */
      loader.register((parser: unknown) => new VRMLoaderPlugin(parser as never, {}));
      loader.load(
        urlToTry,
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

        // Main avatar loads via GLTFLoader (not useGLTF). Purge OLD embedded desk/table/office/chair meshes.
        strictPurgeDeskLikeMeshes(model.scene);

        const isVRM1Meta = detectAndLogV52Vrm(model, urlToTry);
        vrmMetaIsV1Ref.current = isVRM1Meta;
        const yawOverride = readAvatarFacingYawBaseEnv();
        avatarFacingBaseRef.current =
          yawOverride !== null ? yawOverride : (isVRM1Meta ? 0 : Math.PI);
        avatarFacingRef.current = avatarFacingBaseRef.current;
        footCalibDoneRef.current = false;
        footToFloorYOffsetRef.current = 0;

        // teach.vrm is VRM 0.x and already faces the camera (native -Z, flipped by Math.PI group rotation).
        // rotateVRM0 is NOT called — it would double-flip the model to invisible.

        let meshCount = 0;
        model.scene.traverse((o) => {
          o.frustumCulled = false;
          if ((o as THREE.Mesh).isMesh) {
            const mesh = o as THREE.Mesh;
            mesh.visible = true;
            mesh.renderOrder = 0;
            // teach.vrm (VRM 0.x) uses standard Three.js materials — safe to override.
            const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            mats.forEach((m: THREE.Material) => {
              m.depthWrite  = true;
              m.depthTest   = true;
              m.visible     = true;
              m.side        = THREE.DoubleSide;
              m.needsUpdate = true;
            });
            meshCount++;
          }
        });
        console.log(`%c[AvatarCanvas] ✅ VRM loaded from ${urlToTry} — ${meshCount} meshes`, 'color:lime;font-weight:bold');
        if (meshCount === 0) console.error('[AvatarCanvas] 🔥 VRM has 0 meshes — avatar will be INVISIBLE! Check the .vrm file at:', urlToTry);

        // Greeting wave disabled — patrol starts immediately (wave would block §8 walk for 3.5 s)
        // waveUntilRef.current = Date.now() + WAVE_DURATION * 1000;

        // Position/scale/rotation are controlled by the <group> wrapper in JSX
        // and updated every frame by useFrame — do NOT set them on vrm.scene here.

        vrmRef.current = model;
        ensureVRMLookAtQuaternionProxyForVrm(model);
        
        // V121 FLOOR LOCK — create LIFT_NODE for isolated foot-floor calibration
        const lift = createLiftNode(model);
        liftNodeRef.current = lift;
        if (process.env.NODE_ENV === 'development') {
          console.log('%c[V121] LIFT_NODE created', 'color:#a78bfa;font-weight:bold');
        }
        
        setVrm(model);   // triggers re-render → <primitive> appears
        onLoad();
        // Capture T-pose hips bind position BEFORE any VRMA plays.
        // This is the ground truth for "standing hip height" — used in §8
        // to restore correct standing posture without sinking the skeleton.
        if (model.humanoid) {
          const hB = model.humanoid.getRawBoneNode('hips' as never);
          if (hB) hipsBindPosRef.current = hB.position.clone();
        }
        captureLowerBodyBindPose();  // V120 — store lower-body bind-pose for resetLowerBodyToIdle
        if (process.env.NODE_ENV === 'development') {
          console.info('[V53] VRM loaded — default stand XZ', AVATAR_DEFAULT_STAND_X, AVATAR_DEFAULT_STAND_Z, 'hipsBind(local)', hipsBindPosRef.current?.toArray?.() ?? null);
        }

        // ── VRMA animation system setup ────────────────────────────────────
        const mixer = new THREE.AnimationMixer(model.scene);
        mixerRef.current = mixer;
        pendingMixerForFinished = mixer;
        // Load all VRMA files in background (non-blocking)
        const vrmaLoader = new GLTFLoader();
        registerVRMAnimationLoaderPlugin(vrmaLoader);
        const origWarnVrma = console.warn;
        console.warn = (...a: unknown[]) => {
          if (shouldSuppressVrmaLoaderWarn(a[0])) return;
          origWarnVrma.apply(console, a);
        };
        const allAnims: [string, string][] = [
          ...VRMA_IDLE.map((url, i) => [`idle${i}`, url] as [string, string]),
          ...Object.entries(VRMA_PATHS),
        ];
        Promise.allSettled(
          allAnims.map(([key, url]) =>
            new Promise<void>((resolve) => {
              vrmaLoader.load(url, (gltf) => {
                strictPurgeDeskLikeMeshes(gltf.scene);
                const anims: VRMAnimation[] = gltf.userData.vrmAnimations ?? [];
                if (anims[0]) {
                  let clip = createVRMAnimationClip(anims[0], model);
                  if (pruneFeetTracks) {
                    clip = pruneFootTracksFromClip(clip);
                  }
                  // V120 — strip lower-body tracks from idle clips to let bind-pose hold
                  if (key.startsWith('idle')) {
                    clip = filterLowerBodyTracks(clip);
                  }
                  const action = mixer.clipAction(clip);
                  vrmaActions.current.set(key, action);
                  console.log(`[VRMA] ✅ ${key}`);
                } else {
                  console.warn(`[VRMA] ⚠️ ${key} — loaded but no vrmAnimations tracks`);
                }
                resolve();
              }, undefined, (err) => {
                console.warn(`[VRMA] ❌ ${key} (${url}) — ${(err as Error)?.message ?? err}`);
                resolve();
              });
            })
          )
        ).then(() => {
          if (cancelled) return;

          vrmaReadyRef.current  = true;
          vrmFirstFrameRef.current = true;  // reset neck warm-up on (re)load
          idleNextRef.current = Date.now()
            + IDLE_VRMA_MIN_MS
            + Math.random() * (IDLE_VRMA_MAX_MS - IDLE_VRMA_MIN_MS);
          idleMicroGestureNextRef.current = Date.now()
            + IDLE_MICRO_GESTURE_MIN_MS
            + Math.random() * 2500;
          // Standing default — must match isSittingRef (walk / idle assume not seated)
          isSittingRef.current = false;
          playVRMA('idle0', true, 0.8);
          console.log(
            '[VRMA] 🎬 Animation system ready — idle0 started, Cogni is standing | isSittingRef=',
            isSittingRef.current,
          );

          // V121 FLOOR LOCK — arm watchdog after animation init
          const _vrmArm = vrmRef.current;
          const _liftArm = liftNodeRef.current;
          const _grpArm = groupRef.current;
          if (_vrmArm && _liftArm && _grpArm) {
            armCalibWatchdog(_vrmArm, _liftArm, _grpArm, scene);
            if (process.env.NODE_ENV === 'development') {
              console.log('%c[V121] Floor-lock watchdog armed', 'color:#a78bfa;font-weight:bold');
            }
          }


          // ── Gesture clip-done tracker (single named listener — no stack on re-init) ──
          // When a non-looping VRMA gesture clip (ack, beckon, clap, …) finishes,
          // mark vrmaClipDoneRef = true. §8 uses this to FREE the arm bones for
          // procedural writes while the avatar stays in STANDING mode for the full
          // gesture window tail after clip end (mixer) + main window uses dur + 500ms. Two concerns:
          //   1. "Arm paralysis" — clips freeze at last frame after ~1.5s
          //   2. "Standing duration" — avatar should remain standing for ~4–5s
          // With vrmaClipDoneRef: arms animate naturally after clip ends, avatar
          // stays standing until the full window expires, then gracefully sits back.
          if (onMixerGestureClipFinished && pendingMixerForFinished) {
            pendingMixerForFinished.removeEventListener('finished', onMixerGestureClipFinished);
          }
          onMixerGestureClipFinished = (ev: Event) => {
            // Clip ended — allow §8 procedural arms again. Do NOT shrink
            // vrmaGestureUntilRef (that aborted the standing gesture tail early).
            // Fix 1: Reset hips position after VRMA to prevent root-motion drift.
            const _vrmFin = vrmRef.current;
            if (_vrmFin?.humanoid) {
              const _hips = _vrmFin.humanoid.getRawBoneNode('hips' as never);
              if (_hips && hipsBindPosRef.current) {
                _hips.position.copy(hipsBindPosRef.current);
                _hips.updateMatrix();
              }
            }
            groupRef.current?.updateMatrixWorld(true);
            _vrmFin?.scene?.updateMatrixWorld(true);
            resetLowerBodyToIdle();   // V120 — restore bind-pose after gesture clip ends
            vrmaClipDoneRef.current = true;
            vrmaGestureNowRef.current = false;
            procLifeDampRef.current = 1.0;
            const fin = ev as unknown as { action?: THREE.AnimationAction };
            if (fin.action && fin.action === cogniDynamicActionRef.current) {
              cogniDynamicActionRef.current = null;
              const idleKey = `idle${idleIdxRef.current}`;
              const idleAct = vrmaActions.current.get(idleKey);
              if (idleAct) {
                idleAct.reset();
                idleAct.setLoop(THREE.LoopRepeat, Infinity);
                idleAct.fadeIn(0.5);
                idleAct.play();
                activeVrmaRef.current = idleKey;
              } else {
                activeVrmaRef.current = '';
              }
            }
          };
          mixer.addEventListener('finished', onMixerGestureClipFinished);
        }).catch(() => {}).finally(() => {
          console.warn = origWarnVrma;
        });
      },
      undefined,
      (err) => {
        if (!cancelled) {
          console.error(`[AvatarCanvas] 🔥 VRM LOAD FAILED — URL: "${urlToTry}" | Error: ${(err as Error)?.message ?? err} | Trying next...`);
          attemptLoad(idx + 1);  // try next fallback URL
        }
      },
    );
    } // end attemptLoad

    attemptLoad(0);

    return () => {
      cancelled = true;
      if (pendingMixerForFinished && onMixerGestureClipFinished) {
        pendingMixerForFinished.removeEventListener('finished', onMixerGestureClipFinished);
      }
      pendingMixerForFinished = null;
      onMixerGestureClipFinished = null;
      console.warn = origWarn;
      // V121 PHASE 3: Cleanup VRMA cache to prevent memory leak
      vrmaPromiseCacheRef.current.clear();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vrmUrl]);

  useEffect(() => {
    const onPerformance = createAvatarPerformanceHandler(() => vrmRef.current, setEM);

    const onGesture = (e: Event) => {
      const d = (e as CustomEvent).detail as {
        type?: string;
        side?: string;
        duration?: number;
        fromPerformance?: boolean;
        fromAI?: boolean;
      };
      if (!d?.type) return;
      const now = Date.now();
      const fromPerformance = d.fromPerformance === true;
      const fromAIEvent = d.fromAI === true;
      const durSec = d.duration ?? 2.5;
      console.log('[GESTURE] received:', {
        gesture: d.type,
        side: d.side ?? 'right',
        duration: durSec,
        source: fromPerformance ? 'performance' : fromAIEvent ? 'agent' : 'other',
      });
      // Gesture variety: if same gesture fires within 4s, swap to alternate (skip when AI/performance owns the turn — V50)
      let gType = d.type;
      if (!fromPerformance && !fromAIEvent) {
        if (gType === 'thumbUp' || gType === 'pointIndex') {
          gType = 'point';
        }
        if (gType === lastGestureTypeRef.current && now - lastGestureTimeRef.current < 4000) {
          const alts: Record<string, string> = { point: 'openHand', openHand: 'beat', beat: 'point' };
          gType = alts[gType] ?? gType;
          console.log(`[BRAIN] Gesture variety swap: ${d.type} → ${gType}`);
        }
      }
      lastGestureTypeRef.current = gType;
      lastGestureTimeRef.current = now;

      if (gType === 'blink') {
        blinkPhaseRef.current = 0.001;
        nextBlinkRef.current = 0;
        blinkCountRef.current = 1;
        console.log('[BRAIN] Gesture received: blink');
        return;
      }

      const dur = durSec * 1000;
      const restoreAfterGesture = () => {
        // Fix 2: Always restore to idle VRMA — sit.vrma/sitTalk.vrma cause root-motion drift.
        // Manual pose (§8) handles the seated leg position when isSittingRef is true.
        playVRMA(`idle${idleIdxRef.current}`, true, 0.45);
      };
      // Returns the ACTUAL clip duration in ms for a VRMA key.
      // Using the clip duration (instead of the caller's `dur`) prevents the
      // "frozen arm" bug: when a short clip (e.g. ack ≈1.5s) is guarded by a
      // long window (4000ms), the arms freeze at the clip's last frame for
      // (4000 - 1500) = 2500ms before §8 is allowed to write the lap pose.
      const getClipDurMs = (key: string): number => {
        const action = vrmaActions.current.get(key);
        if (action) return Math.round(action.getClip().duration * 1000);
        return dur; // fallback to gesture_duration_ms if clip not loaded yet
      };

      if (isSittingRef.current) {
        if (gType === 'look') {
          headYawRef.current = 0.12 * (Math.random() > 0.5 ? 1 : -1);
          headPitchRef.current = -0.05;
          headUntilRef.current = Date.now() + Math.min(dur, 2200);
          console.log('[BRAIN] Seated look → head pose');
          return;
        }
        // Perma-sit: do not play standing VRMA gestures while seated.
        // Use procedural upper-body gestures only, keeping legs clamped to seated pose.
        const seatedType =
          gType === 'point' || gType === 'openHand' || gType === 'beat'
            ? gType
            : gType === 'thumbUp'
              ? 'point'
              : gType === 'beckon' || gType === 'think' || gType === 'peace'
                ? 'openHand'
                : 'openHand';
        gestureRef.current = {
          type: seatedType as 'point' | 'openHand' | 'beat',
          side: (d.side ?? 'right') as 'left' | 'right' | 'both',
          startMs: Date.now(),
          durationMs: dur,
        };
        setTimeout(() => {
          // Fix 2: Keep idle VRMA; manual pose handles seated posture.
          if (isSittingRef.current) playVRMA(`idle${idleIdxRef.current}`, true, 0.35);
        }, dur + 250);
        console.log(`[BRAIN] Seated gesture override: ${gType} → ${seatedType}`);
      } else if (gType === 'wave') {
        if (vrmaReadyRef.current) {
          pulseHandSeparationWindow(HAND_SEPARATION_PULSE_MS);
          const clipMs = getClipDurMs('wave');
          vrmaClipDoneRef.current = false;                          // reset clip-done sentinel
          playVRMA('wave', false, 0.3);
          vrmaGestureUntilRef.current = Date.now() + dur + 500;    // full standing window
          setTimeout(restoreAfterGesture, Math.max(clipMs, dur) + 400);
        } else {
          waveUntilRef.current = Date.now() + dur;
        }
        console.log('[BRAIN] Gesture received: wave');
      } else if (gType === 'clap' || gType === 'cheer') {
        if (vrmaReadyRef.current) {
          pulseHandSeparationWindow(HAND_SEPARATION_PULSE_MS);
          const vrmaKey2 = gType === 'cheer' ? 'cheer' : 'clap';
          const clipMs2  = getClipDurMs(vrmaKey2);
          vrmaClipDoneRef.current = false;
          playVRMA(vrmaKey2, false, 0.3);
          vrmaGestureUntilRef.current = Date.now() + dur + 500;
          setTimeout(restoreAfterGesture, Math.max(clipMs2, dur) + 400);
        } else {
          // Fallback: symmetric beat gesture on both arms
          gestureRef.current = {
            type: 'beat', side: 'both', startMs: Date.now(), durationMs: dur,
          };
        }
        console.log(`[BRAIN] Gesture received: ${gType}`);
      } else if (gType === 'beckon') {
        if (vrmaReadyRef.current) {
          const clipMsB = getClipDurMs('beckon');
          vrmaClipDoneRef.current = false;
          playVRMA('beckon', false, 0.3);
          vrmaGestureUntilRef.current = Date.now() + dur + 500;
          setTimeout(restoreAfterGesture, Math.max(clipMsB, dur) + 400);
        } else {
          gestureRef.current = {
            type: 'openHand',
            side: (d.side ?? 'right') as 'left' | 'right' | 'both',
            startMs: Date.now(),
            durationMs: dur,
          };
        }
        console.log(`[BRAIN] Gesture received: beckon (${d.side ?? 'right'})`);
      } else if (
        gType === 'point'
        || gType === 'openHand'
        || gType === 'beat'
        || gType === 'thumbUp'
      ) {
        const sideEff = (d.side ?? 'right') as 'left' | 'right' | 'both';
        const useLeftPointProc =
          vrmaReadyRef.current && gType === 'point' && sideEff === 'left';
        if (vrmaReadyRef.current && !useLeftPointProc) {
          if (gType === 'point' || gType === 'thumbUp') {
            pulseHandSeparationWindow(HAND_SEPARATION_PULSE_MS);
          }
          const vrmaGesture: Record<string, string> = {
            point: 'point',
            thumbUp: 'point',
            openHand: 'beckon',
            beat: 'ack',
          };
          const vrmaKey3 = vrmaGesture[gType] ?? 'ack';
          const clipMs3 = getClipDurMs(vrmaKey3);
          vrmaClipDoneRef.current = false;
          playVRMA(vrmaKey3, false, 0.3);
          vrmaGestureUntilRef.current = Date.now() + dur + 500;
          setTimeout(restoreAfterGesture, Math.max(clipMs3, dur) + 400);
        } else {
          const procType: 'point' | 'openHand' | 'beat' =
            gType === 'thumbUp' ? 'point' : gType === 'beat' ? 'beat' : gType === 'openHand' ? 'openHand' : 'point';
          gestureRef.current = {
            type: procType,
            side: sideEff,
            startMs: Date.now(),
            durationMs: dur,
          };
          if (useLeftPointProc) {
            setTimeout(restoreAfterGesture, dur + 400);
          }
        }
        console.log(`[BRAIN] Gesture received: ${gType} (${d.side ?? 'right'})`);
      } else if (gType === 'think' || gType === 'peace' || gType === 'agree') {
        if (vrmaReadyRef.current) {
          const keyMap: Record<string, string> = { think: 'think', peace: 'peace', agree: 'agree' };
          const vk = keyMap[gType] ?? 'think';
          const clipMsX = getClipDurMs(vk);
          vrmaClipDoneRef.current = false;
          playVRMA(vk, false, 0.3);
          vrmaGestureUntilRef.current = Date.now() + dur + 500;
          setTimeout(restoreAfterGesture, Math.max(clipMsX, dur) + 400);
        }
        console.log(`[BRAIN] Gesture received (co-speech): ${gType}`);
      } else if (gType === 'relax') {
        if (vrmaReadyRef.current && !isSittingRef.current) {
          const clipMsR = getClipDurMs('relax');
          vrmaClipDoneRef.current = false;
          playVRMA('relax', false, 0.3);
          vrmaGestureUntilRef.current = Date.now() + dur + 500;
          setTimeout(restoreAfterGesture, Math.max(clipMsR, dur) + 400);
        }
        console.log('[BRAIN] Gesture received: relax');
      } else if (gType === 'look') {
        if (vrmaReadyRef.current && !isSittingRef.current) {
          const clipMsL = getClipDurMs('look');
          vrmaClipDoneRef.current = false;
          playVRMA('look', false, 0.3);
          vrmaGestureUntilRef.current = Date.now() + dur + 500;
          setTimeout(restoreAfterGesture, Math.max(clipMsL, dur) + 400);
        } else if (!isSittingRef.current) {
          headYawRef.current = 0.1 * (Math.random() > 0.5 ? 1 : -1);
          headUntilRef.current = Date.now() + Math.min(dur, 2000);
        }
        console.log('[BRAIN] Gesture received: look');
      } else if (gType === 'head_down') {
        headPitchRef.current = 0.14;
        headUntilRef.current = Date.now() + 520;
        console.log('[BRAIN] Gesture received: head_down → pitch');
      } else if (gType === 'tilt') {
        headRollEmotionRef.current = 0.11 * (Math.random() > 0.5 ? 1 : -1);
        headPitchRef.current = -0.03;
        headUntilRef.current = Date.now() + 880;
        console.log('[BRAIN] Gesture received: tilt');
      } else if (gType === 'shoulder_sigh') {
        shoulderShrugUntilRef.current = Date.now() + 600;
        console.log('[BRAIN] Gesture received: shoulder_sigh (procedural)');
      } else if (gType === 'hands_up') {
        handsUpUntilRef.current = Date.now() + 950;
        console.log('[BRAIN] Gesture received: hands_up (procedural)');
      } else if (gType === 'lean_back') {
        headPitchRef.current = -0.09;
        headUntilRef.current = Date.now() + 720;
        console.log('[BRAIN] Gesture received: lean_back → head lean');
      } else if (gType === 'celebration') {
        if (vrmaReadyRef.current && !isSittingRef.current) {
          pulseHandSeparationWindow(HAND_SEPARATION_PULSE_MS);
          const clipMsC = getClipDurMs('cheer');
          vrmaClipDoneRef.current = false;
          playVRMA('cheer', false, 0.3);
          vrmaGestureUntilRef.current = Date.now() + dur + 500;
          setTimeout(restoreAfterGesture, Math.max(clipMsC, dur) + 400);
        }
        console.log('[BRAIN] Gesture received: celebration → cheer');
      } else if (gType === 'idle') {
        if (vrmaReadyRef.current && !isSittingRef.current) {
          idleIdxRef.current = (idleIdxRef.current + 1) % 4;
          playVRMA(`idle${idleIdxRef.current}`, true, 0.55);
          idleNextRef.current = Date.now()
            + IDLE_VRMA_MIN_MS
            + Math.random() * (IDLE_VRMA_MAX_MS - IDLE_VRMA_MIN_MS);
        }
        console.log('[BRAIN] Gesture received: idle (variation)');
      }
    };
    const onMicroGesture = (e: Event) => {
      const d = (e as CustomEvent<{ type?: string; side?: 'left' | 'right' }>).detail;
      const mt = d?.type ?? 'shoulder_sigh';
      const nowM = Date.now();
      if (mt === 'shoulder_sigh' || mt === 'shrug') {
        shoulderShrugUntilRef.current = nowM + 640;
      } else if (mt === 'tilt') {
        headRollEmotionRef.current = 0.11 * (Math.random() > 0.5 ? 1 : -1);
        headPitchRef.current = -0.035;
        headUntilRef.current = nowM + 920;
      } else if (mt === 'head_down') {
        headPitchRef.current = 0.13;
        headUntilRef.current = nowM + 580;
      } else if (mt === 'finger_tap') {
        fingerTapSideRef.current = d?.side ?? (Math.random() > 0.5 ? 'right' : 'left');
        fingerTapUntilRef.current = nowM + 520;
      }
      console.log(`[BRAIN] avatar:micro:gesture → ${mt}`);
    };
    const onSpeechEmphasis = (e: Event) => {
      const kind = (e as CustomEvent<{ kind?: string }>).detail?.kind;
      if (kind === 'eyebrow') {
        microExprTypeRef.current = 'eyebrowRaise';
        microExprUntilRef.current = Date.now() + 720;
      } else if (kind === 'question_tilt') {
        headRollEmotionRef.current = 0.1;
        headPitchRef.current = -0.04;
        headUntilRef.current = Date.now() + 1400;
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
          microExprUntilRef.current = Date.now() + 1000;
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
          relaxed:     { name: 'relax',    loop: true,  dur: 0    }, // AgentDirector sends EmotionLabel.relaxed
          thinking:    { name: 'think',    loop: true,  dur: 0    },
          celebration: { name: 'cheer',    loop: false, dur: 5000 },
          excited:     { name: 'clap',     loop: false, dur: 4000 },
          sleepy:      { name: 'sleepy',   loop: true,  dur: 0    },
          friendly:    { name: 'beckon',   loop: false, dur: 3500 },
        };
        const anim = emotionAnim[em];
        if (anim) {
          playVRMA(anim.name, anim.loop, 0.4);
          if (!anim.loop)
            setTimeout(() => { if (!isSittingRef.current) playVRMA(`idle${idleIdxRef.current}`, true, 0.5); }, anim.dur);
        }
      }
      // Emotion-specific head-pose overrides
      if (em === 'friendly') {
        headPitchRef.current      = 0.05;
        headRollEmotionRef.current = -0.08; // subtle head-tilt left — friendly engagement cue
        headUntilRef.current      = Date.now() + 3000;
      }
      if (em === 'thinking') {
        headPitchRef.current      = -0.08;
        headYawRef.current        = 0.06;
        headRollEmotionRef.current = 0;    // clear any lingering friendly tilt
        headUntilRef.current      = Date.now() + 5000;
      }
    };
    // avatar:transcribing — fired by useAvatarAgent when Whisper is processing.
    // Drives a subtle "thinking" head pose + relaxed blendshape so the avatar
    // looks attentive during the STT latency window instead of standing idle.
    const onTranscribing = (e: Event) => {
      const active = (e as CustomEvent<{ active?: boolean }>).detail?.active ?? false;
      if (active) {
        savedEmotionRef.current   = emotionRef.current;
        emotionRef.current        = 'thinking';
        isTranscribingRef.current = true;
        // Subtle upward head tilt — avatar appears to be "listening carefully"
        headPitchRef.current = -0.06;
        headUntilRef.current = Date.now() + 30_000; // hold until cleared
        console.log('[BRAIN] avatar:transcribing — thinking pose active');
      } else {
        isTranscribingRef.current = false;
        // Restore emotion; neutral reset handled by emotion linger (Sprint 1)
        emotionRef.current   = savedEmotionRef.current === 'thinking'
          ? 'neutral'
          : savedEmotionRef.current;
        headPitchRef.current = 0;
        headUntilRef.current = Date.now() + 800;
        console.log('[BRAIN] avatar:transcribing — thinking pose cleared');
      }
    };

    const onSpeakStart = () => {
      isTalkingRef.current   = true;
      talkElapsedRef.current = 0;
      // Fix 2: Do NOT play sitTalk.vrma — root-motion in sitting VRMA clips sinks the avatar.
      // Manual posing + §8 bone overrides handle the seated speaking look.
      console.log('[BRAIN] avatar:speak:start — lip-sync active (manual pose while seated)');
    };
    const onSpeakEnd   = () => {
      isTalkingRef.current      = false;
      azureVisemeActive.current = false;
      azureVisemeRef.current    = { aa: 0, ih: 0, ou: 0 };
      visemeCueQueueRef.current   = [];
      lipSyncAudioRef.current     = null;
      lastLoggedVisemeRef.current = -1;
      // Don't clobber a gesture that's still running
      const gestureStillLive = Date.now() < vrmaGestureUntilRef.current;
      // Fix 2: Do NOT play sit.vrma after speaking ends — manual pose handles seated look.
      if (isSittingRef.current && vrmaReadyRef.current && !gestureStillLive) {
        playVRMA(`idle${idleIdxRef.current}`, true, 0.4);
      }
      // Gap 3-B: Hold the current emotion for 2.5 s post-speech before fading to
      // neutral. This prevents robotic emotional snapping after the avatar talks.
      const lingeredEmotion = emotionRef.current;
      setTimeout(() => {
        if (emotionRef.current === lingeredEmotion) {
          emotionRef.current = 'neutral';
          console.log(`[BRAIN] Emotion linger ended — fading "${lingeredEmotion}" → neutral`);
        }
      }, 2500);
      console.log(`[BRAIN] avatar:speak:end — holding emotion "${lingeredEmotion}" for 2.5 s`);
    };
    // Gap 2-A: explicit viseme queue clear dispatched by useAvatarAgent when
    // audio.play() is rejected (autoplay policy) before the cue queue can run.
    const onVisemesClear = () => {
      visemeCueQueueRef.current   = [];
      azureVisemeActive.current   = false;
      lastLoggedVisemeRef.current = -1;
      console.log('[LipSync] avatar:visemes:clear — queue flushed');
    };
    // avatar:viseme:start — legacy: real visemes are incoming; switch from procedural
    const onVisemeStart = () => { azureVisemeActive.current = true; };
    // avatar:viseme — legacy: update target weights from real phoneme data
    const onViseme = (e: Event) => {
      const d = (e as CustomEvent<{ id?: number; weights?: { aa: number; ih: number; ou: number } }>).detail;
      if (d?.weights) {
        azureVisemeRef.current = d.weights;
      }
    };
    // avatar:visemes:timeline — NEW: full Azure cue array { t: ms, id: 0-21 }[]
    const onVisemesTimeline = (e: Event) => {
      const d = (e as CustomEvent<{ cues?: Array<{ t: number; id: number }> }>).detail;
      if (d?.cues && d.cues.length > 0) {
        visemeCueQueueRef.current   = d.cues;
        azureVisemeActive.current   = true;
        lastLoggedVisemeRef.current = -1;
        console.log(`[LipSync] Timeline loaded: ${d.cues.length} cues, first=${d.cues[0].t}ms, last=${d.cues[d.cues.length-1].t}ms`);
      }
    };
    // avatar:audio:element — NEW: the HTMLAudioElement being played (for currentTime reads)
    const onAudioElement = (e: Event) => {
      // Cancel any in-flight Web Speech utterance before WAV starts (prevents echo)
      try { if ('speechSynthesis' in window) window.speechSynthesis.cancel(); } catch { /* ignore */ }
      (window as typeof window & { __SERVER_TTS_ACTIVE__?: boolean }).__SERVER_TTS_ACTIVE__ = true;
      const d = (e as CustomEvent<{ audio?: HTMLAudioElement }>).detail;
      if (d?.audio) {
        lipSyncAudioRef.current = d.audio;
        console.log('[LipSync] Audio element bound — timeline sync ready');
      }
    };
    const onWalk  = (e: Event) => {
      if (isSittingRef.current) {
        console.warn('[BRAIN] Walk ignored — sitting (use Stand first)');
        return;
      }
      const d = (e as CustomEvent<{ distance?: number }>).detail;
      const requestedDistance = Number.isFinite(d?.distance)
        ? Number(d?.distance)
        : WALK_DEFAULT_DISTANCE_METERS;
      // Preserve explicit zero/short distances so V121 min-walk guard can suppress spam.
      const forwardDistance = Math.max(0, requestedDistance);
      const angle =
        groupRef.current?.rotation.y ??
        avatarFacingRef.current ??
        avatarFacingBaseRef.current;
      const dx = Math.sin(angle) * forwardDistance;
      const dz = Math.cos(angle) * forwardDistance;
      const margin = 0.3;
      let nextX = currentAvatarXRef.current + dx;
      let nextZ = currentAvatarZRef.current + dz;
      nextX = Math.max(ROOM_BOUNDS.minX + margin, Math.min(ROOM_BOUNDS.maxX - margin, nextX));
      nextZ = Math.max(ROOM_BOUNDS.minZ + margin, Math.min(ROOM_BOUNDS.maxZ - margin, nextZ));
      targetAvatarXRef.current = nextX;
      targetAvatarZRef.current = nextZ;

      const actualDx = targetAvatarXRef.current - currentAvatarXRef.current;
      const actualDz = targetAvatarZRef.current - currentAvatarZRef.current;
      const distance = Math.hypot(actualDx, actualDz);
      
      // V121 PHASE 2 — Min-walk guard: ignore walks below 0.12m (hysteresis: 0.06m to resume)
      const MIN_WALK_DISTANCE = 0.12;
      const STOP_WALK_DISTANCE = 0.06;
      const wasWalkingRef_val = walkUntilRef.current > Date.now();
      if (distance < MIN_WALK_DISTANCE && !wasWalkingRef_val) {
        console.log(
          `[BRAIN] Walk ignored — distance ${distance.toFixed(2)}m < MIN (${MIN_WALK_DISTANCE}m)`,
        );
        return;
      }
      
      const durMs = Math.max(300, (distance / WALK_SPEED_MPS) * 1000);
      walkUntilRef.current = Date.now() + durMs;

      console.log(
        `[BRAIN] Walk → ${durMs.toFixed(0)}ms (${distance.toFixed(2)}m @ ${WALK_SPEED_MPS}m/s) target (${targetAvatarXRef.current.toFixed(2)}, ${targetAvatarZRef.current.toFixed(2)}) angle=${angle.toFixed(2)}`,
      );
    };
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
    // avatar:listening — fired by AvatarAgentClient when VAD mic is active/inactive.
    // Drives the Listening phase: attentive posture, reduced sway, slight forward lean.
    const onListening = (e: Event) => {
      const active = (e as CustomEvent<{ active?: boolean }>).detail?.active ?? false;
      isListeningExtRef.current = active;
      if (active) {
        if (emotionRef.current === 'neutral') emotionRef.current = 'attentive';
        headPitchRef.current = 0.04;        // slight forward attentive lean
        headUntilRef.current = Date.now() + 60_000;
        console.log('[BRAIN] avatar:listening → attentive phase ACTIVE');
      } else {
        if (emotionRef.current === 'attentive') emotionRef.current = 'neutral';
        headPitchRef.current = 0;
        headUntilRef.current = Date.now() + 800; // brief hold then idle takes over
        console.log('[BRAIN] avatar:listening → attentive phase CLEARED');
      }
    };

    const onSit = (e: Event) => {
      const requested = (e as CustomEvent<{ sitting?: boolean }>).detail?.sitting;
      // Only sit when the UI explicitly sends { sitting: true }. Any other payload → stand (fixes stray `avatar:sit` without detail).
      if (requested === true) {
        // V121 PHASE 2 — Posture dedup: skip if already sitting
        if (isSittingRef.current) {
          if (process.env.NODE_ENV === 'development') {
            console.log('[BRAIN] avatar:sit ignored — already sitting');
          }
          return;
        }
        isSittingRef.current = true;
        headPitchRef.current  = -0.05;
        headUntilRef.current  = Date.now() + 60_000;
        spineBreathRef.current = 0.10;
        // Fix 2: Do NOT play sit.vrma — its root-motion hips animation conflicts with
        // manual §8 bone overrides, sinking the avatar below the floor.
        // Idle VRMA continues; §8 clamps legs to seated position each frame.
        console.log('[BRAIN] avatar:sit → manual pose (no sit.vrma)');
        return;
      }
      // V121 PHASE 2 — Posture dedup: skip if already standing
      if (!isSittingRef.current) {
        if (process.env.NODE_ENV === 'development') {
          console.log('[BRAIN] avatar:stand ignored — already standing');
        }
        return;
      }
      isSittingRef.current = false;
      headPitchRef.current = 0;
      spineBreathRef.current = 0;
      // Fix 1 + 5: Reset hips bind position and force matrix update on stand-up.
      const _vrmSit = vrmRef.current;
      if (_vrmSit?.humanoid) {
        const _h = _vrmSit.humanoid.getRawBoneNode('hips' as never);
        if (_h && hipsBindPosRef.current) { _h.position.copy(hipsBindPosRef.current); _h.updateMatrix(); }
      }
      groupRef.current?.updateMatrixWorld(true);
      _vrmSit?.scene?.updateMatrixWorld(true);
      if (vrmaReadyRef.current) playVRMA('idle0', true, 0.8);
      console.log('[BRAIN] avatar:stand — idle0 (standing default)');
    };
    const onStand = () => {
      window.dispatchEvent(new CustomEvent('avatar:sit', { detail: { sitting: false } }));
    };
    // avatar:play — play any clip by key from VRMA_PATHS
    const onPlay = (e: Event) => {
      const clip = (e as CustomEvent<{ clip?: string }>).detail?.clip ?? '';
      if (clip && VRMA_PATHS[clip]) {
        playVRMA(clip, false, 0.4);
        console.log(`[BRAIN] avatar:play → ${clip}`);
      }
    };
    // avatar:speak:text — dev-only Web Speech fallback (no-op in production)
    const onSpeakText = (e: Event) => {
      if (!getMimeMode()) return;   // production always returns false; dev needs health-check failure
      const text = (e as CustomEvent<{ text?: string }>).detail?.text ?? '';
      if (!text) return;
      ensureWebSpeechVoicesChangeHook();
      window.dispatchEvent(new CustomEvent('avatar:speak:start'));
      try {
        const isAr = /[\u0600-\u06FF]/.test(text);
        const u = new SpeechSynthesisUtterance(text);
        u.lang  = isAr ? 'ar-JO' : 'en-US';
        u.rate  = Math.min(1.0, voiceRateRef.current);
        const synth = window.speechSynthesis;
        const v =
          synth &&
          getStableWebSpeechVoice(synth, {
            langHint: u.lang,
            preferMale: isAr,
          });
        const allVoices = synth?.getVoices() ?? [];
        // Guard: if no Arabic voice is available but other voices are loaded,
        // skip speaking to prevent the browser using the wrong language.
        if (!v && allVoices.length > 0 && isAr) {
          setTimeout(() => window.dispatchEvent(new CustomEvent('avatar:speak:end')), 500);
          return;
        }
        if (v) u.voice = v;
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

    window.addEventListener('avatar:transcribing',  onTranscribing);
    window.addEventListener('avatar:listening',     onListening);
    window.addEventListener('avatar:performance',  onPerformance);
    window.addEventListener('avatar:gesture',       onGesture);
    window.addEventListener('avatar:micro:gesture', onMicroGesture);
    window.addEventListener('avatar:emotion',       onEmotion);
    window.addEventListener('avatar:speak:start',   onSpeakStart);
    window.addEventListener('avatar:speak:end',     onSpeakEnd);
    window.addEventListener('avatar:stopSpeaking',  onSpeakEnd);
    window.addEventListener('avatar:viseme:start',      onVisemeStart);
    window.addEventListener('avatar:viseme',            onViseme);
    window.addEventListener('avatar:visemes:timeline',  onVisemesTimeline);
    window.addEventListener('avatar:visemes:clear',     onVisemesClear);
    window.addEventListener('avatar:audio:element',     onAudioElement);
    window.addEventListener('avatar:walk',          onWalk);
    window.addEventListener('avatar:nod',           onNod);
    window.addEventListener('avatar:laugh',         onLaugh);
    window.addEventListener('avatar:voice',         onVoice);
    window.addEventListener('avatar:blink',         onBlink);
    window.addEventListener('avatar:headpose',      onHeadpose);
    window.addEventListener('avatar:sit',           onSit);
    window.addEventListener('avatar:stand',         onStand);
    window.addEventListener('avatar:speak:text',    onSpeakText);
    window.addEventListener('avatar:play',          onPlay);
    window.addEventListener('avatar:speech:emphasis', onSpeechEmphasis);

    return () => {
      window.removeEventListener('avatar:transcribing', onTranscribing);
      window.removeEventListener('avatar:listening',    onListening);
      window.removeEventListener('avatar:performance', onPerformance);
      window.removeEventListener('avatar:gesture',      onGesture);
      window.removeEventListener('avatar:micro:gesture', onMicroGesture);
      window.removeEventListener('avatar:emotion',      onEmotion);
      window.removeEventListener('avatar:speak:start',  onSpeakStart);
      window.removeEventListener('avatar:speak:end',    onSpeakEnd);
      window.removeEventListener('avatar:stopSpeaking', onSpeakEnd);
      window.removeEventListener('avatar:viseme:start',     onVisemeStart);
      window.removeEventListener('avatar:viseme',            onViseme);
      window.removeEventListener('avatar:visemes:timeline',  onVisemesTimeline);
      window.removeEventListener('avatar:visemes:clear',     onVisemesClear);
      window.removeEventListener('avatar:audio:element',     onAudioElement);
      window.removeEventListener('avatar:walk',         onWalk);
      window.removeEventListener('avatar:nod',          onNod);
      window.removeEventListener('avatar:laugh',        onLaugh);
      window.removeEventListener('avatar:voice',        onVoice);
      window.removeEventListener('avatar:blink',        onBlink);
      window.removeEventListener('avatar:headpose',     onHeadpose);
      window.removeEventListener('avatar:sit',          onSit);
      window.removeEventListener('avatar:stand',        onStand);
      window.removeEventListener('avatar:speak:text',   onSpeakText);
      window.removeEventListener('avatar:play',         onPlay);
      window.removeEventListener('avatar:speech:emphasis', onSpeechEmphasis);
    };
  }, []);

  useEffect(() => {
    const onPlayGesture = (e: Event) => {
      const d = (e as CustomEvent<{ intent?: string }>).detail;
      if (!d?.intent) return;
      playCogniAnimation(getRandomAnimationPath(d.intent));
    };
    window.addEventListener('avatar:play-gesture', onPlayGesture);
    return () => window.removeEventListener('avatar:play-gesture', onPlayGesture);
  }, [playCogniAnimation]);

  // Click listener — maps screen click to world (X, Z) floor position
  useEffect(() => {
    const raycaster = new THREE.Raycaster();
    const floorPlane = new THREE.Plane();
    floorPlane.setFromNormalAndCoplanarPoint(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, ROOM_BOUNDS.floorY, 0),
    );
    const handleClick = (e: MouseEvent) => {
      if (e.button !== 2) return; // right click only
      e.preventDefault();
      const rect = gl.domElement.getBoundingClientRect();
      const ndcX = ((e.clientX - rect.left) / rect.width)  * 2 - 1;
      const ndcY = -((e.clientY - rect.top)  / rect.height) * 2 + 1;
      raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
      const hit = new THREE.Vector3();
      if (!raycaster.ray.intersectPlane(floorPlane, hit)) return;
      // Fix 4: Clamp click target inside room bounds (0.5 m margin matches collision resolver).
      targetAvatarXRef.current = Math.max(ROOM_BOUNDS.minX + 0.5, Math.min(ROOM_BOUNDS.maxX - 0.5, hit.x));
      targetAvatarZRef.current = Math.max(ROOM_BOUNDS.minZ + 0.5, Math.min(ROOM_BOUNDS.maxZ - 0.5, hit.z));
      // MOUSE-TRACK MODE: walk trigger disabled — avatar stays in place and tracks mouse
      // const dist = Math.hypot(
      //   hit.x - currentAvatarXRef.current,
      //   hit.z - currentAvatarZRef.current,
      // );
      // const walkSec = Math.max(0.5, dist * 1.6);
      // walkUntilRef.current = Date.now() + walkSec * 1000;
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

  useEffect(() => {
    let cancelled = false;
    void initRapierWorld().then((w) => {
      if (!cancelled) physicsWorldRef.current = w;
    });
    return () => {
      cancelled = true;
      physicsWorldRef.current = null;
    };
  }, []);

  // V56 FeetFixer — init when VRM is ready (?fixFeet=1); does not interact with GroundLock.
  useEffect(() => {
    if (!fixFeet || !vrm) {
      feetFixerRef.current = null;
      if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
        delete (window as Window & { __feetFix?: unknown }).__feetFix;
      }
      return;
    }
    feetFixerRef.current = new FeetFixer(vrm);
    feetFixerRef.current.captureBaseline();
    if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
      const w = window as Window & {
        __feetFix?: { dump: () => ReturnType<FeetFixer['dumpDiagnostics']> };
      };
      w.__feetFix = {
        dump: () => feetFixerRef.current?.dumpDiagnostics() ?? { has: false },
      };
    }
    return () => {
      feetFixerRef.current = null;
      if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
        delete (window as Window & { __feetFix?: unknown }).__feetFix;
      }
    };
  }, [vrm, fixFeet]);

  // V56 dev — tiny spheres on foot bones when ?fixFeet=1 (confirms bone space; not in prod)
  useEffect(() => {
    if (!fixFeet || process.env.NODE_ENV !== 'development' || !vrm?.humanoid) return;
    const h = vrm.humanoid as unknown as {
      getNormalizedBoneNode?: (n: string) => THREE.Object3D | null;
      getRawBoneNode?: (n: string) => THREE.Object3D | null;
    };
    const lf = h.getNormalizedBoneNode?.('leftFoot') ?? h.getRawBoneNode?.('leftFoot');
    const rf = h.getNormalizedBoneNode?.('rightFoot') ?? h.getRawBoneNode?.('rightFoot');
    const meshes: THREE.Mesh[] = [];
    const add = (bone: THREE.Object3D | null | undefined, hex: number) => {
      if (!bone) return;
      const g = new THREE.SphereGeometry(0.028, 10, 10);
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: hex, depthTest: true }));
      m.name = 'FeetFixV56DebugMarker';
      bone.add(m);
      meshes.push(m);
    };
    add(lf, 0xff00ff);
    add(rf, 0x00ffff);
    return () => {
      meshes.forEach((m) => {
        m.parent?.remove(m);
        m.geometry.dispose();
        const mat = m.material as THREE.MeshBasicMaterial;
        mat.dispose();
      });
    };
  }, [vrm, fixFeet]);

  useFrame((state, delta) => {
    // LAYER ORDER: 1) VRMA + VRM internals (`v.update`), 2) Spine breathing (§1-A), 3) Neck/head (§6–§7), 4) §8 final bone overrides (arms/hands/legs).
    const v     = vrmRef.current;
    const group = groupRef.current;
    if (!group) return;

    v54DebugCamRef.current = state.camera as THREE.PerspectiveCamera;
    const ctrDbg = state.controls as { target?: THREE.Vector3 } | undefined;
    v54DebugOrbitTargetRef.current = ctrDbg?.target ?? null;

    const safeDelta = Math.min(Math.max(delta, 0), TAB_SAFE_MAX_DELTA);

    const t   = state.clock.elapsedTime;
    const now = Date.now();

    // ── Behavioral phase — drives all physical layer modulations ─────────────
    // Derived each frame so it is always coherent with current system state.
    // Priority: speaking > thinking > listening > idle
    const phase: 'idle' | 'listening' | 'thinking' | 'speaking' =
      isTalkingRef.current       ? 'speaking'  :
      isTranscribingRef.current  ? 'thinking'  :
      isListeningExtRef.current  ? 'listening' : 'idle';
    avatarPhaseRef.current = phase;
    if (isTalkingRef.current || isTranscribingRef.current) {
      idleMicroGestureNextRef.current = Math.max(idleMicroGestureNextRef.current, now + 5000);
    }

    // ── Auto micro-nod: fires every 3-7 s during active conversation ──────────
    // Triggers when avatar is speaking (isTalkingRef) OR user is speaking (isTranscribing).
    // Uses the existing nod system (nodUntilRef / nodStartRef) — no new bones needed.
    if ((isTalkingRef.current || isTranscribingRef.current)
        && now > autoNodNextRef.current
        && now >= nodUntilRef.current) {
      nodStartRef.current    = now;
      nodDurationRef.current = 500 + Math.random() * 400;  // 500-900 ms micro-nod
      nodUntilRef.current    = now + nodDurationRef.current;
      autoNodNextRef.current = now + 3000 + Math.random() * 4000; // reschedule 3-7 s
    }
    // Reset scheduler when silent (prevents instant nod on next turn start)
    if (!isTalkingRef.current && !isTranscribingRef.current && now > autoNodNextRef.current + 8000) {
      autoNodNextRef.current = now + 4000;
    }
    // Rare idle head movement — subtle alive-feeling micro-nod when completely still
    if (!isTalkingRef.current && !isTranscribingRef.current && !isSittingRef.current
        && now >= walkUntilRef.current
        && now > idleNodNextRef.current && now >= nodUntilRef.current) {
      nodStartRef.current    = now;
      nodDurationRef.current = 300 + Math.random() * 200; // 300-500 ms subtle bob
      nodUntilRef.current    = now + nodDurationRef.current;
      idleNodNextRef.current = now + 22000 + Math.random() * 23000; // next 22-45 s
    }

    const isWalkingNow  = now < walkUntilRef.current;
    const isLaughingNow = now < laughUntilRef.current;
    const walkBounce = isWalkingNow  ? Math.abs(Math.sin(t * 5.5)) * 0.055 : 0;
    const laughShake = isLaughingNow ? Math.sin(t * 14) * 0.02 : 0;

    const isSittingNow = readAvatarDebugForceStandEnv() ? false : isSittingRef.current;
    const isSittingEffective = isSittingNow;

    // V30 — procedural life continues during VRMA gestures (reduced amplitude)
    const vrmaGPlaying =
      vrmaReadyRef.current
      && !isWalkingNow
      && now < vrmaGestureUntilRef.current
      && !vrmaClipDoneRef.current;
    const procLifeDamp = vrmaGPlaying ? PROC_LIFE_DURING_VRMA_GESTURE : 1;
    /** Spine / chest / neck / head / arms only — not face (`expressionManager`). */
    const skelMul = vrmaGestureNowRef.current ? 0 : procLifeDampRef.current * procLifeDamp;

    // 1. Idle body sway (group-level micro-rock)
    const idleBodyTarget = _noise3D(t * 0.1, 0, 0) * 0.020 * procLifeDamp;
    idleBodyOffsetRef.current = lerp(idleBodyOffsetRef.current, idleBodyTarget, 0.08);

    // V20 — pelvic roll driver only (no horizontal root translation — avoids foot slide)
    lifeHipTiltZRef.current = lerp(
      lifeHipTiltZRef.current,
      (Math.sin(t * 0.6 + 1) * 0.012 + Math.sin(t * 0.42) * 0.008) * (isSittingNow ? 0.55 : 1) * skelMul,
      safeDelta * 3,
    );
    if (now >= lifeHeadTiltFlipNextRef.current) {
      lifeLongHeadTiltRef.current = (Math.random() > 0.5 ? 1 : -1) * LONG_HEAD_TILT_RAD;
      lifeHeadTiltFlipNextRef.current = now + 48_000 + Math.random() * 24_000;
    }
    if (now >= lifeShoulderDropNextRef.current) {
      lifeShoulderDropSideRef.current = lifeShoulderDropSideRef.current === 'left' ? 'right' : 'left';
      lifeShoulderDropNextRef.current = now + 22_000 + Math.random() * 16_000;
    }
    // Subconscious eye micro-saccades (world-space look target jitter) — 2–5 s cadence, smooth lerp in §1-B
    if (now >= eyeMicroNextRef.current && now >= eyeMicroBurstUntilRef.current) {
      eyeMicroBurstUntilRef.current = now + 80 + Math.random() * 120;
      eyeMicroNextRef.current = now + 2000 + Math.random() * 3000;
      eyeMicroOffsetRef.current.set(
        (Math.random() - 0.5) * 0.065,
        (Math.random() - 0.5) * 0.050,
        (Math.random() - 0.5) * 0.032,
      );
    }

    // Phase 2 — Y axis: standing uses Leva `yOffset`; sitting uses floor + seat height
    const sitWorldExtra =
      readAvatarSitWorldYOffsetEnv() + (vrmMetaIsV1Ref.current ? SIT_WORLD_Y_TRIM_VRM1 : 0);
    const standTargetY = isSittingNow ? sitYWorld + sitWorldExtra : ROOM_BOUNDS.floorY + yOffset;
    const yMicro = walkBounce + laughShake + idleBodyOffsetRef.current;
    const breathBounceY = breathGroupBounce(t, isSittingNow) * procLifeDamp;

    // V52 — one-shot foot–floor alignment (world AABB vs room floor), then persistent additive Y
    if (v && !footCalibDoneRef.current) {
      const preFootY = standTargetY + yMicro + breathBounceY;
      if (!isSittingNow) {
        group.position.x = currentAvatarXRef.current;
        group.position.z = currentAvatarZRef.current;
        group.position.y = preFootY;
      } else {

        // V122 — keep standing Y locked above floor baseline to avoid sub-floor sinking.
        // This is a one-way guard (downward only) and preserves normal idle/walk/breath motion.
        const standingFloorGuardY = ROOM_BOUNDS.floorY + yOffset + footY - 0.01;
        if (group.position.y < standingFloorGuardY) {
          const prevY = group.position.y;
          group.position.y = standingFloorGuardY;
          if (process.env.NODE_ENV === 'development') {
            const n = Date.now();
            if (n - lastStandClampLogAtRef.current > 1200) {
              lastStandClampLogAtRef.current = n;
              console.warn('[V122] standing Y guard clamp', {
                from: +prevY.toFixed(4),
                to: +group.position.y.toFixed(4),
                floorY: +ROOM_BOUNDS.floorY.toFixed(4),
                footY: +footY.toFixed(4),
              });
            }
          }
        }
        group.position.set(permaChairXRef.current, preFootY, permaChairZRef.current);
      }
      group.updateMatrixWorld(true);
      v.scene.updateMatrixWorld(true);
      const footBox = new THREE.Box3().setFromObject(v.scene);
      footToFloorYOffsetRef.current =
        ROOM_BOUNDS.floorY - footBox.min.y + readAvatarStandYOffsetEnv();
      footCalibDoneRef.current = true;
      if (process.env.NODE_ENV === 'development' && !groundLockedRef?.current) {
        console.log('%c[V52] foot–floor calibration (once)', 'color:#38bdf8', {
          meshMinY: footBox.min.y.toFixed(4),
          floorY: ROOM_BOUNDS.floorY.toFixed(4),
          addY: footToFloorYOffsetRef.current.toFixed(4),
        });
      }
    }

    const footY = footToFloorYOffsetRef.current;

    if (!isSittingNow) {
      if (isWalkingNow) {
        // V40 — constant-speed move toward target (matches onWalk duration = path / WALK_SPEED_MPS)
        const toX = targetAvatarXRef.current - currentAvatarXRef.current;
        const toZ = targetAvatarZRef.current - currentAvatarZRef.current;
        const dist = Math.hypot(toX, toZ);
        const maxStep = WALK_SPEED_MPS * safeDelta;
        if (dist <= maxStep) {
          currentAvatarXRef.current = targetAvatarXRef.current;
          currentAvatarZRef.current = targetAvatarZRef.current;
        } else if (dist > 1e-8) {
          const s = maxStep / dist;
          currentAvatarXRef.current += toX * s;
          currentAvatarZRef.current += toZ * s;
        }
      } else {
        const posLerp = safeDelta * 2.5;
        currentAvatarXRef.current = lerp(currentAvatarXRef.current, targetAvatarXRef.current, posLerp);
        currentAvatarZRef.current = lerp(currentAvatarZRef.current, targetAvatarZRef.current, posLerp);
      }
      group.position.x = currentAvatarXRef.current;
      group.position.z = currentAvatarZRef.current;
      group.position.y = standTargetY + footY + yMicro + breathBounceY;
    } else {
      group.position.set(
        permaChairXRef.current,
        standTargetY + footY + yMicro + breathBounceY,
        permaChairZRef.current,
      );
    }

    const pw = physicsWorldRef.current;
    if (pw && v) {
      resolveIfEnabled(pw, v, undefined, group, safeDelta);
    } else if (!isSittingNow) {
      resolveIfEnabled(group.position, PHYSICS_CONFIG.avatar.capsuleRadius);
    }

    // ── Avatar facing rotation — body turns to face direction of travel ─────
    // Base yaw from avatarFacingBaseRef (VRM 0.x ≈ π, VRM 1.0 ≈ 0; override via NEXT_PUBLIC_AVATAR_FACING_YAW_BASE).
    // lerpAngle handles ±π wrap so there is no 360° spin on direction changes.
    {
      const baseYaw = avatarFacingBaseRef.current;
      const dx = targetAvatarXRef.current - currentAvatarXRef.current;
      const dz = targetAvatarZRef.current - currentAvatarZRef.current;
      const moveDist = Math.hypot(dx, dz);
      const mouseBodyTarget = baseYaw + pointer.x * 0.35; // ±20° yaw at screen edge
      const targetFacing = (isWalkingNow && moveDist > 0.05 && phase !== 'speaking')
        ? baseYaw + Math.atan2(dx, dz)  // walk → face travel direction
        : phase === 'speaking' ? baseYaw // speaking → direct camera
        : mouseBodyTarget;               // idle/listening → follow mouse
      const facingLerpSpeed = phase === 'speaking'
        ? safeDelta * 9.0
        : isWalkingNow ? safeDelta * 3.0 : safeDelta * 3.0;
      avatarFacingRef.current = lerpAngle(
        avatarFacingRef.current,
        // Perma-sit: keep avatar facing camera while seated.
        isSittingNow ? 0 : targetFacing,
        facingLerpSpeed,
      );
      group.rotation.y = avatarFacingRef.current;
    }

    // ── Auto-patrol: off by default (enable via Leva "Auto patrol")
    if (autoPatrolRef.current && !isSittingNow && !isTalkingRef.current) {
      const wp = patrolWpRef.current[patrolIdxRef.current];
      const distToWp = Math.hypot(
        wp[0] - currentAvatarXRef.current,
        wp[1] - currentAvatarZRef.current,
      );
      if (distToWp > 0.2) {
        targetAvatarXRef.current = wp[0];
        targetAvatarZRef.current = wp[1];
        walkUntilRef.current     = now + (distToWp / WALK_SPEED_MPS) * 1000;
      } else {
        // Arrived — let existing walk expire, then pause → next waypoint
        if (now >= walkUntilRef.current && now > patrolWaitUntilRef.current) {
          patrolWaitUntilRef.current = now + 2000 + Math.random() * 2000;
          patrolIdxRef.current = (patrolIdxRef.current + 1) % patrolWpRef.current.length;
        }
      }
    }

    // V54 — قبل اكتمال تحميل الـ VRM: حافظ على توجيه الكاميرا نحو مجموعة الأفاتار (تقريب صدر)
    if (!v) {
      group.updateMatrixWorld(true);
      group.getWorldPosition(_v53WorldPos);
      v54OrbitLookAtWorld.copy(_v53WorldPos);
      v54OrbitLookAtWorld.y += 1.55;
      clampOrbitLookAtToRoomXZ(v54OrbitLookAtWorld);
      const ocPre = state.controls as { target?: THREE.Vector3; update?: () => void } | undefined;
      if (ocPre?.target && typeof ocPre.update === 'function') {
        ocPre.target.lerp(v54OrbitLookAtWorld, 0.18);
        ocPre.update();
      }
      return;
    }

    // ── VRMA mixer update — pace ↔ idle switching ─────────────────────────
    if (mixerRef.current) {
      // Switch to Walking.vrma when patrol is active
      if (vrmaReadyRef.current && isWalkingNow && activeVrmaRef.current !== 'walk') {
        playVRMA('walk', true, 0.3);
      }
      mixerRef.current.update(safeDelta);
    }
    // V56 FeetFixer — after VRMA: baseline-relative delta clamp (inv(base)*qRelNow → Euler clip → blend)
    if (fixFeet && feetFixerRef.current) {
      feetFixerRef.current.apply({
        enabled: true,
        maxPitchDeg: 35,
        maxYawDeg: 12,
        maxRollDeg: 12,
        blend: 0.75,
      });
    }
    // Walk ended → play stop-walk once, then return to idle after it finishes
    if (wasWalkingRef.current && !isWalkingNow && vrmaReadyRef.current && !isSittingRef.current) {
      playVRMA('stopWalk', false, 0.25);
      stopWalkUntilRef.current = now + 1200;  // ~1.2 s for stop-walk clip
    }
    // After stop-walk finishes → blend to idle
    if (!isWalkingNow && stopWalkUntilRef.current > 0 && now >= stopWalkUntilRef.current
        && activeVrmaRef.current === 'stopWalk' && !isSittingRef.current) {
      stopWalkUntilRef.current = 0;
      playVRMA(`idle${idleIdxRef.current}`, true, 0.5);
    }
    wasWalkingRef.current = isWalkingNow;

    // VRMA walk clip owns full-body locomotion — skip procedural spine/leg overrides that fight it
    const isVRMAWalking = vrmaReadyRef.current && isWalkingNow && activeVrmaRef.current === 'walk';

    // Idle cycling — rotate idle0–idle3 every 10–15 s when standing still (V30)
    if (!isWalkingNow && !isSittingRef.current && vrmaReadyRef.current
        && !isTalkingRef.current && !isTranscribingRef.current
        && now >= idleNextRef.current && activeVrmaRef.current !== 'stopWalk'
        && activeVrmaRef.current !== '__cogni__') {
      idleIdxRef.current  = (idleIdxRef.current + 1) % 4;
      idleNextRef.current = now
        + IDLE_VRMA_MIN_MS
        + Math.random() * (IDLE_VRMA_MAX_MS - IDLE_VRMA_MIN_MS);
      playVRMA(`idle${idleIdxRef.current}`, true, 0.8);
    }

    // Seated idle — same 10–15 s cadence; alternate sit ↔ sitTalk
    if (!isWalkingNow && isSittingRef.current && vrmaReadyRef.current
        && now >= idleNextRef.current && !isTalkingRef.current && !isTranscribingRef.current
        && activeVrmaRef.current !== 'stopWalk'
        && activeVrmaRef.current !== '__cogni__') {
      idleNextRef.current = now
        + IDLE_VRMA_MIN_MS
        + Math.random() * (IDLE_VRMA_MAX_MS - IDLE_VRMA_MIN_MS);
      playVRMA(Math.random() < 0.55 ? 'sit' : 'sitTalk', true, 0.42);
    }

    // V30 — autonomous micro-gestures during calm idle (seated or standing)
    if (
      vrmaReadyRef.current
      && idleMicroGestureNextRef.current > 0
      && now >= idleMicroGestureNextRef.current
      && !isWalkingNow
      && !isTalkingRef.current
      && !isTranscribingRef.current
      && !isLaughingNow
    ) {
      const procBusy =
        gestureRef.current != null && now < gestureRef.current.startMs + gestureRef.current.durationMs;
      const vrmaBusy =
        vrmaGPlaying
        || (vrmaReadyRef.current && !isWalkingNow && vrmaGestureNowRef.current);
      if (!procBusy && !vrmaBusy) {
        const roll = Math.random();
        if (roll < 0.28) {
          shoulderShrugUntilRef.current = now + 620;
        } else if (roll < 0.55) {
          headRollEmotionRef.current = 0.09 * (Math.random() > 0.5 ? 1 : -1);
          headPitchRef.current = -0.03;
          headUntilRef.current = now + 880;
        } else if (roll < 0.78) {
          headPitchRef.current = 0.11;
          headUntilRef.current = now + 560;
        } else {
          fingerTapSideRef.current = Math.random() > 0.5 ? 'right' : 'left';
          fingerTapUntilRef.current = now + 480;
        }
        idleMicroGestureNextRef.current = now
          + IDLE_MICRO_GESTURE_COOLDOWN_MIN_MS
          + Math.random() * (IDLE_MICRO_GESTURE_COOLDOWN_MAX_MS - IDLE_MICRO_GESTURE_COOLDOWN_MIN_MS);
      } else {
        idleMicroGestureNextRef.current = now + 1200;
      }
    }

    // 2. Blink — smooth phase, asymmetric left/right, noise-driven irregular intervals
    const em = v.expressionManager;
    if (em) {
      if (blinkPhaseRef.current > 0) {
        blinkPhaseRef.current += safeDelta * 12;
        // Right eye: primary phase | Left eye: slightly lagged by blinkAsymRef (asymmetric)
        const phaseR = blinkPhaseRef.current;
        const phaseL = Math.max(0, blinkPhaseRef.current - blinkAsymRef.current);
        const bvR = phaseR < Math.PI ? Math.sin(phaseR) : 0;
        const bvL = phaseL < Math.PI ? Math.sin(phaseL) : 0;
        // Try unified 'blink' key first; fall back to separate blinkLeft/blinkRight
        try {
          em.setValue('blink' as never, Math.min(1, (bvR + bvL) * 0.5));
        } catch {
          try {
            em.setValue('blinkRight' as never, Math.min(1, bvR));
            em.setValue('blinkLeft'  as never, Math.min(1, bvL));
          } catch {}
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
            // Noise-driven organic interval: simplex noise gives non-uniform, biologically
            // realistic variation (1.8 – 5.2 s) instead of pure uniform random.
            const noiseVal = (_noise3D(t * 0.0009, 77, 0) + 1) * 0.5; // [0, 1]
            nextBlinkRef.current = now + (BLINK_MIN_SEC + noiseVal * (BLINK_MAX_SEC - BLINK_MIN_SEC)) * 1000;
            // Randomise left/right asymmetry for next blink (0 – 150 ms phase lag)
            blinkAsymRef.current = Math.random() * 0.18;
          }
        }
      } else if (now >= nextBlinkRef.current) {
        blinkPhaseRef.current = 0.001;
        // ~20 % double-blink sequences (second closure scheduled when first cycle ends)
        blinkCountRef.current = Math.random() < 0.2 ? 2 : 1;
        blinkAsymRef.current = Math.random() * 0.18;
      }

      // 3. Lip-sync: real visemes (Phase 2) or procedural fallback
      if (isTalkingRef.current) {
        talkElapsedRef.current += safeDelta;
        const lw = lipWeightsRef.current;
        const audioEl = lipSyncAudioRef.current;
        const cues    = visemeCueQueueRef.current;
        if (azureVisemeActive.current && audioEl && cues.length > 0) {
          // ── Frame-perfect Azure temporal timeline lip sync ─────────────────
          const nowMs = audioEl.currentTime * 1000;
          // Binary search: find last cue where cue.t <= nowMs
          let lo = 0, hi = cues.length - 1, idx = 0;
          while (lo <= hi) {
            const mid = (lo + hi) >>> 1;
            if (cues[mid].t <= nowMs) { idx = mid; lo = mid + 1; }
            else hi = mid - 1;
          }
          const visemeId = cues[idx]?.id ?? 0;
          const target   = AZURE_VISEME_TO_VRM[Math.min(visemeId, 21)] ?? {};
          // Throttled debug log — fires only when the active viseme ID changes
          if (visemeId !== lastLoggedVisemeRef.current) {
            const shapeName = Object.keys(target).join('/') || 'silence';
            console.log(`[LipSync] ${nowMs.toFixed(0)}ms → ID:${visemeId} → ${shapeName}`);
            lastLoggedVisemeRef.current = visemeId;
          }
          const spd = safeDelta * 18; // fast blend — tracks sharp phoneme transitions
          lw.aa = lerp(lw.aa, target.aa ?? 0, spd);
          lw.ih = lerp(lw.ih, target.ih ?? 0, spd);
          lw.ou = lerp(lw.ou, target.ou ?? 0, spd);
          lw.ee = lerp(lw.ee, target.ee ?? 0, spd);
          lw.oh = lerp(lw.oh, target.oh ?? 0, spd);
          setEM(em, 'aa', lw.aa);
          setEM(em, 'ih', lw.ih);
          setEM(em, 'ou', lw.ou);
          setEM(em, 'ee', lw.ee);
          setEM(em, 'oh', lw.oh);
        } else {
          // ── Procedural fallback: sine-wave when no Azure timeline available ──
          const fastJaw = 0.5 * Math.sin(talkElapsedRef.current * 9.1);
          const slowJaw = 0.2 * Math.sin(talkElapsedRef.current * 3.7);
          const jaw = Math.max(0, Math.min(1, 0.35 + fastJaw + slowJaw));
          lw.aa = jaw; lw.ih = 0; lw.ou = 0; lw.ee = 0; lw.oh = 0;
          setEM(em, 'aa', jaw);
          const oh = Math.max(0, Math.min(0.4, 0.15 * Math.sin(talkElapsedRef.current * 5.3 + 1)));
          setEM(em, 'oh', oh);
        }
      } else {
        // Mouth closed: smoothly decay all 5 lip shapes to zero
        const lw = lipWeightsRef.current;
        const spd = safeDelta * 10;
        lw.aa = lerp(lw.aa, 0, spd);
        lw.ih = lerp(lw.ih, 0, spd);
        lw.ou = lerp(lw.ou, 0, spd);
        lw.ee = lerp(lw.ee, 0, spd);
        lw.oh = lerp(lw.oh, 0, spd);
        setEM(em, 'aa', lw.aa);
        setEM(em, 'ih', lw.ih);
        setEM(em, 'ou', lw.ou);
        setEM(em, 'ee', lw.ee);
        setEM(em, 'oh', lw.oh);
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
        const next    = lerp(current, target, safeDelta * blendSpeed);
        emotionBlendRef.current[key] = next;
        setEM(em, key, next);
      });

      // Micro-expressions overlay (V20 — brief 0.2–0.5 s, low intensity)
      if (now < microExprUntilRef.current) {
        const mTotal = microExprUntilRef.current - microExprStartAtRef.current;
        const mProgress = mTotal > 0 ? (now - microExprStartAtRef.current) / mTotal : 0;
        const mPeak = microExprPeakRef.current;
        const mIntensity = Math.sin(Math.min(1, mProgress) * Math.PI) * mPeak;
        const mType = microExprTypeRef.current;
        if (mType === 'eyebrowRaise') {
          setEM(em, 'lookUp',    mIntensity * 0.3);
          setEM(em, 'surprised', (emotionBlendRef.current['surprised'] ?? 0) + mIntensity * 0.3);
        } else if (mType === 'squint') {
          setEM(em, 'angry', (emotionBlendRef.current['angry'] ?? 0) + mIntensity * 0.15);
        } else if (mType === 'halfSmile') {
          setEM(em, 'happy', (emotionBlendRef.current['happy'] ?? 0) + mIntensity * 0.2);
        } else if (mType === 'cheekPuff') {
          setEM(em, 'relaxed', (emotionBlendRef.current['relaxed'] ?? 0) + mIntensity * 0.18);
        } else if (mType === 'eyeWide') {
          setEM(em, 'surprised', (emotionBlendRef.current['surprised'] ?? 0) + mIntensity * 0.2);
        } else if (mType === 'browFurrow') {
          setEM(em, 'angry', (emotionBlendRef.current['angry'] ?? 0) + mIntensity * 0.22);
        } else if (mType === 'lipPress') {
          setEM(em, 'relaxed', (emotionBlendRef.current['relaxed'] ?? 0) + mIntensity * 0.12);
        } else if (mType === 'noseWrinkle') {
          setEM(em, 'angry', (emotionBlendRef.current['angry'] ?? 0) + mIntensity * 0.1);
        } else if (mType === 'eyeSquint') {
          setEM(em, 'relaxed', (emotionBlendRef.current['relaxed'] ?? 0) + mIntensity * 0.08);
        }
      } else if (microExprTypeRef.current !== 'none') {
        microExprTypeRef.current = 'none';
        setEM(em, 'lookUp', 0);
      }

      // Auto-scheduled micro-expressions — speaking ~6–12 s; idle 6–12 s (V29)
      if (now > autoMicroExprNextRef.current && microExprTypeRef.current === 'none' && now >= microExprUntilRef.current) {
        const types = [
          'eyebrowRaise', 'halfSmile', 'halfSmile', 'squint', 'cheekPuff', 'eyeWide',
          'browFurrow', 'lipPress', 'noseWrinkle', 'eyeSquint',
        ] as const;
        microExprTypeRef.current  = types[Math.floor(Math.random() * types.length)];
        microExprPeakRef.current  = 0.1 + Math.random() * 0.15;
        microExprStartAtRef.current = now;
        microExprUntilRef.current = now + 200 + Math.random() * 300; // 0.2–0.5 s
        const speakingBoost = isTalkingRef.current;
        autoMicroExprNextRef.current = speakingBoost
          ? now + 6000 + Math.random() * 6000
          : now + MICRO_EXPR_MIN_MS + Math.random() * (MICRO_EXPR_MAX_MS - MICRO_EXPR_MIN_MS);
      }

      // ── Transcribing overlay — additive "attentive listening" blendshapes ──
      // Applied on top of the emotion system while Whisper is transcribing.
      // Uses smooth lerp so there's no abrupt pop when the state changes.
      if (isTranscribingRef.current) {
        // Relaxed + slight upward gaze = "I'm processing what you said"
        setEM(em, 'relaxed', lerp(0, 0.45, Math.min(1, safeDelta * 6)));
        setEM(em, 'lookUp',  lerp(0, 0.18, Math.min(1, safeDelta * 6)));
      }
      // Decay when no longer transcribing (handled implicitly by emotion lerp)

      em.update();
    }

    // §2 Upper-body coupling only — noise drives subtle head roll (hips weight = §8 Z-rotation)
    if (v.humanoid && !isVRMAWalking) {
      const sitMul    = isSittingRef.current ? 0.26 : 1.0;
      const hipScale  = (phase === 'listening' || phase === 'thinking') ? 0.35 : 1.0;
      const hipTarget = _noise3D(t * 0.25, 5, 0) * 0.024 * hipScale * sitMul * skelMul;
      hipShiftRef.current = lerp(hipShiftRef.current, hipTarget, safeDelta * 2.0);
      const headRollTarget  = -hipShiftRef.current * 3.5;
      headRollRef.current   = lerp(headRollRef.current, headRollTarget, safeDelta * 2.5);
    }

    // §1-B Saccadic gaze state machine ────────────────────────────────────
    // Architecture:
    //   Eyes  → VRM lookAt (drives eye-bone rotations, limited ±30°)
    //   Neck  → bone additive override (absorbs 30% of gaze angle)
    //   Head  → existing headBone lerp (absorbs 20% via slow speed)
    //
    // FSM: fixate → wait → schedule saccade → saccade (20-80ms snap) → fixate
    {
      // 1. Compute "desire" gaze — toward the camera (viewer) blended with
      // the NDC mouse/pointer position so Cogni tracks the cursor naturally.
      // R3F pointer.{x,y} is already in [-1..1] NDC coords, updated every frame.
      // Scale to subtle world offsets from the camera position:
      //   ±0.9 m lateral  (X) — wide enough to feel responsive
      //   ±0.45 m vertical (Y) — narrower to keep face in view
      // Also add slow Perlin face-region variance (±5 cm) to simulate natural
      // eye contact: drifting between left eye → nose → right eye.
      const faceVarianceX = _noise3D(t * 0.14, 20, 0) * 0.050;
      const faceVarianceY = _noise3D(t * 0.11, 21, 0) * 0.030;
      // Phase-aware pointer scale:
      // speaking → near-zero (direct camera eye contact while talking)
      // listening → subtle  (light cursor following, feels attentive)
      // idle/thinking → moderate (natural gaze wander, not locked)
      // Capped ≤0.3 to reduce pointer-driven neck jitter / circular motion
      const gazePointerScale = phase === 'speaking' ? 0.05
                             : phase === 'listening' ? 0.22
                             : 0.28;
      const pointerOffsetX = pointer.x * gazePointerScale;
      const pointerOffsetY = pointer.y * (gazePointerScale * 0.5);
      // Random look-away breaks: briefly glance off to the side every 10-25 s
      if (phase !== 'speaking' && now > gazeBreakNextRef.current) {
        gazeBreakUntilRef.current = now + 800 + Math.random() * 1200; // 0.8-2 s look-away
        gazeBreakOffsetRef.current.set(
          (Math.random() * 2 - 1) * 1.6,  // ±1.6 m horizontal
          (Math.random() * 2 - 1) * 0.7,  // ±0.7 m vertical
          0,
        );
        gazeBreakNextRef.current = now + 10000 + Math.random() * 15000; // reschedule 10-25 s
      }
      const lookAwayBlend = now < gazeBreakUntilRef.current ? 1 : 0;
      _desireWorld.set(
        pointerOffsetX + faceVarianceX + gazeBreakOffsetRef.current.x * lookAwayBlend,
        pointerOffsetY + faceVarianceY + gazeBreakOffsetRef.current.y * lookAwayBlend,
        0,
      );
      const desireWorld = _desireWorld.add(camera.position);

      // 2. State-machine tick
      if (gazeStateRef.current === 'fixate') {
        // Microsaccade drift — tiny random walk around fixation point
        const driftAmp = 0.003;
        gazeDriftRef.current.x = lerp(gazeDriftRef.current.x, _noise3D(t * 3.1, 10, 0) * driftAmp * 0.5, safeDelta * 4);
        gazeDriftRef.current.y = lerp(gazeDriftRef.current.y, _noise3D(t * 2.8, 11, 0) * driftAmp * 0.5, safeDelta * 4);

        if (now > gazeFixateUntilRef.current) {
          // Schedule next saccade: jump toward the current desire direction
          // but only 60-90% of the way (undershoot is biologically correct)
          const undershoot = 0.6 + Math.random() * 0.3;
          gazeTargetRef.current.lerpVectors(gazeCurrRef.current, desireWorld, undershoot);
          gazeStateRef.current      = 'saccade';
          gazeSaccadeUntilRef.current = now + 20 + Math.random() * 60; // 20–80 ms saccade
        }
      } else {
        // saccade: fast snap — cap t so a single frame never fully jumps (tab-return safety)
        const saccadeSpd = Math.min(1, safeDelta * 40);
        gazeCurrRef.current.lerp(gazeTargetRef.current, saccadeSpd);
        if (now > gazeSaccadeUntilRef.current) {
          gazeStateRef.current       = 'fixate';
          // Fixation hold: 150–500 ms (human average ~220 ms)
          gazeFixateUntilRef.current = now + (phase === 'speaking'
            ? 150 + Math.random() * 350
            : GAZE_FIXATE_IDLE_MIN_MS + Math.random() * (GAZE_FIXATE_IDLE_MAX_MS - GAZE_FIXATE_IDLE_MIN_MS));
        }
      }

      // 3. Smooth eye target = fixated point + microsaccade drift + V20 micro-burst offset
      const eyeDesire = _eyeDesireScratch.copy(gazeCurrRef.current).add(gazeDriftRef.current);
      if (now < eyeMicroBurstUntilRef.current) {
        eyeDesire.add(eyeMicroOffsetRef.current);
      } else {
        eyeMicroOffsetRef.current.lerp(_eyeMicroZero, Math.min(1, safeDelta * 14));
      }
      eyeWorldTargetRef.current.lerp(eyeDesire, Math.min(1, safeDelta * 18)); // cap α — avoids eye snap after tab focus

      // §1-B eye lookAt — VRM built-in eye tracking (limited ±30° by VRM spec)
      const lookAt = (v as { lookAt?: { autoUpdate?: boolean; lookAt?: (p: THREE.Vector3) => void } }).lookAt;
      if (lookAt?.lookAt) {
        lookAt.autoUpdate = false;
        lookAt.lookAt(eyeWorldTargetRef.current);
      }

      // 5. Neck driven by direct pointer-to-angle mapping — NOT atan2 from world-point.
      // Root cause of the previous "invisible" tracking:
      //   camera z ≈ 3.5, avatar z ≈ -2.0  →  5.5 m gap between them
      //   pointer offset = pointer.x × 0.50 = max ±0.5 m world offset
      //   atan2(0.5, 5.5) = 0.09 rad → neck × 0.30 = 0.027 rad → head ≈ 3°  — imperceptible.
      // Fix: pointer.x × gazePointerScale × 0.40 → neck ±0.20 rad
      //      → head × (7/3) ≈ ±0.47 rad ≈ ±27°  — clearly visible.
      if (v.humanoid) {
        let neckYaw   = -pointer.x * gazePointerScale * 0.40;
        let neckPitch =  pointer.y * gazePointerScale * 0.22;
        // During random gaze-break: blend toward actual world-direction of the off-screen target
        if (lookAwayBlend > 0) {
          const avatarPos = group ? group.position : new THREE.Vector3();
          const toBreak   = desireWorld.clone().sub(avatarPos);
          const bYaw      = -Math.atan2(toBreak.x, toBreak.z) * 0.40;
          const bPitch    = -Math.atan2(toBreak.y, Math.hypot(toBreak.x, toBreak.z)) * 0.40;
          neckYaw   = lerp(neckYaw,   bYaw,   lookAwayBlend);
          neckPitch = lerp(neckPitch, bPitch, lookAwayBlend);
        }
        // Hard cap desired neck angles before smoothing (atan2 / look-away can overshoot soft limits).
        const NECK_DESIRE_CAP = 0.32;
        neckYaw   = THREE.MathUtils.clamp(neckYaw,   -NECK_DESIRE_CAP, NECK_DESIRE_CAP);
        neckPitch = THREE.MathUtils.clamp(neckPitch, -NECK_DESIRE_CAP, NECK_DESIRE_CAP);
        const neckLerpT = Math.min(1, safeDelta * 3.5);
        if (vrmFirstFrameRef.current) {
          vrmFirstFrameRef.current = false;
          neckGazeYawRef.current   = neckYaw;
          neckGazePitchRef.current = neckPitch;
        } else {
          neckGazeYawRef.current   = lerp(neckGazeYawRef.current,   neckYaw,   neckLerpT);
          neckGazePitchRef.current = lerp(neckGazePitchRef.current, neckPitch, neckLerpT);
        }
      }
    }

    // 6. VRM internals update — VRMA mixer bakes animation keyframes into raw bones.
    //    All procedural bone overrides that must WIN over VRMA go AFTER this call.
    v.update(safeDelta);

    // §1-A Spine breathing (+nod) — AFTER v.update so VRMA pose is the base, then multiply deltas
    if (v.humanoid && !isVRMAWalking) {
      const nodArc = (now < nodUntilRef.current)
        ? Math.sin(Math.min(1, (now - nodStartRef.current) / nodDurationRef.current) * Math.PI)
        : 0;
      const vrmaLive = vrmaReadyRef.current && !isWalkingNow;
      const phaseBreathScale =
        phase === 'speaking'  ? 1.15 :
        phase === 'listening' ? 0.75 :
        phase === 'thinking'  ? 0.90 : 1.0;
      const vrm1BreathMul = vrmMetaIsV1Ref.current
        ? AVATAR_BREATHE_SCALE_VRM1
          * (isSittingNow
            ? BREATHE_AMP_SITTING_VRM1 / BREATHE_AMP_SITTING
            : BREATHE_AMP_STANDING_VRM1 / BREATHE_AMP_STANDING)
        : 1;
      const spineBreathTarget =
        breathSpineAmount(t, isSittingNow, phaseBreathScale) * skelMul * vrm1BreathMul;
      spineBreathRef.current = lerp(spineBreathRef.current, spineBreathTarget, safeDelta * 2);

      const spineBone  = v.humanoid.getRawBoneNode('spine'   as never);
      const spine1Bone = v.humanoid.getRawBoneNode('spine1'  as never);
      const spine2Bone = v.humanoid.getRawBoneNode('upperChest' as never)
                      ?? v.humanoid.getRawBoneNode('chest'   as never);
      const spine2Mid  = v.humanoid.getRawBoneNode('spine2'  as never);

      if (spineBone) {
        // Breathing + nod: strict local X (pitch — chest forward/back). Y/Z only for gaze/roll share (no lateral “pendulum” on X)
        const breathPitch =
          (spineBreathRef.current * 0.35 * phaseBreathScale + nodArc * 0.10) * skelMul;
        const spineGazeYaw = neckGazeYawRef.current * (isSittingNow ? 0.10 : 0.12) * skelMul;
        const spineRoll    = headRollRef.current * 0.022 * skelMul;
        _scratchEuler.set(breathPitch, spineGazeYaw, spineRoll, 'XYZ');
        _scratchQuat.setFromEuler(_scratchEuler);
        if (vrmaLive) {
          spineBone.quaternion.multiply(_scratchQuat);
        } else {
          spineBone.quaternion.slerp(_scratchQuat, 0.18);
        }
      }
      if (spine2Bone) {
        _scratchEuler2.set(spineBreathRef.current * 0.20 * phaseBreathScale * skelMul, 0, 0, 'XYZ');
        _scratchQuat2.setFromEuler(_scratchEuler2);
        if (vrmaLive) spine2Bone.quaternion.multiply(_scratchQuat2);
        else          spine2Bone.quaternion.slerp(_scratchQuat2, 0.15);
        // Upper chest: extra inhale/exhale on local X only (axis-angle — no Y/Z wobble)
        const chestSit = isSittingNow ? 0.5 : 1;
        _scratchQuat3.setFromAxisAngle(
          _V_AXIS_X,
          Math.sin(t * 1.5) * 0.015 * skelMul * chestSit,
        );
        if (vrmaLive) spine2Bone.quaternion.multiply(_scratchQuat3);
        else          spine2Bone.quaternion.multiply(_scratchQuat3);
      }
      const bChain = spineBreathRef.current * 0.11 * phaseBreathScale * skelMul;
      if (spine1Bone) {
        _scratchEuler2.set(bChain * 0.85, 0, 0, 'XYZ');
        _scratchQuat2.setFromEuler(_scratchEuler2);
        if (vrmaLive) spine1Bone.quaternion.multiply(_scratchQuat2);
        else          spine1Bone.quaternion.slerp(_scratchQuat2, 0.12);
      }
      if (spine2Mid && spine2Mid !== spine2Bone) {
        _scratchEuler2.set(bChain * 0.65, 0, 0, 'XYZ');
        _scratchQuat2.setFromEuler(_scratchEuler2);
        if (vrmaLive) spine2Mid.quaternion.multiply(_scratchQuat2);
        else          spine2Mid.quaternion.slerp(_scratchQuat2, 0.11);
      }
    }

    // §6-A Neck override — after v.update(safeDelta). Blend toward gaze with slerp (not copy)
    // to avoid fighting VRMA + reduce pointer-driven spin.
    if (v.humanoid && skelMul > 1e-5) {
      const neckBone = v.humanoid.getRawBoneNode('neck' as never);
      if (neckBone) {
        // Tighter neck limits + slerp (not copy) to avoid Euler/pointer instability & fast circular motion
        const MAX_NECK_YAW   = 0.3;
        const MAX_NECK_PITCH = 0.3;
        const safeYaw   = isNaN(neckGazeYawRef.current)
          ? 0
          : THREE.MathUtils.clamp(neckGazeYawRef.current, -MAX_NECK_YAW, MAX_NECK_YAW);
        const safePitch = isNaN(neckGazePitchRef.current)
          ? 0
          : THREE.MathUtils.clamp(neckGazePitchRef.current, -MAX_NECK_PITCH, MAX_NECK_PITCH);
        const nodB = (now < nodUntilRef.current)
          ? Math.sin(Math.min(1, (now - nodStartRef.current) / nodDurationRef.current) * Math.PI)
          : 0;
        const neckSwayZ = (_noise3D(t * 0.41, 40, 0) * 0.004 + _noise3D(t * 0.19, 41, 0) * 0.002);
        _scratchEuler.set(
          (safePitch + nodB * 0.12) * skelMul,
          safeYaw * skelMul,
          neckSwayZ * skelMul,
          'YXZ',
        );
        _scratchQuat.setFromEuler(_scratchEuler);
        neckBone.quaternion.slerp(_scratchQuat, 0.3);
      }
    }

    // §7 Head-pose lerp — phase-aware pitch bias added to idle baseline so the avatar
    // reads as: listening → slight forward lean, thinking → slight upward gaze.
    if (v.humanoid && skelMul > 1e-5) {
      const headBone = v.humanoid.getRawBoneNode('head' as never);
      if (headBone) {
        const active = headUntilRef.current > now;
        let camPitchBaseline = 0;
        if (!active) {
          const avatarWorldY = group ? group.position.y : 0;
          const dY  = camera.position.y - avatarWorldY;
          const dZ  = Math.abs(camera.position.z);
          camPitchBaseline = Math.atan2(dY, dZ) * 0.35;
        }
        // Phase-aware pitch bias applied only during idle head state (not overriding active headpose).
        // listening → +0.04 rad forward-attentive lean
        // thinking  → -0.07 rad upward-reflective gaze
        const phasePitchBias = !active
          ? (phase === 'listening' ? 0.04 : phase === 'thinking' ? -0.07 : 0)
          : 0;
        const idleHeadYawTarget   = _noise3D(t * 0.25, 1, 0) * 0.045;   // ±0.045 rad (~2.5°) — organic non-repeating drift
        const listenMicroPitch =
          phase === 'listening' && isListeningExtRef.current
            ? Math.sin(t * 1.55) * 0.038 + Math.sin(t * 0.85) * 0.012
            : 0;
        const idleHeadPitchTarget =
          camPitchBaseline + phasePitchBias + _noise3D(t * 0.20, 2, 0) * 0.030 + listenMicroPitch;
        idleHeadOffsetRef.current = lerp(idleHeadOffsetRef.current, idleHeadYawTarget, 0.03);
        const MAX_HEAD_YAW   = 0.3;
        const MAX_HEAD_PITCH = 0.3;
        const clampedNeckYaw   = THREE.MathUtils.clamp(neckGazeYawRef.current, -0.3, 0.3);
        const clampedNeckPitch = THREE.MathUtils.clamp(neckGazePitchRef.current, -0.3, 0.3);
        const headGazeYaw   = THREE.MathUtils.clamp(clampedNeckYaw   * (7 / 3), -MAX_HEAD_YAW, MAX_HEAD_YAW);
        const headGazePitch = THREE.MathUtils.clamp(clampedNeckPitch * (7 / 3), -MAX_HEAD_PITCH, MAX_HEAD_PITCH);
        const targetYaw   = THREE.MathUtils.clamp(
          active ? headYawRef.current + headGazeYaw : idleHeadOffsetRef.current + headGazeYaw,
          -MAX_HEAD_YAW,
          MAX_HEAD_YAW,
        );
        const targetPitch = THREE.MathUtils.clamp(
          active ? headPitchRef.current + headGazePitch : idleHeadPitchTarget + headGazePitch,
          -MAX_HEAD_PITCH,
          MAX_HEAD_PITCH,
        );
        // Simplex organic head-roll micro-movement (replaces uniform Math.sin periodicity)
        const organicHeadZ = _noise3D(t * 0.53, 50, 0) * 0.006 + _noise3D(t * 0.29, 51, 0) * 0.004;
        if (!active) headRollEmotionRef.current = lerp(headRollEmotionRef.current, 0, safeDelta * 2.0);
        const targetRoll  = headRollRef.current * 0.60 + organicHeadZ + headRollEmotionRef.current + lifeLongHeadTiltRef.current;
        // NaN guard — only write if values are finite (prevents runaway rotation on model load edge cases)
        if (Number.isFinite(targetYaw) && Number.isFinite(targetPitch)) {
          const DAMPING_FACTOR = 0.15; // smoother head — less oscillation vs 0.30
          headYawSmoothRef.current   = lerp(headYawSmoothRef.current,   targetYaw,   DAMPING_FACTOR);
          headPitchSmoothRef.current = lerp(headPitchSmoothRef.current, targetPitch, DAMPING_FACTOR);
          headRollSmoothRef.current  = lerp(headRollSmoothRef.current,  targetRoll,  0.05);
          // Quaternion.copy(setFromEuler) — YXZ order prevents Gimbal Lock on head bone.
          // The smooth lerp refs above handle temporal interpolation;
          // the quaternion write is the final, gimbal-safe application.
          _scratchEuler.set(
            headPitchSmoothRef.current * skelMul,
            headYawSmoothRef.current * skelMul,
            headRollSmoothRef.current * skelMul,
            'YXZ',
          );
          _scratchQuat.setFromEuler(_scratchEuler);
          headBone.quaternion.copy(_scratchQuat);
        }
      }
    }

    // 8. Arm/leg pose — ALWAYS runs as final bone override (prevents T-pose from VRMA gaps)
    //    v.update(safeDelta) already ran above; §8 overwrites raw bones as the last step before render.
    const humanoid = v.humanoid;
    if (humanoid) {
      const sitUpperLegX = vrmMetaIsV1Ref.current ? SIT_UPPER_LEG_X_VRM1 : SIT_UPPER_LEG_X_VRM0;
      const sitLowerLegX = SIT_LOWER_LEG_X_SEATED;
      // Micro pelvic roll (local Z) — weight shift without translating hips.position (feet stay planted)
      const pelvicRollStand = Math.sin(t * 0.5) * 0.005 * skelMul;

      const isWaving   = now < waveUntilRef.current;
      const gs         = gestureRef.current;
      if (gs && now > gs.startMs + gs.durationMs) gestureRef.current = null;
      const hasGesture = !!gestureRef.current;

      if (isWaving && !hasGesture) {
        const waveProgress = (now - (waveUntilRef.current - WAVE_DURATION * 1000)) / (WAVE_DURATION * 1000);
        const waveEase = Easing.easeInOutSine(Math.min(1, waveProgress));
        const waveAng = Math.sin(t * 6) * 1.0 * waveEase;
        const rua = rawBone8(humanoid, 'rightUpperArm');
        const rla = rawBone8(humanoid, 'rightLowerArm');
        const rha = rawBone8(humanoid, 'rightHand');
        if (rua) rua.rotation.set(-0.9,  0.2, waveAng,           'XYZ');
        if (rla) rla.rotation.set(-0.7,  0,   waveAng * 1.2,     'XYZ');
        if (rha) rha.rotation.set( 0.05, 0,   waveAng * 0.35,    'XYZ');
        const lua = rawBone8(humanoid, 'leftUpperArm');
        const lla = rawBone8(humanoid, 'leftLowerArm');
        if (lua) lua.rotation.set(0, 0,  1.3, 'XYZ');
        if (lla) lla.rotation.set(0.06, 0, 0, 'XYZ');
        // LEGS: always straight during wave — this branch never reaches the `else` block
        if (!isSittingEffective) {
          const hB  = rawBone8(humanoid, 'hips');
          resetLowerBodyToIdle();
          // Full hips reset — restore T-pose bind position + clear pelvic tilt quaternion
          if (hB) {
            const bp = hipsBindPosRef.current;
            if (bp) hB.position.copy(bp);
            else
              hB.position.set(0, hB.position.y, 0);
            hB.rotation.set(0, 0, pelvicRollStand, 'XYZ');
          }
        }

      } else if (hasGesture && gestureRef.current) {
        const progress = Math.min(1, (now - gestureRef.current.startMs) / gestureRef.current.durationMs);
        const curve    = Easing.easeOutQuad(progress);
        const gType    = gestureRef.current.type;
        const gSide    = gestureRef.current.side;
        // When sitting, scale down gesture amplitude and offset from lap rest pose
        const sitScale = isSittingNow ? 0.6 : 1.0;

        const applyArm = (prefix: 'left' | 'right') => {
          const dir  = prefix === 'right' ? 1 : -1;
          const ua   = rawBone8(humanoid, `${prefix}UpperArm`);
          const la   = rawBone8(humanoid, `${prefix}LowerArm`);
          const ha   = rawBone8(humanoid, `${prefix}Hand`);
          // Lap rest offsets so gesture lifts from seated position rather than T-pose
          const lapUAx = isSittingNow ? -0.15 : 0;
          const lapUAz = isSittingNow ? (dir < 0 ?  1.1 : -1.1) : 0;
          const lapLAx = isSittingNow ? 0.5  : 0;
          if (gType === 'point') {
            if (ua) ua.rotation.set(lapUAx - 0.55 * curve * sitScale, 0,  lapUAz + dir * 0.1 * curve * sitScale, 'YXZ');
            if (la) la.rotation.set(lapLAx - 0.35 * curve * sitScale, 0, 0, 'YXZ');
            if (ha) ha.rotation.set(0, dir * 0.08 * curve * sitScale, 0, 'YXZ');
            const idxP = rawBone8(humanoid, `${prefix}IndexProximal`);
            const idxI = rawBone8(humanoid, `${prefix}IndexIntermediate`);
            if (idxP) idxP.rotation.z = dir * 0.42 * curve * sitScale;
            if (idxI) idxI.rotation.z = dir * 0.28 * curve * sitScale;
          } else if (gType === 'openHand') {
            if (ua) ua.rotation.set(lapUAx - 0.45 * curve * sitScale, dir * 0.15 * curve * sitScale, lapUAz + dir * 0.08 * curve * sitScale, 'YXZ');
            if (la) la.rotation.set(lapLAx - 0.25 * curve * sitScale, 0, 0, 'YXZ');
            if (ha) ha.rotation.set(0, dir * 0.25 * curve * sitScale,  0, 'YXZ');
          } else if (gType === 'beat') {
            const beat = Math.sin(progress * Math.PI * 5) * 0.28 * curve * sitScale;
            if (ua) ua.rotation.set(lapUAx - (curve * 0.35 + beat * 0.5) * sitScale, 0, lapUAz + dir * 0.12 * sitScale, 'YXZ');
            if (la) la.rotation.set(lapLAx - 0.2 * sitScale + beat,                  0, 0, 'YXZ');
            if (ha) ha.rotation.set(0,                                                0, beat * 0.6, 'YXZ');
          }
        };

        if (gSide === 'right' || gSide === 'both') applyArm('right');
        if (gSide === 'left'  || gSide === 'both') applyArm('left');

        // Keep legs consistent with effective sitting state
        {
          const rul = rawBone8(humanoid, 'rightUpperLeg');
          const lul = rawBone8(humanoid, 'leftUpperLeg');
          const rll = rawBone8(humanoid, 'rightLowerLeg');
          const lll = rawBone8(humanoid, 'leftLowerLeg');
          if (isSittingEffective) {
            if (rul) rul.rotation.set( sitUpperLegX, 0,  0.04, 'XYZ');
            if (lul) lul.rotation.set( sitUpperLegX, 0, -0.04, 'XYZ');
            if (rll) rll.rotation.set( sitLowerLegX, 0,  0,    'XYZ');
            if (lll) lll.rotation.set( sitLowerLegX, 0,  0,    'XYZ');
          } else {
            resetLowerBodyToIdle();
            // Full hips reset — restore T-pose bind position + clear pelvic tilt
            const hG = rawBone8(humanoid, 'hips');
            if (hG) {
              const bp = hipsBindPosRef.current;
              if (bp) hG.position.copy(bp);
              else hG.position.set(0, hG.position.y, 0);
              hG.rotation.set(0, 0, pelvicRollStand, 'XYZ');
            }
          }
        }

      } else if (isWalkingNow) {
        const walkCycle = Math.sin(t * WALK_CYCLE_RAD_PER_S);
        const vrmaWalkLower = activeVrmaRef.current === 'walk';
        const armSwing  = walkCycle * 0.45;
        const legSwing  = walkCycle * 0.55;
        const rightKnee = Math.max(0,  walkCycle) * 0.65;
        const leftKnee  = Math.max(0, -walkCycle) * 0.65;
        const rua = rawBone8(humanoid, 'rightUpperArm');
        const lua = rawBone8(humanoid, 'leftUpperArm');
        const rla = rawBone8(humanoid, 'rightLowerArm');
        const lla = rawBone8(humanoid, 'leftLowerArm');
        const rul = rawBone8(humanoid, 'rightUpperLeg');
        const lul = rawBone8(humanoid, 'leftUpperLeg');
        const rll = rawBone8(humanoid, 'rightLowerLeg');
        const lll = rawBone8(humanoid, 'leftLowerLeg');
        if (rua) rua.rotation.set( armSwing, 0, -1.1, 'XYZ');
        if (lua) lua.rotation.set(-armSwing, 0,  1.1, 'XYZ');
        if (rla) rla.rotation.set(0.12, 0, 0, 'XYZ');
        if (lla) lla.rotation.set(0.12, 0, 0, 'XYZ');
        if (!vrmaWalkLower) {
          if (rul) rul.rotation.set(-legSwing, 0, 0, 'XYZ');
          if (lul) lul.rotation.set( legSwing, 0, 0, 'XYZ');
          if (rll) rll.rotation.set(-rightKnee, 0, 0, 'XYZ');
          if (lll) lll.rotation.set(-leftKnee,  0, 0, 'XYZ');
          const rf  = rawBone8(humanoid, 'rightFoot');
          const lf  = rawBone8(humanoid, 'leftFoot');
          if (rf) rf.rotation.set( rightKnee * 0.4, 0, 0, 'XYZ');
          if (lf) lf.rotation.set( leftKnee  * 0.4, 0, 0, 'XYZ');
        }

        if (process.env.NODE_ENV === 'development' && t - _lastWalkProcLogT > 0.25) {
          _lastWalkProcLogT = t;
          console.log('[WALK] walkCycle=', walkCycle.toFixed(3), 'vrmaWalkLower=', vrmaWalkLower);
        }

      } else if (isLaughingNow) {
        // vrmaGestureNow: a gesture VRMA clip is actively PLAYING (clip done = §8 takes over)
        const vrmaGestureNow =
          ((now < vrmaGestureUntilRef.current) && !vrmaClipDoneRef.current)
          || vrmaGestureNowRef.current;
        if (!vrmaGestureNow) {
          const rua = rawBone8(humanoid, 'rightUpperArm');
          const lua = rawBone8(humanoid, 'leftUpperArm');
          const rla = rawBone8(humanoid, 'rightLowerArm');
          const lla = rawBone8(humanoid, 'leftLowerArm');
          if (isSittingNow) {
            // Sitting laugh: subtle arm bounce (no longer frozen)
            const laughBounce = Math.sin(t * 14) * 0.04;
            if (rua) rua.rotation.set(-0.15 + laughBounce, 0.08,  -1.1, 'XYZ');
            if (lua) lua.rotation.set(-0.15 + laughBounce, -0.08,  1.1, 'XYZ');
            if (rla) rla.rotation.set(0.5, 0, 0, 'XYZ');
            if (lla) lla.rotation.set(0.5, 0, 0, 'XYZ');
          } else {
            const shoulBounce = Math.sin(t * 14) * 0.15;
            if (rua) rua.rotation.set( shoulBounce, 0, -1.3, 'XYZ');
            if (lua) lua.rotation.set(-shoulBounce, 0,  1.3, 'XYZ');
            if (rla) rla.rotation.set(0.08, 0, 0, 'XYZ');
            if (lla) lla.rotation.set(0.08, 0, 0, 'XYZ');
          }
        }
        // Keep legs consistent with effective sitting state during laugh
        {
          const rul = rawBone8(humanoid, 'rightUpperLeg');
          const lul = rawBone8(humanoid, 'leftUpperLeg');
          const rll = rawBone8(humanoid, 'rightLowerLeg');
          const lll = rawBone8(humanoid, 'leftLowerLeg');
          if (isSittingEffective) {
            if (rul) rul.rotation.set( sitUpperLegX, 0,  0.04, 'XYZ');
            if (lul) lul.rotation.set( sitUpperLegX, 0, -0.04, 'XYZ');
            if (rll) rll.rotation.set( sitLowerLegX, 0,  0,    'XYZ');
            if (lll) lll.rotation.set( sitLowerLegX, 0,  0,    'XYZ');
          } else {
            resetLowerBodyToIdle();
          }
        }

      } else {
        // ── Natural idle OR sitting ──
        // vrmaGestureNow: true while gesture VRMA clip is actively PLAYING.
        // Once the clip finishes (vrmaClipDoneRef=true), §8 takes over arms even if
        // the gesture WINDOW (vrmaGestureUntilRef) is still open for the standing pose.
        // This decouples "arm override" (clip playing) from "standing duration" (window).
        const vrmaGestureNow =
          ((now < vrmaGestureUntilRef.current) && !vrmaClipDoneRef.current)
          || vrmaGestureNowRef.current;
        const sway    = (Math.sin(t * 0.4) * 0.04 + Math.sin(t * 0.27 + 1.1) * 0.025
                      + _noise3D(t * 0.13, 7, 0) * 0.009) * skelMul;
        const breathZ = spineBreathRef.current * 0.15 * skelMul;
        const rua  = rawBone8(humanoid, 'rightUpperArm');
        const lua  = rawBone8(humanoid, 'leftUpperArm');
        const rla  = rawBone8(humanoid, 'rightLowerArm');
        const lla  = rawBone8(humanoid, 'leftLowerArm');
        const rul  = rawBone8(humanoid, 'rightUpperLeg');
        const lul  = rawBone8(humanoid, 'leftUpperLeg');
        const rll  = rawBone8(humanoid, 'rightLowerLeg');
        const lll  = rawBone8(humanoid, 'leftLowerLeg');

        // isSittingEffective = sitting state minus any standing-VRMA window
        // (computed earlier in frame alongside group.position)
        if (isSittingEffective) {
          // ── Hips root-motion lock (sitting) ─────────────────────────────────────
          // sit.vrma contains root-motion keyframes on the hips bone that shift it
          // in local Z/X. With group.rotation.y = Math.PI the transform is:
          //   world_z = group.z − hips.local_z
          // So if sit.vrma pushes hips.local_z = −0.6 → world_z = CHAIR_Z + 0.6
          // → avatar visually sits IN FRONT OF the desk instead of behind it.
          // Fix: pin hips X/Z to the T-pose bind values so group.position is the
          // sole driver of world position. Y is kept from sit.vrma (seated height).
          const hipsBoneS = rawBone8(humanoid, 'hips');
          if (hipsBoneS && hipsBindPosRef.current) {
            const bp = hipsBindPosRef.current;
            hipsBoneS.position.set(bp.x, hipsBoneS.position.y, bp.z);
          }
          // ── Sitting pose calibrated for teach.vrm (VRM 0.x, group.rotation.y = Math.PI) ──
          // Legs/feet are always clamped in perma-sit mode (even during gestures).
          if (rul) rul.rotation.set( sitUpperLegX, 0,  0.04, 'XYZ');
          if (lul) lul.rotation.set( sitUpperLegX, 0, -0.04, 'XYZ');
          if (rll) rll.rotation.set( sitLowerLegX, 0,  0,    'XYZ');
          if (lll) lll.rotation.set( sitLowerLegX, 0,  0,    'XYZ');
          // Feet: with lower leg vertical, ankle should be neutral (0) so sole faces floor.
          // Slight plantar flexion (0.12) looks natural in resting seated pose.
          const rf  = rawBone8(humanoid, 'rightFoot');
          const lf  = rawBone8(humanoid, 'leftFoot');
          const rto = rawBone8(humanoid, 'rightToes');
          const lto = rawBone8(humanoid, 'leftToes');
          if (rf)  rf.rotation.set( 0.12, 0, 0, 'XYZ');
          if (lf)  lf.rotation.set( 0.12, 0, 0, 'XYZ');
          if (rto) rto.rotation.set(0,    0, 0, 'XYZ');
          if (lto) lto.rotation.set(0,    0, 0, 'XYZ');
          if (!vrmaGestureNow) {
            // Arms on lap
            const lapSway    = (Math.sin(t * 0.35) * 0.013 + Math.sin(t * 0.21 + 1.3) * 0.008) * skelMul;
            const lapBreathZ = spineBreathRef.current * 0.12 * skelMul;
            const shDropS =
              (lifeShoulderDropSideRef.current === 'right' ? SHOULDER_DROP_RAD * 0.45 : -SHOULDER_DROP_RAD * 0.45)
              * skelMul;
            if (rua) rua.rotation.set(-0.15 + lapSway * 0.4, 0.08,  -1.1 + lapBreathZ + shDropS, 'XYZ');
            if (lua) lua.rotation.set(-0.15 - lapSway * 0.4, -0.08,  1.1 - lapBreathZ - shDropS, 'XYZ');
            if (rla) rla.rotation.set( 0.5  + lapSway * 0.3, 0, 0, 'XYZ');
            if (lla) lla.rotation.set( 0.5  - lapSway * 0.3, 0, 0, 'XYZ');
            // Wrists: relax slightly inward to match lap arm angle
            const rha = rawBone8(humanoid, 'rightHand');
            const lha = rawBone8(humanoid, 'leftHand');
            if (rha) rha.rotation.set(0,  0.1, 0, 'XYZ');
            if (lha) lha.rotation.set(0, -0.1, 0, 'XYZ');
          }
          // When vrmaGestureNow: VRMA clip drives ALL bones — no procedural override
        } else {
          // ── Natural standing idle / standing gesture ──────────────────────────
          // LEGS + FEET: ALWAYS zeroed when standing, even during VRMA gestures.
          // Reason: many gesture VRMA clips (clap, cheer, wave) only have upper-body
          // keyframes. If we trust VRMA for legs, they stay at sit.vrma's last value →
          // "ghost sitting" effect. Zeroing procedurally guarantees straight legs.
          // Arms are still released to VRMA during a gesture window.
          resetLowerBodyToIdle();
          // ── Hips full T-pose reset ───────────────────────────────────────────
          // sit.vrma drives TWO things on the hips bone:
          //   1. position (root motion) — lowers hips ~0.3 m from T-pose bind height
          //   2. quaternion            — tilts pelvis forward (sitting lean)
          // CRITICAL: T-pose hips.y for teach.vrm ≈ 0.9m (NOT 0!). Setting y=0
          // would sink the skeleton BELOW the floor. We restore to the saved bind
          // position captured right after VRM load (hipsBindPosRef).
          // Spine bones are NOT touched here — §1-A (breathing) is additive on spine
          // and runs before v.update(); resetting spine in §8 would kill breathing.
          const hipsBone = rawBone8(humanoid, 'hips');
          if (hipsBone) {
            const bp = hipsBindPosRef.current;
            if (bp) hipsBone.position.copy(bp);
            else
              hipsBone.position.set(0, hipsBone.position.y, 0);
            // Euler Z = V20 tilt + microscopic weight roll (no hips.position.x slide)
            hipsBone.rotation.set(0, 0, lifeHipTiltZRef.current + pelvicRollStand, 'XYZ');
          }
          // Keep standing feet in bind pose; zeroing rotations breaks some VRM rigs.
          // Arms: only override when no VRMA gesture (let clap/wave/cheer drive arms)
          if (!vrmaGestureNow) {
            const _procNow = Date.now();
            if (_procNow < handsUpUntilRef.current) {
              if (rua) rua.rotation.set(-0.52, 0.12, -0.62, 'XYZ');
              if (lua) lua.rotation.set(-0.52, -0.12, 0.62, 'XYZ');
              if (rla) rla.rotation.set(0.2, 0, 0, 'XYZ');
              if (lla) lla.rotation.set(0.2, 0, 0, 'XYZ');
            } else if (_procNow < shoulderShrugUntilRef.current) {
              const bump = Math.sin(t * 16) * 0.11;
              const shDrop = lifeShoulderDropSideRef.current === 'right' ? SHOULDER_DROP_RAD : -SHOULDER_DROP_RAD;
              if (rua) rua.rotation.set(sway + bump, 0, -1.22 + breathZ + shDrop * 0.5, 'XYZ');
              if (lua) lua.rotation.set(-sway - bump, 0, 1.22 - breathZ - shDrop * 0.5, 'XYZ');
              if (rla) rla.rotation.set(0.07, 0, 0, 'XYZ');
              if (lla) lla.rotation.set(0.07, 0, 0, 'XYZ');
            } else {
              const shDrop = lifeShoulderDropSideRef.current === 'right' ? SHOULDER_DROP_RAD : -SHOULDER_DROP_RAD;
              if (rua) rua.rotation.set( sway, 0, -1.3 + breathZ + shDrop * 0.55, 'XYZ');
              if (lua) lua.rotation.set(-sway, 0,  1.3 - breathZ - shDrop * 0.55, 'XYZ');
              if (rla) rla.rotation.set(0.07, 0, 0, 'XYZ');
              if (lla) lla.rotation.set(0.07, 0, 0, 'XYZ');
            }
            const rha = rawBone8(humanoid, 'rightHand');
            const lha = rawBone8(humanoid, 'leftHand');
            if (rha) rha.rotation.set(0, 0, 0, 'XYZ');
            if (lha) lha.rotation.set(0, 0, 0, 'XYZ');
          }
        }
      }

      // V20 — wrist separation: clap/cheer get stronger spread; any VRMA gesture gets light repulsion if hands clip
      if (
        now < vrmaGestureUntilRef.current
        && !isSittingEffective
        && activeVrmaRef.current !== '__cogni__'
      ) {
        const isClapFamily = activeVrmaRef.current === 'clap' || activeVrmaRef.current === 'cheer';
        const pulseBoost = isClapFamily && isHandSeparationPulseActive() ? 1.48 : isClapFamily ? 1 : 0.62;
        const spread = (0.13 + Math.sin(t * 14) * 0.048) * pulseBoost;
        const ruaC = rawBone8(humanoid, 'rightUpperArm');
        const luaC = rawBone8(humanoid, 'leftUpperArm');
        _scratchEuler.set(0, 0, -spread, 'XYZ');
        _scratchQuat.setFromEuler(_scratchEuler);
        if (ruaC) ruaC.quaternion.multiply(_scratchQuat);
        _scratchEuler.set(0, 0, spread, 'XYZ');
        _scratchQuat.setFromEuler(_scratchEuler);
        if (luaC) luaC.quaternion.multiply(_scratchQuat);
        if (v.scene) {
          v.scene.updateMatrixWorld(true);
          const rhW =
            rawBone8(humanoid, 'rightHand')
            ?? rawBone8(humanoid, 'rightLowerArm');
          const lhW =
            rawBone8(humanoid, 'leftHand')
            ?? rawBone8(humanoid, 'leftLowerArm');
          const ruaW = rawBone8(humanoid, 'rightUpperArm');
          const luaW = rawBone8(humanoid, 'leftUpperArm');
          if (rhW && lhW && ruaW && luaW) {
            rhW.getWorldPosition(_wristSepWpA);
            lhW.getWorldPosition(_wristSepWpB);
            const sep = _wristSepWpA.distanceTo(_wristSepWpB);
            if (sep < WALK_WRIST_MIN_SEP_M && sep > 1e-7) {
              const repel = isClapFamily ? 0.5 : 0.32;
              const k = ((WALK_WRIST_MIN_SEP_M - sep) / WALK_WRIST_MIN_SEP_M) * repel;
              _scratchEuler.set(-k * 0.22, k * 0.28, -k, 'XYZ');
              _scratchQuat.setFromEuler(_scratchEuler);
              ruaW.quaternion.multiply(_scratchQuat);
              _scratchEuler.set(k * 0.22, -k * 0.28, k, 'XYZ');
              _scratchQuat.setFromEuler(_scratchEuler);
              luaW.quaternion.multiply(_scratchQuat);
            }
          }
        }
      }

      // V30 — residual upper-arm sway while a one-shot VRMA gesture clip plays (eases “frozen” arms)
      // (Skip during Cogni map-driven VRMA — full skeleton is authored in clip.)
      {
        const vrmaLegacyGestureArms =
          (now < vrmaGestureUntilRef.current) && !vrmaClipDoneRef.current;
        if (
          vrmaLegacyGestureArms
          && !isSittingEffective
          && !isWalkingNow
          && !isLaughingNow
          && !hasGesture
          && !isWaving
        ) {
          const res =
            (Math.sin(t * 0.42) * 0.024 + _noise3D(t * 0.17, 44, 0) * 0.009)
            * PROC_LIFE_DURING_VRMA_GESTURE;
          const ruaR = rawBone8(humanoid, 'rightUpperArm');
          const luaR = rawBone8(humanoid, 'leftUpperArm');
          _scratchEuler.set(0, 0, res, 'XYZ');
          _scratchQuat.setFromEuler(_scratchEuler);
          if (ruaR) ruaR.quaternion.multiply(_scratchQuat);
          _scratchEuler.set(0, 0, -res, 'XYZ');
          _scratchQuat.setFromEuler(_scratchEuler);
          if (luaR) luaR.quaternion.multiply(_scratchQuat);
        }
      }

      // V29 — VRMA point: additive finger articulation (lerp ~0.2s) on top of clip
      {
        const wantPoint =
          activeVrmaRef.current === 'point'
          && now < vrmaGestureUntilRef.current
          && !isSittingEffective;
        const tgt = wantPoint ? 1 : 0;
        pointFingerBlendRef.current = lerp(pointFingerBlendRef.current, tgt, Math.min(1, safeDelta * 6));
        const pb = pointFingerBlendRef.current;
        if (pb > 0.02) {
          const dir = 1;
          const idxP = rawBone8(humanoid, 'rightIndexProximal');
          const idxI = rawBone8(humanoid, 'rightIndexIntermediate');
          const idxD = rawBone8(humanoid, 'rightIndexDistal');
          const thP  = rawBone8(humanoid, 'rightThumbProximal');
          if (idxP) idxP.rotation.z = idxP.rotation.z + dir * 0.38 * pb;
          if (idxI) idxI.rotation.z = idxI.rotation.z + dir * 0.26 * pb;
          if (idxD) idxD.rotation.z = idxD.rotation.z + dir * 0.12 * pb;
          if (thP)  thP.rotation.y  = thP.rotation.y  - 0.2 * pb;
        }
      }

      // V29/V30 — idle finger micro-sway; damped continuation during heavy VRMA gestures
      {
        const vrmaGNow =
          ((now < vrmaGestureUntilRef.current) && !vrmaClipDoneRef.current)
          || vrmaGestureNowRef.current;
        const act = activeVrmaRef.current;
        const heavy = act === 'clap' || act === 'cheer' || act === 'wave' || act === 'point';
        const allowIdleFingers =
          !isTalkingRef.current
          && !isTranscribingRef.current
          && !isWalkingNow
          && (phase === 'idle' || phase === 'listening');
        const fingerDamp = heavy && vrmaGNow ? PROC_LIFE_DURING_VRMA_GESTURE : 1;
        if (allowIdleFingers) {
          const wf =
            (Math.sin(t * 0.5) * 0.015
            + Math.sin(t * 0.73 + 0.7) * 0.01)
            * fingerDamp;
          for (const side of ['left', 'right'] as const) {
            const sign = side === 'right' ? 1 : -1;
            for (const bn of ['IndexProximal', 'MiddleProximal', 'RingProximal', 'LittleProximal'] as const) {
              const b = rawBone8(humanoid, `${side}${bn}`);
              if (b) b.rotation.z = b.rotation.z + wf * sign;
            }
          }
        }
        if (now < fingerTapUntilRef.current) {
          const wTap = Math.sin(t * 19) * 0.038;
          const side = fingerTapSideRef.current;
          const idxP = rawBone8(humanoid, `${side}IndexProximal`);
          const idxI = rawBone8(humanoid, `${side}IndexIntermediate`);
          if (idxP) idxP.rotation.z += wTap;
          if (idxI) idxI.rotation.z += wTap * 0.65;
        }
      }
    }
    // » §8 bone writes are the last thing before this frame renders — no v.update after this

    // ── §9 MOCAP Interceptor ─────────────────────────────────────────────────
    // Passively snapshots bone quaternions + blendshapes for the Cogni dataset.
    // Zero cost when not recording (single boolean check, no heap allocations).
    if (motionLogger.isRecording && v?.humanoid && v?.expressionManager) {
      const h  = v.humanoid;
      const em = v.expressionManager;

      const bSnap: BlendshapeSnapshot = {};
      const EXPR_KEYS = [
        'aa','ih','ou','ee','oh',
        'blink','blinkLeft','blinkRight',
        'happy','sad','angry','surprised','relaxed',
      ] as const;
      for (const k of EXPR_KEYS) {
        const val = em.getValue(k as never) as number | undefined;
        if (val !== undefined && val !== 0) bSnap[k] = val;
      }

      const BONE_KEYS = [
        'hips','spine','upperChest','chest','neck','head',
        'leftUpperArm','leftLowerArm','leftHand',
        'rightUpperArm','rightLowerArm','rightHand',
      ] as const;
      const rSnap: BoneSnapshot = {};
      for (const k of BONE_KEYS) {
        const bone = h.getRawBoneNode(k as never);
        if (bone) {
          const q = bone.quaternion;
          (rSnap as Record<string, QuatTuple>)[k] = [q.x, q.y, q.z, q.w];
        }
      }
      motionLogger.logFrame(safeDelta, bSnap, rSnap);
    }

    // ── V54 — orbit target follows avatar (after §8 bones); diagnostics ─────────
    group.updateMatrixWorld(true);
    group.getWorldPosition(_v53WorldPos);
    v54OrbitLookAtWorld.copy(_v53WorldPos);
    const vEnd = vrmRef.current;
    if (vEnd?.humanoid) {
      const hn = vEnd.humanoid.getRawBoneNode('head' as never);
      if (hn) hn.getWorldPosition(v54OrbitLookAtWorld);
      else v54OrbitLookAtWorld.y += 1.55;
    } else if (vEnd) {
      v54OrbitLookAtWorld.y += 1.55;
    }
    clampOrbitLookAtToRoomXZ(v54OrbitLookAtWorld);
    const ocEnd = state.controls as { target?: THREE.Vector3; update?: () => void } | undefined;
    if (ocEnd?.target && typeof ocEnd.update === 'function') {
      ocEnd.target.lerp(v54OrbitLookAtWorld, 0.18);
      ocEnd.update();
    }

    if (_v54TeleportLogPending) {
      _v54TeleportLogPending = false;
      const cam = state.camera as THREE.PerspectiveCamera;
      cam.getWorldPosition(_v53CamPos);
      cam.getWorldDirection(_v53Forward);
      console.log('[V54] Post-teleport snapshot', {
        groupWorld: [_v53WorldPos.x, _v53WorldPos.y, _v53WorldPos.z],
        orbitDesired: [v54OrbitLookAtWorld.x, v54OrbitLookAtWorld.y, v54OrbitLookAtWorld.z],
        camPos: [_v53CamPos.x, _v53CamPos.y, _v53CamPos.z],
        camFwd: [_v53Forward.x, _v53Forward.y, _v53Forward.z],
      });
    }

    if (process.env.NODE_ENV === 'development' && t - _v53LastLogSec >= V54_DEV_LOG_INTERVAL_SEC) {
      _v53LastLogSec = t;
      const cam = state.camera as THREE.PerspectiveCamera;
      cam.getWorldPosition(_v53CamPos);
      cam.getWorldDirection(_v53Forward);
      _v54RawToAvatar.subVectors(_v53WorldPos, _v53CamPos);
      const distCam = _v54RawToAvatar.length();
      _v53ToAvatar.copy(_v54RawToAvatar);
      if (distCam > 1e-8) _v53ToAvatar.multiplyScalar(1 / distCam);
      const inFront = _v53Forward.dot(_v53ToAvatar) > 0.02;
      const behindHeuristic = _v53WorldPos.z > cam.position.z;
      const tgt = ocEnd?.target;
      const desk = getDeskBox();
      const chair = getChairAnchorVector3();
      let headStr = '—';
      if (vEnd?.humanoid) {
        const hn = vEnd.humanoid.getRawBoneNode('head' as never);
        if (hn) {
          hn.getWorldPosition(_v53HeadWorld);
          headStr = `${_v53HeadWorld.x.toFixed(2)},${_v53HeadWorld.y.toFixed(2)},${_v53HeadWorld.z.toFixed(2)}`;
        }
      }
      const deskStr = desk.isEmpty()
        ? '(empty — desk not registered yet)'
        : `min[${desk.min.x.toFixed(2)},${desk.min.y.toFixed(2)},${desk.min.z.toFixed(2)}] max[${desk.max.x.toFixed(2)},${desk.max.y.toFixed(2)},${desk.max.z.toFixed(2)}]`;
      const chairStr = chair
        ? `${chair.x.toFixed(2)},${chair.y.toFixed(2)},${chair.z.toFixed(2)}`
        : '(null)';
      console.log(
        '[V54][AVATAR] world',
        _v53WorldPos.x.toFixed(3),
        _v53WorldPos.y.toFixed(3),
        _v53WorldPos.z.toFixed(3),
        '| local',
        group.position.x.toFixed(3),
        group.position.y.toFixed(3),
        group.position.z.toFixed(3),
      );
      console.log(
        '[V54][CAM] pos',
        _v53CamPos.x.toFixed(3),
        _v53CamPos.y.toFixed(3),
        _v53CamPos.z.toFixed(3),
        'fwd',
        _v53Forward.x.toFixed(3),
        _v53Forward.y.toFixed(3),
        _v53Forward.z.toFixed(3),
        'near',
        cam.near,
        'far',
        cam.far,
      );
      console.log(
        '[V54][TO_AVATAR] raw',
        _v54RawToAvatar.x.toFixed(3),
        _v54RawToAvatar.y.toFixed(3),
        _v54RawToAvatar.z.toFixed(3),
        'dist',
        distCam.toFixed(3),
        'inFront(dot)',
        inFront,
        'z>cam.z?',
        behindHeuristic,
      );
      console.log(
        '[V54][ORBIT] target',
        tgt ? `${tgt.x.toFixed(3)},${tgt.y.toFixed(3)},${tgt.z.toFixed(3)}` : 'n/a',
        '| desired',
        `${v54OrbitLookAtWorld.x.toFixed(3)},${v54OrbitLookAtWorld.y.toFixed(3)},${v54OrbitLookAtWorld.z.toFixed(3)}`,
      );
      console.log('[V54][DESK]', deskStr, '| chair', chairStr, '| headW', headStr);
      console.log(
        '[V54] sitting effective',
        isSittingNow,
        'rawRef',
        isSittingRef.current,
        'forceStandEnv',
        readAvatarDebugForceStandEnv(),
      );
    }
  });

  // ── Dev hotkey: Alt+R → toggle MotionLogger (record ▶ / export-and-stop ⏹) ──
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return;
    const handler = (e: KeyboardEvent) => {
      if (e.altKey && e.key === 'r') {
        if (motionLogger.isRecording) {
          motionLogger.exportData();
        } else {
          motionLogger.startRecording();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <>
      {/* Stable wrapper: scale ~1.35; rotation.y default π (legacy teach) — useFrame sets group.rotation.y from avatarFacingRef (base VRM0≈π, VRM1≈0). */}
      {/* Fix 6: Initial position matches currentAvatarXRef/ZRef to prevent one-frame flicker. */}
      {/* V121: Render liftNode (contains vrm.scene) instead of vrm.scene directly. */}
      <group ref={groupRef} position={[AVATAR_DEFAULT_STAND_X, AVATAR_BASE_Y, AVATAR_DEFAULT_STAND_Z]} rotation={[0, Math.PI, 0]} scale={[1.35, 1.35, 1.35]}>
        {liftNodeRef.current && <primitive object={liftNodeRef.current} />}
      </group>
    </>
  );
}

// المكتب (Office GLB) أُزيل من المشهد — تبقى الغرفة (RoomShell) + الأفاتار فقط.

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

// ── NaturalScene — lives inside <Canvas> ─────────────────────────────────────
// Ultra-natural Scandinavian north-light setup.
// Calibrated for 8+ hour eye comfort, zero glare, perfect avatar readability.
interface NaturalSceneProps {
  toneMappingExposure: number;
  envIntensity:        number;
}

function CinematicScene({ toneMappingExposure, envIntensity }: NaturalSceneProps) {
  const { gl } = useThree();

  useEffect(() => {
    gl.toneMappingExposure = toneMappingExposure;
  }, [gl, toneMappingExposure]);

  return (
    <>
      {/* ── 1. Hemisphere — sky/ground fill, balanced with HDRI ─── */}
      <hemisphereLight args={['#C8D8FF', '#0A174E', 0.45]} />

      {/* ── 2. Key directional — casts dramatic shadows ──────────────── */}
      <directionalLight
        position={[6, 7, 3]}
        intensity={0.85}
        color="#FFEFD9"
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-near={0.5}
        shadow-camera-far={30}
        shadow-camera-left={-8}
        shadow-camera-right={8}
        shadow-camera-top={8}
        shadow-camera-bottom={-8}
        shadow-bias={-0.0005}
        shadow-normalBias={0.02}
      />

      {/* ── 3. Luxury warm spot — royal drama, strong shadows ─────────── */}
      <spotLight
        position={[5, 8, 4]}
        intensity={1.0}
        color="#FFEED8"
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        penumbra={0.4}
        angle={0.45}
        decay={1.5}
      />

      {/* ── 4. Soft fill from ceiling-left (north-light bounce) ─────── */}
      <directionalLight position={[-4, 5, -2]} intensity={0.18} color="#F0F4FB" castShadow={false} />

      {/* ── 5. Environment — removed; CDN fetch causes R3F concurrent-mode
           Suspense to defer the whole canvas. PBR ambient provided via
           the hemisphere + spotLight combo below instead.             ── */}

      {/* ── 6. Avatar warm ground wrap ──────────────────────────────── */}
      <pointLight position={[0, -0.6, 0]} intensity={0.35} distance={3.5} color="#FFF8F0" />
    </>
  );
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

// ── ExposureSync — keeps renderer toneMappingExposure in sync with Leva ────────
function ExposureSync({ exposure }: { exposure: number }) {
  const { gl } = useThree();
  useEffect(() => { gl.toneMappingExposure = exposure; }, [gl, exposure]);
  return null;
}

// ── Main component (pure VRM renderer — no WS hook, no HUD) ─────────────────
// HUD and WS state management live in AvatarAgentClient.tsx.
// This component only renders the R3F canvas and reacts to window avatar:* events.

export default function AvatarCanvas({
  vrmUrl = '/models/teach.vrm',
  fallbackVrmUrl: _fallbackVrmUrl,
}: {
  vrmUrl?: string;
  /** Optional fallback VRM path (reserved for future use). */
  fallbackVrmUrl?: string;
}) {
  // ── Canonical renderer lock: prevent double-mount ────────────────────────
  if (typeof window !== 'undefined') {
    const w = window as typeof window & { __AVATAR_CANONICAL__?: string };
    if (w.__AVATAR_CANONICAL__ && w.__AVATAR_CANONICAL__ !== 'AvatarCanvas') {
      if (process.env.NODE_ENV === 'development') {
        console.warn(
          '[Guard] Another avatar renderer is already mounted:',
          w.__AVATAR_CANONICAL__,
          '\u2014 AvatarCanvas will not mount.',
        );
      }
      return null as unknown as React.ReactElement;
    }
    w.__AVATAR_CANONICAL__ = 'AvatarCanvas';
  }

  const [loaded,    setLoaded]    = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // ── Leva: dev-only natural light controls ───────────────────────────────────
  const { toneMappingExposure, envIntensity } = useControls(
    'Natural Light',
    {
      toneMappingExposure: { value: 0.90, min: 0.3, max: 2.0, step: 0.01 },
      envIntensity:        { value: 0.65, min: 0.0, max: 3.0, step: 0.05 },
    },
  );

  const handleLoad = useCallback(() => {
    setLoaded(true);
    // Signal useAgentAgent to start the idle/greeting timer only now that the
    // avatar is visible — prevents greeting from firing while user is still
    // zooming into the scene.
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('avatar:scene:ready'));
      console.log('[AvatarCanvas] ✅ avatar:scene:ready dispatched');
    }
  }, []);
  const handleError = useCallback((err: string) => setLoadError(err), []);

  /** `?fixFeet=1` — lowerLeg/foot rotation clamp after VRMA (FeetFixer in VRMScene). */
  const fixFeetEnabled = useMemo(
    () =>
      typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).get('fixFeet') === '1',
    [],
  );
  /** `?pruneFeet=1` — strip foot/toe VRMA tracks at load (diagnostic). */
  const pruneFeetEnabled = useMemo(
    () =>
      typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).get('pruneFeet') === '1',
    [],
  );

  /** V55 — React copy of mutable `ROOM_BOUNDS` after carpet GLB world AABB is applied */
  const [playableBounds, setPlayableBounds] = useState<RoomBounds>(() => ({ ...ROOM_BOUNDS }));

  /** GROUND LOCK V2 — derivative clamp + reset fuse (see `frontend/src/engine/ground/GroundLock.ts`). */
  const groundLockApi = useMemo(() => createGroundLock(), []);
  const {
    groundLockedRef,
    firstFloorYRef,
    lastAppliedYRef,
    allowedResetsRef,
    resetsPerformedRef,
    tryApplyFloorY,
  } = groundLockApi;
  const groundLockQueryDoneRef = useRef(false);

  const applyAvatarGroundOffset = useCallback(
    (nextY: number) => {
      ROOM_BOUNDS.floorY = nextY;
      ROOM_BOUNDS.minX = ROOM_BOUNDS_DEFAULT.minX;
      ROOM_BOUNDS.maxX = ROOM_BOUNDS_DEFAULT.maxX;
      ROOM_BOUNDS.minZ = ROOM_BOUNDS_DEFAULT.minZ;
      ROOM_BOUNDS.maxZ = ROOM_BOUNDS_DEFAULT.maxZ;
      setPlayableBounds({ ...ROOM_BOUNDS });
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('room:bounds:applied'));
        if (!groundLockQueryDoneRef.current) {
          groundLockQueryDoneRef.current = true;
          try {
            if (new URLSearchParams(window.location.search).get('groundLock') === '1') {
              groundLockedRef.current = true;
            }
          } catch {
            /* ignore */
          }
        }
      }
    },
    [setPlayableBounds, groundLockedRef],
  );

  /** ── V56.1 — Legacy Carpet Redirect (HMR-safe) ───────────────────────────── */
  /**
   * Same rug walk extra as V56 — uses module-level {@link RUG_WALK_SURFACE_Y_EXTRA} (env snapshot).
   * Redefining it here would duplicate the identifier; keep a single source at module scope.
   */
  const legacyCarpetRedirect = useCallback(
    (box: THREE.Box3) => {
      if (!box || !box.max || (typeof box.isEmpty === 'function' && box.isEmpty())) return;
      const proposed = (box.max.y ?? 0) + RUG_WALK_SURFACE_Y_EXTRA;
      tryApplyFloorY(proposed, applyAvatarGroundOffset, { bypassGroundLock: true });
      if (process.env.NODE_ENV === 'development') {
        console.warn('[V56] Legacy applyCarpetFloorYFromWorldBox redirected to GroundLock');
      }
    },
    [tryApplyFloorY, applyAvatarGroundOffset],
  );

  /**
   * Some HMR snapshots may still reference the old name inside this module. Reserve the same identifier
   * so the binding resolves to GroundLock. Safe: nothing imports RoomShell's function here.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- intentional shim for stale HMR closures
  const applyCarpetFloorYFromWorldBox = legacyCarpetRedirect;

  /** V56 — after the settle timer applies carpet floor once, ignore all further `room:carpetBounds` events. */
  const carpetBoundsAppliedRef = useRef(false);
  const carpetSettleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Backdrop + carpet GLB use a fixed XZ footprint (ROOM_BOUNDS_DEFAULT) so carpet scale/position
   * does not depend on shrinking playable bounds — that caused a remount↔remeasure feedback loop (V55 logs).
   * Only floorY/ceilY track gameplay state for visuals.
   */
  const backdropLayoutBounds = useMemo(
    () => ({
      ...ROOM_BOUNDS_DEFAULT,
      floorY: playableBounds.floorY,
      ceilY: playableBounds.ceilY,
    }),
    [playableBounds.floorY, playableBounds.ceilY],
  );

  useEffect(() => {
    const applyLockedCarpetFloor = (box: THREE.Box3) => {
      if (!box || !box.max || (typeof box.isEmpty === 'function' && box.isEmpty())) return;
      if (carpetBoundsAppliedRef.current) return;

      const proposed = (box.max.y ?? 0) + RUG_WALK_SURFACE_Y_EXTRA;
      /** Order: `tryApplyFloorY` → `applyAvatarGroundOffset` → `ROOM_BOUNDS` + `setPlayableBounds` + `room:bounds:applied`. */
      tryApplyFloorY(proposed, applyAvatarGroundOffset, { bypassGroundLock: true });
      /**
       * V100 — foot–floor vs locked carpet: after floorY is applied (or GroundLock skips apply), force V52 foot
       * re-calibration so soles match **current** `ROOM_BOUNDS.floorY` + `NEXT_PUBLIC_RUG_WALK_SURFACE_Y_EXTRA`.
       * Does not clear `groundLockedRef` or break GroundLock.
       */
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('room:footRecalib'));
      }

      carpetBoundsAppliedRef.current = true;
      if (process.env.NODE_ENV === 'development') {
        console.info('%c[G2/V56] carpet → tryApplyFloorY + footRecalib (XZ = default room)', 'color:#4ade80;font-weight:bold', {
          proposed,
          ...ROOM_BOUNDS,
          groundLocked: groundLockedRef.current,
        });
      }
    };

    const onCarpet = (e: Event) => {
      if (carpetBoundsAppliedRef.current) {
        if (process.env.NODE_ENV === 'development') {
          console.debug('[V56] carpet bounds already locked — ignoring room:carpetBounds');
        }
        return;
      }
      const box = (e as CustomEvent<{ box: THREE.Box3 }>).detail?.box;
      if (!box || !box.max || (typeof box.isEmpty === 'function' && box.isEmpty())) return;

      if (carpetSettleTimerRef.current) {
        clearTimeout(carpetSettleTimerRef.current);
        carpetSettleTimerRef.current = null;
      }
      carpetSettleTimerRef.current = window.setTimeout(() => {
        carpetSettleTimerRef.current = null;
        applyLockedCarpetFloor(box);
      }, CARPET_FLOOR_SETTLE_MS);
    };

    window.addEventListener('room:carpetBounds', onCarpet);
    return () => {
      window.removeEventListener('room:carpetBounds', onCarpet);
      if (carpetSettleTimerRef.current) {
        clearTimeout(carpetSettleTimerRef.current);
        carpetSettleTimerRef.current = null;
      }
    };
  }, [applyAvatarGroundOffset, tryApplyFloorY, groundLockedRef]);

  useEffect(() => {
    if (typeof window === 'undefined' || process.env.NODE_ENV !== 'development') return;
    const w = window as typeof window & {
      __groundLockV2?: () => {
        groundLocked: boolean;
        firstFloorY: number | null;
        lastAppliedY: number | null;
        allowedResetsLeft: number;
        resetsPerformed: number;
      };
    };
    w.__groundLockV2 = () => ({
      groundLocked: groundLockedRef.current,
      firstFloorY: firstFloorYRef.current,
      lastAppliedY: lastAppliedYRef.current,
      allowedResetsLeft: allowedResetsRef.current,
      resetsPerformed: resetsPerformedRef.current,
    });
    return () => {
      delete w.__groundLockV2;
    };
  }, [groundLockedRef, firstFloorYRef, lastAppliedYRef, allowedResetsRef, resetsPerformedRef]);

  const standForCamera = useMemo(() => getDefaultStandXZ(playableBounds), [playableBounds]);
  const cameraPosZ = useMemo(() => getCameraPosZ(playableBounds), [playableBounds]);
  const orbitDistance = useMemo(() => getCameraOrbitDistance(playableBounds), [playableBounds]);

  // لا مكتب في المشهد — امسح أي مرجع قديم لـ desk collider (HMR / تنقل)
  useEffect(() => {
    clearDeskScene();
    return () => { clearDeskScene(); };
  }, []);

  // Dev-only console debug API (fires window events — no WS required)
  useEffect(() => {
    if (typeof window === 'undefined' || process.env.NODE_ENV !== 'development') return;
    const w = window as typeof window & { __avatarDebug?: unknown };
    w.__avatarDebug = {
      testEmotion:  (emotion = 'happy') =>
        window.dispatchEvent(new CustomEvent('avatar:emotion',  { detail: { emotion } })),
      testGesture:  (type = 'wave', side = 'right', duration = 2.5) =>
        window.dispatchEvent(new CustomEvent('avatar:gesture',  { detail: { type, side, duration } })),
      testMicroGesture: (type = 'shoulder_sigh') =>
        window.dispatchEvent(new CustomEvent('avatar:micro:gesture', { detail: { type } })),
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
      <div className="absolute top-2 left-2 z-20 rounded bg-red-900/80 px-2 py-1 text-[10px] text-yellow-200">
        EMERGENCY_REVERT v9
      </div>
      <div className="absolute top-8 left-2 z-20 rounded bg-black/70 px-2 py-1 text-[10px] text-cyan-300">
        VRM: {vrmUrl}
      </div>
      {!loaded && !loadError && (
        <div className={styles.loadingOverlay}>جاري تحميل الدكتور حمزة…</div>
      )}
      {loadError === 'allFailed' && (
        <div className="absolute inset-0 z-10">
          <SimpleAvatarPlaceholder />
        </div>
      )}
      {loadError && loadError !== 'allFailed' && (
        <div className={styles.errorOverlay}>⚠️ تعذّر تحميل الأفاتار</div>
      )}
      {/* Leva debug panel — dev only, hidden in production */}
      <Leva hidden={process.env.NODE_ENV !== 'development'} collapsed />
      <Canvas
        dpr={[1, 1.75]}
        shadows="soft"
        gl={{
          powerPreference: 'high-performance',
          antialias:       false,
          alpha:           false,
        }}
        onCreated={({ gl }) => {
          /* بيج دافئ يطابق حواف الصورة — يقلل الهوامش البيضاء */
          gl.setClearColor(0xe4dcd2, 1);
          gl.outputColorSpace     = THREE.SRGBColorSpace;
          gl.toneMapping          = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure  = 0.90;
        }}
        style={{ width: '100%', height: '100%', display: 'block' }}
      >
        <PerspectiveCamera
          makeDefault
          position={[0, playableBounds.floorY + CAMERA_OFFSET_Y, cameraPosZ]}
          fov={45}
          near={0.01}
          far={500}
          up={[0, 1, 0]}
        />
        <CameraUpLock />
        {/* ── Royal comfort lighting + exposure sync ──────────────── */}
        <ComfortLightingRig />
        <ExposureSync exposure={toneMappingExposure} />

        <Suspense fallback={null}>
          {/* خلفية المكتب + غلاف غرفة يدمجان الصورة مع المشهد */}
          <EduverseRoomBackdrop bounds={backdropLayoutBounds} groundLockedRef={groundLockedRef} />
          {/* شبكة أرضية بلون أرضية Eduverse (Cool Cyan-Grey) — خطوط منتصف داكنة + مربعات فاتحة */}
          {EDUVERSE_FLOOR_GRID_VISIBLE && EDUVERSE_FLOOR_MODE !== 'carpet_glb' && (
            <gridHelper
              args={[
                EDUVERSE_GRID_SIZE,
                EDUVERSE_GRID_DIVISIONS,
                EDUVERSE_GRID_COLOR_CENTER,
                EDUVERSE_GRID_COLOR_CELL,
              ]}
              position={[
                0,
                playableBounds.floorY + EDUVERSE_FLOOR_EPSILON_Y + EDUVERSE_GRID_Y_ABOVE_FLOOR,
                getRoomZCenter(playableBounds),
              ]}
              renderOrder={-2004}
            />
          )}
          <VRMScene
            vrmUrl={vrmUrl}
            onLoad={handleLoad}
            onError={handleError}
            groundLockedRef={groundLockedRef}
            fixFeet={fixFeetEnabled}
            pruneFeetTracks={pruneFeetEnabled}
          />
          {/* أرضية فقط — بدون جدران جانبية لرؤية أوضح للخلفية والمكتب */}
          <RoomShell
            width={playableBounds.maxX - playableBounds.minX}
            floorY={playableBounds.floorY}
            zNear={playableBounds.maxZ}
            zFar={playableBounds.minZ}
            height={playableBounds.ceilY - playableBounds.floorY}
            showFloor={false}
            showBackWall={false}
            showSideWalls={false}
          />
          {/* مكتب جديد من office_desk.glb — useGLTF + primitive (القديم يُزال من الـ VRM فقط) */}
          <OfficeDeskFromGltf
            floorY={playableBounds.floorY}
            zCenter={getRoomZCenter(playableBounds)}
            groundLockedRef={groundLockedRef}
          />
        </Suspense>

        {/* Soft contact shadows under avatar/furniture */}
        <ContactShadows
          position={[0, playableBounds.floorY + 0.012, standForCamera.z]}
          opacity={0.18}
          blur={2.2}
          far={6}
          resolution={512}
          frames={1}
        />

        <OrbitControls
          makeDefault
          target={[standForCamera.x, playableBounds.floorY + CAMERA_TARGET_OFFSET_Y, standForCamera.z]}
          minDistance={orbitDistance}
          maxDistance={orbitDistance}
          minPolarAngle={0.12}
          maxPolarAngle={Math.PI / 2 - 0.05}
          enableRotate={false}
          enablePan={false}
          enableZoom={false}
          enableDamping={false}
        />

        {/* PostFX after controls so camera matrix is final for this frame */}
        <EffectComposer multisampling={0} enableNormalPass>
          <SSAO intensity={0.22} radius={0.16} luminanceInfluence={0.28} />
        </EffectComposer>
      </Canvas>
    </div>
  );
}
