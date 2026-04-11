'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas, createPortal, useFrame } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, TransformControls } from '@react-three/drei';
import { GLTFLoader, type GLTFParser } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm';
import { FORWARD_ROTATION_Y, pickVrmUrl } from '@/config/avatar';
import { ARM_OFFSETS, composeArmTargets } from '@/app/avatar-agent/armGestureReference';

type DirArrow = {
  key: string;
  label: string;
  color: string;
  dir: THREE.Vector3;
};

const ARROWS: DirArrow[] = [
  { key: 'front', label: 'Front', color: '#ef4444', dir: new THREE.Vector3(0, 0, 1) },
  { key: 'back', label: 'Back', color: '#22c55e', dir: new THREE.Vector3(0, 0, -1) },
  { key: 'up', label: 'Up', color: '#06b6d4', dir: new THREE.Vector3(0, 1, 0) },
  { key: 'down', label: 'Down', color: '#f97316', dir: new THREE.Vector3(0, -1, 0) },
  { key: 'right', label: 'Right', color: '#3b82f6', dir: new THREE.Vector3(1, 0, 0) },
  { key: 'left', label: 'Left', color: '#d946ef', dir: new THREE.Vector3(-1, 0, 0) },
];

type BoneName =
  | 'head'
  | 'neck'
  | 'rightUpperArm'
  | 'rightLowerArm'
  | 'rightHand'
  | 'leftUpperArm'
  | 'leftLowerArm'
  | 'leftHand';

type RotState = { x: number; y: number; z: number };
type PoseProfile = Record<BoneName, RotState>;
type GestureName = 'idle' | 'think' | 'explain' | 'agree' | 'wave' | 'test_elbow' | 'manual';
type ArmJoint = 'shoulder' | 'elbow' | 'wrist';
type ArmSide = 'right' | 'left';
type CamPose = {
  position: [number, number, number];
  target: [number, number, number];
};

const BONE_OPTIONS: Array<{ value: BoneName; label: string }> = [
  { value: 'head', label: 'Head' },
  { value: 'neck', label: 'Neck' },
  { value: 'rightUpperArm', label: 'Right Upper Arm' },
  { value: 'rightLowerArm', label: 'Right Lower Arm' },
  { value: 'rightHand', label: 'Right Hand' },
  { value: 'leftUpperArm', label: 'Left Upper Arm' },
  { value: 'leftLowerArm', label: 'Left Lower Arm' },
  { value: 'leftHand', label: 'Left Hand' },
];

const ROT_MIN = -2.2;
const ROT_MAX = 2.2;

/**
 * Avatar side mapping (confirmed during manual calibration):
 * This booth model behaves mirrored for arm naming, so avatar RIGHT is driven by left* bones.
 * Keep this ON unless a future model re-calibration proves otherwise.
 */
/**
 * 195_Uta01.vrm faces −Z natively (no π rotation needed) → arms are NOT mirrored.
 * avaturn_avatar.vrm needed π rotation → arms appeared mirrored → was true.
 * Set to false for any model that faces the camera without FORWARD_ROTATION_Y.
 */
const USE_MIRRORED_ARM_SIDE_MAPPING = false;

function clampRot(v: number): number {
  return THREE.MathUtils.clamp(v, ROT_MIN, ROT_MAX);
}

function makeEmptyPose(): PoseProfile {
  const zero: RotState = { x: 0, y: 0, z: 0 };
  return {
    head: { ...zero },
    neck: { ...zero },
    rightUpperArm: { ...zero },
    rightLowerArm: { ...zero },
    rightHand: { ...zero },
    leftUpperArm: { ...zero },
    leftLowerArm: { ...zero },
    leftHand: { ...zero },
  };
}

const POSE_PRESETS: Record<'think_base' | 'explain_base' | 'agree_base', PoseProfile> = {
  think_base: {
    ...makeEmptyPose(),
    head: { x: -0.1, y: 0.12, z: 0.06 },
    neck: { x: -0.06, y: 0.08, z: 0.03 },
    rightUpperArm: { x: -0.35, y: 0.18, z: 0.28 },
    rightLowerArm: { x: -0.52, y: 0.09, z: 0.16 },
    rightHand: { x: -0.08, y: 0.05, z: 0.05 },
  },
  explain_base: {
    ...makeEmptyPose(),
    head: { x: -0.04, y: 0.04, z: 0 },
    neck: { x: -0.02, y: 0.02, z: 0 },
    rightUpperArm: { x: -0.45, y: 0.22, z: 0.36 },
    rightLowerArm: { x: -0.4, y: 0.12, z: 0.22 },
    rightHand: { x: -0.1, y: 0.08, z: 0.06 },
    leftUpperArm: { x: -0.2, y: -0.1, z: -0.14 },
  },
  agree_base: {
    ...makeEmptyPose(),
    head: { x: 0.12, y: 0, z: 0 },
    neck: { x: 0.06, y: 0, z: 0 },
    rightUpperArm: { x: -0.1, y: 0.04, z: 0.08 },
    leftUpperArm: { x: -0.1, y: -0.04, z: -0.08 },
  },
};

