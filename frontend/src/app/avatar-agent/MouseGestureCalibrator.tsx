'use client';

/**
 * أداة تطوير: معايرة إزاحات الأذرع بالماوس (TransformControls = سحب دوران).
 * تظهر فقط في development — انظر AvatarCanvas.
 */

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, TransformControls } from '@react-three/drei';
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { VRM } from '@pixiv/three-vrm';
import {
  ARM_IDLE,
  ARM_OFFSETS,
  composeArmTargets,
  MOUSE_CALIB_LS_KEY,
  type ArmEulerOffset,
  type ArmGestureId,
} from './armGestureReference';

type BoneCtrl = 'rua' | 'lua' | 'rh' | 'lh';

const HUMANOID_NAMES: Record<BoneCtrl | 'rla' | 'lla', string> = {
  rua: 'rightUpperArm',
  lua: 'leftUpperArm',
  rla: 'rightLowerArm',
  lla: 'leftLowerArm',
  rh: 'rightHand',
  lh: 'leftHand',
};

function findByName(root: THREE.Object3D, name: string): THREE.Object3D | null {
  let hit: THREE.Object3D | null = null;
  root.traverse((o) => {
    if (o.name === name) hit = o;
  });
  return hit;
}

function eulerYXZ(obj: THREE.Object3D) {
  const e = new THREE.Euler().setFromQuaternion(obj.quaternion, 'YXZ');
  return { x: e.x, y: e.y, z: e.z };
}

function setEulerYXZ(obj: THREE.Object3D, x: number, y: number, z: number) {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, 'YXZ'));
  obj.quaternion.copy(q);
}

function readArmFromBones(b: Record<'rua' | 'lua' | 'rla' | 'lla' | 'rh' | 'lh', THREE.Object3D | null>): ArmEulerOffset {
  const r = (k: keyof typeof b) => {
    const o = b[k];
    if (!o) return { x: 0, y: 0, z: 0 };
    const e = eulerYXZ(o);
    return { x: e.x, y: e.y, z: e.z };
  };
  const rua = r('rua');
  const lua = r('lua');
  const rla = r('rla');
  const lla = r('lla');
  const rh = r('rh');
  const lh = r('lh');
  return {
    ruaX: rua.x,
    ruaY: rua.y,
    ruaZ: rua.z,
    luaX: lua.x,
    luaY: lua.y,
    luaZ: lua.z,
    rlaX: rla.x,
    rlaZ: rla.z,
    llaX: lla.x,
    llaZ: lla.z,
    rhX: rh.x,
    rhY: rh.y,
    rhZ: rh.z,
    lhX: lh.x,
    lhY: lh.y,
    lhZ: lh.z,
  };
}

function applyTargets(
  b: Record<'rua' | 'lua' | 'rla' | 'lla' | 'rh' | 'lh', THREE.Object3D | null>,
  t: ArmEulerOffset,
) {
  setEulerYXZ(b.rua!, t.ruaX, t.ruaY, t.ruaZ);
  setEulerYXZ(b.lua!, t.luaX, t.luaY, t.luaZ);
  setEulerYXZ(b.rla!, t.rlaX, 0, t.rlaZ);
  setEulerYXZ(b.lla!, t.llaX, 0, t.llaZ);
  setEulerYXZ(b.rh!, t.rhX, t.rhY, t.rhZ);
  setEulerYXZ(b.lh!, t.lhX, t.lhY, t.lhZ);
}

function loadLs(): Partial<Record<ArmGestureId, ArmEulerOffset>> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(MOUSE_CALIB_LS_KEY);
    if (!raw) return {};
    const p = JSON.parse(raw) as Partial<Record<ArmGestureId, ArmEulerOffset>>;
    return p && typeof p === 'object' ? p : {};
  } catch {
    return {};
  }
}

function saveLs(data: Partial<Record<ArmGestureId, ArmEulerOffset>>) {
  localStorage.setItem(MOUSE_CALIB_LS_KEY, JSON.stringify(data));
}

/**
 * drei TransformControls يضيف مستمعات على `gl.domElement` عند التركيب؛
 * إن وُضع قبل اكتمال الـ canvas يكون domElement = null → addEventListener يرمي.
 */
