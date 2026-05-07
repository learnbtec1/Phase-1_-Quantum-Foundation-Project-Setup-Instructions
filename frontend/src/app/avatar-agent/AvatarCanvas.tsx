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
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import {
  PerspectiveCamera,
  OrbitControls,
  Text,
} from '@react-three/drei';
import {
  GLTFLoader,
  type GLTF,
  type GLTFParser,
} from 'three/examples/jsm/loaders/GLTFLoader.js';


import { VRMLoaderPlugin, VRM } from '@pixiv/three-vrm';
import { DiagnosticsOverlay } from '@/lib/diagnostics/diagnosticsOverlay';
import {
  startDiagnosticsAnalyzer,
  stopDiagnosticsAnalyzer,
} from '@/lib/diagnostics/diagnosticsAnalyzer';
import {
  startRuntimeTimelineRecorder,
  stopRuntimeTimelineRecorder,
} from '@/lib/diagnostics/runtimeTimelineRecorder';
import {
  startEmbodiedRuntimeNervousSystem,
  stopEmbodiedRuntimeNervousSystem,
} from '@/lib/forensics/EmbodiedRuntimeNervousSystem';
import {
  startAutonomousRuntimeRepairGovernor,
  stopAutonomousRuntimeRepairGovernor,
} from '@/lib/repair/AutonomousRuntimeRepairGovernor';
import {
  startEmbodiedCognitiveCore,
  stopEmbodiedCognitiveCore,
} from '@/lib/cognition/EmbodiedCognitiveCore';
import { useBrainStore } from '@/store/useBrainStore';
import { initBrainPersistence, flushBrainPersistence } from '@/lib/brainPersistence';
import { recordPersonalitySessionVisit } from '@/ai/avatar/personalityMemory';
import { initMasterClockSession } from '@/lib/avatar/masterClock';
import { initSpeechLifecycleGuard } from '@/lib/avatar/speechLifecycleGuard';
import { applyBrainStatePayload, transitionFsmToListening } from '@/lib/avatar/behaviorExecutionContract';
import type { BrainStatePayload } from '@/lib/avatar/brainStatePayload';
import { clearAudioTimeline, patchTimelineCues, setPlaybackAudio, clearVisemeTimelineCues, type AudioTimelineSource } from '@/lib/avatar/audioTimeline';
import { initAvatarVoiceListener } from '@/ai/io/tts';
import { startSpontaneousBehavior, stopSpontaneousBehavior } from '@/lib/behavior/SpontaneousBehavior';
import { CameraUpLock } from './CameraUpLock';
import ComfortLightingRig from '@/components/ComfortLightingRig';
import LipSyncManager, { type VisemeCue } from './LipSyncManager';
import { AnimationController } from './AnimationController';
import { VRMSkeletonManager } from './VRMSkeletonManager';
import { VRMAPlayer } from './VRMAPlayer';
import type { BonePoseMap } from './motion/PoseComposer';
import { GenerativeGestureManager } from './GenerativeGestureManager';
import { BehaviorBrainHost } from './behavior';
import { MotionTraceOverlay } from './MotionTraceOverlay';
import AvatarDebugOverlay from '@/components/avatar-debug-overlay';
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
  getAvatarOfficeScenePosition,
  pickVrmUrl,
  AVATAR_EQUIRECT_ENV_PUBLIC_PATH,
  AVATAR_OFFICE_SCENE_DEFAULTS,
  PHYSICS_CONFIG,
  readDebugFloorGridEnv,
  getWorldFloorY,
  showGestureCalibrationUi,
  useAvatarBoundedRoomScene,
  useAvatarEquirectSceneBackground,
  useCognieHtmlBackdropUnderCanvas,
  readAvatarStandYOffsetEnv,
  readBoundedFootCalibYOffsetM,
} from '@/config/avatar';
import { clearDeskScene, resolveIfEnabled } from './physics/WorldColliders';
import { createAvatarPerformanceHandler } from '@/app/avatar-agent/avatarPerformanceBridge';
import {
  applyFootFloorCalib,
  createLiftNode,
  runWorldFloorAntiDriftFrame,
} from '@/app/avatar-agent/floorLockV121';
import { ROOM_BOUNDS, getDefaultStandXZ } from '@/app/avatar-agent/scene/RoomShell';
import { BoundedMiniRoom } from '@/app/avatar-agent/scene/BoundedMiniRoom';
import { isObservabilityEnabled } from '@/lib/observability/config';
import { ObservabilityOverlay } from '@/lib/observability/ObservabilityOverlay';
import { ObservabilityR3F } from '@/lib/observability/ObservabilityR3F';
import { EquirectSceneEnvironment } from './EquirectSceneEnvironment';