/** Same composed targets as VRMSkeletonManager `test_elbow` (ARM_IDLE + ARM_OFFSETS). */
const _ARM_TEST_ELBOW_COMPOSED = composeArmTargets(ARM_OFFSETS.test_elbow);

const GESTURE_POSES: Record<'idle' | 'think' | 'explain' | 'agree' | 'wave' | 'test_elbow', PoseProfile> = {
  idle: {
    ...makeEmptyPose(),
    head: { x: -0.02, y: 0, z: 0 },
    neck: { x: -0.01, y: 0, z: 0 },
    rightUpperArm: { x: -0.12, y: 0.04, z: 0.08 },
    rightLowerArm: { x: -0.1, y: 0.02, z: 0.04 },
    leftUpperArm: { x: -0.12, y: -0.04, z: -0.08 },
    leftLowerArm: { x: -0.1, y: -0.02, z: -0.04 },
  },
  think: {
    ...POSE_PRESETS.think_base,
    head: { x: -0.12, y: 0.16, z: 0.08 },
    neck: { x: -0.08, y: 0.11, z: 0.05 },
    rightUpperArm: { x: -0.46, y: 0.26, z: 0.38 },
    rightLowerArm: { x: -0.62, y: 0.17, z: 0.28 },
    rightHand: { x: -0.15, y: 0.11, z: 0.12 },
  },
  explain: {
    ...POSE_PRESETS.explain_base,
    rightUpperArm: { x: -0.56, y: 0.3, z: 0.52 },
    rightLowerArm: { x: -0.48, y: 0.18, z: 0.34 },
    rightHand: { x: -0.12, y: 0.13, z: 0.2 },
    leftUpperArm: { x: -0.28, y: -0.14, z: -0.2 },
  },
  agree: POSE_PRESETS.agree_base,
  wave: {
    ...makeEmptyPose(),
    head: { x: 0.06, y: 0.01, z: 0 },
    neck: { x: 0, y: 0, z: 0 },
    rightUpperArm: { x: -1.13, y: 0.22, z: 0.51 },
    rightLowerArm: { x: 2.2, y: 1.42, z: -2.2 },
    rightHand: { x: 0, y: 0, z: 0 },
    leftUpperArm: { x: 0.95, y: -0.12, z: -0.28 },
    leftLowerArm: { x: 0.55, y: -0.06, z: -0.16 },
    leftHand: { x: 0.2, y: -0.03, z: -0.08 },
  },
  test_elbow: {
    ...makeEmptyPose(),
    head: { x: -0.02, y: 0, z: 0 },
    neck: { x: -0.01, y: 0, z: 0 },
    rightUpperArm: {
      x: _ARM_TEST_ELBOW_COMPOSED.ruaX,
      y: _ARM_TEST_ELBOW_COMPOSED.ruaY,
      z: _ARM_TEST_ELBOW_COMPOSED.ruaZ,
    },
    rightLowerArm: {
      x: _ARM_TEST_ELBOW_COMPOSED.rlaX,
      y: 0,
      z: _ARM_TEST_ELBOW_COMPOSED.rlaZ,
    },
    rightHand: {
      x: _ARM_TEST_ELBOW_COMPOSED.rhX,
      y: _ARM_TEST_ELBOW_COMPOSED.rhY,
      z: _ARM_TEST_ELBOW_COMPOSED.rhZ,
    },
    leftUpperArm: {
      x: _ARM_TEST_ELBOW_COMPOSED.luaX,
      y: _ARM_TEST_ELBOW_COMPOSED.luaY,
      z: _ARM_TEST_ELBOW_COMPOSED.luaZ,
    },
    leftLowerArm: {
      x: _ARM_TEST_ELBOW_COMPOSED.llaX,
      y: 0,
      z: _ARM_TEST_ELBOW_COMPOSED.llaZ,
    },
    leftHand: {
      x: _ARM_TEST_ELBOW_COMPOSED.lhX,
      y: _ARM_TEST_ELBOW_COMPOSED.lhY,
      z: _ARM_TEST_ELBOW_COMPOSED.lhZ,
    },
  },
};

