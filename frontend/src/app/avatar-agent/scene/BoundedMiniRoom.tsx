'use client';

/**
 * غرفة **6×6 م** (أرضية) وارتفاع داخلي **4 م**، أطلس ثلاث وجهات (يسار • خلف • يمين) + أرضية.
 * الواجهة الأمامية (‎+Z، نحو المتفرج): **جدار زجاجي 5 م** (5 ألواح × 1 م، ارتفاع زجاج 2.7 م)
 * مع عمود معتم 0.5 م على كل طرف داخل عرض الغرفة 6 م.
 *
 * اعتياد المصمّم (قابل للتعديل بالثوابت أدناه):
 *   • نسبة قطاع الأرضية في الأطلس: `NEXT_PUBLIC_BOUNDED_ATLAS_FLOOR_V_MAX` (افتراضي 0.34) لرفع/خفض خط مقابلة الجدران.
 *   • جزء صوريّ أعلى منه مقسوم إلى ثلاثة أعمدة بحجم متساوٍ أفقيًا: يمين | خلف | يسار
 *       من جهة الناظر الواقف داخل الغرفة وينظر نحو المحور ‎+Z (الوجه الأمامية عند maxZ لا تستخدم الصورة).
 *   السقف والعمودان الأماميان يستخدمان لونًا محايدًا؛ الزجاج + موليونات رقيقة.
 */

import React, { Suspense, useLayoutEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useTexture } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { AVATAR_EQUIRECT_ENV_PUBLIC_PATH, readBoundedRoomAtlasFloorVMaxEnv } from '@/config/avatar';
import { ROOM_BOUNDS, ROOM_INTERIOR_HEIGHT_M } from '@/app/avatar-agent/scene/RoomShell';

export type BoundedMiniRoomProps = {
  /** Override atlas image URL (يتوافق مع `avatar.ts`). */
  envMapUrl?: string;
};

const WIDTH_M = 6;
const DEPTH_M = 6;

/** واجهة زجاجية أمامية (معايير تصميم). */
const GLASS_FACADE_WIDTH_M = 5;
const GLASS_HEIGHT_M = 2.7;
const GLASS_PANEL_COUNT = 5;
const GLASS_PANEL_WIDTH_M = 1;
const MULLION_W_M = 0.045;

const SIDE_STRIP_W_M = (WIDTH_M - GLASS_FACADE_WIDTH_M) / 2;

const FASCIA_ABOVE_GLASS_H_M = ROOM_INTERIOR_HEIGHT_M - GLASS_HEIGHT_M;

const THIRD = 1 / 3;
/** عمود atlas: وجه الغرفة يسير مع minX؛ منظور شخص داخل الغرفة؛ يطبّق على شبكة الموضع. */
const ATLAS_U_LEFT_COL: readonly [number, number] = [0, THIRD];
/** جدار ظهر المنظر (باتجاه −Z؛ كامرة عادة أمام أفاتار باتجاه +Z). */
const ATLAS_U_BACK_COL: readonly [number, number] = [THIRD, 2 * THIRD];
/** وجه الغرفة باتجاه maxX. */
const ATLAS_U_RIGHT_COL: readonly [number, number] = [2 * THIRD, 1];

const EPS = 0.009;

/** لوح أرضي موسّع تحت الشبكة المنسوجة — لون قريب من `gl.setClearColor` في وضع الغرفة المحدودة. */
const FLOOR_APRON_SIZE_M = 28;
/** إزاحة لأسفل عن `ROOM_BOUNDS.floorY` لتفادي وميض Z مع الأرضية الملموسة. */
const FLOOR_APRON_Y = -0.022;

/** تعزيز لمسة أفاقية لتفادي زحف طبقي على الحواف. */
const PANO_SURFACE_COLOR_MUL = 1.32;

/** لون لواجهتين لم تكونا ضمن PSD: سقف + عمود أمامي (maxZ، ناحية المتفرج). */
const NEUTRAL_FACADE = '#383844';

/** إسناد شبكة Plane الافتراضية (u,v∈[0,1]) إلى مستطيل في atlas. */
function remapUvToRect(
  geo: THREE.BufferGeometry,
  uSpan: readonly [number, number],
  vSpan: readonly [number, number],
): void {
  const att = geo.getAttribute('uv');
  const arr = att.array as Float32Array;
  for (let i = 0; i < arr.length; i += 2) {
    const u = arr[i]!;
    const v = arr[i + 1]!;
    arr[i] = THREE.MathUtils.lerp(uSpan[0], uSpan[1], u);
    arr[i + 1] = THREE.MathUtils.lerp(vSpan[0], vSpan[1], v);
  }
  att.needsUpdate = true;
}

