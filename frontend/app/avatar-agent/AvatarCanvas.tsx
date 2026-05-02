'use client';

import React, {
  useState,
  useRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  Suspense,
  type MutableRefObject,
  type RefObject,
} from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree, useLoader } from '@react-three/fiber';
import type { ThreeEvent } from '@react-three/fiber';
import {
  PerspectiveCamera,
  OrbitControls,
  Text,
  TransformControls,
} from '@react-three/drei';
import {
  GLTFLoader,
  type GLTF,
  type GLTFParser,
} from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { VRMLoaderPlugin, VRM } from '@pixiv/three-vrm';
import { useBrainStore } from '@/store/useBrainStore';
import { initBrainPersistence, flushBrainPersistence } from '@/lib/brainPersistence';
import { recordPersonalitySessionVisit } from '@/ai/avatar/personalityMemory';
import { initMasterClockSession } from '@/lib/avatar/masterClock';
import { applyBrainStatePayload, transitionFsmToListening } from '@/lib/avatar/behaviorExecutionContract';
import type { BrainStatePayload } from '@/lib/avatar/brainStatePayload';
import { clearAudioTimeline, patchTimelineCues, setPlaybackAudio } from '@/lib/avatar/audioTimeline';
import { initAvatarVoiceListener } from '@/ai/io/tts';
import { startSpontaneousBehavior, stopSpontaneousBehavior } from '@/lib/behavior/SpontaneousBehavior';
import { CameraUpLock } from './CameraUpLock';
import ComfortLightingRig from '@/components/ComfortLightingRig';
import ErrorBoundary from '@/components/ErrorBoundary';
import LipSyncManager, { type VisemeCue } from './LipSyncManager';
import { AnimationController } from './AnimationController';
import { VRMSkeletonManager } from './VRMSkeletonManager';
import { VRMAPlayer } from './VRMAPlayer';
import type { BonePoseMap } from './motion/PoseComposer';
import { GenerativeGestureManager } from './GenerativeGestureManager';
import { BehaviorBrainHost } from './behavior';
import { MotionTraceOverlay } from './MotionTraceOverlay';
import { useAvatarEventBridge } from '@/hooks/useAvatarEventBridge';
import { initGestureNormalizer } from '@/lib/gestureNormalizer';
import { GestureCalibrator } from './GestureCalibrator';
import { MouseGestureCalibrator } from './MouseGestureCalibrator';
import {
  INTERNAL_THOUGHT_END_EVENT,
  INTERNAL_THOUGHT_MOTOR_EVENT,
} from '@/lib/behavior/internalThoughtLayer';
import { dispatchAvatar } from '@/utils/events/normalizeAvatarEvents';
import { avatarDebug, DEBUG_AVATAR } from '@/app/avatar-agent/debugAvatar';
import { getSharedAudioContext } from '@/lib/audio/avatarAudioContext';
import {
  attachAvatarPlaybackEnhancement,
  isAvatarAudioEnhancerEnabled,
  type AvatarPlaybackEnhancerHandle,
} from '@/lib/audio/audioEnhancer';
import {
  AVATAR_OFFICE_SCENE_DEFAULTS,
  getAvatarOfficeScenePosition,
  getAvatar2dStudioScenePosition,
  readAvatarUse2dEnvBackground,
  readAvatar2dEnvImageUrl,
  OFFICE_GLB_PUBLIC_PATH,
  pickVrmUrl,
  AVATAR_GROUP_ROTATION_Y,
  PHYSICS_CONFIG,
  readFloorBaselineOffsetEnv,
  readDebugFloorGridEnv,
  FINAL_ROOM_POSITION,
  getRoomGroupPosition,
  getWorldFloorY,
  OFFICE_BACKGROUND_MESH_NAME,
  showGestureCalibrationUi,
  showOfficeSceneEditorUi,
} from '@/config/avatar';
import { SceneBackgroundTexture } from '@/app/avatar-agent/scene/SceneBackgroundTexture';
import defaultOfficeScene from '@/config/office_scene.default.json';
import {
  ENV_ROOT_NAME,
  type OfficeSceneFileV1,
  type OfficeSceneObjectSnapshot,
  applyOfficeSceneJson,
  buildOfficeSceneJson,
  cullFarEnvironmentMeshes,
  resetGltfEnvironmentAndReapplyDefaults,
  snapshotFromObject,
} from '@/app/avatar-agent/scene/officeEnvironmentLayout';
import {
  setDeskScene,
  clearDeskScene,
  computeChairAnchor,
  markDeskSceneTransformDirty,
  resolveIfEnabled,
} from './physics/WorldColliders';
import { createAvatarPerformanceHandler } from '@/app/avatar-agent/avatarPerformanceBridge';
import {
  applyFootFloorCalib,
  createLiftNode,
  runWorldFloorAntiDriftFrame,
} from '@/app/avatar-agent/floorLockV121';
import { ROOM_BOUNDS } from '@/app/avatar-agent/scene/RoomShell';
import { isObservabilityEnabled } from '@/lib/observability/config';
import { ObservabilityOverlay } from '@/lib/observability/ObservabilityOverlay';
import { ObservabilityR3F } from '@/lib/observability/ObservabilityR3F';

const ROOM_POSITION_EPS = 1e-4;

/** Metres — hide office meshes whose world position is farther than this (after room placement). */
const ENV_FAR_CULL_WORLD_RADIUS = 150;

/** V120 — lower-body bind snapshot for resetLowerBodyToIdle (f22f888b). */
const LOWER_BONES_FLOOR = [
  'leftUpperLeg',
  'leftLowerLeg',
  'leftFoot',
  'rightUpperLeg',
  'rightLowerLeg',
  'rightFoot',
] as const;

