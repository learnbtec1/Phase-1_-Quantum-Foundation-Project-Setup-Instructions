import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';

export type FeetFixOptions = {
  enabled: boolean;
  maxPitchDeg?: number;
  maxRollDeg?: number;
  maxYawDeg?: number;
  blend?: number;
};

export type FeetEulerDump = {
  pitchDeg: number;
  yawDeg: number;
  rollDeg: number;
};

type BonePack = {
  leftFoot?: THREE.Object3D;
  rightFoot?: THREE.Object3D;
  leftToes?: THREE.Object3D;
  rightToes?: THREE.Object3D;
  leftLowerLeg?: THREE.Object3D;
  rightLowerLeg?: THREE.Object3D;
};

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

function getHumanoidBone(humanoid: VRM['humanoid'], name: string): THREE.Object3D | undefined {
  if (!humanoid) return undefined;
  const h = humanoid as unknown as {
    getBoneNode?: (n: string) => THREE.Object3D | null;
    getNormalizedBoneNode?: (n: string) => THREE.Object3D | null;
    getRawBoneNode?: (n: string) => THREE.Object3D | null;
  };
  return h.getBoneNode?.(name) ?? h.getNormalizedBoneNode?.(name) ?? h.getRawBoneNode?.(name) ?? undefined;
}

/**
 * Baseline-relative clamp: captures inv(qLower)*qFoot at rest, then each frame limits deviation
 * of that relative rotation (delta from baseline in Euler XYZ) before re-applying.
 * Runs after VRMA mixer; does not touch GroundLock.
 */
export class FeetFixer {
  private bones: BonePack;
  private readonly qRelBaseL = new THREE.Quaternion();
  private readonly qRelBaseR = new THREE.Quaternion();
  private hasBaseL = false;
  private hasBaseR = false;

  private tmpQ = new THREE.Quaternion();
  private tmpQ2 = new THREE.Quaternion();
  private tmpQ3 = new THREE.Quaternion();
  private tmpE = new THREE.Euler();
  private refQ = new THREE.Quaternion();

  constructor(vrm: VRM) {
    const h = vrm.humanoid;
    this.bones = {
      leftFoot: getHumanoidBone(h, 'leftFoot'),
      rightFoot: getHumanoidBone(h, 'rightFoot'),
      leftToes: getHumanoidBone(h, 'leftToes'),
      rightToes: getHumanoidBone(h, 'rightToes'),
      leftLowerLeg: getHumanoidBone(h, 'leftLowerLeg'),
      rightLowerLeg: getHumanoidBone(h, 'rightLowerLeg'),
    };
  }

  /**
   * Call once after VRM + skeleton are ready (before or after first mixer tick).
   * Stores qRelBase = inv(qLowerWorld) * qFootWorld per side.
   */
  captureBaseline(): void {
    const cap = (lower: THREE.Object3D | undefined, foot: THREE.Object3D | undefined, target: THREE.Quaternion) => {
      if (!lower || !foot) return false;
      lower.getWorldQuaternion(this.tmpQ);
      this.tmpQ3.copy(this.tmpQ).invert();
      foot.getWorldQuaternion(this.tmpQ2);
      target.copy(this.tmpQ3).multiply(this.tmpQ2);
      return true;
    };
    this.hasBaseL = cap(this.bones.leftLowerLeg, this.bones.leftFoot, this.qRelBaseL);
    this.hasBaseR = cap(this.bones.rightLowerLeg, this.bones.rightFoot, this.qRelBaseR);
  }

  private eulerFromQRel(lower: THREE.Object3D | undefined, foot: THREE.Object3D | undefined): FeetEulerDump | null {
    if (!lower || !foot) return null;
    lower.getWorldQuaternion(this.tmpQ);
    this.tmpQ3.copy(this.tmpQ).invert();
    foot.getWorldQuaternion(this.tmpQ2);
    this.tmpQ.copy(this.tmpQ3).multiply(this.tmpQ2);
    this.tmpE.setFromQuaternion(this.tmpQ, 'XYZ');
    return {
      pitchDeg: this.tmpE.x * RAD2DEG,
      yawDeg: this.tmpE.y * RAD2DEG,
      rollDeg: this.tmpE.z * RAD2DEG,
    };
  }