function capturePose(vrm: VRM | null): PoseProfile {
  const pose = makeEmptyPose();
  if (!vrm) return pose;

  for (const opt of BONE_OPTIONS) {
    const node = getBoneNode(vrm, opt.value);
    if (!node) continue;
    pose[opt.value] = {
      x: clampRot(node.rotation.x),
      y: clampRot(node.rotation.y),
      z: clampRot(node.rotation.z),
    };
  }
  return pose;
}

function applyPose(vrm: VRM | null, pose: PoseProfile): void {
  if (!vrm) return;
  for (const opt of BONE_OPTIONS) {
    const node = getBoneNode(vrm, opt.value);
    if (!node) continue;
    const rot = pose[opt.value];
    node.rotation.set(clampRot(rot.x), clampRot(rot.y), clampRot(rot.z));
  }
}

function parsePoseProfile(raw: unknown): PoseProfile | null {
  if (!raw || typeof raw !== 'object') return null;
  const src = raw as Record<string, unknown>;
  const parsed = makeEmptyPose();

  for (const opt of BONE_OPTIONS) {
    const v = src[opt.value];
    if (!v || typeof v !== 'object') continue;
    const r = v as Record<string, unknown>;
    const x = typeof r.x === 'number' ? clampRot(r.x) : 0;
    const y = typeof r.y === 'number' ? clampRot(r.y) : 0;
    const z = typeof r.z === 'number' ? clampRot(r.z) : 0;
    parsed[opt.value] = { x, y, z };
  }
  return parsed;
}

function getArmBones(vrm: VRM | null, side: ArmSide): Record<ArmJoint, THREE.Object3D | null> {
  const upper = USE_MIRRORED_ARM_SIDE_MAPPING
    ? (side === 'right' ? 'leftUpperArm' : 'rightUpperArm')
    : (side === 'right' ? 'rightUpperArm' : 'leftUpperArm');
  const lower = USE_MIRRORED_ARM_SIDE_MAPPING
    ? (side === 'right' ? 'leftLowerArm' : 'rightLowerArm')
    : (side === 'right' ? 'rightLowerArm' : 'leftLowerArm');
  const hand = USE_MIRRORED_ARM_SIDE_MAPPING
    ? (side === 'right' ? 'leftHand' : 'rightHand')
    : (side === 'right' ? 'rightHand' : 'leftHand');
  return {
    shoulder: getBoneNode(vrm, upper),
    elbow: getBoneNode(vrm, lower),
    wrist: getBoneNode(vrm, hand),
  };
}

function readArmPose(vrm: VRM | null, side: ArmSide): Record<ArmJoint, RotState> {
  const bones = getArmBones(vrm, side);
  const toRot = (node: THREE.Object3D | null): RotState => ({
    x: clampRot(node?.rotation.x ?? 0),
    y: clampRot(node?.rotation.y ?? 0),
    z: clampRot(node?.rotation.z ?? 0),
  });
  return {
    shoulder: toRot(bones.shoulder),
    elbow: toRot(bones.elbow),
    wrist: toRot(bones.wrist),
  };
}

function getBoneNode(vrm: VRM | null, boneName: BoneName): THREE.Object3D | null {
  if (!vrm?.humanoid) return null;
  // In VRM runtime with autoUpdateHumanBones=true, drive normalized bones.
  const normalized = vrm.humanoid.getNormalizedBoneNode(boneName as never);
  if (normalized) return normalized;
  return vrm.humanoid.getRawBoneNode(boneName as never);
}

function BonePoint({
  bone,
  color,
}: {
  bone: THREE.Object3D | null;
  color: string;
}) {
  if (!bone) return null;
  return createPortal(
    <mesh>
      <sphereGeometry args={[0.03, 16, 16]} />
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.35} />
    </mesh>,
    bone,
  );
}

function RightArmRigControls({
  vrm,
  side,
  enabled,
  selectedJoint,
  onDragChange,
}: {
  vrm: VRM;
  side: ArmSide;
  enabled: boolean;
  selectedJoint: ArmJoint;
  onDragChange: (dragging: boolean) => void;
}) {
  const bones = useMemo(() => getArmBones(vrm, side), [vrm, side]);
  const activeBone = bones[selectedJoint];
  const hasAllBones = !!bones.shoulder && !!bones.elbow && !!bones.wrist;

  return (
    <>
      <BonePoint bone={bones.shoulder} color="#3b82f6" />
      <BonePoint bone={bones.elbow} color="#f97316" />
      <BonePoint bone={bones.wrist} color="#22c55e" />

      {enabled && activeBone ? (
        <TransformControls
          key={`${side}-${selectedJoint}`}
          object={activeBone}
          mode="rotate"
          space="local"
          size={1.15}
          onMouseDown={() => onDragChange(true)}
          onMouseUp={() => onDragChange(false)}
        />
      ) : null}

      {!hasAllBones ? null : null}
    </>
  );
}