function BoundedMiniRoomImpl({ envMapUrl }: BoundedMiniRoomProps): React.JSX.Element {
  const gl = useThree((s) => s.gl);
  const url = envMapUrl ?? AVATAR_EQUIRECT_ENV_PUBLIC_PATH;
  const tex = useTexture(url);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;

  useLayoutEffect(() => {
    const maxA = Math.min(8, gl.capabilities.getMaxAnisotropy?.() ?? 1);
    tex.anisotropy = maxA;
    tex.needsUpdate = true;
  }, [tex, gl]);

  const centroidX = (ROOM_BOUNDS.minX + ROOM_BOUNDS.maxX) / 2;
  const centroidZ = (ROOM_BOUNDS.minZ + ROOM_BOUNDS.maxZ) / 2;
  const floorY = ROOM_BOUNDS.floorY;
  const cy = floorY + ROOM_INTERIOR_HEIGHT_M / 2;
  const vxMin = ROOM_BOUNDS.minX;
  const vxMax = ROOM_BOUNDS.maxX;
  const vzMin = ROOM_BOUNDS.minZ;
  const vzMax = ROOM_BOUNDS.maxZ;

  const atlasFloorVMax = readBoundedRoomAtlasFloorVMaxEnv();

  const texturedMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        map: tex,
        roughness: 0.93,
        metalness: 0.03,
        color: new THREE.Color().setRGB(PANO_SURFACE_COLOR_MUL, PANO_SURFACE_COLOR_MUL, PANO_SURFACE_COLOR_MUL),
      }),
    [tex],
  );

  /** Floor atlas sits on `ROOM_BOUNDS.floorY`; slight polygon offset avoids z‑fight vs apron plane. */
  const floorAtlasMat = useMemo(() => {
    const m = texturedMat.clone();
    m.polygonOffset = true;
    m.polygonOffsetFactor = -0.75;
    m.polygonOffsetUnits = -1;
    return m;
  }, [texturedMat]);

  const neutralMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: NEUTRAL_FACADE,
        roughness: 0.9,
        metalness: 0.06,
      }),
    [],
  );

  const glassMat = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: '#b9cad8',
        metalness: 0.05,
        roughness: 0.1,
        transmission: 0.58,
        thickness: 0.14,
        envMapIntensity: 0.85,
        transparent: true,
      }),
    [],
  );

  const mullionMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#1e1e26',
        roughness: 0.78,
        metalness: 0.35,
      }),
    [],
  );

  const apronMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#1e2028',
        roughness: 0.98,
        metalness: 0,
      }),
    [],
  );

  /** أرض مستوية: عرض=W عمق=Z داخل قطاع الأسفل في الصورة؛ v من قاع الصورة لتطابق PSD. */
  const floorGeo = useMemo(() => {
    const g = new THREE.PlaneGeometry(WIDTH_M, DEPTH_M, 1, 1);
    remapUvToRect(g, [0, 1], [0, atlasFloorVMax]);
    return g;
  }, [atlasFloorVMax]);

  const backGeo = useMemo(() => {
    const g = new THREE.PlaneGeometry(WIDTH_M, ROOM_INTERIOR_HEIGHT_M, 1, 1);
    remapUvToRect(g, ATLAS_U_BACK_COL as [number, number], [atlasFloorVMax, 1]);
    return g;
  }, [atlasFloorVMax]);

  const leftGeo = useMemo(() => {
    const g = new THREE.PlaneGeometry(DEPTH_M, ROOM_INTERIOR_HEIGHT_M, 1, 1);
    remapUvToRect(g, ATLAS_U_LEFT_COL as [number, number], [atlasFloorVMax, 1]);
    return g;
  }, [atlasFloorVMax]);

  const rightGeo = useMemo(() => {
    const g = new THREE.PlaneGeometry(DEPTH_M, ROOM_INTERIOR_HEIGHT_M, 1, 1);
    remapUvToRect(g, ATLAS_U_RIGHT_COL as [number, number], [atlasFloorVMax, 1]);
    return g;
  }, [atlasFloorVMax]);

  const apronGeo = useMemo(() => new THREE.PlaneGeometry(FLOOR_APRON_SIZE_M, FLOOR_APRON_SIZE_M, 1, 1), []);

  const zFront = vzMax - EPS;
  const Z_OPAQUE = zFront - 0.004;
  const Z_GLASS = zFront - 0.012;
  const fasciaCenterY = floorY + GLASS_HEIGHT_M + FASCIA_ABOVE_GLASS_H_M / 2;
  const glassCenterY = floorY + GLASS_HEIGHT_M / 2;
  const glassBandCenterX = vxMin + SIDE_STRIP_W_M + GLASS_FACADE_WIDTH_M / 2;
  const pierCenters = [vxMin + SIDE_STRIP_W_M / 2, vxMax - SIDE_STRIP_W_M / 2] as const;

  return (
    <group name="BoundedMiniRoom">
      {/* موسّعة أرضية تحت الأطلس لتفادي شريط void بلون مختلف عن الباركيه */}
      <mesh
        geometry={apronGeo}
        material={apronMat}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[centroidX, floorY + FLOOR_APRON_Y, centroidZ]}
        renderOrder={-2}
      />

      {/* الأرض — شريط أطلس على مستوى `floorY` (مواءمة مع فیزيا الغرفة ومعايرة القدمين). */}
      <mesh
        geometry={floorGeo}
        material={floorAtlasMat}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[centroidX, floorY, centroidZ]}
        renderOrder={0}
      />

      {/* جدار ظهر المنظر */}
      <mesh
        geometry={backGeo}
        material={texturedMat}
        position={[centroidX, cy, vzMin + EPS]}
      />

      {/* جدار جهة −X؛ اتجاهه +X نحو داخل الغرفة */}
      <mesh
        geometry={leftGeo}
        material={texturedMat}
        rotation={[0, Math.PI / 2, 0]}
        position={[vxMin + EPS, cy, centroidZ]}
      />

      {/* جدار جهة +X؛ وجه الغرف −X نحو الداخل */}
      <mesh
        geometry={rightGeo}
        material={texturedMat}
        rotation={[0, -Math.PI / 2, 0]}
        position={[vxMax - EPS, cy, centroidZ]}
      />

      {/* أمام المنظر (‎maxZ): عمودان جانبيان، زجاج 5 لوح × 1 م، موليونات، لوح تحت السقف فوق الزجاج */}
      {pierCenters.map((px, ix) => (
        <mesh
          key={`front-pier-${ix}`}
          material={neutralMat}
          rotation={[0, Math.PI, 0]}
          position={[px, cy, Z_OPAQUE]}
        >
          <planeGeometry args={[SIDE_STRIP_W_M, ROOM_INTERIOR_HEIGHT_M]} />
        </mesh>
      ))}

      {Array.from({ length: GLASS_PANEL_COUNT }, (_, i) => (
        <mesh
          key={`glass-${i}`}
          material={glassMat}
          rotation={[0, Math.PI, 0]}
          position={[vxMin + SIDE_STRIP_W_M + (i + 0.5) * GLASS_PANEL_WIDTH_M, glassCenterY, Z_GLASS]}
        >
          <planeGeometry args={[GLASS_PANEL_WIDTH_M, GLASS_HEIGHT_M]} />
        </mesh>
      ))}

      {Array.from({ length: GLASS_PANEL_COUNT - 1 }, (_, i) => {
        const bx = vxMin + SIDE_STRIP_W_M + (i + 1) * GLASS_PANEL_WIDTH_M;
        return (
          <mesh
            key={`mullion-${i}`}
            material={mullionMat}
            rotation={[0, Math.PI, 0]}
            position={[bx, glassCenterY, Z_GLASS + 0.002]}
          >
            <planeGeometry args={[MULLION_W_M, GLASS_HEIGHT_M]} />
          </mesh>
        );
      })}

      <mesh
        material={neutralMat}
        rotation={[0, Math.PI, 0]}
        position={[glassBandCenterX, fasciaCenterY, Z_OPAQUE]}
      >
        <planeGeometry args={[GLASS_FACADE_WIDTH_M + 0.04, FASCIA_ABOVE_GLASS_H_M]} />
      </mesh>

      {/* سقف — بدون قطعة من PSD */}
      <mesh material={neutralMat} rotation={[Math.PI / 2, 0, 0]} position={[centroidX, floorY + ROOM_INTERIOR_HEIGHT_M - EPS, centroidZ]}>
        <planeGeometry args={[WIDTH_M, DEPTH_M]} />
      </mesh>
    </group>
  );
}

export function BoundedMiniRoom(props: BoundedMiniRoomProps): React.JSX.Element {
  return (
    <Suspense fallback={null}>
      <BoundedMiniRoomImpl {...props} />
    </Suspense>
  );
}

/** أبعاد الصندوق الداخلي (مطابق لـ ROOM_BOUNDS × ROOM_INTERIOR_HEIGHT_M). */
export const BOUNDED_ROOM_DIMENSIONS_METRES = {
  width: WIDTH_M,
  height: ROOM_INTERIOR_HEIGHT_M,
  depth: DEPTH_M,
} as const;

/** واجهة زجاجية أمام المنظر — للمزامنة مع التصاميم PSD / مواصفات العمارة. */
export const FRONT_GLASS_FACADE_METRES = {
  totalGlassWidth: GLASS_FACADE_WIDTH_M,
  glassHeight: GLASS_HEIGHT_M,
  panelCount: GLASS_PANEL_COUNT,
  panelWidth: GLASS_PANEL_WIDTH_M,
  sideRevealEach: SIDE_STRIP_W_M,
  fasciaAboveGlass: FASCIA_ABOVE_GLASS_H_M,
  mullionWidth: MULLION_W_M,
} as const;