/**
 * World-floor lock — `applyFootFloorCalib` on mount (parent) + per-frame anti-drift (feet never below Y=0).
 * Vertical correction is ONLY `liftNode.position.y`; do not clamp AvatarRoot Y to `ROOM_BOUNDS.floorY`.
 */
function FloorLockRuntime({
  vrm,
  liftNode,
  groupRef,
}: {
  vrm: VRM;
  liftNode: THREE.Group;
  groupRef: React.RefObject<THREE.Group | null>;
}) {
  const liftDebugFrameRef = useRef(0);
  useFrame(() => {
    const g = groupRef.current;
    if (g) {
      runWorldFloorAntiDriftFrame(vrm, liftNode, g);
    }
    if (process.env.NODE_ENV === 'development' && DEBUG_AVATAR) {
      liftDebugFrameRef.current += 1;
      if (liftDebugFrameRef.current % 90 === 0) {
        console.log('LIFT_NODE Y:', liftNode.position.y, 'worldFloor', getWorldFloorY());
      }
    }
  });
  return null;
}

/** Dev-only: horizontal grid at resolved `ROOM_BOUNDS.floorY` (enable `NEXT_PUBLIC_DEBUG_FLOOR_GRID`). */
function FloorBaselineDebugGrid() {
  const ref = useRef<THREE.GridHelper | null>(null);
  useFrame(() => {
    const g = ref.current;
    if (g) g.position.y = ROOM_BOUNDS.floorY;
  });
  return (
    <gridHelper
      ref={ref}
      args={[16, 32, 0x55ffcc, 0x3a4a3a]}
      position={[0, ROOM_BOUNDS.floorY, 0]}
    />
  );
}

type AvatarCanvasProps = {
  vrmUrl?: string;
  /** When true (default prop), loads the office GLB only if `NEXT_PUBLIC_AVATAR_2D_ENV_BACKGROUND` is not forcing 2D mode. */
  showOfficeEnvironment?: boolean;
  /** مسار GLB للمكتب (افتراضي من `OFFICE_GLB_PUBLIC_PATH`) */
  officeGlbUrl?: string;
  /** Uniform scale for office room `<group>` (default from `AVATAR_OFFICE_SCENE_DEFAULTS.officeScale`). */
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

// ── Office scene editor (save/load layout JSON) ─────

type TransformMode = 'translate' | 'rotate' | 'scale';

function pickFirstMesh(hit: THREE.Object3D | null): THREE.Mesh | null {
  let o: THREE.Object3D | null = hit;
  while (o) {
    if ((o as THREE.Mesh).isMesh) return o as THREE.Mesh;
    o = o.parent;
  }
  return null;
}

function isBackgroundMeshOrDescendant(obj: THREE.Object3D, backgroundName: string): boolean {
  let o: THREE.Object3D | null = obj;
  while (o) {
    if (o.name === backgroundName) return true;
    o = o.parent;
  }
  return false;
}

type OfficeSceneWithEditorProps = {
  url: string;
  position: [number, number, number];
  scale: number;
  /** XZ probe for future floor raycast; GLB AABB uses the whole placed group. */
  floorProbeXZ: [number, number];
  editorEnabled: boolean;
  transformMode: TransformMode;
  gizmoVisible: boolean;
  selectedUuid: string | null;
  onSelect: (uuid: string | null, snap: OfficeSceneObjectSnapshot | null) => void;
  officeGltfRef: MutableRefObject<GLTF | null>;
};

function OfficeSceneWithEditor({
  url,
  position,
  scale,
  floorProbeXZ: _floorProbeXZ,
  editorEnabled,
  transformMode,
  gizmoVisible,
  selectedUuid,
  onSelect,
  officeGltfRef,
}: OfficeSceneWithEditorProps) {
  void _floorProbeXZ;
  const officeRootRef = useRef<THREE.Group>(null);
  const roomEditGroupRef = useRef<THREE.Group | null>(null);
  const [, setRoomEditVersion] = useState(0);
  const roomPositionLoggedRef = useRef(false);
  const gltf = useLoader(GLTFLoader, url, (loader) => {
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('/draco/');
    dracoLoader.setDecoderConfig({ type: 'js' });
    loader.setDRACOLoader(dracoLoader);
  });

  useLayoutEffect(() => {
    officeGltfRef.current = gltf;
    gltf.scene.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const mesh = obj as THREE.Mesh;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        if (mesh.material) {
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          mats.forEach((m) => {
            m.needsUpdate = true;
          });
        }
      }
    });
    setDeskScene(gltf.scene);
    return () => {
      officeGltfRef.current = null;
      clearDeskScene();
    };
  }, [gltf, officeGltfRef]);

  useLayoutEffect(() => {
    if (!gltf?.scene) return;
    const scene = gltf.scene;
    const hadEditGroup = !!scene.userData.roomContentEditGroup;
    resetGltfEnvironmentAndReapplyDefaults(gltf, defaultOfficeScene as OfficeSceneFileV1);
    const g = scene.userData.roomContentEditGroup as THREE.Group | undefined;
    if (g) {
      roomEditGroupRef.current = g;
      if (!hadEditGroup) setRoomEditVersion((v) => v + 1);
    }
  }, [gltf]);

  /** `ROOM_BOUNDS.floorY` tracks world floor + env offset only — never GLB Box3. */
  const syncRoomFloorToWorld = useCallback(() => {
    const next = getWorldFloorY() + readFloorBaselineOffsetEnv();
    if (Math.abs(next - ROOM_BOUNDS.floorY) < 1e-3) return;
    ROOM_BOUNDS.floorY = next;
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('room:bounds:applied', { detail: { floorY: next, source: 'world-floor' } }),
      );
    }
    if (process.env.NODE_ENV === 'development' && DEBUG_AVATAR) {
      console.log('[floor] ROOM_BOUNDS.floorY synced to world', { floorY: next });
    }
  }, []);

  /** Apply room lift to `gltf.scene` root so walls + furniture (entire GLB graph) share one transform. */
  useLayoutEffect(() => {
    if (!gltf?.scene) return;
    gltf.scene.position.set(position[0], position[1], position[2]);
    gltf.scene.updateMatrixWorld(true);
    const cull = cullFarEnvironmentMeshes(gltf.scene, ENV_FAR_CULL_WORLD_RADIUS);
    if (process.env.NODE_ENV === 'development' && DEBUG_AVATAR && cull.hiddenCount > 0) {
      console.warn('[AvatarCanvas] far office meshes hidden (world cull)', cull);
    }
    markDeskSceneTransformDirty();
    computeChairAnchor();
  }, [gltf, position, scale]);

  useLayoutEffect(() => {
    syncRoomFloorToWorld();
  }, [gltf, position, scale, syncRoomFloorToWorld]);

  useLayoutEffect(() => {
    if (!gltf?.scene) return;
    const s = gltf.scene;
    if (!roomPositionLoggedRef.current) {
      roomPositionLoggedRef.current = true;
      console.log(
        'OFFICE GLB root (gltf.scene) position — base FINAL_ROOM_POSITION + ROOM_Y_OFFSET on Y',
        FINAL_ROOM_POSITION,
        '→',
        position,
      );
      console.log('gltf.scene.position (Three.js)', s.position.x, s.position.y, s.position.z);
    }
    if (
      process.env.NODE_ENV === 'development' &&
      (Math.abs(s.position.x - position[0]) > ROOM_POSITION_EPS ||
        Math.abs(s.position.y - position[1]) > ROOM_POSITION_EPS ||
        Math.abs(s.position.z - position[2]) > ROOM_POSITION_EPS)
    ) {
      console.warn('[AvatarCanvas] gltf.scene position differs from expected — check for overrides.', {
        expected: [...position],
        actual: [s.position.x, s.position.y, s.position.z],
      });
    }
  }, [gltf, position]);

  const selectedObject = useMemo((): THREE.Object3D | null => {
    if (!selectedUuid) return null;
    const rg = roomEditGroupRef.current;
    if (rg && rg.uuid === selectedUuid) return rg;
    return null;
  }, [selectedUuid]);

  useEffect(() => {
    if (!editorEnabled) {
      onSelect(null, null);
    }
  }, [editorEnabled, onSelect]);

  const handleClick = useCallback(
    (e: ThreeEvent<MouseEvent>) => {
      if (!editorEnabled) return;
      e.stopPropagation();
      const mesh = pickFirstMesh(e.object);
      if (!mesh) {
        onSelect(null, null);
        return;
      }
      if (isBackgroundMeshOrDescendant(mesh, OFFICE_BACKGROUND_MESH_NAME)) {
        onSelect(null, null);
        return;
      }
      const rg = roomEditGroupRef.current;
      if (!rg) {
        onSelect(null, null);
        return;
      }
      onSelect(rg.uuid, snapshotFromObject(rg));
    },
    [editorEnabled, onSelect],
  );

  const handlePointerMissed = useCallback(() => {
    if (!editorEnabled) return;
    onSelect(null, null);
  }, [editorEnabled, onSelect]);

  const onTcChange = useCallback(() => {
    markDeskSceneTransformDirty();
    computeChairAnchor();
    if (selectedObject) onSelect(selectedObject.uuid, snapshotFromObject(selectedObject));
  }, [selectedObject, onSelect]);

  return (
    <group onPointerMissed={handlePointerMissed}>
      <group ref={officeRootRef} scale={scale}>
        <primitive object={gltf.scene} onClick={handleClick} />
      </group>
      {editorEnabled && gizmoVisible && selectedObject && (
        <TransformControls
          object={selectedObject}
          mode={transformMode}
          space="world"
          onObjectChange={onTcChange}
        />
      )}
    </group>
  );
}