function SafeTransformControls(
  props: Omit<React.ComponentProps<typeof TransformControls>, 'ref'> & {
    object: THREE.Object3D | null;
  },
) {
  const { object, ...rest } = props;
  const gl = useThree((s) => s.gl);
  const [canvasReady, setCanvasReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let raf = 0;
    let frames = 0;
    const tick = () => {
      if (cancelled || frames++ > 120) return;
      const el = gl?.domElement;
      if (el && typeof el.addEventListener === 'function') {
        setCanvasReady(true);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      setCanvasReady(false);
    };
  }, [gl]);

  if (!object || !canvasReady || !gl?.domElement) return null;

  return <TransformControls object={object} {...rest} />;
}

function formatOffsetBlock(g: ArmGestureId, o: ArmEulerOffset): string {
  return `  ${g}: {
    ruaX: ${o.ruaX.toFixed(4)}, ruaY: ${o.ruaY.toFixed(4)}, ruaZ: ${o.ruaZ.toFixed(4)},
    luaX: ${o.luaX.toFixed(4)}, luaY: ${o.luaY.toFixed(4)}, luaZ: ${o.luaZ.toFixed(4)},
    rlaX: ${o.rlaX.toFixed(4)}, rlaZ: ${o.rlaZ.toFixed(4)},
    llaX: ${o.llaX.toFixed(4)}, llaZ: ${o.llaZ.toFixed(4)},
    rhX: ${o.rhX.toFixed(4)}, rhY: ${o.rhY.toFixed(4)}, rhZ: ${o.rhZ.toFixed(4)},
    lhX: ${o.lhX.toFixed(4)}, lhY: ${o.lhY.toFixed(4)}, lhZ: ${o.lhZ.toFixed(4)},
  },`;
}

function CalibratorScene({
  vrm,
  gesture,
  activeBone,
  onLiveEuler,
  poseRevision,
}: {
  vrm: VRM;
  gesture: ArmGestureId;
  activeBone: BoneCtrl;
  onLiveEuler: (a: ArmEulerOffset) => void;
  poseRevision: number;
}) {
  const [orbitOn, setOrbitOn] = useState(true);
  const [tcAttach, setTcAttach] = useState<THREE.Object3D | null>(null);
  const bonesRef = useRef<Record<'rua' | 'lua' | 'rla' | 'lla' | 'rh' | 'lh', THREE.Object3D | null>>({
    rua: null,
    lua: null,
    rla: null,
    lla: null,
    rh: null,
    lh: null,
  });

  const cloneRoot = useMemo(() => {
    const c = cloneSkinned(vrm.scene);
    c.traverse((o) => {
      if (o instanceof THREE.SkinnedMesh) {
        o.frustumCulled = false;
      }
    });
    return c;
  }, [vrm]);

  useLayoutEffect(() => {
    const orig = vrm.humanoid;
    if (!orig) return;
    const map = bonesRef.current;
    (['rua', 'lua', 'rla', 'lla', 'rh', 'lh'] as const).forEach((key) => {
      const boneName = HUMANOID_NAMES[key];
      const src = orig.getNormalizedBoneNode(boneName as never);
      const nm = src?.name ?? boneName;
      map[key] = findByName(cloneRoot, nm);
    });
    const b = map;
    if (!b.rua || !b.lua || !b.rla || !b.lla || !b.rh || !b.lh) return;
    const stored = loadLs()[gesture];
    const baseOff = stored ?? ARM_OFFSETS[gesture];
    applyTargets(b, composeArmTargets(baseOff));
    onLiveEuler(readArmFromBones(b));
  }, [vrm, cloneRoot, gesture, poseRevision, onLiveEuler]);

  useLayoutEffect(() => {
    const b = bonesRef.current;
    const o = b[activeBone];
    if (o) setTcAttach(o);
  }, [activeBone, cloneRoot]);

  const pushLive = useCallback(() => {
    const b = bonesRef.current;
    if (!b.rua || !b.lua || !b.rla || !b.lla || !b.rh || !b.lh) return;
    onLiveEuler(readArmFromBones(b));
  }, [onLiveEuler]);

  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[2, 4, 3]} intensity={0.9} />
      <group position={[0, 0, 0]}>
        <primitive object={cloneRoot} />
      </group>
      <OrbitControls
        makeDefault
        enabled={orbitOn}
        target={[0, 1.2, 0]}
        minDistance={1.2}
        maxDistance={4}
      />
      {tcAttach && (
        <SafeTransformControls
          key={activeBone}
          object={tcAttach}
          mode="rotate"
          size={0.55}
          onMouseDown={() => setOrbitOn(false)}
          onMouseUp={() => setOrbitOn(true)}
          onObjectChange={pushLive}
        />
      )}
    </>
  );
}

