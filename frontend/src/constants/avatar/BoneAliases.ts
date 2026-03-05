/**
 * Aliases per bone key to support VRM / Mixamo / Avaturn naming differences.
 * Resolution: find the first actual bone name present in the scene for each canonical key.
 *
 * Usage:
 *   scene.traverse(obj => {
 *     if (!obj.isBone) return;
 *     for (const [key, aliases] of Object.entries(BoneAliases)) {
 *       if (aliases.some(a => obj.name === a || obj.name.toLowerCase().includes(a.toLowerCase()))) {
 *         map.set(key as BoneName, obj as THREE.Bone); break;
 *       }
 *     }
 *   });
 */
import type { BoneName } from './BoneNames';
import { BoneNames } from './BoneNames';

export const BoneAliases: Record<BoneName, string[]> = {
  // ── Torso ─────────────────────────────────────────────────────────────────
  [BoneNames.HIPS]: [
    'Hips', 'hips', 'J_Bip_C_Hips', 'mixamorigHips', 'Root', 'pelvis',
  ],
  [BoneNames.SPINE]: [
    'Spine', 'spine', 'J_Bip_C_Spine', 'mixamorigSpine',
    'Spine01', 'Spine1', 'UpperBody',
  ],
  [BoneNames.CHEST]: [
    'Chest', 'chest', 'J_Bip_C_Chest', 'mixamorigSpine1',
    'Spine02', 'Spine2', 'UpperBody2',
  ],
  [BoneNames.UPPER_CHEST]: [
    'UpperChest', 'upperChest', 'J_Bip_C_UpperChest', 'mixamorigSpine2',
    'Spine03', 'Spine3',
  ],
  [BoneNames.NECK]: [
    'Neck', 'neck', 'J_Bip_C_Neck', 'mixamorigNeck',
  ],
  [BoneNames.HEAD]: [
    'Head', 'head', 'J_Bip_C_Head', 'mixamorigHead', 'Bip001_Head',
  ],
  [BoneNames.JAW]: [
    'Jaw', 'jaw', 'J_Bip_C_Jaw', 'mixamorigJaw', 'Bip001_Jaw',
  ],
  [BoneNames.LEFT_EYE]: [
    'LeftEye', 'leftEye', 'Eye_L', 'L_Eye', 'mixamorigLeftEye',
  ],
  [BoneNames.RIGHT_EYE]: [
    'RightEye', 'rightEye', 'Eye_R', 'R_Eye', 'mixamorigRightEye',
  ],

  // ── Left arm ──────────────────────────────────────────────────────────────
  [BoneNames.LEFT_SHOULDER]: [
    'LeftShoulder', 'leftShoulder', 'J_Bip_L_Shoulder', 'mixamorigLeftShoulder',
    'Shoulder_L', 'L_Shoulder',
  ],
  [BoneNames.LEFT_UPPER_ARM]: [
    'LeftUpperArm', 'LeftArm', 'leftUpperArm', 'J_Bip_L_UpperArm',
    'mixamorigLeftArm', 'UpperArm_L', 'L_UpperArm', 'LeftArmUpper',
  ],
  [BoneNames.LEFT_LOWER_ARM]: [
    'LeftLowerArm', 'LeftForeArm', 'leftLowerArm', 'J_Bip_L_LowerArm',
    'mixamorigLeftForeArm', 'LowerArm_L', 'Forearm_L', 'L_LowerArm', 'LeftForearm',
  ],
  [BoneNames.LEFT_HAND]: [
    'LeftHand', 'leftHand', 'J_Bip_L_Hand', 'mixamorigLeftHand',
    'Hand_L', 'L_Hand', 'LeftWrist',
  ],

  // ── Right arm ─────────────────────────────────────────────────────────────
  [BoneNames.RIGHT_SHOULDER]: [
    'RightShoulder', 'rightShoulder', 'J_Bip_R_Shoulder', 'mixamorigRightShoulder',
    'Shoulder_R', 'R_Shoulder',
  ],
  [BoneNames.RIGHT_UPPER_ARM]: [
    'RightUpperArm', 'RightArm', 'rightUpperArm', 'J_Bip_R_UpperArm',
    'mixamorigRightArm', 'UpperArm_R', 'R_UpperArm', 'RightArmUpper',
  ],
  [BoneNames.RIGHT_LOWER_ARM]: [
    'RightLowerArm', 'RightForeArm', 'rightLowerArm', 'J_Bip_R_LowerArm',
    'mixamorigRightForeArm', 'LowerArm_R', 'Forearm_R', 'R_LowerArm', 'RightForearm',
  ],
  [BoneNames.RIGHT_HAND]: [
    'RightHand', 'rightHand', 'J_Bip_R_Hand', 'mixamorigRightHand',
    'Hand_R', 'R_Hand', 'RightWrist',
  ],

  // ── Left leg ──────────────────────────────────────────────────────────────
  [BoneNames.LEFT_UPPER_LEG]: [
    'LeftUpLeg', 'LeftUpperLeg', 'leftUpperLeg', 'J_Bip_L_UpperLeg',
    'mixamorigLeftUpLeg', 'UpperLeg_L', 'Thigh_L', 'L_Thigh', 'LeftThigh',
  ],
  [BoneNames.LEFT_LOWER_LEG]: [
    'LeftLeg', 'LeftLowerLeg', 'leftLowerLeg', 'J_Bip_L_LowerLeg',
    'mixamorigLeftLeg', 'LowerLeg_L', 'Calf_L', 'L_Calf', 'LeftCalf',
  ],
  [BoneNames.LEFT_FOOT]: [
    'LeftFoot', 'leftFoot', 'J_Bip_L_Foot', 'mixamorigLeftFoot',
    'Foot_L', 'L_Foot', 'LeftAnkle',
  ],
  [BoneNames.LEFT_TOES]: [
    'LeftToeBase', 'leftToes', 'J_Bip_L_ToeBase', 'mixamorigLeftToeBase',
    'Toes_L', 'L_Toe',
  ],

  // ── Right leg ─────────────────────────────────────────────────────────────
  [BoneNames.RIGHT_UPPER_LEG]: [
    'RightUpLeg', 'RightUpperLeg', 'rightUpperLeg', 'J_Bip_R_UpperLeg',
    'mixamorigRightUpLeg', 'UpperLeg_R', 'Thigh_R', 'R_Thigh', 'RightThigh',
  ],
  [BoneNames.RIGHT_LOWER_LEG]: [
    'RightLeg', 'RightLowerLeg', 'rightLowerLeg', 'J_Bip_R_LowerLeg',
    'mixamorigRightLeg', 'LowerLeg_R', 'Calf_R', 'R_Calf', 'RightCalf',
  ],
  [BoneNames.RIGHT_FOOT]: [
    'RightFoot', 'rightFoot', 'J_Bip_R_Foot', 'mixamorigRightFoot',
    'Foot_R', 'R_Foot', 'RightAnkle',
  ],
  [BoneNames.RIGHT_TOES]: [
    'RightToeBase', 'rightToes', 'J_Bip_R_ToeBase', 'mixamorigRightToeBase',
    'Toes_R', 'R_Toe',
  ],

  // ── Left fingers ──────────────────────────────────────────────────────────
  [BoneNames.LEFT_THUMB_METACARPAL]:    ['LeftThumb1', 'LeftThumbMeta', 'mixamorigLeftHandThumb1', 'J_Bip_L_Thumb1'],
  [BoneNames.LEFT_THUMB_PROXIMAL]:      ['LeftThumb2', 'mixamorigLeftHandThumb2', 'J_Bip_L_Thumb2'],
  [BoneNames.LEFT_THUMB_DISTAL]:        ['LeftThumb3', 'mixamorigLeftHandThumb3', 'J_Bip_L_Thumb3'],
  [BoneNames.LEFT_INDEX_PROXIMAL]:      ['LeftIndex1', 'mixamorigLeftHandIndex1', 'J_Bip_L_Index1'],
  [BoneNames.LEFT_INDEX_INTERMEDIATE]:  ['LeftIndex2', 'mixamorigLeftHandIndex2', 'J_Bip_L_Index2'],
  [BoneNames.LEFT_INDEX_DISTAL]:        ['LeftIndex3', 'mixamorigLeftHandIndex3', 'J_Bip_L_Index3'],
  [BoneNames.LEFT_MIDDLE_PROXIMAL]:     ['LeftMiddle1', 'mixamorigLeftHandMiddle1', 'J_Bip_L_Middle1'],
  [BoneNames.LEFT_MIDDLE_INTERMEDIATE]: ['LeftMiddle2', 'mixamorigLeftHandMiddle2', 'J_Bip_L_Middle2'],
  [BoneNames.LEFT_MIDDLE_DISTAL]:       ['LeftMiddle3', 'mixamorigLeftHandMiddle3', 'J_Bip_L_Middle3'],
  [BoneNames.LEFT_RING_PROXIMAL]:       ['LeftRing1',   'mixamorigLeftHandRing1',   'J_Bip_L_Ring1'],
  [BoneNames.LEFT_RING_INTERMEDIATE]:   ['LeftRing2',   'mixamorigLeftHandRing2',   'J_Bip_L_Ring2'],
  [BoneNames.LEFT_RING_DISTAL]:         ['LeftRing3',   'mixamorigLeftHandRing3',   'J_Bip_L_Ring3'],
  [BoneNames.LEFT_LITTLE_PROXIMAL]:     ['LeftPinky1',  'LeftLittle1', 'mixamorigLeftHandPinky1',  'J_Bip_L_Little1'],
  [BoneNames.LEFT_LITTLE_INTERMEDIATE]: ['LeftPinky2',  'LeftLittle2', 'mixamorigLeftHandPinky2',  'J_Bip_L_Little2'],
  [BoneNames.LEFT_LITTLE_DISTAL]:       ['LeftPinky3',  'LeftLittle3', 'mixamorigLeftHandPinky3',  'J_Bip_L_Little3'],

  // ── Right fingers ─────────────────────────────────────────────────────────
  [BoneNames.RIGHT_THUMB_METACARPAL]:    ['RightThumb1', 'RightThumbMeta', 'mixamorigRightHandThumb1', 'J_Bip_R_Thumb1'],
  [BoneNames.RIGHT_THUMB_PROXIMAL]:      ['RightThumb2', 'mixamorigRightHandThumb2', 'J_Bip_R_Thumb2'],
  [BoneNames.RIGHT_THUMB_DISTAL]:        ['RightThumb3', 'mixamorigRightHandThumb3', 'J_Bip_R_Thumb3'],
  [BoneNames.RIGHT_INDEX_PROXIMAL]:      ['RightIndex1', 'mixamorigRightHandIndex1', 'J_Bip_R_Index1'],
  [BoneNames.RIGHT_INDEX_INTERMEDIATE]:  ['RightIndex2', 'mixamorigRightHandIndex2', 'J_Bip_R_Index2'],
  [BoneNames.RIGHT_INDEX_DISTAL]:        ['RightIndex3', 'mixamorigRightHandIndex3', 'J_Bip_R_Index3'],
  [BoneNames.RIGHT_MIDDLE_PROXIMAL]:     ['RightMiddle1', 'mixamorigRightHandMiddle1', 'J_Bip_R_Middle1'],
  [BoneNames.RIGHT_MIDDLE_INTERMEDIATE]: ['RightMiddle2', 'mixamorigRightHandMiddle2', 'J_Bip_R_Middle2'],
  [BoneNames.RIGHT_MIDDLE_DISTAL]:       ['RightMiddle3', 'mixamorigRightHandMiddle3', 'J_Bip_R_Middle3'],
  [BoneNames.RIGHT_RING_PROXIMAL]:       ['RightRing1',   'mixamorigRightHandRing1',   'J_Bip_R_Ring1'],
  [BoneNames.RIGHT_RING_INTERMEDIATE]:   ['RightRing2',   'mixamorigRightHandRing2',   'J_Bip_R_Ring2'],
  [BoneNames.RIGHT_RING_DISTAL]:         ['RightRing3',   'mixamorigRightHandRing3',   'J_Bip_R_Ring3'],
  [BoneNames.RIGHT_LITTLE_PROXIMAL]:     ['RightPinky1',  'RightLittle1', 'mixamorigRightHandPinky1',  'J_Bip_R_Little1'],
  [BoneNames.RIGHT_LITTLE_INTERMEDIATE]: ['RightPinky2',  'RightLittle2', 'mixamorigRightHandPinky2',  'J_Bip_R_Little2'],
  [BoneNames.RIGHT_LITTLE_DISTAL]:       ['RightPinky3',  'RightLittle3', 'mixamorigRightHandPinky3',  'J_Bip_R_Little3'],
};
