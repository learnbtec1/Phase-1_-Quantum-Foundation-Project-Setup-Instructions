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
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRM, VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { VRMAnimationLoaderPlugin, createVRMAnimationClip } from '@pixiv/three-vrm-animation';
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
} from '@/config/avatar';
import { breathSpineAmount, breathGroupBounce } from './proceduralLife';
import { RoomShell, ROOM_BOUNDS } from './scene/RoomShell';

/** مركز الغرفة على Z — محاذاة الشبكة مع أرضية Eduverse */
const ROOM_Z_CENTER = (ROOM_BOUNDS.maxZ + ROOM_BOUNDS.minZ) / 2;

/** كاميرا ثابتة: نفس البُعد بين min/max لـ OrbitControls + تعطيل الزوم بالسكرول */
const CAMERA_OFFSET_Y = 2.78;
const CAMERA_TARGET_OFFSET_Y = 1.55;
const CAMERA_POS_Z = ROOM_BOUNDS.maxZ + 3.2;
const CAMERA_ORBIT_DISTANCE = Math.hypot(
  CAMERA_OFFSET_Y - CAMERA_TARGET_OFFSET_Y,
  CAMERA_POS_Z - ROOM_Z_CENTER,
);

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
  initRapierWorld,
  pulseHandSeparationWindow,
  isHandSeparationPulseActive,
} from './physics/WorldColliders';

import { motionLogger, type BlendshapeSnapshot, type BoneSnapshot, type QuatTuple } from '@/utils/MotionLogger';
import { getStableWebSpeechVoice, ensureWebSpeechVoicesChangeHook } from '@/ai/io/webSpeechVoice';
import { createAvatarPerformanceHandler } from './avatarPerformanceBridge';

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

  return <primitive object={object} />;
}

/**
 * ثلاثة جدران بزوايا الغرفة: يسار / خلف (زجاج) / يمين — كل جدار يعرض شريحة من نفس الصورة.
 */