const GESTURES: ArmGestureId[] = ['explain', 'point', 'think', 'clap', 'wave', 'agree'];

export type MouseGestureCalibratorProps = { vrm: VRM | null };

export function MouseGestureCalibrator({ vrm }: MouseGestureCalibratorProps) {
  /** Same as AvatarCanvas: avoid R3F connect(null) when inner canvas divRef lags React 19 timing. */
  const calibratorEventSourceRef = useRef<HTMLDivElement>(null);
  const [gesture, setGesture] = useState<ArmGestureId>('clap');
  const [activeBone, setActiveBone] = useState<BoneCtrl>('rua');
  const [live, setLive] = useState<ArmEulerOffset | null>(null);
  const [poseRevision, setPoseRevision] = useState(0);
  const [committed, setCommitted] = useState<Partial<Record<ArmGestureId, ArmEulerOffset>>>(() =>
    typeof window !== 'undefined' ? loadLs() : {},
  );

  const onLiveEuler = useCallback((a: ArmEulerOffset) => {
    setLive(a);
  }, []);

  const currentOffset = useMemo(() => {
    if (!live) return null;
    const abs = live;
    return {
      ruaX: abs.ruaX - ARM_IDLE.ruaX,
      ruaY: abs.ruaY - ARM_IDLE.ruaY,
      ruaZ: abs.ruaZ - ARM_IDLE.ruaZ,
      luaX: abs.luaX - ARM_IDLE.luaX,
      luaY: abs.luaY - ARM_IDLE.luaY,
      luaZ: abs.luaZ - ARM_IDLE.luaZ,
      rlaX: abs.rlaX - ARM_IDLE.rlaX,
      rlaZ: abs.rlaZ - ARM_IDLE.rlaZ,
      llaX: abs.llaX - ARM_IDLE.llaX,
      llaZ: abs.llaZ - ARM_IDLE.llaZ,
      rhX: abs.rhX - ARM_IDLE.rhX,
      rhY: abs.rhY - ARM_IDLE.rhY,
      rhZ: abs.rhZ - ARM_IDLE.rhZ,
      lhX: abs.lhX - ARM_IDLE.lhX,
      lhY: abs.lhY - ARM_IDLE.lhY,
      lhZ: abs.lhZ - ARM_IDLE.lhZ,
    } as ArmEulerOffset;
  }, [live]);

  const commitOffset = useCallback(() => {
    if (!currentOffset) return;
    const next = { ...committed, [gesture]: { ...currentOffset } };
    setCommitted(next);
    saveLs(next);
    console.log(`[MouseGestureCalibrator] اعتمدت إزاحة «${gesture}» في localStorage (${MOUSE_CALIB_LS_KEY})`);
  }, [committed, currentOffset, gesture]);

  const copyOne = useCallback(() => {
    if (!currentOffset) return;
    const o = currentOffset;
    const block = formatOffsetBlock(gesture, o);
    void navigator.clipboard?.writeText(block);
    console.log(`[MouseGestureCalibrator] نسخ كتلة armGestureReference لـ «${gesture}»:\n`, block);
  }, [currentOffset, gesture]);

  const copyAll = useCallback(() => {
    let out = 'export const ARM_OFFSETS: Record<ArmGestureId, ArmEulerOffset> = {\n';
    for (const g of GESTURES) {
      const off = committed[g] ?? ARM_OFFSETS[g];
      out += formatOffsetBlock(g, off);
      out += '\n';
    }
    out += '};\n';
    void navigator.clipboard?.writeText(out);
    console.log('[MouseGestureCalibrator] نسخ ARM_OFFSETS كاملاً (الصق في armGestureReference.ts):\n', out);
  }, [committed]);

  const resetGesture = useCallback(() => {
    const next = { ...committed };
    delete next[gesture];
    setCommitted(next);
    saveLs(next);
    setPoseRevision((n) => n + 1);
    console.log(`[MouseGestureCalibrator] أُعيدت إزاحة «${gesture}» للافتراضي من ARM_OFFSETS`);
  }, [committed, gesture]);

  if (process.env.NODE_ENV !== 'development' || !vrm?.humanoid) return null;

  return (
    <div
      className="pointer-events-auto fixed bottom-3 left-3 z-[60] flex max-h-[min(92vh,720px)] w-[min(96vw,380px)] flex-col gap-2 rounded-lg border border-white/15 bg-black/80 p-3 text-xs text-gray-200 shadow-xl backdrop-blur-sm"
      dir="rtl"
    >
      <div className="text-[11px] leading-relaxed text-gray-400">
        اسحب حلقات الدوران على الذراع/اليد المختارة (TransformControls). اختر الإيماءة، ثم «اعتماد الإزاحة».
        الإزاحة = الوضع الحالي − idle (مرجع armGestureReference).
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-gray-500">الإيماءة</span>
        <select
          className="rounded border border-white/20 bg-zinc-900 px-2 py-1 text-gray-100"
          value={gesture}
          onChange={(e) => setGesture(e.target.value as ArmGestureId)}
        >
          {GESTURES.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
      </label>
      <div className="flex flex-wrap gap-1">
        {(['rua', 'lua', 'rh', 'lh'] as BoneCtrl[]).map((k) => (
          <button
            key={k}
            type="button"
            className={`rounded px-2 py-1 ${activeBone === k ? 'bg-blue-600 text-white' : 'bg-zinc-800 text-gray-300'}`}
            onClick={() => setActiveBone(k)}
          >
            {k}
          </button>
        ))}
      </div>
      <div
        ref={calibratorEventSourceRef}
        className="h-[220px] w-full min-h-[220px] overflow-hidden rounded border border-white/10 bg-zinc-950"
      >
        <Canvas
          eventSource={calibratorEventSourceRef as React.RefObject<HTMLElement>}
          camera={{ position: [0, 1.35, 2.1], fov: 35 }}
          gl={{ antialias: true, alpha: true }}
          dpr={[1, 2]}
        >
          <CalibratorScene
            vrm={vrm}
            gesture={gesture}
            activeBone={activeBone}
            onLiveEuler={onLiveEuler}
            poseRevision={poseRevision}
          />
        </Canvas>
      </div>
      {currentOffset && (
        <pre className="max-h-28 overflow-auto rounded bg-zinc-950 p-2 text-[10px] leading-tight text-emerald-300/90">
          {`إزاحة (عن idle) — ${gesture}\nrua ${currentOffset.ruaX.toFixed(3)} ${currentOffset.ruaY.toFixed(3)} ${currentOffset.ruaZ.toFixed(3)}\nlua ${currentOffset.luaX.toFixed(3)} ${currentOffset.luaY.toFixed(3)} ${currentOffset.luaZ.toFixed(3)}\nrla ${currentOffset.rlaX.toFixed(3)} z ${currentOffset.rlaZ.toFixed(3)}\nlla ${currentOffset.llaX.toFixed(3)} z ${currentOffset.llaZ.toFixed(3)}\nrh ${currentOffset.rhX.toFixed(3)} ${currentOffset.rhY.toFixed(3)} ${currentOffset.rhZ.toFixed(3)}\nlh ${currentOffset.lhX.toFixed(3)} ${currentOffset.lhY.toFixed(3)} ${currentOffset.lhZ.toFixed(3)}`}
        </pre>
      )}
      <div className="flex flex-col gap-1">
        <button
          type="button"
          className="rounded bg-emerald-700 py-1.5 text-white hover:bg-emerald-600"
          onClick={commitOffset}
        >
          اعتماد الإزاحة
        </button>
        <button type="button" className="rounded bg-zinc-700 py-1 text-white hover:bg-zinc-600" onClick={copyOne}>
          نسخ كود الإزاحة (للإيماءة الحالية)
        </button>
        <button type="button" className="rounded bg-zinc-700 py-1 text-white hover:bg-zinc-600" onClick={copyAll}>
          نسخ جميع الإزاحات (ARM_OFFSETS)
        </button>
        <button type="button" className="rounded bg-rose-900/80 py-1 text-white hover:bg-rose-800" onClick={resetGesture}>
          إعادة تعيين إزاحة الإيماءة الحالية
        </button>
      </div>
    </div>
  );
}