  /** Current relative foot↔lowerLeg Euler (XYZ) per side — for `window.__feetFix.dump()`. */
  dumpDiagnostics(): {
    has: boolean;
    left?: FeetEulerDump;
    right?: FeetEulerDump;
  } {
    return {
      has: true,
      left: this.eulerFromQRel(this.bones.leftLowerLeg, this.bones.leftFoot) ?? undefined,
      right: this.eulerFromQRel(this.bones.rightLowerLeg, this.bones.rightFoot) ?? undefined,
    };
  }

  private clampFootRotation(
    lowerLeg: THREE.Object3D | undefined,
    foot: THREE.Object3D | undefined,
    qRelBase: THREE.Quaternion,
    hasBase: boolean,
    opt: Required<Pick<FeetFixOptions, 'maxPitchDeg' | 'maxRollDeg' | 'maxYawDeg' | 'blend'>> & { enabled: boolean },
  ): void {
    if (!hasBase || !lowerLeg || !foot) return;
    const parent = foot.parent;
    if (!parent) return;

    lowerLeg.getWorldQuaternion(this.tmpQ);
    this.tmpQ3.copy(this.tmpQ).invert();
    foot.getWorldQuaternion(this.tmpQ2);
    this.tmpQ.copy(this.tmpQ3).multiply(this.tmpQ2);

    this.refQ.copy(qRelBase).invert();
    this.tmpQ2.copy(this.refQ).multiply(this.tmpQ);

    this.tmpE.setFromQuaternion(this.tmpQ2, 'XYZ');
    const maxPitch = opt.maxPitchDeg * DEG2RAD;
    const maxRoll = opt.maxRollDeg * DEG2RAD;
    const maxYaw = opt.maxYawDeg * DEG2RAD;
    this.tmpE.set(
      THREE.MathUtils.clamp(this.tmpE.x, -maxPitch, maxPitch),
      THREE.MathUtils.clamp(this.tmpE.y, -maxYaw, maxYaw),
      THREE.MathUtils.clamp(this.tmpE.z, -maxRoll, maxRoll),
    );
    this.tmpQ.setFromEuler(this.tmpE);

    this.tmpQ3.copy(qRelBase).multiply(this.tmpQ);

    lowerLeg.getWorldQuaternion(this.tmpQ);
    this.refQ.copy(this.tmpQ).multiply(this.tmpQ3);

    foot.getWorldQuaternion(this.tmpQ2);
    this.tmpQ.copy(this.tmpQ2).slerp(this.refQ, opt.blend);

    parent.getWorldQuaternion(this.tmpQ3);
    this.tmpQ2.copy(this.tmpQ3).invert();
    this.tmpQ2.multiply(this.tmpQ);
    foot.quaternion.copy(this.tmpQ2);
    foot.updateMatrixWorld(true);
  }

  apply(options?: FeetFixOptions): void {
    const opt: Required<Pick<FeetFixOptions, 'maxPitchDeg' | 'maxRollDeg' | 'maxYawDeg' | 'blend'>> & {
      enabled: boolean;
    } = {
      enabled: options?.enabled ?? true,
      maxPitchDeg: options?.maxPitchDeg ?? 35,
      maxRollDeg: options?.maxRollDeg ?? 12,
      maxYawDeg: options?.maxYawDeg ?? 12,
      blend: options?.blend ?? 0.75,
    };
    if (!opt.enabled) return;

    const { leftFoot, rightFoot, leftLowerLeg, rightLowerLeg } = this.bones;
    this.clampFootRotation(leftLowerLeg, leftFoot, this.qRelBaseL, this.hasBaseL, opt);
    this.clampFootRotation(rightLowerLeg, rightFoot, this.qRelBaseR, this.hasBaseR, opt);
  }
}

/** Strip foot/toe/ankle tracks from a clip (diagnostic: VRMA vs bind). */
export function pruneFootTracksFromClip(clip: THREE.AnimationClip): THREE.AnimationClip {
  const bad = /(Foot|Toe|Ankle|Ball|Heel)/i;
  const tracks = clip.tracks.filter((t) => !bad.test(t.name));
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}