function DirectionArrows() {
  const origin = useMemo(() => new THREE.Vector3(0, 1.25, 0), []);
  const helpers = useMemo(
    () =>
      ARROWS.map((arrow) => ({
        ...arrow,
        helper: new THREE.ArrowHelper(arrow.dir.clone().normalize(), origin, 0.45, arrow.color, 0.09, 0.05),
      })),
    [origin],
  );

  return (
    <group>
      {helpers.map((arrow) => (
        <primitive
          key={arrow.key}
          object={arrow.helper}
        />
      ))}
      <mesh position={[0, 1.25, 0]}>
        <sphereGeometry args={[0.02, 12, 12]} />
        <meshStandardMaterial color="#f8fafc" />
      </mesh>
    </group>
  );
}

function VrmPreview({
  vrm,
  targetPose,
  activeGesture,
  gestureStartedAt,
  manualRigEnabled,
}: {
  vrm: VRM;
  targetPose: PoseProfile;
  activeGesture: GestureName;
  gestureStartedAt: number;
  manualRigEnabled: boolean;
}) {
  useFrame((_, delta) => {
    if (!manualRigEnabled) {
      const t = (Date.now() - gestureStartedAt) / 1000;
      const blend = 1 - Math.exp(-delta * 9);

      for (const opt of BONE_OPTIONS) {
        const node = getBoneNode(vrm, opt.value);
        if (!node) continue;
        const base = targetPose[opt.value];
        let tx = base.x;
        let ty = base.y;
        let tz = base.z;

        if (activeGesture === 'wave' && opt.value === 'rightHand') {
          // Right wrist live wave motion.
          ty += Math.sin(t * 8.2) * 0.35;
          tz += Math.sin(t * 8.2 + 0.8) * 0.22;
        } else if (activeGesture === 'agree' && (opt.value === 'head' || opt.value === 'neck')) {
          tx += Math.sin(t * 6.5) * 0.09;
        } else if (activeGesture === 'think' && opt.value === 'head') {
          ty += Math.sin(t * 2.2) * 0.02;
        }

        node.rotation.x = THREE.MathUtils.lerp(node.rotation.x, clampRot(tx), blend);
        node.rotation.y = THREE.MathUtils.lerp(node.rotation.y, clampRot(ty), blend);
        node.rotation.z = THREE.MathUtils.lerp(node.rotation.z, clampRot(tz), blend);
      }
    }

    vrm.update(delta);
  });

  return (
    <group position={[0, -0.14, 0.26]} scale={0.88} rotation={[0, FORWARD_ROTATION_Y, 0]}>
      <primitive object={vrm.scene} />
    </group>
  );
}