const LOWER_BONES_FLOOR = [
  'leftUpperLeg',
  'leftLowerLeg',
  'leftFoot',
  'rightUpperLeg',
  'rightLowerLeg',
  'rightFoot',
] as const;

/**
 * World-floor lock — `applyFootFloorCalib` on mount (parent) + per-frame anti-drift.
 * Bounded room passes `footTargetWorldY = ROOM_BOUNDS.floorY + sole gap`; legacy uses `getWorldFloorY()`.
 * Vertical correction is ONLY `liftNode.position.y`; do not clamp AvatarRoot Y to `ROOM_BOUNDS.floorY`.
 */
function FloorLockRuntime({
  vrm,
  liftNode,
  groupRef,
  footTargetWorldY,
}: {
  vrm: VRM;
  liftNode: THREE.Group;
  groupRef: React.RefObject<THREE.Group | null>;
  footTargetWorldY?: number;
}) {
  const liftDebugFrameRef = useRef(0);
  const finalStateLogMsRef = useRef(0);
  useFrame(() => {
    const g = groupRef.current;
    if (g) {
      runWorldFloorAntiDriftFrame(vrm, liftNode, g, footTargetWorldY);
    }
    // ── [FINAL_STATE] throttled diagnostic (1 s) ─────────────────────────────
    // Single-line summary covering foot grounding + arm idle state. Lets you
    // confirm at a glance: feet at floor, liftNode steady, arms not in T-pose.
    const _now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (_now - finalStateLogMsRef.current > 1000) {
      finalStateLogMsRef.current = _now;
      let footY: number | null = null;
      try {
        const h = vrm.humanoid as {
          getNormalizedBoneNode?: (n: string) => THREE.Object3D | undefined;
        };
        const lf = h.getNormalizedBoneNode?.('leftFoot');
        const rf = h.getNormalizedBoneNode?.('rightFoot');
        if (lf && rf && g) {
          g.updateMatrixWorld(true);
          const lp = new THREE.Vector3(); lf.getWorldPosition(lp);
          const rp = new THREE.Vector3(); rf.getWorldPosition(rp);
          footY = (lp.y + rp.y) * 0.5;
        }
      } catch { /* ignore */ }
      const w = typeof window !== 'undefined'
        ? (window as Window & {
            __armDebug?: unknown;
            __motionInput?: { speaking?: boolean; energy?: number };
          })
        : null;
      const speaking = !!w?.__motionInput?.speaking;
      const energy = w?.__motionInput?.energy ?? 0;
      // eslint-disable-next-line no-console
      console.log('[FINAL_STATE]', {
        footY: footY === null ? null : +footY.toFixed(4),
        liftNodeY: +liftNode.position.y.toFixed(4),
        targetFloorY: typeof footTargetWorldY === 'number' ? footTargetWorldY : getWorldFloorY(),
        isIdle: !speaking && energy < 0.01,
        speaking,
        energy,
        armRotation: w?.__armDebug ?? null,
      });
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

/** Office panorama / equirect path — elevated wide framing. */
// Camera eye height: 1.55 m targets face centre of a 1.70-1.75 m VRM avatar.
const OFFICE_CAMERA_FACE_Y = 1.55;
/** Bounded 6×6 room: eye height ≈1.6 m — matches real interior perspective (less “top-down”). */
const OFFICE_CAMERA_FACE_Y_BOUNDED = 1.55;
const OFFICE_CAMERA_Z_OFFSET = 3.5;
/**
 * Bounded room: camera on **−Z** world axis at `avatarZ − offset`, sight line **+Z** toward avatar face.
 * VRM native forward is **+Z**; offset magnitude (~5.5–6 m) matches the bounded-room framing FOV.
 */
const OFFICE_CAMERA_Z_OFFSET_BOUNDED_ROOM = 4.2;
/** Look-at height from avatar feet - face centre of a 1.70 m VRM (both modes). */
const OFFICE_LOOK_AT_Y_OFFSET = 1.55;
/** Look-at ≈ face/chest height from avatar root (feet) — aligns with avatar integration. */
const OFFICE_LOOK_AT_Y_OFFSET_BOUNDED = 1.55;
/** Tight horizontal FOV for bounded room atlas / façade (see product art direction). */
const BOUNDED_ROOM_CAMERA_FOV = 40;
const OFFICE_CAMERA_LABEL_Y = 0.3;

function OfficeAvatarCameraFaceSetup({
  active,
  hasVrm,
  avatarX,
  avatarY,
  avatarZ,
  cameraEyeY,
  cameraZOffset,
  lookAtYOffset,
}: {
  active: boolean;
  hasVrm: boolean;
  avatarX: number;
  avatarY: number;
  avatarZ: number;
  cameraEyeY: number;
  cameraZOffset: number;
  lookAtYOffset: number;
}) {
  const { camera, controls } = useThree();
  const appliedRef = useRef(false);

  useLayoutEffect(() => {
    if (!active || !hasVrm || appliedRef.current) return;
    appliedRef.current = true;
    const look = new THREE.Vector3(avatarX, avatarY + lookAtYOffset, avatarZ);
    camera.position.set(avatarX, cameraEyeY, avatarZ - cameraZOffset);
    camera.lookAt(look);
    const ctrl = controls as { target?: THREE.Vector3; update?: () => void } | undefined;
    if (ctrl?.target && typeof ctrl.update === 'function') {
      ctrl.target.copy(look);
      ctrl.update();
    }
  }, [
    active,
    hasVrm,
    avatarX,
    avatarY,
    avatarZ,
    camera,
    controls,
    cameraEyeY,
    cameraZOffset,
    lookAtYOffset,
  ]);

  if (!active || !hasVrm) return null;

  const cx = avatarX;
  const cz = avatarZ - cameraZOffset;
  const labelY = cameraEyeY + OFFICE_CAMERA_LABEL_Y;

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
  const boundedRoomScene = useAvatarBoundedRoomScene();
  const cognieHtmlBackdrop =
    useCognieHtmlBackdropUnderCanvas() && !boundedRoomScene;
  const equirectSceneBg =
    useAvatarEquirectSceneBackground() && !boundedRoomScene;
  const canvasAlpha = cognieHtmlBackdrop && !equirectSceneBg;

  /** Bounded room: avatar root on `ROOM_BOUNDS.floorY` so atlas floor plane matches foot calibration baseline. */
  const resolvedAvatarPosition = useMemo((): [number, number, number] => {
    if (!boundedRoomScene) return avatarPosition;
    const { x, z } = getDefaultStandXZ(ROOM_BOUNDS);
    return [x, ROOM_BOUNDS.floorY + readAvatarStandYOffsetEnv(), z];
  }, [boundedRoomScene, avatarPosition]);

  /** Bounded room foot snap target: room floor + VRM bone→sole gap (default 0.10 m). Omit = use `getWorldFloorY()`. */
  const boundedFootCalibTargetY = useMemo((): number | undefined => {
    if (!boundedRoomScene) return undefined;
    return ROOM_BOUNDS.floorY + readBoundedFootCalibYOffsetM();
  }, [boundedRoomScene]);

  const [vrm, setVrm] = useState<VRM | null>(null);
  const [error, setError] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  // Right-click → move avatar to floor position (starts at desk position)
  const [avatarXZ, setAvatarXZ] = useState<[number, number]>([
    boundedRoomScene ? getDefaultStandXZ(ROOM_BOUNDS).x : avatarPosition[0],
    boundedRoomScene ? getDefaultStandXZ(ROOM_BOUNDS).z : avatarPosition[2],
  ]);
  const floorClickScratchRef = useRef(new THREE.Vector3());
  const onAvatarFloorNavigate = useCallback(
    (x: number, z: number) => {
      const v = floorClickScratchRef.current;
      v.set(x, resolvedAvatarPosition[1], z);
      resolveIfEnabled(v, PHYSICS_CONFIG.avatar.capsuleRadius);
      setAvatarXZ([v.x, v.z]);
    },
    [resolvedAvatarPosition[1]],
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

  useEffect(() => {
    clearDeskScene();
    return () => clearDeskScene();
  }, []);

  const spontaneousBehaviorEnabled = true;

  useEffect(() => {
    // Speech-lifecycle guard MUST init first — registers capture-phase listeners
    // for `avatar:speak:start` / `avatar:speak:end` before any consumer effect
    // attaches. Blocks premature/overlapping events with [SPEAK_RACE_CONDITION].
    initSpeechLifecycleGuard();
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
    startDiagnosticsAnalyzer();
    startRuntimeTimelineRecorder();
    startEmbodiedRuntimeNervousSystem();
    startEmbodiedCognitiveCore();
    if ((process.env.NEXT_PUBLIC_AUTONOMOUS_REPAIR_GOVERNOR ?? '').trim() === '1') {
      startAutonomousRuntimeRepairGovernor();
    }
    return () => {
      stopAutonomousRuntimeRepairGovernor();
      stopEmbodiedCognitiveCore();
      stopEmbodiedRuntimeNervousSystem();
      stopRuntimeTimelineRecorder();
      stopDiagnosticsAnalyzer();
    };
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
      const src = ctx.createMediaElementSource(audio);
      const analyser = ctx.createAnalyser();
      analyser.fftSize        = 512;  // more bins → better mouth resolution
      // Lowered 0.65 → 0.50: energy rises faster at speech onset so the
      // motion pipeline (VRMSkeletonManager → tickUnifiedEnergy) sees
      // non-zero RMS within the first render frame after play() resolves.
      analyser.smoothingTimeConstant = 0.50;
      src.connect(analyser);
      analyser.connect(ctx.destination);
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
      const d = (e as CustomEvent<{ cues?: unknown[]; source?: AudioTimelineSource }>).detail;
      if (!Array.isArray(d?.cues) || d.cues.length === 0) return;
      // Accept both { t, id } (VisemeCue) and raw WS shapes — cast to shared contract
      const validated = (d.cues as Array<{ t?: unknown; id?: unknown }>)
        .filter(c => typeof c.t === 'number' && typeof c.id === 'number')
        .map(c => ({ t: c.t as number, id: c.id as number }));
      if (validated.length > 0) {
        patchTimelineCues(validated, d.source);
        visemeCueQueueRef.current = validated;
      }
    };

    // Clear viseme queue and reset LipSync state at end of utterance
    const onVisemesClear = () => {
      clearVisemeTimelineCues();
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

      // ─────────────────────────────────────────────────────────────────────
      // GESTURE PATH POLICY — read before re-enabling.
      // Arm gestures arrive on TWO independent code paths:
      //   1.  useAgentAgent.ts → unifiedGestureEngine.play(...) + structured
      //       performance[] / gestures[] from agent_ws.py.   ← canonical path.
      //   2.  This handler (cogni-agent-bridge / agent:message → "gesture").
      // Re-dispatching `avatar:gesture` here would fire the same gesture twice
      // (once via the engine, once raw), causing visible double-triggering and
      // race conditions in gesture timing.  This branch is therefore muted.
      // If you need to re-enable it, route through unifiedGestureEngine.play
      // with an idempotency key, NOT raw dispatchAvatar('avatar:gesture').
      // ─────────────────────────────────────────────────────────────────────
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
    applyFootFloorCalib({
      vrm,
      liftNode,
      group: groupRef.current,
      footTargetWorldY: boundedFootCalibTargetY,
    });
    resetLowerBodyToIdle();
  }, [vrm, liftNode, boundedFootCalibTargetY, captureLowerBodyBindPose, resetLowerBodyToIdle]);

  /** Signals `useAgentAgent` to arm hands-free VAD — must fire after VRM + lift node exist (was never dispatched before). */
  useEffect(() => {
    if (typeof window === 'undefined' || !vrm || !liftNode) return;
    queueMicrotask(() => {
      window.dispatchEvent(
        new CustomEvent('avatar:scene:ready', { detail: { source: 'AvatarCanvas' as const } }),
      );
      if (process.env.NODE_ENV === 'development') {
        // eslint-disable-next-line no-console -- post-orientation calibration sanity marker
        console.info('[POST_ALIGNMENT_OK]', true);
      }
    });
  }, [vrm, liftNode]);

  const ax = avatarXZ[0];
  const ay = resolvedAvatarPosition[1];
  const az = avatarXZ[1];

  const cameraZOff = boundedRoomScene ? OFFICE_CAMERA_Z_OFFSET_BOUNDED_ROOM : OFFICE_CAMERA_Z_OFFSET;
  const cameraEyeY = boundedRoomScene ? OFFICE_CAMERA_FACE_Y_BOUNDED : OFFICE_CAMERA_FACE_Y;
  const lookYOffset = boundedRoomScene ? OFFICE_LOOK_AT_Y_OFFSET_BOUNDED : OFFICE_LOOK_AT_Y_OFFSET;
  const perspectiveFov = boundedRoomScene ? BOUNDED_ROOM_CAMERA_FOV : 45;

  // Camera is placed on −Z looking toward +Z (avatar front). See `config/avatar.ts` global axes.
  /** +Y up, +Z forward (VRM). Camera on −Z side; positive `cameraZOff` = distance along −Z from avatar. */
  const cameraPosition: [number, number, number] = [
    ax,
    cameraEyeY,
    az - cameraZOff,
  ];
  const orbitTarget: [number, number, number] = [ax, ay + lookYOffset, az];

  // ROOT DIV MUST ALWAYS RENDER so r3fEventSourceRef.current is non-null when Canvas mounts.
  // This is the permanent fix for "Cannot read properties of null (reading 'addEventListener')".
  // Loading/error overlays are positioned on top — never use early return before this div.
  return (
    <div ref={r3fEventSourceRef} className="relative h-full w-full bg-transparent">
      <MotionTraceOverlay />
      <AvatarDebugOverlay />
      <ObservabilityOverlay />
      {showGestureCalibrationUi() && (
        <>
          <GestureCalibrator />
          {vrm ? <MouseGestureCalibrator vrm={vrm} /> : null}
        </>
      )}
      <BehaviorBrainHost motorSpeedMulRef={motorSpeedMulRef} isTalkingRef={isTalkingRef} />
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
        eventSource={r3fEventSourceRef as React.RefObject<HTMLElement>}
        frameloop="always"
        shadows
        gl={{ powerPreference: 'high-performance', alpha: canvasAlpha, antialias: true }}
        style={{ width: '100%', height: '100%', display: 'block' }}
        onCreated={({ gl }) => {
          gl.outputColorSpace = THREE.SRGBColorSpace;
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.0;
          if (canvasAlpha) {
            gl.setClearColor(0x000000, 0);
          } else if (boundedRoomScene) {
            gl.setClearColor(0x0b0f14, 1);
          } else if (equirectSceneBg) {
            gl.setClearColor(0x000000, 1);
          } else {
            gl.setClearColor(0x1a1a2e, 1);
          }
          gl.domElement.addEventListener('webglcontextlost', (e) => {
            e.preventDefault();
            setTimeout(() => window.location.reload(), 800);
          }, { once: true });
        }}
      >
        {/* كاميرا على محور −Z تنظر نحو +Z (وجه VRM الافتراضي) */}
        <PerspectiveCamera
          makeDefault
          position={cameraPosition}
          fov={perspectiveFov}
          near={0.05}
          far={8000}
        />

        <CameraUpLock />
        {/*
          ComfortLightingRig يوفر:
            • ambientLight + hemisphereLight + pointLight
            • directionalLight (key) مع castShadow + shadow-mapSize 2048×2048
            • directionalLight fill + rim (castShadow=false)
            • Environment preset="apartment" (يُعطّل عند تفعيل equirect الاستوديو)
          → لا نُكرّر أياً منها هنا لتجنّب ضوءَي shadow-casting في نفس الـ Canvas،
            وهو ما تسبّب في "undefined.shadowIntensity" (فشل تهيئة directionalLightShadows).
        */}
        <ComfortLightingRig
          skipEnvironmentMap={equirectSceneBg || boundedRoomScene}
          roomInteriorBoost={boundedRoomScene}
        />

        {boundedRoomScene ? <BoundedMiniRoom /> : null}

        {equirectSceneBg && (
          <Suspense fallback={null}>
            <EquirectSceneEnvironment url={AVATAR_EQUIRECT_ENV_PUBLIC_PATH} />
          </Suspense>
        )}

        {boundedRoomScene ? <color attach="background" args={['#0b0f14']} /> : null}
        {!boundedRoomScene && !equirectSceneBg && !cognieHtmlBackdrop && (
          <color attach="background" args={['#1a1a2e']} />
        )}
        {/* fog disabled — was hiding room geometry at Z>4 */}

        <OrbitControls
          makeDefault
          enablePan
          enableZoom
          enableRotate
          minDistance={0.05}
          maxDistance={boundedRoomScene ? 11 : 5000}
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
          active={!!vrm}
          hasVrm={!!vrm}
          avatarX={ax}
          avatarY={ay}
          avatarZ={az}
          cameraEyeY={cameraEyeY}
          cameraZOffset={cameraZOff}
          lookAtYOffset={lookYOffset}
        />

        <Suspense fallback={null}>
          {vrm && liftNode && (
            <group
              ref={groupRef}
              name="AvatarRoot"
              position={[avatarXZ[0], resolvedAvatarPosition[1], avatarXZ[1]]}
              rotation={[0, 0, 0]}
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
                  footTargetWorldY={boundedFootCalibTargetY}
                />
              )}
              {observabilityEnabled && (
                <ObservabilityR3F enabled={observabilityEnabled} groupRef={groupRef} />
              )}
            </group>
          )}
        </Suspense>

        {readDebugFloorGridEnv() ? <FloorBaselineDebugGrid /> : null}

        {/* Invisible floor — right-click moves the avatar */}
        <FloorClickDetector
          floorY={boundedRoomScene ? ROOM_BOUNDS.floorY : resolvedAvatarPosition[1]}
          onRightClick={onAvatarFloorNavigate}
        />
      </Canvas>

      {process.env.NEXT_PUBLIC_DIAGNOSTICS_OVERLAY === 'true' ? <DiagnosticsOverlay /> : null}

    </div>
  );
}
