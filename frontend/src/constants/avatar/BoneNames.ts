/**
 * Canonical English bone keys for VRM 1.0 / Mixamo humanoid rigs.
 * Based on: https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_vrm-1.0/humanoid.md
 * Use these keys in code; resolution to actual skeleton names is done via BoneAliases.
 */
export const BoneNames = {
  // Torso
  HIPS:        'hips',
  SPINE:       'spine',
  CHEST:       'chest',
  UPPER_CHEST: 'upperChest',
  NECK:        'neck',
  HEAD:        'head',
  JAW:         'jaw',

  // Eyes (VRM 1.0)
  LEFT_EYE:  'leftEye',
  RIGHT_EYE: 'rightEye',

  // Left arm
  LEFT_SHOULDER:  'leftShoulder',
  LEFT_UPPER_ARM: 'leftUpperArm',
  LEFT_LOWER_ARM: 'leftLowerArm',
  LEFT_HAND:      'leftHand',

  // Right arm
  RIGHT_SHOULDER:  'rightShoulder',
  RIGHT_UPPER_ARM: 'rightUpperArm',
  RIGHT_LOWER_ARM: 'rightLowerArm',
  RIGHT_HAND:      'rightHand',

  // Left leg
  LEFT_UPPER_LEG: 'leftUpperLeg',
  LEFT_LOWER_LEG: 'leftLowerLeg',
  LEFT_FOOT:      'leftFoot',
  LEFT_TOES:      'leftToes',

  // Right leg
  RIGHT_UPPER_LEG: 'rightUpperLeg',
  RIGHT_LOWER_LEG: 'rightLowerLeg',
  RIGHT_FOOT:      'rightFoot',
  RIGHT_TOES:      'rightToes',

  // Fingers — left
  LEFT_THUMB_METACARPAL:    'leftThumbMetacarpal',
  LEFT_THUMB_PROXIMAL:      'leftThumbProximal',
  LEFT_THUMB_DISTAL:        'leftThumbDistal',
  LEFT_INDEX_PROXIMAL:      'leftIndexProximal',
  LEFT_INDEX_INTERMEDIATE:  'leftIndexIntermediate',
  LEFT_INDEX_DISTAL:        'leftIndexDistal',
  LEFT_MIDDLE_PROXIMAL:     'leftMiddleProximal',
  LEFT_MIDDLE_INTERMEDIATE: 'leftMiddleIntermediate',
  LEFT_MIDDLE_DISTAL:       'leftMiddleDistal',
  LEFT_RING_PROXIMAL:       'leftRingProximal',
  LEFT_RING_INTERMEDIATE:   'leftRingIntermediate',
  LEFT_RING_DISTAL:         'leftRingDistal',
  LEFT_LITTLE_PROXIMAL:     'leftLittleProximal',
  LEFT_LITTLE_INTERMEDIATE: 'leftLittleIntermediate',
  LEFT_LITTLE_DISTAL:       'leftLittleDistal',

  // Fingers — right
  RIGHT_THUMB_METACARPAL:    'rightThumbMetacarpal',
  RIGHT_THUMB_PROXIMAL:      'rightThumbProximal',
  RIGHT_THUMB_DISTAL:        'rightThumbDistal',
  RIGHT_INDEX_PROXIMAL:      'rightIndexProximal',
  RIGHT_INDEX_INTERMEDIATE:  'rightIndexIntermediate',
  RIGHT_INDEX_DISTAL:        'rightIndexDistal',
  RIGHT_MIDDLE_PROXIMAL:     'rightMiddleProximal',
  RIGHT_MIDDLE_INTERMEDIATE: 'rightMiddleIntermediate',
  RIGHT_MIDDLE_DISTAL:       'rightMiddleDistal',
  RIGHT_RING_PROXIMAL:       'rightRingProximal',
  RIGHT_RING_INTERMEDIATE:   'rightRingIntermediate',
  RIGHT_RING_DISTAL:         'rightRingDistal',
  RIGHT_LITTLE_PROXIMAL:     'rightLittleProximal',
  RIGHT_LITTLE_INTERMEDIATE: 'rightLittleIntermediate',
  RIGHT_LITTLE_DISTAL:       'rightLittleDistal',
} as const;

export type BoneName = typeof BoneNames[keyof typeof BoneNames];