export default function AvatarMotionLabPage() {
  const vrmUrl = pickVrmUrl();
  const eventSourceRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<{
    target: THREE.Vector3;
    update: () => void;
  } | null>(null);
  const [vrm, setVrm] = useState<VRM | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedBone, setSelectedBone] = useState<BoneName>('head');
  const [rotation, setRotation] = useState<RotState>({ x: 0, y: 0, z: 0 });
  const [capturedPose, setCapturedPose] = useState<PoseProfile | null>(null);
  const [ioMessage, setIoMessage] = useState<string>('');
  const [targetPose, setTargetPose] = useState<PoseProfile>(GESTURE_POSES.idle);
  const [activeGesture, setActiveGesture] = useState<GestureName>('idle');
  const [gestureStartedAt, setGestureStartedAt] = useState<number>(Date.now());
  const [manualRigEnabled, setManualRigEnabled] = useState<boolean>(true);
  const [rigDragging, setRigDragging] = useState<boolean>(false);
  const [rigSide, setRigSide] = useState<ArmSide>('right');
  const [selectedJoint, setSelectedJoint] = useState<ArmJoint>('shoulder');
  const [cameraPose, setCameraPose] = useState<CamPose>({
    position: [0, 1.55, -3.45],
    target: [0, 1.35, 0.2],
  });
  const [armPose, setArmPose] = useState<Record<ArmJoint, RotState>>({
    shoulder: { x: 0, y: 0, z: 0 },
    elbow: { x: 0, y: 0, z: 0 },
    wrist: { x: 0, y: 0, z: 0 },
  });
  const importInputRef = useRef<HTMLInputElement>(null);
  const activeArmBones = useMemo(() => getArmBones(vrm, rigSide), [vrm, rigSide]);

  useEffect(() => {
    let cancelled = false;
    const loader = new GLTFLoader();
    loader.register((parser: GLTFParser) => new VRMLoaderPlugin(parser));

    loader.load(
      vrmUrl,
      (gltf) => {
        if (cancelled) return;
        const loaded = (gltf.userData.vrm as VRM | undefined) ?? null;
        if (!loaded) {
          setLoadError('VRM not found in loaded glTF.');
          return;
        }
        // Ensure avatar faces camera regardless of metaVersion field presence
        VRMUtils.rotateVRM0(loaded);
        setLoadError(null);
        setVrm(loaded);
      },
      undefined,
      (err) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : 'Failed to load VRM model.');
      },
    );

    return () => {
      cancelled = true;
    };
  }, [vrmUrl]);

  const selectedBoneNode = useMemo(() => getBoneNode(vrm, selectedBone), [vrm, selectedBone]);
  const elbowNode = useMemo(
    () => getBoneNode(vrm, rigSide === 'right' ? 'rightLowerArm' : 'leftLowerArm'),
    [vrm, rigSide],
  );

  useEffect(() => {
    if (!selectedBoneNode) return;
    setRotation({
      x: clampRot(selectedBoneNode.rotation.x),
      y: clampRot(selectedBoneNode.rotation.y),
      z: clampRot(selectedBoneNode.rotation.z),
    });
  }, [selectedBoneNode]);

  useEffect(() => {
    if (!selectedBoneNode) return;
    selectedBoneNode.rotation.set(clampRot(rotation.x), clampRot(rotation.y), clampRot(rotation.z));
  }, [rotation, selectedBoneNode]);

  const onAxis = (axis: keyof RotState, value: number) => {
    setActiveGesture('manual');
    setRotation((prev) => ({ ...prev, [axis]: clampRot(value) }));
  };

  const resetSelectedBone = () => {
    setActiveGesture('manual');
    setRotation({ x: 0, y: 0, z: 0 });
    if (selectedBoneNode) {
      selectedBoneNode.rotation.set(0, 0, 0);
    }
  };

  const refreshSelectedFromScene = () => {
    const node = getBoneNode(vrm, selectedBone);
    if (!node) return;
    setRotation({
      x: clampRot(node.rotation.x),
      y: clampRot(node.rotation.y),
      z: clampRot(node.rotation.z),
    });
  };

  useEffect(() => {
    if (!vrm) return;
    const id = window.setInterval(() => {
      setArmPose(readArmPose(vrm, rigSide));
    }, 120);
    return () => window.clearInterval(id);
  }, [vrm, manualRigEnabled, selectedJoint, rigSide]);

  const captureCurrentPose = () => {
    const snap = capturePose(vrm);
    setCapturedPose(snap);
    setIoMessage('Pose captured from current avatar state.');
  };

  const applyCapturedPose = () => {
    if (!capturedPose) return;
    setActiveGesture('manual');
    setTargetPose(capturedPose);
    setGestureStartedAt(Date.now());
    applyPose(vrm, capturedPose);
    refreshSelectedFromScene();
    setIoMessage('Captured pose applied.');
  };

  const applyPresetPose = (presetKey: keyof typeof POSE_PRESETS) => {
    setActiveGesture('manual');
    setTargetPose(POSE_PRESETS[presetKey]);
    setGestureStartedAt(Date.now());
    applyPose(vrm, POSE_PRESETS[presetKey]);
    refreshSelectedFromScene();
    setIoMessage(`Preset applied: ${presetKey}`);
  };

  const triggerGesture = (gesture: Exclude<GestureName, 'manual'>) => {
    if (manualRigEnabled) {
      setManualRigEnabled(false);
    }
    setActiveGesture(gesture);
    setTargetPose(GESTURE_POSES[gesture]);
    setGestureStartedAt(Date.now());
    setIoMessage(
      gesture === 'test_elbow'
        ? 'Gesture playing: test_elbow (diagnostic — [TEST_ELBOW] logs appear on /avatar-agent with VRMSkeletonManager).'
        : `Gesture playing: ${gesture}`,
    );
  };

  const copyRightArmPoseJson = async () => {
    const payload =
      rigSide === 'right'
        ? {
            rightUpperArm: armPose.shoulder,
            rightLowerArm: armPose.elbow,
            rightHand: armPose.wrist,
          }
        : {
            leftUpperArm: armPose.shoulder,
            leftLowerArm: armPose.elbow,
            leftHand: armPose.wrist,
          };
    const text = JSON.stringify(payload, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      setIoMessage(`${rigSide}-arm pose JSON copied to clipboard.`);
    } catch {
      setIoMessage('Copy failed. You can copy values manually from the panel.');
    }
  };

  const resetCameraView = () => {
    const next: CamPose = {
      position: [0, 1.55, -3.45],
      target: [0, 1.35, 0.2],
    };
    setCameraPose(next);
    if (controlsRef.current) {
      controlsRef.current.target.set(...next.target);
      controlsRef.current.update();
    }
    setIoMessage('Camera reset for full upper-body visibility.');
  };

  const setElbowAxis = (axis: keyof RotState, value: number) => {
    if (!elbowNode) return;
    const next = clampRot(value);
    if (axis === 'x') elbowNode.rotation.x = next;
    if (axis === 'y') elbowNode.rotation.y = next;
    if (axis === 'z') elbowNode.rotation.z = next;
    setArmPose((prev) => ({
      ...prev,
      elbow: {
        ...prev.elbow,
        [axis]: next,
      },
    }));
    setActiveGesture('manual');
    setIoMessage('Elbow adjusted from rig panel.');
  };

  const exportPoseJson = () => {
    const payload = capturedPose ?? capturePose(vrm);
    const fileBody = JSON.stringify(payload, null, 2);
    const blob = new Blob([fileBody], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'pose-profile.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setIoMessage('pose-profile.json exported.');
  };

  const onImportJsonClick = () => {
    importInputRef.current?.click();
  };

  const onImportFile: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const f = e.target.files?.[0];
    e.currentTarget.value = '';
    if (!f) return;
    try {
      const txt = await f.text();
      const raw = JSON.parse(txt) as unknown;
      const parsed = parsePoseProfile(raw);
      if (!parsed) {
        setIoMessage('Invalid JSON pose file.');
        return;
      }
      setCapturedPose(parsed);
      applyPose(vrm, parsed);
      refreshSelectedFromScene();
      setIoMessage(`Imported pose from ${f.name}`);
    } catch {
      setIoMessage('Failed to import pose file.');
    }
  };

  return (
    <div className="relative h-screen w-screen bg-[#0a0a12] text-white" ref={eventSourceRef}>
      <Canvas
        eventSource={eventSourceRef as React.RefObject<HTMLElement>}
        frameloop="always"
        gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
        style={{ width: '100%', height: '100%', display: 'block' }}
        onCreated={({ gl }) => {
          gl.outputColorSpace = THREE.SRGBColorSpace;
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1;
        }}
      >
        <PerspectiveCamera
          makeDefault
          position={cameraPose.position}
          fov={45}
          near={0.05}
          far={120}
        />

        <ambientLight intensity={0.6} />
        <hemisphereLight args={['#ffffff', '#0f172a', 0.55]} />
        <directionalLight position={[3, 5, -3]} intensity={1.35} castShadow />
        <gridHelper args={[10, 10, '#334155', '#1e293b']} position={[0, 0, 0]} />

        <DirectionArrows />
        {vrm ? (
          <VrmPreview
            vrm={vrm}
            targetPose={targetPose}
            activeGesture={activeGesture}
            gestureStartedAt={gestureStartedAt}
            manualRigEnabled={manualRigEnabled}
          />
        ) : null}
        {vrm ? (
          <RightArmRigControls
            key={`rig-${rigSide}-${selectedJoint}-${manualRigEnabled ? 'on' : 'off'}`}
            vrm={vrm}
            side={rigSide}
            enabled={manualRigEnabled}
            selectedJoint={selectedJoint}
            onDragChange={setRigDragging}
          />
        ) : null}

        <OrbitControls
          ref={(ref) => {
            controlsRef.current = ref
              ? {
                  target: ref.target,
                  update: () => ref.update(),
                }
              : null;
          }}
          enableRotate={!rigDragging}
          enableZoom={!rigDragging}
          enablePan={!rigDragging}
          target={cameraPose.target}
          minDistance={0.5}
          maxDistance={10}
        />
      </Canvas>

      <div className="pointer-events-none absolute left-4 top-4 rounded-md bg-black/55 p-3 text-xs leading-5">
        <div className="mb-1 text-sm font-semibold text-lime-300">Direction Sanity Check (Step 0)</div>
        <div>Avatar is forced to face camera on first load.</div>
        <div className="mt-2">Step 0 confirmed. You can now test bones with sliders.</div>
      </div>

      <div className="pointer-events-none absolute right-4 top-4 rounded-md bg-black/55 p-3 text-xs leading-5">
        <div className="mb-1 text-sm font-semibold text-cyan-200">Color Legend</div>
        {ARROWS.map((arrow) => (
          <div key={arrow.key} className="flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: arrow.color }} />
            <span>{arrow.label}</span>
          </div>
        ))}
      </div>

      <div className="absolute bottom-20 left-4 z-20 w-[360px] rounded-md bg-black/70 p-3 text-xs">
        <div className="mb-2 text-sm font-semibold text-amber-200">Bone Control Panel</div>

        <div className="mb-3 rounded border border-slate-700 bg-slate-900/60 p-2">
          <div className="mb-2 text-sm font-semibold text-yellow-200">Arm Rig (3 Points)</div>
          <div className="mb-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setManualRigEnabled((v) => !v);
                setActiveGesture('manual');
                setIoMessage('Manual rig toggled.');
              }}
              className="rounded bg-yellow-700 px-2 py-1 text-white hover:bg-yellow-600"
            >
              {manualRigEnabled ? 'Disable Rig' : 'Enable Rig'}
            </button>
            <button
              type="button"
              onClick={copyRightArmPoseJson}
              className="rounded bg-emerald-700 px-2 py-1 text-white hover:bg-emerald-600"
            >
              Copy {rigSide === 'right' ? 'Right' : 'Left'} Arm JSON
            </button>
          </div>

          <div className="mb-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setRigSide('right')}
              className="rounded bg-slate-700 px-2 py-1 text-white hover:bg-slate-600"
            >
              Avatar Right (confirmed)
            </button>
            <button
              type="button"
              onClick={() => setRigSide('left')}
              className="rounded bg-slate-700 px-2 py-1 text-white hover:bg-slate-600"
            >
              Avatar Left
            </button>
          </div>

          <div className="mb-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setSelectedJoint('shoulder')}
              className="rounded bg-slate-700 px-2 py-1 text-white hover:bg-slate-600"
            >
              Shoulder Point
            </button>
            <button
              type="button"
              onClick={() => setSelectedJoint('elbow')}
              className="rounded bg-slate-700 px-2 py-1 text-white hover:bg-slate-600"
            >
              Elbow Point
            </button>
            <button
              type="button"
              onClick={() => setSelectedJoint('wrist')}
              className="rounded bg-slate-700 px-2 py-1 text-white hover:bg-slate-600"
            >
              Wrist Point
            </button>
          </div>

          <div className="rounded bg-slate-950/60 p-2 leading-5 text-slate-200">
            <div>Manual mode is ON by default.</div>
            <div>Left mouse: drag the active gizmo to rotate selected point.</div>
            <div>Camera rotate/pan is paused while manual rig is enabled.</div>
            <div>Rig side: {rigSide}</div>
            <div>Mapping mode: {USE_MIRRORED_ARM_SIDE_MAPPING ? 'mirrored (booth-calibrated)' : 'normal'}</div>
            <div>
              Bones found: {activeArmBones.shoulder ? 'S' : '-'} {activeArmBones.elbow ? 'E' : '-'} {activeArmBones.wrist ? 'W' : '-'}
            </div>
            <div>Selected point: {selectedJoint}</div>
            <div>Shoulder: x {armPose.shoulder.x.toFixed(2)} | y {armPose.shoulder.y.toFixed(2)} | z {armPose.shoulder.z.toFixed(2)}</div>
            <div>Elbow: x {armPose.elbow.x.toFixed(2)} | y {armPose.elbow.y.toFixed(2)} | z {armPose.elbow.z.toFixed(2)}</div>
            <div>Wrist: x {armPose.wrist.x.toFixed(2)} | y {armPose.wrist.y.toFixed(2)} | z {armPose.wrist.z.toFixed(2)}</div>
          </div>

          <div className="mt-2 rounded bg-slate-950/60 p-2">
            <div className="mb-1 text-xs font-semibold text-orange-200">Elbow Direct Control ({rigSide})</div>
            {(['x', 'y', 'z'] as const).map((axis) => (
              <label key={`elbow-${axis}`} className="mb-1 block">
                <div className="mb-1 flex items-center justify-between text-[11px] text-gray-200">
                  <span>Elbow {axis.toUpperCase()}</span>
                  <span>{armPose.elbow[axis].toFixed(2)} rad</span>
                </div>
                <input
                  type="range"
                  min={ROT_MIN}
                  max={ROT_MAX}
                  step={0.01}
                  value={armPose.elbow[axis]}
                  onChange={(e) => setElbowAxis(axis, Number(e.target.value))}
                  className="w-full"
                />
              </label>
            ))}
          </div>
        </div>

        <label className="mb-2 block">
          <span className="mb-1 block text-gray-200">Selected Bone</span>
          <select
            className="w-full rounded border border-slate-600 bg-slate-900 px-2 py-1 text-white"
            value={selectedBone}
            onChange={(e) => setSelectedBone(e.target.value as BoneName)}
          >
            {BONE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        {(['x', 'y', 'z'] as const).map((axis) => (
          <label key={axis} className="mb-2 block">
            <div className="mb-1 flex items-center justify-between text-gray-200">
              <span>Rotation {axis.toUpperCase()}</span>
              <span>{rotation[axis].toFixed(2)} rad</span>
            </div>
            <input
              type="range"
              min={ROT_MIN}
              max={ROT_MAX}
              step={0.01}
              value={rotation[axis]}
              onChange={(e) => onAxis(axis, Number(e.target.value))}
              className="w-full"
            />
          </label>
        ))}

        <button
          type="button"
          onClick={resetSelectedBone}
          className="mt-1 rounded bg-sky-700 px-3 py-1.5 text-white hover:bg-sky-600"
        >
          Reset Selected Bone
        </button>

        <div className="mt-3 border-t border-slate-700 pt-3">
          <div className="mb-2 text-sm font-semibold text-emerald-200">Pose Lab</div>
          <div className="mb-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={captureCurrentPose}
              className="rounded bg-emerald-700 px-2 py-1 text-white hover:bg-emerald-600"
            >
              Capture Pose
            </button>
            <button
              type="button"
              onClick={applyCapturedPose}
              className="rounded bg-indigo-700 px-2 py-1 text-white hover:bg-indigo-600 disabled:opacity-50"
              disabled={!capturedPose}
            >
              Apply Captured
            </button>
            <button
              type="button"
              onClick={exportPoseJson}
              className="rounded bg-slate-700 px-2 py-1 text-white hover:bg-slate-600"
            >
              Export JSON
            </button>
            <button
              type="button"
              onClick={onImportJsonClick}
              className="rounded bg-violet-700 px-2 py-1 text-white hover:bg-violet-600"
            >
              Import JSON
            </button>
            <input
              ref={importInputRef}
              type="file"
              accept="application/json,.json"
              onChange={onImportFile}
              className="hidden"
            />
          </div>

          <div className="mb-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => applyPresetPose('think_base')}
              className="rounded bg-cyan-700 px-2 py-1 text-white hover:bg-cyan-600"
            >
              think_base
            </button>
            <button
              type="button"
              onClick={() => applyPresetPose('explain_base')}
              className="rounded bg-cyan-700 px-2 py-1 text-white hover:bg-cyan-600"
            >
              explain_base
            </button>
            <button
              type="button"
              onClick={() => applyPresetPose('agree_base')}
              className="rounded bg-cyan-700 px-2 py-1 text-white hover:bg-cyan-600"
            >
              agree_base
            </button>
          </div>
        </div>

        <div className="mt-3 rounded bg-slate-900/70 p-2 leading-5 text-slate-200">
          <div>Bone: {selectedBone}</div>
          <div>Status: {selectedBoneNode ? 'found' : 'missing'}</div>
          <div>x: {clampRot(rotation.x).toFixed(2)}</div>
          <div>y: {clampRot(rotation.y).toFixed(2)}</div>
          <div>z: {clampRot(rotation.z).toFixed(2)}</div>
          <div>Active gesture: {activeGesture}</div>
          <div>Captured pose: {capturedPose ? 'yes' : 'no'}</div>
          {ioMessage ? <div className="text-emerald-300">{ioMessage}</div> : null}
          {loadError ? <div className="text-rose-300">Load error: {loadError}</div> : null}
        </div>
      </div>

      <div className="absolute bottom-4 left-1/2 z-30 -translate-x-1/2 rounded-md bg-black/80 p-2">
        <div className="flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => triggerGesture('agree')}
            className="rounded bg-cyan-700 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-600"
          >
            Agree
          </button>
          <button
            type="button"
            onClick={() => triggerGesture('wave')}
            className="rounded bg-cyan-700 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-600"
          >
            Wave
          </button>
          <button
            type="button"
            title="Diagnostic: same composed arm targets as VRMSkeletonManager test_elbow"
            onClick={() => triggerGesture('test_elbow')}
            className="rounded border-2 border-amber-400 bg-amber-950/90 px-3 py-2 text-xs font-semibold text-amber-100 hover:bg-amber-900/90"
          >
            test_elbow
          </button>
          <button
            type="button"
            onClick={resetCameraView}
            className="rounded bg-amber-700 px-3 py-2 text-xs text-white hover:bg-amber-600"
          >
            Reset Camera
          </button>
        </div>
      </div>
    </div>
  );
}