function EduverseRoomBackdrop() {
  const tex = useTexture(EDUVERSE_BG_URL);

  const roomW = ROOM_BOUNDS.maxX - ROOM_BOUNDS.minX;
  const roomH = ROOM_BOUNDS.ceilY - ROOM_BOUNDS.floorY;
  const wallHVis = Math.max(0.5, roomH - EDUVERSE_VERTICAL_SHRINK_M);
  const wallYVis = ROOM_BOUNDS.floorY + wallHVis / 2;
  /** نسبة قص UV من أسفل نسيج الجدران (تقريب: نصف متر من ارتفاع الغرفة) */
  const vCropWall = Math.min(0.45, EDUVERSE_VERTICAL_SHRINK_M / Math.max(0.01, roomH));
  const zLen = Math.abs(ROOM_BOUNDS.maxZ - ROOM_BOUNDS.minZ);
  const zCenter = (ROOM_BOUNDS.maxZ + ROOM_BOUNDS.minZ) / 2;
  const backZ = ROOM_BOUNDS.minZ + 0.08;
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
          position={[0, ROOM_BOUNDS.ceilY - 0.03, zCenter]}
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
          position={[ROOM_BOUNDS.minX + sideX, wallYVis, zCenter]}
          rotation={[0, Math.PI / 2, 0]}
          frustumCulled={false}
          renderOrder={-2000}
          material={matL}
        >
          <planeGeometry args={[zLen, wallHVis]} />
        </mesh>

        <mesh
          name="EduverseBackdropRight"
          position={[ROOM_BOUNDS.maxX - sideX, wallYVis, zCenter]}
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
          localY={ROOM_BOUNDS.floorY + EDUVERSE_FLOOR_EPSILON_Y - EDUVERSE_FULL_IMAGE_Y_LIFT_M}
        />
      ) : EDUVERSE_FLOOR_MODE === 'dedicated_file' ? (
        <EduverseParquetFloorPlane
          url={EDUVERSE_FLOOR_DEDICATED_URL}
          roomW={roomW}
          zLen={zLen}
          position={[0, ROOM_BOUNDS.floorY + EDUVERSE_FLOOR_EPSILON_Y - EDUVERSE_FULL_IMAGE_Y_LIFT_M, zCenter]}
        />
      ) : (
        <mesh
          name="EduverseFloor"
          position={[0, ROOM_BOUNDS.floorY + EDUVERSE_FLOOR_EPSILON_Y - EDUVERSE_FULL_IMAGE_Y_LIFT_M, zCenter]}
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
/** وقوف الأفاتار: وسط الغرفة على X، أمام المكتب نحو الكاميرا (+Z) */
const AVATAR_DEFAULT_STAND_X = 0;
const AVATAR_DEFAULT_STAND_Z = ROOM_Z_CENTER + 1.0;
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
function OfficeDeskFromGltf() {
  const { scene } = useGLTF(OFFICE_DESK_GLB_PATH) as { scene: THREE.Group };
  const { deskRoot, deskPosition } = useMemo(() => {
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
    root.rotation.set(OFFICE_DESK_ROTATION[0], OFFICE_DESK_ROTATION[1], OFFICE_DESK_ROTATION[2]);
    root.position.set(0, ROOM_BOUNDS.floorY, 0);
    root.updateMatrixWorld(true);
    const boxW = new THREE.Box3().setFromObject(root);
    const boxCenter = new THREE.Vector3();
    boxW.getCenter(boxCenter);
    const px = -boxCenter.x;
    const pz = ROOM_Z_CENTER - boxCenter.z - OFFICE_DESK_TOWARD_GLASS_M;
    root.rotation.set(0, 0, 0);
    root.position.set(0, 0, 0);

    if (process.env.NODE_ENV === 'development') {
      console.info(
        '[OfficeDeskFromGltf] scale',
        root.scale.x,
        root.scale.y,
        root.scale.z,
        'bbox hMax(x,z)',
        hMax,
        'targetLengthM',
        OFFICE_DESK_TARGET_LENGTH_M,
        'sizeBoost',
        OFFICE_DESK_SIZE_BOOST,
        'desk pos',
        px,
        pz,
        'chair extra',
        OFFICE_CHAIR_EXTRA_SCALE,
      );
    }
    return {
      deskRoot: root,
      deskPosition: [px, ROOM_BOUNDS.floorY, pz] as [number, number, number],
    };
  }, [scene]);

  useEffect(() => {
    setDeskScene(deskRoot);
    const raf = requestAnimationFrame(() => {
      computeChairAnchor();
    });
    return () => {
      cancelAnimationFrame(raf);
      clearDeskScene();
    };
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

// ── Constants ────────────────────────────────────────────────────────────────
/** ارتفاع وقوف الأفاتار على الأرض المنطقية (يتبع ROOM_BOUNDS.floorY) */
const AVATAR_BASE_Y = ROOM_BOUNDS.floorY;
const WAVE_DURATION = 3.5;   // seconds — greeting wave on load
/** Tab background → rAF throttling: unclamped delta can be seconds (neck/gaze lerp explodes). */
const TAB_SAFE_MAX_DELTA = 0.1;

// ── Chair anchor (seated mode — same X/Z as desk workflow) ──────────────────
const PERMA_CHAIR_X = AVATAR_DEFAULT_STAND_X;
const PERMA_CHAIR_Z = AVATAR_DEFAULT_STAND_Z;

// ── Organic noise engine — true simplex noise (replaces fake sine-hash perlinNoise) ──────
// createNoise3D() produces band-limited, non-repeating organic values in [-1, 1].
// Using a single persistent instance keeps the noise field coherent across frames.
const _noise3D = createNoise3D();

// ── Auto-patrol waypoints — حلقة صغيرة حول موضع الوقوف الافتراضي
const PATROL_WAYPOINTS: [number, number][] = [
  [-1.2, AVATAR_DEFAULT_STAND_Z - 0.35],
  [ 1.2, AVATAR_DEFAULT_STAND_Z - 0.35],
  [ 1.2, AVATAR_DEFAULT_STAND_Z + 0.35],
  [-1.2, AVATAR_DEFAULT_STAND_Z + 0.35],
];

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
  // 🔥 TRACER BULLET — confirms this file/version is the one being executed
  if (typeof window !== 'undefined' && !(window as typeof window & { __TRACER_LOGGED__?: boolean }).__TRACER_LOGGED__) {
    (window as typeof window & { __TRACER_LOGGED__?: boolean }).__TRACER_LOGGED__ = true;
    console.log('🔥 [SYSTEM] NEW SOVEREIGN CANVAS LOADED — F3 CLAMPING ACTIVE (±0.3 neck, ±0.45 head)');
  }

  const [vrm, setVrm]     = useState<VRM | null>(null);
  const vrmRef            = useRef<VRM | null>(null);
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
  const vrmaClipDoneRef = useRef(false);
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
    yOffset:         { value: ROOM_BOUNDS.floorY, min: -4, max: 0.5, step: 0.01 },
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

  const { pointer, camera, gl } = useThree();

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
      loader.register((parser: unknown) => new VRMLoaderPlugin(parser as never));
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

        // Detect VRM version — meta.metaVersion is '0' for VRM0 and '1' for VRM1
        const vrmMeta    = (model as unknown as { meta?: { metaVersion?: string } }).meta;
        const isVRM1     = vrmMeta?.metaVersion === '1';
        console.log(`[AvatarCanvas] VRM version: ${isVRM1 ? '1.0' : '0.x'} | model: ${urlToTry}`);

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
        setVrm(model);   // triggers re-render → <primitive> appears
        onLoad();
        // Capture T-pose hips bind position BEFORE any VRMA plays.
        // This is the ground truth for "standing hip height" — used in §8
        // to restore correct standing posture without sinking the skeleton.
        if (model.humanoid) {
          const hB = model.humanoid.getRawBoneNode('hips' as never);
          if (hB) hipsBindPosRef.current = hB.position.clone();
        }

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
                strictPurgeDeskLikeMeshes(gltf.scene);
                const anims: VRMAnimation[] = gltf.userData.vrmAnimations ?? [];
                if (anims[0]) {
                  const clip   = createVRMAnimationClip(anims[0], model);
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

          // ── Gesture clip-done tracker ──────────────────────────────────────
          // When a non-looping VRMA gesture clip (ack, beckon, clap, …) finishes,
          // mark vrmaClipDoneRef = true. §8 uses this to FREE the arm bones for
          // procedural writes while the avatar stays in STANDING mode for the full
          // gesture window tail after clip end (mixer) + main window uses dur + 500ms. Two concerns:
          //   1. "Arm paralysis" — clips freeze at last frame after ~1.5s
          //   2. "Standing duration" — avatar should remain standing for ~4–5s
          // With vrmaClipDoneRef: arms animate naturally after clip ends, avatar
          // stays standing until the full window expires, then gracefully sits back.
          mixer.addEventListener('finished', () => {
            // Clip ended — allow §8 procedural arms again. Do NOT shrink
            // vrmaGestureUntilRef (that aborted the standing gesture tail early).
            vrmaClipDoneRef.current = true;
          });
        }).catch(() => {});
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
      console.warn = origWarn;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vrmUrl]);

  useEffect(() => {
    const onPerformance = createAvatarPerformanceHandler(() => vrmRef.current, setEM);

    const onGesture = (e: Event) => {
      const d = (e as CustomEvent).detail as { type?: string; side?: string; duration?: number };
      if (!d?.type) return;
      const now = Date.now();
      // Gesture variety: if same gesture fires within 4s, swap to alternate
      let gType = d.type;
      if (gType === 'thumbUp' || gType === 'pointIndex') {
        gType = 'point';
      }
      if (gType === lastGestureTypeRef.current && now - lastGestureTimeRef.current < 4000) {
        const alts: Record<string, string> = { point: 'openHand', openHand: 'beat', beat: 'point' };
        gType = alts[gType] ?? gType;
        console.log(`[BRAIN] Gesture variety swap: ${d.type} → ${gType}`);
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

      const dur = (d.duration ?? 2.5) * 1000;
      const restoreAfterGesture = () => {
        if (isSittingRef.current) {
          playVRMA(isTalkingRef.current ? 'sitTalk' : 'sit', true, 0.45);
        } else {
          playVRMA(`idle${idleIdxRef.current}`, true, 0.45);
        }
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
            : gType === 'think' || gType === 'peace'
              ? 'openHand'
              : 'openHand';
        gestureRef.current = {
          type: seatedType as 'point' | 'openHand' | 'beat',
          side: (d.side ?? 'right') as 'left' | 'right' | 'both',
          startMs: Date.now(),
          durationMs: dur,
        };
        setTimeout(() => {
          if (isSittingRef.current) playVRMA(isTalkingRef.current ? 'sitTalk' : 'sit', true, 0.35);
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
      } else if (gType === 'point' || gType === 'openHand' || gType === 'beat') {
        if (vrmaReadyRef.current) {
          if (gType === 'point') pulseHandSeparationWindow(HAND_SEPARATION_PULSE_MS);
          const vrmaGesture: Record<string, string> = { point: 'point', openHand: 'beckon', beat: 'ack' };
          const vrmaKey3  = vrmaGesture[gType] ?? 'ack';
          const clipMs3   = getClipDurMs(vrmaKey3);
          vrmaClipDoneRef.current = false;
          playVRMA(vrmaKey3, false, 0.3);
          vrmaGestureUntilRef.current = Date.now() + dur + 500;    // full standing window (4–5s)
          setTimeout(restoreAfterGesture, Math.max(clipMs3, dur) + 400);
        } else {
          gestureRef.current = {
            type:       gType as 'point' | 'openHand' | 'beat',
            side:       (d.side ?? 'right') as 'left' | 'right' | 'both',
            startMs:    Date.now(),
            durationMs: dur,
          };
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
      if (isSittingRef.current && vrmaReadyRef.current) {
        playVRMA('sitTalk', true, 0.35);
        console.log('[BRAIN] avatar:speak:start — seated speaking active');
      }
      console.log('[BRAIN] avatar:speak:start — lip-sync active');
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
      if (isSittingRef.current && vrmaReadyRef.current && !gestureStillLive) {
        playVRMA('sit', true, 0.4);
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
      const forwardDistance = Math.max(0.15, d?.distance ?? WALK_DEFAULT_DISTANCE_METERS);
      const angle =
        groupRef.current?.rotation.y ??
        avatarFacingRef.current ??
        Math.PI;
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
        isSittingRef.current = true;
        headPitchRef.current  = -0.05;
        headUntilRef.current  = Date.now() + 60_000;
        spineBreathRef.current = 0.10;
        playVRMA(isTalkingRef.current ? 'sitTalk' : 'sit', true, 0.5);
        console.log('[BRAIN] avatar:sit — seated (explicit)');
        return;
      }
      isSittingRef.current = false;
      headPitchRef.current = 0;
      spineBreathRef.current = 0;
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
      if (process.env.NODE_ENV !== 'development') return;
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
      // Clamp click target inside room bounds
      targetAvatarXRef.current = Math.max(ROOM_BOUNDS.minX + 0.3, Math.min(ROOM_BOUNDS.maxX - 0.3, hit.x));
      targetAvatarZRef.current = Math.max(ROOM_BOUNDS.minZ + 0.3, Math.min(ROOM_BOUNDS.maxZ - 0.3, hit.z));
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

  useFrame((state, delta) => {
    const v     = vrmRef.current;
    const group = groupRef.current;
    if (!group) return;

    const safeDelta = Math.min(Math.max(delta, 0), TAB_SAFE_MAX_DELTA);

    const t   = state.clock.elapsedTime;
    const now = Date.now();

    // 🔥 TRACER BULLET — fires once to confirm useFrame is running
    if (t < 0.1) console.log('🔥 [SYSTEM] USE-FRAME IS ALIVE — t=', t.toFixed(4), 'vrm=', !!v);

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

    const isSittingNow = isSittingRef.current;
    const isSittingEffective = isSittingNow;

    // V30 — procedural life continues during VRMA gestures (reduced amplitude)
    const vrmaGPlaying =
      vrmaReadyRef.current
      && !isWalkingNow
      && now < vrmaGestureUntilRef.current
      && !vrmaClipDoneRef.current;
    const procLifeDamp = vrmaGPlaying ? PROC_LIFE_DURING_VRMA_GESTURE : 1;

    // 1. Idle body sway (group-level micro-rock)
    const idleBodyTarget = _noise3D(t * 0.1, 0, 0) * 0.020 * procLifeDamp;
    idleBodyOffsetRef.current = lerp(idleBodyOffsetRef.current, idleBodyTarget, 0.08);

    // V20 — pelvic roll driver only (no horizontal root translation — avoids foot slide)
    lifeHipTiltZRef.current = lerp(
      lifeHipTiltZRef.current,
      (Math.sin(t * 0.6 + 1) * 0.012 + Math.sin(t * 0.42) * 0.008) * (isSittingNow ? 0.55 : 1) * procLifeDamp,
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
    const standTargetY = isSittingNow ? sitYWorld : yOffset;
    const yMicro = walkBounce + laughShake + idleBodyOffsetRef.current;
    const breathBounceY = breathGroupBounce(t, isSittingNow) * procLifeDamp;

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
      group.position.y = standTargetY + yMicro + breathBounceY;
    } else {
      group.position.set(
        PERMA_CHAIR_X,
        standTargetY + yMicro + breathBounceY,
        PERMA_CHAIR_Z,
      );
    }

    const pw = physicsWorldRef.current;
    if (pw && v) {
      resolveIfEnabled(pw, v, undefined, group, safeDelta);
    } else if (!isSittingNow) {
      resolveIfEnabled(group.position, PHYSICS_CONFIG.avatar.capsuleRadius);
    }

    // ── Avatar facing rotation — body turns to face direction of travel ─────
    // Math.PI base = face-camera default (teach.vrm is VRM 0.x, native -Z flipped by Math.PI).
    // targetFacing = Math.PI + atan2(dx, dz) → correct world-space facing.
    // lerpAngle handles ±π wrap so there is no 360° spin on direction changes.
    {
      const dx = targetAvatarXRef.current - currentAvatarXRef.current;
      const dz = targetAvatarZRef.current - currentAvatarZRef.current;
      const moveDist = Math.hypot(dx, dz);
      const mouseBodyTarget = Math.PI + pointer.x * 0.35; // ±20° yaw at screen edge
      const targetFacing = (isWalkingNow && moveDist > 0.05 && phase !== 'speaking')
        ? Math.PI + Math.atan2(dx, dz)  // walk → face travel direction
        : phase === 'speaking' ? Math.PI // speaking → direct camera
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
      const wp = PATROL_WAYPOINTS[patrolIdxRef.current];
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
          patrolIdxRef.current = (patrolIdxRef.current + 1) % PATROL_WAYPOINTS.length;
        }
      }
    }

    if (!v) return;

    // ── VRMA mixer update — pace ↔ idle switching ─────────────────────────
    if (mixerRef.current) {
      // Switch to Walking.vrma when patrol is active
      if (vrmaReadyRef.current && isWalkingNow && activeVrmaRef.current !== 'walk') {
        playVRMA('walk', true, 0.3);
      }
      mixerRef.current.update(safeDelta);
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
        && now >= idleNextRef.current && activeVrmaRef.current !== 'stopWalk') {
      idleIdxRef.current  = (idleIdxRef.current + 1) % 4;
      idleNextRef.current = now
        + IDLE_VRMA_MIN_MS
        + Math.random() * (IDLE_VRMA_MAX_MS - IDLE_VRMA_MIN_MS);
      playVRMA(`idle${idleIdxRef.current}`, true, 0.8);
    }

    // Seated idle — same 10–15 s cadence; alternate sit ↔ sitTalk
    if (!isWalkingNow && isSittingRef.current && vrmaReadyRef.current
        && now >= idleNextRef.current && !isTalkingRef.current && !isTranscribingRef.current
        && activeVrmaRef.current !== 'stopWalk') {
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
      const vrmaBusy = vrmaGPlaying;
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
      const hipTarget = _noise3D(t * 0.25, 5, 0) * 0.024 * hipScale * sitMul * procLifeDamp;
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
      const spineBreathTarget = breathSpineAmount(t, isSittingNow, phaseBreathScale) * procLifeDamp;
      spineBreathRef.current = lerp(spineBreathRef.current, spineBreathTarget, safeDelta * 2);

      const spineBone  = v.humanoid.getRawBoneNode('spine'   as never);
      const spine1Bone = v.humanoid.getRawBoneNode('spine1'  as never);
      const spine2Bone = v.humanoid.getRawBoneNode('upperChest' as never)
                      ?? v.humanoid.getRawBoneNode('chest'   as never);
      const spine2Mid  = v.humanoid.getRawBoneNode('spine2'  as never);

      if (spineBone) {
        // Breathing + nod: strict local X (pitch — chest forward/back). Y/Z only for gaze/roll share (no lateral “pendulum” on X)
        const breathPitch =
          spineBreathRef.current * 0.35 * phaseBreathScale + nodArc * 0.10;
        const spineGazeYaw = neckGazeYawRef.current * (isSittingNow ? 0.10 : 0.12);
        const spineRoll    = headRollRef.current * 0.022;
        _scratchEuler.set(breathPitch, spineGazeYaw, spineRoll, 'XYZ');
        _scratchQuat.setFromEuler(_scratchEuler);
        if (vrmaLive) {
          spineBone.quaternion.multiply(_scratchQuat);
        } else {
          spineBone.quaternion.slerp(_scratchQuat, 0.18);
        }
      }
      if (spine2Bone) {
        _scratchEuler2.set(spineBreathRef.current * 0.20 * phaseBreathScale, 0, 0, 'XYZ');
        _scratchQuat2.setFromEuler(_scratchEuler2);
        if (vrmaLive) spine2Bone.quaternion.multiply(_scratchQuat2);
        else          spine2Bone.quaternion.slerp(_scratchQuat2, 0.15);
        // Upper chest: extra inhale/exhale on local X only (axis-angle — no Y/Z wobble)
        const chestSit = isSittingNow ? 0.5 : 1;
        _scratchQuat3.setFromAxisAngle(
          _V_AXIS_X,
          Math.sin(t * 1.5) * 0.015 * procLifeDamp * chestSit,
        );
        if (vrmaLive) spine2Bone.quaternion.multiply(_scratchQuat3);
        else          spine2Bone.quaternion.multiply(_scratchQuat3);
      }
      const bChain = spineBreathRef.current * 0.11 * phaseBreathScale;
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
    if (v.humanoid) {
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
        _scratchEuler.set(safePitch + nodB * 0.12, safeYaw, neckSwayZ, 'YXZ');
        _scratchQuat.setFromEuler(_scratchEuler);
        neckBone.quaternion.slerp(_scratchQuat, 0.3);
      }
    }

    // §7 Head-pose lerp — phase-aware pitch bias added to idle baseline so the avatar
    // reads as: listening → slight forward lean, thinking → slight upward gaze.
    if (v.humanoid) {
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
            headPitchSmoothRef.current,
            headYawSmoothRef.current,
            headRollSmoothRef.current,
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
      // Micro pelvic roll (local Z) — weight shift without translating hips.position (feet stay planted)
      const pelvicRollStand = Math.sin(t * 0.5) * 0.005 * procLifeDamp;

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
        const rha = humanoid.getRawBoneNode('rightHand'     as never);
        if (rua) rua.rotation.set(-0.9,  0.2, waveAng,           'XYZ');
        if (rla) rla.rotation.set(-0.7,  0,   waveAng * 1.2,     'XYZ');
        if (rha) rha.rotation.set( 0.05, 0,   waveAng * 0.35,    'XYZ');
        const lua = humanoid.getRawBoneNode('leftUpperArm' as never);
        const lla = humanoid.getRawBoneNode('leftLowerArm' as never);
        if (lua) lua.rotation.set(0, 0,  1.3, 'XYZ');
        if (lla) lla.rotation.set(0.06, 0, 0, 'XYZ');
        // LEGS: always straight during wave — this branch never reaches the `else` block
        if (!isSittingEffective) {
          const rul = humanoid.getRawBoneNode('rightUpperLeg' as never);
          const lul = humanoid.getRawBoneNode('leftUpperLeg'  as never);
          const rll = humanoid.getRawBoneNode('rightLowerLeg' as never);
          const lll = humanoid.getRawBoneNode('leftLowerLeg'  as never);
          const hB  = humanoid.getRawBoneNode('hips'          as never);
          if (rul) rul.rotation.set(0, 0, 0, 'XYZ');
          if (lul) lul.rotation.set(0, 0, 0, 'XYZ');
          if (rll) rll.rotation.set(0, 0, 0, 'XYZ');
          if (lll) lll.rotation.set(0, 0, 0, 'XYZ');
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
          const ua   = humanoid.getRawBoneNode(`${prefix}UpperArm` as never);
          const la   = humanoid.getRawBoneNode(`${prefix}LowerArm` as never);
          const ha   = humanoid.getRawBoneNode(`${prefix}Hand`     as never);
          // Lap rest offsets so gesture lifts from seated position rather than T-pose
          const lapUAx = isSittingNow ? -0.15 : 0;
          const lapUAz = isSittingNow ? (dir < 0 ?  1.1 : -1.1) : 0;
          const lapLAx = isSittingNow ? 0.5  : 0;
          if (gType === 'point') {
            if (ua) ua.rotation.set(lapUAx - 0.55 * curve * sitScale, 0,  lapUAz + dir * 0.1 * curve * sitScale, 'YXZ');
            if (la) la.rotation.set(lapLAx - 0.35 * curve * sitScale, 0, 0, 'YXZ');
            if (ha) ha.rotation.set(0, dir * 0.08 * curve * sitScale, 0, 'YXZ');
            const idxP = humanoid.getRawBoneNode(`${prefix}IndexProximal` as never);
            const idxI = humanoid.getRawBoneNode(`${prefix}IndexIntermediate` as never);
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
          const rul = humanoid.getRawBoneNode('rightUpperLeg' as never);
          const lul = humanoid.getRawBoneNode('leftUpperLeg'  as never);
          const rll = humanoid.getRawBoneNode('rightLowerLeg' as never);
          const lll = humanoid.getRawBoneNode('leftLowerLeg'  as never);
          if (isSittingEffective) {
            if (rul) rul.rotation.set( 1.57, 0,  0.04, 'XYZ');
            if (lul) lul.rotation.set( 1.57, 0, -0.04, 'XYZ');
            if (rll) rll.rotation.set(-1.57, 0,  0,    'XYZ');
            if (lll) lll.rotation.set(-1.57, 0,  0,    'XYZ');
          } else {
            if (rul) rul.rotation.set(0, 0, 0, 'XYZ');
            if (lul) lul.rotation.set(0, 0, 0, 'XYZ');
            if (rll) rll.rotation.set(0, 0, 0, 'XYZ');
            if (lll) lll.rotation.set(0, 0, 0, 'XYZ');
            // Full hips reset — restore T-pose bind position + clear pelvic tilt
            const hG = humanoid.getRawBoneNode('hips' as never);
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
        const rua = humanoid.getRawBoneNode('rightUpperArm' as never);
        const lua = humanoid.getRawBoneNode('leftUpperArm'  as never);
        const rla = humanoid.getRawBoneNode('rightLowerArm' as never);
        const lla = humanoid.getRawBoneNode('leftLowerArm'  as never);
        const rul = humanoid.getRawBoneNode('rightUpperLeg' as never);
        const lul = humanoid.getRawBoneNode('leftUpperLeg'  as never);
        const rll = humanoid.getRawBoneNode('rightLowerLeg' as never);
        const lll = humanoid.getRawBoneNode('leftLowerLeg'  as never);
        if (rua) rua.rotation.set( armSwing, 0, -1.1, 'XYZ');
        if (lua) lua.rotation.set(-armSwing, 0,  1.1, 'XYZ');
        if (rla) rla.rotation.set(0.12, 0, 0, 'XYZ');
        if (lla) lla.rotation.set(0.12, 0, 0, 'XYZ');
        if (!vrmaWalkLower) {
          if (rul) rul.rotation.set(-legSwing, 0, 0, 'XYZ');
          if (lul) lul.rotation.set( legSwing, 0, 0, 'XYZ');
          if (rll) rll.rotation.set(-rightKnee, 0, 0, 'XYZ');
          if (lll) lll.rotation.set(-leftKnee,  0, 0, 'XYZ');
          const rf  = humanoid.getRawBoneNode('rightFoot' as never);
          const lf  = humanoid.getRawBoneNode('leftFoot'  as never);
          if (rf) rf.rotation.set( rightKnee * 0.4, 0, 0, 'XYZ');
          if (lf) lf.rotation.set( leftKnee  * 0.4, 0, 0, 'XYZ');
        }

        if (process.env.NODE_ENV === 'development' && t - _lastWalkProcLogT > 0.25) {
          _lastWalkProcLogT = t;
          console.log('[WALK] walkCycle=', walkCycle.toFixed(3), 'vrmaWalkLower=', vrmaWalkLower);
        }

      } else if (isLaughingNow) {
        // vrmaGestureNow: a gesture VRMA clip is actively PLAYING (clip done = §8 takes over)
        const vrmaGestureNow = (now < vrmaGestureUntilRef.current) && !vrmaClipDoneRef.current;
        if (!vrmaGestureNow) {
          const rua = humanoid.getRawBoneNode('rightUpperArm' as never);
          const lua = humanoid.getRawBoneNode('leftUpperArm'  as never);
          const rla = humanoid.getRawBoneNode('rightLowerArm' as never);
          const lla = humanoid.getRawBoneNode('leftLowerArm'  as never);
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
          const rul = humanoid.getRawBoneNode('rightUpperLeg' as never);
          const lul = humanoid.getRawBoneNode('leftUpperLeg'  as never);
          const rll = humanoid.getRawBoneNode('rightLowerLeg' as never);
          const lll = humanoid.getRawBoneNode('leftLowerLeg'  as never);
          if (isSittingEffective) {
            if (rul) rul.rotation.set( 1.57, 0,  0.04, 'XYZ');
            if (lul) lul.rotation.set( 1.57, 0, -0.04, 'XYZ');
            if (rll) rll.rotation.set(-1.57, 0,  0,    'XYZ');
            if (lll) lll.rotation.set(-1.57, 0,  0,    'XYZ');
          } else {
            if (rul) rul.rotation.set(0, 0, 0, 'XYZ');
            if (lul) lul.rotation.set(0, 0, 0, 'XYZ');
            if (rll) rll.rotation.set(0, 0, 0, 'XYZ');
            if (lll) lll.rotation.set(0, 0, 0, 'XYZ');
          }
        }

      } else {
        // ── Natural idle OR sitting ──
        // vrmaGestureNow: true while gesture VRMA clip is actively PLAYING.
        // Once the clip finishes (vrmaClipDoneRef=true), §8 takes over arms even if
        // the gesture WINDOW (vrmaGestureUntilRef) is still open for the standing pose.
        // This decouples "arm override" (clip playing) from "standing duration" (window).
        const vrmaGestureNow = (now < vrmaGestureUntilRef.current) && !vrmaClipDoneRef.current;
        const sway    = Math.sin(t * 0.4) * 0.04 + Math.sin(t * 0.27 + 1.1) * 0.025
                      + _noise3D(t * 0.13, 7, 0) * 0.009;
        const breathZ = spineBreathRef.current * 0.15;
        const rua  = humanoid.getRawBoneNode('rightUpperArm' as never);
        const lua  = humanoid.getRawBoneNode('leftUpperArm'  as never);
        const rla  = humanoid.getRawBoneNode('rightLowerArm' as never);
        const lla  = humanoid.getRawBoneNode('leftLowerArm'  as never);
        const rul  = humanoid.getRawBoneNode('rightUpperLeg' as never);
        const lul  = humanoid.getRawBoneNode('leftUpperLeg'  as never);
        const rll  = humanoid.getRawBoneNode('rightLowerLeg' as never);
        const lll  = humanoid.getRawBoneNode('leftLowerLeg'  as never);

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
          const hipsBoneS = humanoid.getRawBoneNode('hips' as never);
          if (hipsBoneS && hipsBindPosRef.current) {
            const bp = hipsBindPosRef.current;
            hipsBoneS.position.set(bp.x, hipsBoneS.position.y, bp.z);
          }
          // ── Sitting pose calibrated for teach.vrm (VRM 0.x, group.rotation.y = Math.PI) ──
          // Legs/feet are always clamped in perma-sit mode (even during gestures).
          if (rul) rul.rotation.set( 1.57, 0,  0.04, 'XYZ');
          if (lul) lul.rotation.set( 1.57, 0, -0.04, 'XYZ');
          if (rll) rll.rotation.set(-1.57, 0,  0,    'XYZ');
          if (lll) lll.rotation.set(-1.57, 0,  0,    'XYZ');
          // Feet: with lower leg vertical, ankle should be neutral (0) so sole faces floor.
          // Slight plantar flexion (0.12) looks natural in resting seated pose.
          const rf  = humanoid.getRawBoneNode('rightFoot' as never);
          const lf  = humanoid.getRawBoneNode('leftFoot'  as never);
          const rto = humanoid.getRawBoneNode('rightToes' as never);
          const lto = humanoid.getRawBoneNode('leftToes'  as never);
          if (rf)  rf.rotation.set( 0.12, 0, 0, 'XYZ');
          if (lf)  lf.rotation.set( 0.12, 0, 0, 'XYZ');
          if (rto) rto.rotation.set(0,    0, 0, 'XYZ');
          if (lto) lto.rotation.set(0,    0, 0, 'XYZ');
          if (!vrmaGestureNow) {
            // Arms on lap
            const lapSway    = Math.sin(t * 0.35) * 0.013 + Math.sin(t * 0.21 + 1.3) * 0.008;
            const lapBreathZ = spineBreathRef.current * 0.12;
            const shDropS = lifeShoulderDropSideRef.current === 'right' ? SHOULDER_DROP_RAD * 0.45 : -SHOULDER_DROP_RAD * 0.45;
            if (rua) rua.rotation.set(-0.15 + lapSway * 0.4, 0.08,  -1.1 + lapBreathZ + shDropS, 'XYZ');
            if (lua) lua.rotation.set(-0.15 - lapSway * 0.4, -0.08,  1.1 - lapBreathZ - shDropS, 'XYZ');
            if (rla) rla.rotation.set( 0.5  + lapSway * 0.3, 0, 0, 'XYZ');
            if (lla) lla.rotation.set( 0.5  - lapSway * 0.3, 0, 0, 'XYZ');
            // Wrists: relax slightly inward to match lap arm angle
            const rha = humanoid.getRawBoneNode('rightHand' as never);
            const lha = humanoid.getRawBoneNode('leftHand'  as never);
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
          if (rul) rul.rotation.set(0, 0, 0, 'XYZ');
          if (lul) lul.rotation.set(0, 0, 0, 'XYZ');
          if (rll) rll.rotation.set(0, 0, 0, 'XYZ');
          if (lll) lll.rotation.set(0, 0, 0, 'XYZ');
          // ── Hips full T-pose reset ───────────────────────────────────────────
          // sit.vrma drives TWO things on the hips bone:
          //   1. position (root motion) — lowers hips ~0.3 m from T-pose bind height
          //   2. quaternion            — tilts pelvis forward (sitting lean)
          // CRITICAL: T-pose hips.y for teach.vrm ≈ 0.9m (NOT 0!). Setting y=0
          // would sink the skeleton BELOW the floor. We restore to the saved bind
          // position captured right after VRM load (hipsBindPosRef).
          // Spine bones are NOT touched here — §1-A (breathing) is additive on spine
          // and runs before v.update(); resetting spine in §8 would kill breathing.
          const hipsBone = humanoid.getRawBoneNode('hips' as never);
          if (hipsBone) {
            const bp = hipsBindPosRef.current;
            if (bp) hipsBone.position.copy(bp);
            else
              hipsBone.position.set(0, hipsBone.position.y, 0);
            // Euler Z = V20 tilt + microscopic weight roll (no hips.position.x slide)
            hipsBone.rotation.set(0, 0, lifeHipTiltZRef.current + pelvicRollStand, 'XYZ');
          }
          // Feet: neutral + V20 idle yaw wiggle (standing only, non-gesture)
          const rf  = humanoid.getRawBoneNode('rightFoot' as never);
          const lf  = humanoid.getRawBoneNode('leftFoot'  as never);
          const rto = humanoid.getRawBoneNode('rightToes' as never);
          const lto = humanoid.getRawBoneNode('leftToes'  as never);
          const ftYaw = Math.sin(t * 0.33) * FOOT_IDLE_YAW_RAD;
          if (rf)  rf.rotation.set(0, ftYaw, 0, 'XYZ');
          if (lf)  lf.rotation.set(0, -ftYaw * 0.92, 0, 'XYZ');
          if (rto) rto.rotation.set(0, 0, 0, 'XYZ');
          if (lto) lto.rotation.set(0, 0, 0, 'XYZ');
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
            const rha = humanoid.getRawBoneNode('rightHand' as never);
            const lha = humanoid.getRawBoneNode('leftHand'  as never);
            if (rha) rha.rotation.set(0, 0, 0, 'XYZ');
            if (lha) lha.rotation.set(0, 0, 0, 'XYZ');
          }
        }
      }

      // V20 — wrist separation: clap/cheer get stronger spread; any VRMA gesture gets light repulsion if hands clip
      if (now < vrmaGestureUntilRef.current && !isSittingEffective) {
        const isClapFamily = activeVrmaRef.current === 'clap' || activeVrmaRef.current === 'cheer';
        const pulseBoost = isClapFamily && isHandSeparationPulseActive() ? 1.48 : isClapFamily ? 1 : 0.62;
        const spread = (0.13 + Math.sin(t * 14) * 0.048) * pulseBoost;
        const ruaC = humanoid.getRawBoneNode('rightUpperArm' as never);
        const luaC = humanoid.getRawBoneNode('leftUpperArm' as never);
        _scratchEuler.set(0, 0, -spread, 'XYZ');
        _scratchQuat.setFromEuler(_scratchEuler);
        if (ruaC) ruaC.quaternion.multiply(_scratchQuat);
        _scratchEuler.set(0, 0, spread, 'XYZ');
        _scratchQuat.setFromEuler(_scratchEuler);
        if (luaC) luaC.quaternion.multiply(_scratchQuat);
        if (v.scene) {
          v.scene.updateMatrixWorld(true);
          const rhW = humanoid.getRawBoneNode('rightHand' as never);
          const lhW = humanoid.getRawBoneNode('leftHand' as never);
          const ruaW = humanoid.getRawBoneNode('rightUpperArm' as never);
          const luaW = humanoid.getRawBoneNode('leftUpperArm' as never);
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
      {
        const vrmaArmsBusy = (now < vrmaGestureUntilRef.current) && !vrmaClipDoneRef.current;
        if (
          vrmaArmsBusy
          && !isSittingEffective
          && !isWalkingNow
          && !isLaughingNow
          && !hasGesture
          && !isWaving
        ) {
          const res =
            (Math.sin(t * 0.42) * 0.024 + _noise3D(t * 0.17, 44, 0) * 0.009)
            * PROC_LIFE_DURING_VRMA_GESTURE;
          const ruaR = humanoid.getRawBoneNode('rightUpperArm' as never);
          const luaR = humanoid.getRawBoneNode('leftUpperArm' as never);
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
          const idxP = humanoid.getRawBoneNode('rightIndexProximal' as never);
          const idxI = humanoid.getRawBoneNode('rightIndexIntermediate' as never);
          const idxD = humanoid.getRawBoneNode('rightIndexDistal' as never);
          const thP  = humanoid.getRawBoneNode('rightThumbProximal' as never);
          if (idxP) idxP.rotation.z = idxP.rotation.z + dir * 0.38 * pb;
          if (idxI) idxI.rotation.z = idxI.rotation.z + dir * 0.26 * pb;
          if (idxD) idxD.rotation.z = idxD.rotation.z + dir * 0.12 * pb;
          if (thP)  thP.rotation.y  = thP.rotation.y  - 0.2 * pb;
        }
      }

      // V29/V30 — idle finger micro-sway; damped continuation during heavy VRMA gestures
      {
        const vrmaGNow = (now < vrmaGestureUntilRef.current) && !vrmaClipDoneRef.current;
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
              const b = humanoid.getRawBoneNode(`${side}${bn}` as never);
              if (b) b.rotation.z = b.rotation.z + wf * sign;
            }
          }
        }
        if (now < fingerTapUntilRef.current) {
          const wTap = Math.sin(t * 19) * 0.038;
          const side = fingerTapSideRef.current;
          const idxP = humanoid.getRawBoneNode(`${side}IndexProximal` as never);
          const idxI = humanoid.getRawBoneNode(`${side}IndexIntermediate` as never);
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
      {/* ALWAYS render a <group> so groupRef is stable and useFrame can position it.
          Scale 1.0 = natural VRM height (~1.7m in-world).
          rotation-y={Math.PI} flips avatar to face camera (VRM 0.0 faces +Z, camera is at +Z looking -Z). */}
      <group ref={groupRef} position={[0, 0, 0]} rotation={[0, Math.PI, 0]} scale={[1.35, 1.35, 1.35]}>
        {vrm && <primitive object={vrm.scene} />}
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
          position={[0, ROOM_BOUNDS.floorY + CAMERA_OFFSET_Y, CAMERA_POS_Z]}
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
          <EduverseRoomBackdrop />
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
                ROOM_BOUNDS.floorY + EDUVERSE_FLOOR_EPSILON_Y + EDUVERSE_GRID_Y_ABOVE_FLOOR,
                ROOM_Z_CENTER,
              ]}
              renderOrder={-2004}
            />
          )}
          <VRMScene vrmUrl={vrmUrl} onLoad={handleLoad} onError={handleError} />
          {/* أرضية فقط — بدون جدران جانبية لرؤية أوضح للخلفية والمكتب */}
          <RoomShell
            width={ROOM_BOUNDS.maxX - ROOM_BOUNDS.minX}
            floorY={ROOM_BOUNDS.floorY}
            zNear={ROOM_BOUNDS.maxZ}
            zFar={ROOM_BOUNDS.minZ}
            height={ROOM_BOUNDS.ceilY - ROOM_BOUNDS.floorY}
            showFloor={false}
            showBackWall={false}
            showSideWalls={false}
          />
          {/* مكتب جديد من office_desk.glb — useGLTF + primitive (القديم يُزال من الـ VRM فقط) */}
          <OfficeDeskFromGltf />
        </Suspense>

        {/* Soft contact shadows under avatar/furniture */}
        <ContactShadows
          position={[0, ROOM_BOUNDS.floorY + 0.012, AVATAR_DEFAULT_STAND_Z]}
          opacity={0.18}
          blur={2.2}
          far={6}
          resolution={512}
          frames={1}
        />

        <OrbitControls
          makeDefault
          target={[0, ROOM_BOUNDS.floorY + CAMERA_TARGET_OFFSET_Y, ROOM_Z_CENTER]}
          minDistance={CAMERA_ORBIT_DISTANCE}
          maxDistance={CAMERA_ORBIT_DISTANCE}
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