/**
 * Invisible floor plane that intercepts right-clicks and emits the XZ position.
 * Placed at the avatar's floor level (Y = avatarPositionY).
 */
function FloorClickDetector({
  floorY,
  onRightClick,
}: {
  floorY: number;
  onRightClick: (x: number, z: number) => void;
}) {
  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, floorY, 0]}
      visible={false}
      onContextMenu={(e) => {
        e.stopPropagation();
        onRightClick(e.point.x, e.point.z);
      }}
    >
      <planeGeometry args={[40, 40]} />
      <meshBasicMaterial />
    </mesh>
  );
}

/** Office: camera on +Z side of avatar (same X), elevated; one-shot align after VRM load + label. */
const OFFICE_CAMERA_FACE_Y = 2.5;
const OFFICE_CAMERA_Z_OFFSET = 5;
const OFFICE_LOOK_AT_Y_OFFSET = 1.25;
const OFFICE_CAMERA_LABEL_Y = 0.3;

function OfficeAvatarCameraFaceSetup({
  active,
  hasVrm,
  avatarX,
  avatarY,
  avatarZ,
}: {
  active: boolean;
  hasVrm: boolean;
  avatarX: number;
  avatarY: number;
  avatarZ: number;
}) {
  const { camera, controls } = useThree();
  const appliedRef = useRef(false);

  useLayoutEffect(() => {
    if (!active || !hasVrm || appliedRef.current) return;
    appliedRef.current = true;
    const look = new THREE.Vector3(avatarX, avatarY + OFFICE_LOOK_AT_Y_OFFSET, avatarZ);
    camera.position.set(avatarX, OFFICE_CAMERA_FACE_Y, avatarZ + OFFICE_CAMERA_Z_OFFSET);
    camera.lookAt(look);
    const ctrl = controls as { target?: THREE.Vector3; update?: () => void } | undefined;
    if (ctrl?.target && typeof ctrl.update === 'function') {
      ctrl.target.copy(look);
      ctrl.update();
    }
  }, [active, hasVrm, avatarX, avatarY, avatarZ, camera, controls]);

  if (!active || !hasVrm) return null;

  const cx = avatarX;
  const cz = avatarZ + OFFICE_CAMERA_Z_OFFSET;
  const labelY = OFFICE_CAMERA_FACE_Y + OFFICE_CAMERA_LABEL_Y;

  return (
    <Suspense fallback={null}>
      <Text
        position={[cx, labelY, cz]}
        fontSize={0.2}
        color="#ffd54f"
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.02}
        outlineColor="#0a0a12"
      >
        CAMERA
      </Text>
    </Suspense>
  );
}

export default function AvatarCanvas({
  vrmUrl = pickVrmUrl(),
  showOfficeEnvironment = true,
  officeGlbUrl = OFFICE_GLB_PUBLIC_PATH,
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
  const use2dEnvBackdrop = readAvatarUse2dEnvBackground();
  const env2dBackgroundUrl = readAvatar2dEnvImageUrl();
  const render3dOfficeRoom = Boolean(showOfficeEnvironment && !use2dEnvBackdrop);
  const avatarAnchorPosition = useMemo(
    () => (use2dEnvBackdrop ? getAvatar2dStudioScenePosition() : avatarPosition),
    [use2dEnvBackdrop, avatarPosition],
  );

  const [vrm, setVrm] = useState<VRM | null>(null);
  const [error, setError] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  // Right-click → move avatar to floor position (starts at desk position)
  const [avatarXZ, setAvatarXZ] = useState<[number, number]>([
    avatarAnchorPosition[0],
    avatarAnchorPosition[2],
  ]);
  const floorClickScratchRef = useRef(new THREE.Vector3());
  const onAvatarFloorNavigate = useCallback(
    (x: number, z: number) => {
      const v = floorClickScratchRef.current;
      v.set(x, avatarAnchorPosition[1], z);
      resolveIfEnabled(v, PHYSICS_CONFIG.avatar.capsuleRadius);
      setAvatarXZ([v.x, v.z]);
    },
    [avatarAnchorPosition],
  );

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
  /** Composes with PAD→motor: slight idle rhythm bump during silent internal thought. */
  const internalThoughtBreathRef = useRef<{ untilMs: number; mul: number }>({ untilMs: 0, mul: 1 });
  const isListeningRef = useRef<boolean>(false);
  const isThinkingRef = useRef<boolean>(false);
  const observabilityEnabled = isObservabilityEnabled();

  const visemeCueQueueInternalRef = useRef<VisemeCue[]>([]);
  const audioElementInternalRef = useRef<HTMLAudioElement | null>(null);
  const analyserInternalRef = useRef<AnalyserNode | null>(null);

  const visemeCueQueueRef = visemeCueQueueProp ?? visemeCueQueueInternalRef;
  const audioElementRef = audioElementProp ?? audioElementInternalRef;
  const analyserRef = analyserProp ?? analyserInternalRef;

  // Track which audio element is currently wired into the analyser so we avoid re-wiring
  const analyserSourceAudioRef = useRef<HTMLAudioElement | null>(null);
  /** Dynamics + AGC inserted between MediaElementSource and lip analyser (disposed on re-wire). */
  const playbackEnhancerRef = useRef<AvatarPlaybackEnhancerHandle | null>(null);

  /**
   * R3F connects pointer events in `onCreated` via `connect(eventSource ?? divRef.current)`.
   * With React 19 + async `configure()`, the inner `divRef` can still be null → null.addEventListener.
   * A stable outer ref (parent of `<Canvas />`) is set before the child fiber root runs.
   */
  const r3fEventSourceRef = useRef<HTMLDivElement>(null);

  /** مرجع مشترك: VRMAPlayer يكتبه، VRMSkeletonManager يقرأه لتوقيف الإيماءات الإجرائية */
  const vrmaActiveRef = useRef<boolean>(false);
  /** لقطة عظام VRMA (عند تفعيل VRMAPlayer) — يستهلكها PoseComposer */
  const vrmaPoseRef = useRef<{ seq: number; bones: BonePoseMap } | null>(null);

  /** V121 — LIFT_NODE between container and vrm.scene; foot calibration adjusts liftNode.y only. */
  const [liftNode, setLiftNode] = useState<THREE.Group | null>(null);
  /** V122 — accumulated foot offset vs floor baseline (f22f888b). */
  /** Stable ref for floor-lock callbacks (same as vrm state). */
  const vrmRef = useRef<VRM | null>(null);

  // ── V120 lower-body bind restore (docs/AVATAR_FEET_AND_SUBFLOOR_FIX_V122.md) ──
  const bindLowerBodyRotationsRef = useRef<Map<string, THREE.Quaternion>>(new Map());
  const captureLowerBodyBindPose = useCallback(() => {
    const vr = vrmRef.current;
    if (!vr?.humanoid) return;
    for (const name of LOWER_BONES_FLOOR) {
      const b = (vr.humanoid as { getRawBoneNode?: (n: string) => THREE.Object3D | undefined }).getRawBoneNode?.(
        name,
      );
      if (b) bindLowerBodyRotationsRef.current.set(name, b.quaternion.clone());
    }
  }, []);
  const resetLowerBodyToIdle = useCallback(() => {
    const vr = vrmRef.current;
    if (!vr?.humanoid) return;
    for (const name of LOWER_BONES_FLOOR) {
      const b = (vr.humanoid as { getRawBoneNode?: (n: string) => THREE.Object3D | undefined }).getRawBoneNode?.(
        name,
      );
      const q = bindLowerBodyRotationsRef.current.get(name);
      if (b && q) {
        b.quaternion.copy(q);
        b.updateMatrixWorld(true);
      }
    }
    vr.scene?.updateMatrixWorld(true);
  }, []);

  /** GLB المكتب المحمّل داخل Canvas — للحفظ/التحميل JSON */
  const officeGltfRef = useRef<GLTF | null>(null);
  const sceneFileInputRef = useRef<HTMLInputElement>(null);
  const [sceneEditorEnabled, setSceneEditorEnabled] = useState(false);
  const [sceneTransformMode, setSceneTransformMode] = useState<TransformMode>('translate');
  const [sceneGizmoVisible, setSceneGizmoVisible] = useState(true);
  const [sceneSelectedUuid, setSceneSelectedUuid] = useState<string | null>(null);
  const [sceneLive, setSceneLive] = useState<OfficeSceneObjectSnapshot | null>(null);

  /** Stable `[x, y+ROOM_Y_OFFSET, z]` — base from `FINAL_ROOM_POSITION` in `@/config/avatar`. */
  const roomGroupPosition = useMemo(() => getRoomGroupPosition(), []);

  useEffect(() => {
    if (use2dEnvBackdrop) clearDeskScene();
  }, [use2dEnvBackdrop]);

  const onOfficeSceneSelect = useCallback((uuid: string | null, snap: OfficeSceneObjectSnapshot | null) => {
    setSceneSelectedUuid(uuid);
    setSceneLive(snap);
  }, []);

  /** أثناء محرر المشهد: تعطيل raycast على شبكة الـ VRM حتى لا يُختار الجسم بدل الأثاث */
  useEffect(() => {
    if (!vrm?.scene || !sceneEditorEnabled) return;
    const restores: { m: THREE.Mesh; r: THREE.Mesh['raycast'] }[] = [];
    const noopRaycast: THREE.Mesh['raycast'] = function (): void {
      /* editor: ignore hits on avatar skin */
    };
    vrm.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        restores.push({ m, r: m.raycast });
        m.raycast = noopRaycast;
      }
    });
    return () => {
      restores.forEach(({ m, r }) => {
        m.raycast = r;
      });
    };
  }, [vrm, sceneEditorEnabled]);

  useEffect(() => {
    if (!sceneEditorEnabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSceneSelectedUuid(null);
        setSceneLive(null);
        setSceneGizmoVisible(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sceneEditorEnabled]);

  const handleSaveOfficeScene = useCallback(() => {
    const gltf = officeGltfRef.current;
    if (!gltf || typeof window === 'undefined') return;
    const data = buildOfficeSceneJson(
      gltf,
      officeGlbUrl,
      [...roomGroupPosition],
      officeScale,
    );
    const dataStr = JSON.stringify(data, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'office_scene.json';
    a.click();
    URL.revokeObjectURL(url);
  }, [officeGlbUrl, officeScale, roomGroupPosition]);

  const handlePickSceneFile = useCallback(() => {
    sceneFileInputRef.current?.click();
  }, []);

  const onSceneFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(String(reader.result ?? '{}')) as OfficeSceneFileV1;
          if (parsed.version !== 1 || !Array.isArray(parsed.objects)) {
            console.warn('[AvatarCanvas] Invalid office_scene.json (expected version 1)');
            return;
          }
          const gltf = officeGltfRef.current;
          if (!gltf) return;
          applyOfficeSceneJson(gltf, parsed);
          gltf.scene.updateMatrixWorld(true);
          cullFarEnvironmentMeshes(gltf.scene, ENV_FAR_CULL_WORLD_RADIUS);
          computeChairAnchor();
          setSceneSelectedUuid(null);
          setSceneLive(null);
        } catch (err) {
          console.error('[AvatarCanvas] Failed to parse scene JSON', err);
        }
      };
      reader.readAsText(file);
    },
    [],
  );

  const spontaneousBehaviorEnabled = true;

  useEffect(() => {
    initGestureNormalizer();
    initBrainPersistence();
    initMasterClockSession();
    recordPersonalitySessionVisit();
    initAvatarVoiceListener();
    if (spontaneousBehaviorEnabled) {
      startSpontaneousBehavior({
        isTalkingRef,
        isThinkingRef,
        motorSpeedMulRef,
        isListeningRef,
      });
    }
    return () => {
      flushBrainPersistence();
      if (spontaneousBehaviorEnabled) stopSpontaneousBehavior();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onContract = (e: Event): void => {
      const d = (e as CustomEvent<BrainStatePayload>).detail;
      if (d) applyBrainStatePayload(d);
    };
    const onSpeakEnd = (): void => {
      if (useBrainStore.getState().behaviorContractPayload) transitionFsmToListening();
    };
    window.addEventListener('cogni:apply-behavior-contract', onContract as EventListener);
    window.addEventListener('avatar:speak:end', onSpeakEnd);
    return () => {
      window.removeEventListener('cogni:apply-behavior-contract', onContract as EventListener);
      window.removeEventListener('avatar:speak:end', onSpeakEnd);
    };
  }, []);

  // PAD → motorSpeedMulRef bridge (no re-render; direct ref writes)
  useEffect(() => {
    const applyPadToMotor = (arousal: number) => {
      const clamped = Math.max(-1, Math.min(1, arousal));
      const padMul = clamped >= 0
        ? 1 + clamped * 0.4
        : 1 + clamped * 0.45;
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const breath =
        now < internalThoughtBreathRef.current.untilMs ? internalThoughtBreathRef.current.mul : 1;
      const rhythm = useBrainStore.getState().userSpeechRhythm;
      const rhythmMul = rhythm === 'fast' ? 1.04 : rhythm === 'slow' ? 0.96 : 1;
      motorSpeedMulRef.current = Math.max(0.55, Math.min(1.4, padMul * breath * rhythmMul));
    };
    const unsub = useBrainStore.subscribe(
      (s) => ({
        arousal: s.pad.arousal,
        thinking: s.thinking,
        isListening: s.physical.isListening,
        rhythm: s.userSpeechRhythm,
      }),
      ({ arousal, thinking, isListening }) => {
        applyPadToMotor(arousal);
        isThinkingRef.current = thinking;
        isListeningRef.current = isListening;
      },
      { equalityFn: (a, b) =>
          Math.abs(a.arousal - b.arousal) < 0.04 &&
          a.thinking === b.thinking &&
          a.isListening === b.isListening &&
          a.rhythm === b.rhythm
      },
    );
    return unsub;
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const onMotor = (e: Event) => {
      const d = (e as CustomEvent<{ mul?: number; durationMs?: number }>).detail;
      const mul = typeof d?.mul === 'number' ? d.mul : 1.07;
      const durationMs = typeof d?.durationMs === 'number' ? d.durationMs : 500;
      internalThoughtBreathRef.current = { untilMs: now() + durationMs, mul };
      const arousal = useBrainStore.getState().pad.arousal;
      const clamped = Math.max(-1, Math.min(1, arousal));
      const padMul = clamped >= 0 ? 1 + clamped * 0.4 : 1 + clamped * 0.45;
      const rhythm = useBrainStore.getState().userSpeechRhythm;
      const rhythmMul = rhythm === 'fast' ? 1.04 : rhythm === 'slow' ? 0.96 : 1;
      motorSpeedMulRef.current = Math.max(0.55, Math.min(1.4, padMul * mul * rhythmMul));
    };
    const onEnd = () => {
      internalThoughtBreathRef.current = { untilMs: 0, mul: 1 };
      const arousal = useBrainStore.getState().pad.arousal;
      const clamped = Math.max(-1, Math.min(1, arousal));
      const padMul = clamped >= 0 ? 1 + clamped * 0.4 : 1 + clamped * 0.45;
      const rhythm = useBrainStore.getState().userSpeechRhythm;
      const rhythmMul = rhythm === 'fast' ? 1.04 : rhythm === 'slow' ? 0.96 : 1;
      motorSpeedMulRef.current = Math.max(0.55, Math.min(1.4, padMul * rhythmMul));
    };
    window.addEventListener(INTERNAL_THOUGHT_MOTOR_EVENT, onMotor as EventListener);
    window.addEventListener(INTERNAL_THOUGHT_END_EVENT, onEnd as EventListener);
    return () => {
      window.removeEventListener(INTERNAL_THOUGHT_MOTOR_EVENT, onMotor as EventListener);
      window.removeEventListener(INTERNAL_THOUGHT_END_EVENT, onEnd as EventListener);
    };
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

      // VRM 1.0: no rotateVRM0 (already faces +Z), no combineSkeletons (causes skinning artifacts on VRM1),
      // no removeUnnecessaryVertices (unnecessary for a production-ready VRM1 model).
      // The model is canonical and was already optimized during UniVRM export.

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

      // ── DIAGNOSTIC: humanoid + skeleton integrity (verbose: NEXT_PUBLIC_DEBUG_AVATAR) ──
      const testBone = loadedVrm.humanoid?.getRawBoneNode('rightUpperArm' as never);
      avatarDebug('[AvatarCanvas] 🔍 Pre-setVrm check:');
      avatarDebug('  humanoid present:', !!loadedVrm.humanoid);
      avatarDebug('  autoUpdateHumanBones:', loadedVrm.humanoid?.autoUpdateHumanBones);
      avatarDebug('  rightUpperArm:', testBone);
      avatarDebug('  hips:', loadedVrm.humanoid?.getRawBoneNode('hips' as never));

      if (loadedVrm.humanoid) {
        const hb = loadedVrm.humanoid.humanBones;
        const presentBones = Object.keys(hb).filter(
          (k) => (hb as Record<string, { node?: unknown }>)[k]?.node != null,
        );
        const nullBones = Object.keys(hb).filter(
          (k) => (hb as Record<string, { node?: unknown }>)[k]?.node == null,
        );
        avatarDebug('[AvatarCanvas] ✅ Present bones:', presentBones);
        avatarDebug('[AvatarCanvas] ❌ Null bones:', nullBones);
      }

      const lift = createLiftNode(loadedVrm);
      setLiftNode(lift);
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
    setLiftNode(null);
    setError(false);
    setLoading(true);

    const loader = new GLTFLoader();
    // VRM 1.0 (cogni.vrm): autoUpdateHumanBones=true (default).
    // VRMSkeletonManager writes ONLY to normalized bones.
    // vrm.update() → humanoid.update() converts normalized→raw per-model correctly.
    // DO NOT set autoUpdateHumanBones=false — breaks procedural animation.
    // DO NOT call setRawPose(getNormalizedPose()) — bypasses per-model transforms.
    loader.register((parser: GLTFParser) => new VRMLoaderPlugin(parser, {
      // expressionPlugin options: only use the 16 preset expressions we actually need.
      // The 317 blendshapes exist in the mesh but VRM manager only exposes preset ones.
      // This is handled automatically — no extra config needed for VRM 1.0.
    }));

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
    const ctx = getSharedAudioContext();
    if (ctx?.state === 'suspended') {
      void ctx.resume().catch(() => { /* ignore */ });
    }
    return ctx;
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
      playbackEnhancerRef.current?.dispose();
      playbackEnhancerRef.current = null;

      const src = ctx.createMediaElementSource(audio);
      const analyser = ctx.createAnalyser();
      analyser.fftSize        = 512;  // more bins → better mouth resolution
      analyser.smoothingTimeConstant = 0.65;
      if (isAvatarAudioEnhancerEnabled()) {
        playbackEnhancerRef.current = attachAvatarPlaybackEnhancement(ctx, src, analyser);
      } else {
        src.connect(analyser);
        analyser.connect(ctx.destination);
      }
      analyserRef.current          = analyser;
      analyserSourceAudioRef.current = audio;
      if (process.env.NODE_ENV === 'development') {
        avatarDebug('[AvatarCanvas] ✅ Analyser wired — lip energy drive active');
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
      setPlaybackAudio(d.audio);
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
        patchTimelineCues(validated);
        visemeCueQueueRef.current = validated;
      }
    };

    // Clear viseme queue and reset LipSync state at end of utterance
    const onVisemesClear = () => {
      visemeCueQueueRef.current = [];
    };

    const onSpeakEnd = () => {
      isTalkingRef.current = false;
      clearAudioTimeline('canvas:speak:end');
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
      analyserSourceAudioRef.current = null;
      playbackEnhancerRef.current?.dispose();
      playbackEnhancerRef.current = null;
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

      // Arm gestures from agent bridge disabled until recalibration
      // if (gesture) {
      //   dispatchAvatar('avatar:gesture', { type: gesture, duration: 2 });
      // }
      void gesture;
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

  useEffect(() => {
    vrmRef.current = vrm;
  }, [vrm]);

  useLayoutEffect(() => {
    vrmRef.current = vrm;
    if (!vrm || !liftNode || !groupRef.current) return;
    captureLowerBodyBindPose();
    applyFootFloorCalib({ vrm, liftNode, group: groupRef.current });
    resetLowerBodyToIdle();
  }, [vrm, liftNode, captureLowerBodyBindPose, resetLowerBodyToIdle]);

  const ax = avatarXZ[0];
  const ay = avatarAnchorPosition[1];
  const az = avatarXZ[1];

  const cameraPosition: [number, number, number] = render3dOfficeRoom
    ? [ax, OFFICE_CAMERA_FACE_Y, az + OFFICE_CAMERA_Z_OFFSET]
    : [0, 1.38, -2.65];
  const orbitTarget: [number, number, number] = render3dOfficeRoom
    ? [ax, ay + OFFICE_LOOK_AT_Y_OFFSET, az]
    : [0, 1.28, 0];

  // ROOT DIV MUST ALWAYS RENDER so r3fEventSourceRef.current is non-null when Canvas mounts.
  // This is the permanent fix for "Cannot read properties of null (reading 'addEventListener')".
  // Loading/error overlays are positioned on top — never use early return before this div.
  return (
    <div ref={r3fEventSourceRef} className="relative w-full h-full bg-[#0a0a12]">
      <MotionTraceOverlay />
      <ObservabilityOverlay />
      {showGestureCalibrationUi() && (
        <>
          <GestureCalibrator />
          {vrm ? <MouseGestureCalibrator vrm={vrm} /> : null}
        </>
      )}
      <BehaviorBrainHost motorSpeedMulRef={motorSpeedMulRef} isTalkingRef={isTalkingRef} />
      {render3dOfficeRoom && showOfficeSceneEditorUi() && (
        <>
          <input
            ref={sceneFileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={onSceneFileChange}
          />
          <div className="pointer-events-auto absolute top-3 right-3 z-30 max-w-[min(100%,18rem)] rounded-lg border border-white/15 bg-black/70 px-3 py-2 text-xs text-gray-200 shadow-lg backdrop-blur-sm">
            <div className="mb-2 font-semibold text-white/90">محرّر المشهد (المكتب)</div>
            <label className="mb-2 flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={sceneEditorEnabled}
                onChange={(e) => {
                  setSceneEditorEnabled(e.target.checked);
                  if (!e.target.checked) {
                    setSceneSelectedUuid(null);
                    setSceneLive(null);
                  }
                }}
                className="accent-sky-500"
              />
              <span>تفعيل التحريك / التحديد</span>
            </label>
            {sceneEditorEnabled && (
              <>
                <div className="mb-2 flex flex-wrap gap-1">
                  {(['translate', 'rotate', 'scale'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setSceneTransformMode(m)}
                      className={`rounded px-2 py-0.5 capitalize ${
                        sceneTransformMode === m
                          ? 'bg-sky-600 text-white'
                          : 'bg-white/10 text-gray-300 hover:bg-white/20'
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
                <label className="mb-2 flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={sceneGizmoVisible}
                    onChange={(e) => setSceneGizmoVisible(e.target.checked)}
                    className="accent-sky-500"
                  />
                  <span>إظهار Gizmo</span>
                </label>
                <div className="mb-2 rounded border border-white/10 bg-black/40 p-2 font-mono text-[10px] leading-relaxed text-gray-300">
                  {sceneLive ? (
                    <>
                      <div className="mb-1 text-sky-300/90">المحدد: {sceneLive.name}</div>
                      <div>pos: {sceneLive.position.map((n) => n.toFixed(3)).join(', ')}</div>
                      <div>rot (rad YXZ): {sceneLive.rotation.map((n) => n.toFixed(3)).join(', ')}</div>
                      <div>scl: {sceneLive.scale.map((n) => n.toFixed(3)).join(', ')}</div>
                    </>
                  ) : (
                    <span className="text-gray-500">
                      انقر على الغرفة لتحريك المحتوى كاملاً (الخلفية ثابتة)…
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-1">
                  <button
                    type="button"
                    onClick={handleSaveOfficeScene}
                    className="rounded bg-emerald-700/90 px-2 py-1 text-white hover:bg-emerald-600"
                  >
                    حفظ JSON
                  </button>
                  <button
                    type="button"
                    onClick={handlePickSceneFile}
                    className="rounded bg-sky-700/90 px-2 py-1 text-white hover:bg-sky-600"
                  >
                    تحميل JSON
                  </button>
                </div>
                <p className="mt-1 text-[10px] text-gray-500">Escape: إخفاء Gizmo وإلغاء التحديد</p>
              </>
            )}
          </div>
        </>
      )}
      {(loading && !error) && (
        <div className="pointer-events-none absolute inset-0 z-10">
          <LoadingFallback />
        </div>
      )}
      {error && (
        <div className="pointer-events-none absolute inset-0 z-10">
          <ErrorFallback />
        </div>
      )}
      <Canvas
        key="avatar-canvas-singleton"
        eventSource={r3fEventSourceRef as React.MutableRefObject<HTMLElement>}
        frameloop="always"
        shadows
        gl={{ powerPreference: 'high-performance', alpha: false, antialias: true }}
        style={{ width: '100%', height: '100%', display: 'block' }}
        onCreated={({ gl }) => {
          gl.outputColorSpace = THREE.SRGBColorSpace;
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.0;
          gl.domElement.addEventListener('webglcontextlost', (e) => {
            e.preventDefault();
            setTimeout(() => window.location.reload(), 800);
          }, { once: true });
        }}
      >
        {/* كاميرا أمام الأفاتار (جهة −Z) مع رؤية المكتب خلفه */}
        <PerspectiveCamera
          makeDefault
          position={cameraPosition}
          fov={45}
          near={0.05}
          far={8000}
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
        <ComfortLightingRig flatImageBackdrop={use2dEnvBackdrop} />
        {use2dEnvBackdrop && <SceneBackgroundTexture url={env2dBackgroundUrl} />}

        {/* ContactShadows removed — room floor is the ground surface now */}

        {/* Fallback floor plane — 2D backdrop or when 3D office is disabled */}
        {!render3dOfficeRoom && (
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
            <planeGeometry args={[20, 20]} />
            <meshStandardMaterial color="#1a1a2e" roughness={0.9} metalness={0.1} />
          </mesh>
        )}

        {!use2dEnvBackdrop && <color attach="background" args={['#1a1a2e']} />}
        {/* fog disabled — was hiding room geometry at Z>4 */}

        <OrbitControls
          makeDefault
          enablePan
          enableZoom
          enableRotate
          minDistance={0.05}
          maxDistance={5000}
          target={orbitTarget}
          minPolarAngle={0}
          maxPolarAngle={Math.PI}
          minAzimuthAngle={-Infinity}
          maxAzimuthAngle={Infinity}
          rotateSpeed={1}
          zoomSpeed={1}
          panSpeed={1}
        />

        <OfficeAvatarCameraFaceSetup
          active={render3dOfficeRoom}
          hasVrm={!!vrm}
          avatarX={ax}
          avatarY={ay}
          avatarZ={az}
        />

        <Suspense fallback={null}>
          {vrm && liftNode && (
            <group
              ref={groupRef}
              name="AvatarRoot"
              position={[avatarXZ[0], avatarAnchorPosition[1], avatarXZ[1]]}
              rotation={[
                0,
                render3dOfficeRoom ? AVATAR_GROUP_ROTATION_Y + Math.PI : AVATAR_GROUP_ROTATION_Y,
                0,
              ]}
              scale={avatarScale}
            >
              {liftNode && <primitive object={liftNode} />}

              <AnimationController
                vrm={vrm}
                isTalkingRef={isTalkingRef}
                neckGazeYawRef={neckGazeYawRef}
                neckGazePitchRef={neckGazePitchRef}
                groupRef={groupRef}
                vrmaActiveRef={vrmaActiveRef}
              />

              <LipSyncManager
                vrm={vrm}
                isTalkingRef={isTalkingRef}
                visemeCueQueueRef={visemeCueQueueRef}
                audioElementRef={audioElementRef}
                analyserRef={analyserRef}
              />

              <VRMAPlayer
                vrm={vrm}
                vrmaActiveRef={vrmaActiveRef}
                vrmaPoseRef={vrmaPoseRef}
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
                vrmaPoseRef={vrmaPoseRef}
              />

              <GenerativeGestureManager
                vrm={vrm}
                isTalkingRef={isTalkingRef}
                wsUrl={generativeGestureWsUrl}
              />

              {liftNode && (
                <FloorLockRuntime
                  vrm={vrm}
                  liftNode={liftNode}
                  groupRef={groupRef}
                />
              )}
              {observabilityEnabled && (
                <ObservabilityR3F enabled={observabilityEnabled} groupRef={groupRef} />
              )}
            </group>
          )}
        </Suspense>

        {/* Isolate GLB failures: missing/wrong URL would otherwise unwind the Canvas + WebGL */}
        <ErrorBoundary fallback={null} resetKeys={[officeGlbUrl]}>
          <Suspense fallback={null}>
            {render3dOfficeRoom && (
              <group name="RoomGroup">
                <group name={ENV_ROOT_NAME} position={[0, 0, 0]} scale={[1, 1, 1]}>
                  <OfficeSceneWithEditor
                    url={officeGlbUrl}
                    position={roomGroupPosition}
                    scale={officeScale}
                    floorProbeXZ={[avatarAnchorPosition[0], avatarAnchorPosition[2]]}
                    editorEnabled={sceneEditorEnabled}
                    transformMode={sceneTransformMode}
                    gizmoVisible={sceneGizmoVisible}
                    selectedUuid={sceneSelectedUuid}
                    onSelect={onOfficeSceneSelect}
                    officeGltfRef={officeGltfRef}
                  />
                </group>
              </group>
            )}
          </Suspense>
        </ErrorBoundary>

        {readDebugFloorGridEnv() && render3dOfficeRoom && <FloorBaselineDebugGrid />}

        {/* Invisible floor — right-click moves the avatar */}
        <FloorClickDetector
          floorY={avatarAnchorPosition[1]}
          onRightClick={onAvatarFloorNavigate}
        />
      </Canvas>

    </div>
  );
}
