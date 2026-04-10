/**
 * vrmaFingerRemapper.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Solves the three interrelated causes of distorted / non-responsive fingers
 * when playing .vrma animations on a VRM model exported from Blender:
 *
 *  PROBLEM 1 — Bone name mismatch
 *    VRMA KeyframeTrack names embed the bone name from the VRMA file
 *    (e.g. "RightIndexProximal.quaternion").  If the VRM model uses the
 *    VRM-spec camelCase names ("rightIndexProximal"), Three.js
 *    PropertyBinding cannot match them and silently skips those tracks.
 *
 *  PROBLEM 2 — Axis / coordinate system mismatch
 *    Blender's default export maps its internal Z-up system to Y-up by
 *    rotating the scene root -90° around X.  The VRM exporter handles the
 *    *scene* root, but quaternion values baked into animation KeyframeTracks
 *    may still be authored in Blender's Z-up space, especially when the
 *    VRMA was created without applying the full armature transform first.
 *    Result: fingers bend toward +Z (forward) instead of curling toward palm.
 *
 *  PROBLEM 3 — Missing intermediate / distal bones in procedural curl
 *    Only proximal bones are written procedurally.  When a VRMA file drives
 *    intermediate and distal joints and they are not found via
 *    getNormalizedBoneNode(), Three.js warns and skips the track, leaving
 *    the distal phalanges frozen.
 *
 * ─── Solution provided by this module ───────────────────────────────────────
 *
 *  remapClipForVRM(clip, vrm)
 *    – Renames every track whose bone-name segment does NOT appear in the VRM
 *      scene graph, trying multiple casing strategies.
 *    – Applies an optional quaternion swizzle per bone group so that values
 *      authored in Blender's Z-up armature space arrive correctly in Y-up.
 *    – Returns the mutated clip (in-place, safe to call before clipAction).
 *
 *  debugVRMBones(vrm)
 *    – Prints all available humanoid bone nodes and their scene-object names,
 *      confirming which bones are actually present after model load.
 *
 * ─── Axis conventions reference ──────────────────────────────────────────────
 *
 *  VRM / Three.js (Y-up, Z-forward):
 *    X = left/right   Y = up/down   Z = forward/backward
 *
 *  VRM spec normalized-bone curl axis for fingers:
 *    +X = flex (curl toward palm)   local space relative to parent
 *
 *  Blender GLTF exporter (apply_unit_scale + Y_UP=true):
 *    Same Y-up, but individual bone orientations inside an armature that was
 *    NOT exported with "Apply Armature Transform" may still carry a
 *    Z-up→Y-up residual rotation of  Q(-90°, X) = (w=cos(−45°), x=sin(−45°), y=0, z=0)
 *    i.e. (w≈0.707, x≈−0.707, y=0, z=0).
 *    The swizzle below removes this residual.
 */

import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';

// ─── Bone name normalisation table ───────────────────────────────────────────
//
// Maps EVERY casing / naming convention variant → canonical VRM-spec camelCase.
//
// Sources covered:
//   • VRM spec (PascalCase, camelCase)
//   • Avaturn / Ready Player Me (Unity Mecanim / Mixamo): RightArm, RightForeArm,
//     RightHandIndex1, RightHandPinky1, RightUpLeg, RightToeBase …
//   • Blender Rigify: f_index.01.R, f_pinky.01.L …
//   • Blender generic: finger02_01_L …
//   • Alternative naming: IndexFinger1_R, Thunb1_R, Thumb1_R, LittleFinger1_R …
//   • VRoid / Japanese VRM: J_Bip_L_UpperArm, J_Bip_R_Index1 …
//
const BONE_NAME_ALIASES: Record<string, string> = {

  // ════════════════════════════════════════════════════════════════════════════
  // BODY — Spine / Head / Hips
  // ════════════════════════════════════════════════════════════════════════════
  Hips:                     'hips',
  Hip:                      'hips',
  pelvis:                   'hips',
  Spine:                    'spine',
  spine01:                  'spine',
  Chest:                    'chest',
  Spine1:                   'chest',           // Avaturn / Mixamo
  Bust:                     'chest',
  spine02:                  'chest',
  upper_chest:              'chest',
  UpperChest:               'upperChest',
  Spine2:                   'upperChest',       // Avaturn / Mixamo
  UChest:                   'upperChest',
  Neck:                     'neck',
  Head:                     'head',

  // ════════════════════════════════════════════════════════════════════════════
  // ARMS — Shoulder / Upper / Lower / Hand
  // ════════════════════════════════════════════════════════════════════════════
  // — Left arm —
  LeftShoulder:             'leftShoulder',
  Shoulder_Left:            'leftShoulder',
  Shoulder_L:               'leftShoulder',
  LeftUpperArm:             'leftUpperArm',
  UpperArm_Left:            'leftUpperArm',
  UpperArm_L:               'leftUpperArm',
  LeftArm:                  'leftUpperArm',    // Avaturn / Mixamo
  Arm_Left:                 'leftUpperArm',
  Arm_L:                    'leftUpperArm',
  UArm_L:                   'leftUpperArm',
  UpperLeftArm:             'leftUpperArm',
  LeftLowerArm:             'leftLowerArm',
  LowerArm_Left:            'leftLowerArm',
  LowerArm_L:               'leftLowerArm',
  LeftForeArm:              'leftLowerArm',    // Avaturn / Mixamo
  LArm_L:                   'leftLowerArm',
  forearm_L:                'leftLowerArm',
  ForArm_L:                 'leftLowerArm',
  Elbow_L:                  'leftLowerArm',
  LeftHand:                 'leftHand',
  Hand_Left:                'leftHand',
  Hand_L:                   'leftHand',
  Wrist_L:                  'leftHand',
  // — Right arm —
  RightShoulder:            'rightShoulder',
  Shoulder_Right:           'rightShoulder',
  Shoulder_R:               'rightShoulder',
  RightUpperArm:            'rightUpperArm',
  UpperArm_Right:           'rightUpperArm',
  UpperArm_R:               'rightUpperArm',
  RightArm:                 'rightUpperArm',   // Avaturn / Mixamo
  Arm_Right:                'rightUpperArm',
  Arm_R:                    'rightUpperArm',
  UArm_R:                   'rightUpperArm',
  UpperRightArm:            'rightUpperArm',
  RightLowerArm:            'rightLowerArm',
  LowerArm_Right:           'rightLowerArm',
  LowerArm_R:               'rightLowerArm',
  RightForeArm:             'rightLowerArm',   // Avaturn / Mixamo
  LArm_R:                   'rightLowerArm',
  forearm_R:                'rightLowerArm',
  ForArm_R:                 'rightLowerArm',
  Elbow_R:                  'rightLowerArm',
  RightHand:                'rightHand',
  Hand_Right:               'rightHand',
  Hand_R:                   'rightHand',
  Wrist_R:                  'rightHand',

  // ════════════════════════════════════════════════════════════════════════════
  // FINGERS — RIGHT hand
  // ════════════════════════════════════════════════════════════════════════════
  // — Thumb —
  RightThumbMetacarpal:     'rightThumbMetacarpal',
  RightHandThumb0:          'rightThumbMetacarpal', // some rigs add thumb0
  RightThumbProximal:       'rightThumbProximal',
  RightHandThumb1:          'rightThumbProximal',   // Avaturn / Mixamo
  Thumb1_R:                 'rightThumbProximal',
  ThumbFinger1_R:           'rightThumbProximal',
  ProximalThumb_Right:      'rightThumbProximal',
  ProximalThumb_R:          'rightThumbProximal',
  Thunb1_R:                 'rightThumbProximal',
  finger01_01_R:            'rightThumbProximal',
  RightThumbIntermediate:   'rightThumbIntermediate',
  RightHandThumb2:          'rightThumbIntermediate', // Avaturn / Mixamo
  Thumb2_R:                 'rightThumbIntermediate',
  ThumbFinger2_R:           'rightThumbIntermediate',
  IntermediateThumb_Right:  'rightThumbIntermediate',
  IntermediateThumb_R:      'rightThumbIntermediate',
  Thunb2_R:                 'rightThumbIntermediate',
  finger01_02_R:            'rightThumbIntermediate',
  RightThumbDistal:         'rightThumbDistal',
  RightHandThumb3:          'rightThumbDistal',       // Avaturn / Mixamo
  Thumb3_R:                 'rightThumbDistal',
  ThumbFinger3_R:           'rightThumbDistal',
  DistalThumb_Right:        'rightThumbDistal',
  DistalThumb_R:            'rightThumbDistal',
  Thunb3_R:                 'rightThumbDistal',
  finger01_03_R:            'rightThumbDistal',
  // — Index —
  RightIndexProximal:       'rightIndexProximal',
  RightHandIndex1:          'rightIndexProximal',    // Avaturn / Mixamo
  Index1_R:                 'rightIndexProximal',
  IndexFinger1_R:           'rightIndexProximal',
  ProximalIndex_Right:      'rightIndexProximal',
  ProximalIndex_R:          'rightIndexProximal',
  'finger02_01_R':          'rightIndexProximal',
  'f_index.01.R':           'rightIndexProximal',
  RightIndexIntermediate:   'rightIndexIntermediate',
  RightHandIndex2:          'rightIndexIntermediate', // Avaturn / Mixamo
  Index2_R:                 'rightIndexIntermediate',
  IndexFinger2_R:           'rightIndexIntermediate',
  IntermediateIndex_Right:  'rightIndexIntermediate',
  IntermediateIndex_R:      'rightIndexIntermediate',
  'finger02_02_R':          'rightIndexIntermediate',
  'f_index.02.R':           'rightIndexIntermediate',
  RightIndexDistal:         'rightIndexDistal',
  RightHandIndex3:          'rightIndexDistal',       // Avaturn / Mixamo
  Index3_R:                 'rightIndexDistal',
  IndexFinger3_R:           'rightIndexDistal',
  DistalIndex_Right:        'rightIndexDistal',
  DistalIndex_R:            'rightIndexDistal',
  'finger02_03_R':          'rightIndexDistal',
  'f_index.03.R':           'rightIndexDistal',
  // — Middle —
  RightMiddleProximal:      'rightMiddleProximal',
  RightHandMiddle1:         'rightMiddleProximal',   // Avaturn / Mixamo
  Middle1_R:                'rightMiddleProximal',
  MiddleFinger1_R:          'rightMiddleProximal',
  ProximalMiddle_Right:     'rightMiddleProximal',
  ProximalMiddle_R:         'rightMiddleProximal',
  'finger03_01_R':          'rightMiddleProximal',
  'f_middle.01.R':          'rightMiddleProximal',
  RightMiddleIntermediate:  'rightMiddleIntermediate',
  RightHandMiddle2:         'rightMiddleIntermediate', // Avaturn / Mixamo
  Middle2_R:                'rightMiddleIntermediate',
  MiddleFinger2_R:          'rightMiddleIntermediate',
  IntermediateMiddle_Right: 'rightMiddleIntermediate',
  IntermediateMiddle_R:     'rightMiddleIntermediate',
  'finger03_02_R':          'rightMiddleIntermediate',
  'f_middle.02.R':          'rightMiddleIntermediate',
  RightMiddleDistal:        'rightMiddleDistal',
  RightHandMiddle3:         'rightMiddleDistal',      // Avaturn / Mixamo
  Middle3_R:                'rightMiddleDistal',
  MiddleFinger3_R:          'rightMiddleDistal',
  DistalMiddle_Right:       'rightMiddleDistal',
  DistalMiddle_R:           'rightMiddleDistal',
  'finger03_03_R':          'rightMiddleDistal',
  'f_middle.03.R':          'rightMiddleDistal',
  // — Ring —
  RightRingProximal:        'rightRingProximal',
  RightHandRing1:           'rightRingProximal',     // Avaturn / Mixamo
  Ring1_R:                  'rightRingProximal',
  RingFinger1_R:            'rightRingProximal',
  ProximalRing_Right:       'rightRingProximal',
  ProximalRing_R:           'rightRingProximal',
  'finger04_01_R':          'rightRingProximal',
  'f_ring.01.R':            'rightRingProximal',
  RightRingIntermediate:    'rightRingIntermediate',
  RightHandRing2:           'rightRingIntermediate', // Avaturn / Mixamo
  Ring2_R:                  'rightRingIntermediate',
  RingFinger2_R:            'rightRingIntermediate',
  IntermediateRing_Right:   'rightRingIntermediate',
  IntermediateRing_R:       'rightRingIntermediate',
  'finger04_02_R':          'rightRingIntermediate',
  'f_ring.02.R':            'rightRingIntermediate',
  RightRingDistal:          'rightRingDistal',
  RightHandRing3:           'rightRingDistal',       // Avaturn / Mixamo
  Ring3_R:                  'rightRingDistal',
  RingFinger3_R:            'rightRingDistal',
  DistalRing_Right:         'rightRingDistal',
  DistalRing_R:             'rightRingDistal',
  'finger04_03_R':          'rightRingDistal',
  'f_ring.03.R':            'rightRingDistal',
  // — Little / Pinky —
  RightLittleProximal:      'rightLittleProximal',
  RightHandPinky1:          'rightLittleProximal',   // Avaturn / Mixamo
  Little1_R:                'rightLittleProximal',
  LittleFinger1_R:          'rightLittleProximal',
  ProximalLittle_Right:     'rightLittleProximal',
  ProximalLittle_R:         'rightLittleProximal',
  'finger05_01_R':          'rightLittleProximal',
  'f_pinky.01.R':           'rightLittleProximal',
  'Pinky1.R':               'rightLittleProximal',
  RightLittleIntermediate:  'rightLittleIntermediate',
  RightHandPinky2:          'rightLittleIntermediate', // Avaturn / Mixamo
  Little2_R:                'rightLittleIntermediate',
  LittleFinger2_R:          'rightLittleIntermediate',
  IntermediateLittle_Right: 'rightLittleIntermediate',
  IntermediateLittle_R:     'rightLittleIntermediate',
  'finger05_02_R':          'rightLittleIntermediate',
  'f_pinky.02.R':           'rightLittleIntermediate',
  'Pinky2.R':               'rightLittleIntermediate',
  RightLittleDistal:        'rightLittleDistal',
  RightHandPinky3:          'rightLittleDistal',      // Avaturn / Mixamo
  Little3_R:                'rightLittleDistal',
  LittleFinger3_R:          'rightLittleDistal',
  DistalLittle_Right:       'rightLittleDistal',
  DistalLittle_R:           'rightLittleDistal',
  'finger05_03_R':          'rightLittleDistal',
  'f_pinky.03.R':           'rightLittleDistal',
  'Pinky3.R':               'rightLittleDistal',

  // ════════════════════════════════════════════════════════════════════════════
  // FINGERS — LEFT hand
  // ════════════════════════════════════════════════════════════════════════════
  // — Thumb —
  LeftThumbMetacarpal:      'leftThumbMetacarpal',
  LeftHandThumb0:           'leftThumbMetacarpal',
  LeftThumbProximal:        'leftThumbProximal',
  LeftHandThumb1:           'leftThumbProximal',     // Avaturn / Mixamo
  Thumb1_L:                 'leftThumbProximal',
  ThumbFinger1_L:           'leftThumbProximal',
  ProximalThumb_Left:       'leftThumbProximal',
  ProximalThumb_L:          'leftThumbProximal',
  Thunb1_L:                 'leftThumbProximal',
  finger01_01_L:            'leftThumbProximal',
  LeftThumbIntermediate:    'leftThumbIntermediate',
  LeftHandThumb2:           'leftThumbIntermediate', // Avaturn / Mixamo
  Thumb2_L:                 'leftThumbIntermediate',
  ThumbFinger2_L:           'leftThumbIntermediate',
  IntermediateThumb_Left:   'leftThumbIntermediate',
  IntermediateThumb_L:      'leftThumbIntermediate',
  Thunb2_L:                 'leftThumbIntermediate',
  finger01_02_L:            'leftThumbIntermediate',
  LeftThumbDistal:          'leftThumbDistal',
  LeftHandThumb3:           'leftThumbDistal',       // Avaturn / Mixamo
  Thumb3_L:                 'leftThumbDistal',
  ThumbFinger3_L:           'leftThumbDistal',
  DistalThumb_Left:         'leftThumbDistal',
  DistalThumb_L:            'leftThumbDistal',
  Thunb3_L:                 'leftThumbDistal',
  finger01_03_L:            'leftThumbDistal',
  // — Index —
  LeftIndexProximal:        'leftIndexProximal',
  LeftHandIndex1:           'leftIndexProximal',     // Avaturn / Mixamo
  Index1_L:                 'leftIndexProximal',
  IndexFinger1_L:           'leftIndexProximal',
  ProximalIndex_Left:       'leftIndexProximal',
  ProximalIndex_L:          'leftIndexProximal',
  finger02_01_L:            'leftIndexProximal',
  'f_index.01.L':           'leftIndexProximal',
  LeftIndexIntermediate:    'leftIndexIntermediate',
  LeftHandIndex2:           'leftIndexIntermediate', // Avaturn / Mixamo
  Index2_L:                 'leftIndexIntermediate',
  IndexFinger2_L:           'leftIndexIntermediate',
  IntermediateIndex_Left:   'leftIndexIntermediate',
  IntermediateIndex_L:      'leftIndexIntermediate',
  finger02_02_L:            'leftIndexIntermediate',
  'f_index.02.L':           'leftIndexIntermediate',
  LeftIndexDistal:          'leftIndexDistal',
  LeftHandIndex3:           'leftIndexDistal',       // Avaturn / Mixamo
  Index3_L:                 'leftIndexDistal',
  IndexFinger3_L:           'leftIndexDistal',
  DistalIndex_Left:         'leftIndexDistal',
  DistalIndex_L:            'leftIndexDistal',
  finger02_03_L:            'leftIndexDistal',
  'f_index.03.L':           'leftIndexDistal',
  // — Middle —
  LeftMiddleProximal:       'leftMiddleProximal',
  LeftHandMiddle1:          'leftMiddleProximal',    // Avaturn / Mixamo
  Middle1_L:                'leftMiddleProximal',
  MiddleFinger1_L:          'leftMiddleProximal',
  ProximalMiddle_Left:      'leftMiddleProximal',
  ProximalMiddle_L:         'leftMiddleProximal',
  finger03_01_L:            'leftMiddleProximal',
  'f_middle.01.L':          'leftMiddleProximal',
  LeftMiddleIntermediate:   'leftMiddleIntermediate',
  LeftHandMiddle2:          'leftMiddleIntermediate', // Avaturn / Mixamo
  Middle2_L:                'leftMiddleIntermediate',
  MiddleFinger2_L:          'leftMiddleIntermediate',
  IntermediateMiddle_Left:  'leftMiddleIntermediate',
  IntermediateMiddle_L:     'leftMiddleIntermediate',
  finger03_02_L:            'leftMiddleIntermediate',
  'f_middle.02.L':          'leftMiddleIntermediate',
  LeftMiddleDistal:         'leftMiddleDistal',
  LeftHandMiddle3:          'leftMiddleDistal',      // Avaturn / Mixamo
  Middle3_L:                'leftMiddleDistal',
  MiddleFinger3_L:          'leftMiddleDistal',
  DistalMiddle_Left:        'leftMiddleDistal',
  DistalMiddle_L:           'leftMiddleDistal',
  finger03_03_L:            'leftMiddleDistal',
  'f_middle.03.L':          'leftMiddleDistal',
  // — Ring —
  LeftRingProximal:         'leftRingProximal',
  LeftHandRing1:            'leftRingProximal',      // Avaturn / Mixamo
  Ring1_L:                  'leftRingProximal',
  RingFinger1_L:            'leftRingProximal',
  ProximalRing_Left:        'leftRingProximal',
  ProximalRing_L:           'leftRingProximal',
  finger04_01_L:            'leftRingProximal',
  'f_ring.01.L':            'leftRingProximal',
  LeftRingIntermediate:     'leftRingIntermediate',
  LeftHandRing2:            'leftRingIntermediate',  // Avaturn / Mixamo
  Ring2_L:                  'leftRingIntermediate',
  RingFinger2_L:            'leftRingIntermediate',
  IntermediateRing_Left:    'leftRingIntermediate',
  IntermediateRing_L:       'leftRingIntermediate',
  finger04_02_L:            'leftRingIntermediate',
  'f_ring.02.L':            'leftRingIntermediate',
  LeftRingDistal:           'leftRingDistal',
  LeftHandRing3:            'leftRingDistal',        // Avaturn / Mixamo
  Ring3_L:                  'leftRingDistal',
  RingFinger3_L:            'leftRingDistal',
  DistalRing_Left:          'leftRingDistal',
  DistalRing_L:             'leftRingDistal',
  finger04_03_L:            'leftRingDistal',
  'f_ring.03.L':            'leftRingDistal',
  // — Little / Pinky —
  LeftLittleProximal:       'leftLittleProximal',
  LeftHandPinky1:           'leftLittleProximal',    // Avaturn / Mixamo
  Little1_L:                'leftLittleProximal',
  LittleFinger1_L:          'leftLittleProximal',
  ProximalLittle_Left:      'leftLittleProximal',
  ProximalLittle_L:         'leftLittleProximal',
  finger05_01_L:            'leftLittleProximal',
  'f_pinky.01.L':           'leftLittleProximal',
  'Pinky1.L':               'leftLittleProximal',
  LeftLittleIntermediate:   'leftLittleIntermediate',
  LeftHandPinky2:           'leftLittleIntermediate', // Avaturn / Mixamo
  Little2_L:                'leftLittleIntermediate',
  LittleFinger2_L:          'leftLittleIntermediate',
  IntermediateLittle_Left:  'leftLittleIntermediate',
  IntermediateLittle_L:     'leftLittleIntermediate',
  finger05_02_L:            'leftLittleIntermediate',
  'f_pinky.02.L':           'leftLittleIntermediate',
  'Pinky2.L':               'leftLittleIntermediate',
  LeftLittleDistal:         'leftLittleDistal',
  LeftHandPinky3:           'leftLittleDistal',      // Avaturn / Mixamo
  Little3_L:                'leftLittleDistal',
  LittleFinger3_L:          'leftLittleDistal',
  DistalLittle_Left:        'leftLittleDistal',
  DistalLittle_L:           'leftLittleDistal',
  finger05_03_L:            'leftLittleDistal',
  'f_pinky.03.L':           'leftLittleDistal',
  'Pinky3.L':               'leftLittleDistal',

  // ════════════════════════════════════════════════════════════════════════════
  // LEGS
  // ════════════════════════════════════════════════════════════════════════════
  LeftUpperLeg:             'leftUpperLeg',
  UpperLeg_Left:            'leftUpperLeg',
  UpperLeg_L:               'leftUpperLeg',
  LeftUpLeg:                'leftUpperLeg',           // Avaturn / Mixamo
  Thigh_L:                  'leftUpperLeg',
  RightUpperLeg:            'rightUpperLeg',
  UpperLeg_Right:           'rightUpperLeg',
  UpperLeg_R:               'rightUpperLeg',
  RightUpLeg:               'rightUpperLeg',          // Avaturn / Mixamo
  Thigh_R:                  'rightUpperLeg',
  LeftLowerLeg:             'leftLowerLeg',
  LowerLeg_Left:            'leftLowerLeg',
  LowerLeg_L:               'leftLowerLeg',
  LeftLeg:                  'leftLowerLeg',            // Avaturn / Mixamo
  shin_L:                   'leftLowerLeg',
  RightLowerLeg:            'rightLowerLeg',
  LowerLeg_Right:           'rightLowerLeg',
  LowerLeg_R:               'rightLowerLeg',
  RightLeg:                 'rightLowerLeg',           // Avaturn / Mixamo
  shin_R:                   'rightLowerLeg',
  LeftFoot:                 'leftFoot',
  Foot_Left:                'leftFoot',
  Foot_L:                   'leftFoot',
  Ankle_L:                  'leftFoot',
  RightFoot:                'rightFoot',
  Foot_Right:               'rightFoot',
  Foot_R:                   'rightFoot',
  Ankle_R:                  'rightFoot',
  LeftToes:                 'leftToes',
  Toes_Left:                'leftToes',
  LeftToeBase:              'leftToes',               // Avaturn / Mixamo
  Toe_L:                    'leftToes',
  RightToes:                'rightToes',
  Toes_Right:               'rightToes',
  RightToeBase:             'rightToes',              // Avaturn / Mixamo
  Toe_R:                    'rightToes',

  // ════════════════════════════════════════════════════════════════════════════
  // VRoid / J_Bip Japanese convention (common in Booth/Vket avatars)
  // ════════════════════════════════════════════════════════════════════════════
  J_Bip_C_Hips:             'hips',
  J_Bip_C_Spine:            'spine',
  J_Bip_C_Chest:            'chest',
  J_Bip_C_UpperChest:       'upperChest',
  J_Bip_C_Neck:             'neck',
  J_Bip_C_Head:             'head',
  J_Bip_L_Shoulder:         'leftShoulder',
  J_Bip_R_Shoulder:         'rightShoulder',
  J_Bip_L_UpperArm:         'leftUpperArm',
  J_Bip_R_UpperArm:         'rightUpperArm',
  J_Bip_L_LowerArm:         'leftLowerArm',
  J_Bip_R_LowerArm:         'rightLowerArm',
  J_Bip_L_Hand:             'leftHand',
  J_Bip_R_Hand:             'rightHand',
  J_Bip_L_UpperLeg:         'leftUpperLeg',
  J_Bip_R_UpperLeg:         'rightUpperLeg',
  J_Bip_L_LowerLeg:         'leftLowerLeg',
  J_Bip_R_LowerLeg:         'rightLowerLeg',
  J_Bip_L_Foot:             'leftFoot',
  J_Bip_R_Foot:             'rightFoot',
  J_Bip_L_ToeBase:          'leftToes',
  J_Bip_R_ToeBase:          'rightToes',
  // VRoid fingers (J_Bip_L_Index1 etc.)
  J_Bip_L_Thumb1:           'leftThumbProximal',
  J_Bip_L_Thumb2:           'leftThumbIntermediate',
  J_Bip_L_Thumb3:           'leftThumbDistal',
  J_Bip_R_Thumb1:           'rightThumbProximal',
  J_Bip_R_Thumb2:           'rightThumbIntermediate',
  J_Bip_R_Thumb3:           'rightThumbDistal',
  J_Bip_L_Index1:           'leftIndexProximal',
  J_Bip_L_Index2:           'leftIndexIntermediate',
  J_Bip_L_Index3:           'leftIndexDistal',
  J_Bip_R_Index1:           'rightIndexProximal',
  J_Bip_R_Index2:           'rightIndexIntermediate',
  J_Bip_R_Index3:           'rightIndexDistal',
  J_Bip_L_Middle1:          'leftMiddleProximal',
  J_Bip_L_Middle2:          'leftMiddleIntermediate',
  J_Bip_L_Middle3:          'leftMiddleDistal',
  J_Bip_R_Middle1:          'rightMiddleProximal',
  J_Bip_R_Middle2:          'rightMiddleIntermediate',
  J_Bip_R_Middle3:          'rightMiddleDistal',
  J_Bip_L_Ring1:            'leftRingProximal',
  J_Bip_L_Ring2:            'leftRingIntermediate',
  J_Bip_L_Ring3:            'leftRingDistal',
  J_Bip_R_Ring1:            'rightRingProximal',
  J_Bip_R_Ring2:            'rightRingIntermediate',
  J_Bip_R_Ring3:            'rightRingDistal',
  J_Bip_L_Little1:          'leftLittleProximal',
  J_Bip_L_Little2:          'leftLittleIntermediate',
  J_Bip_L_Little3:          'leftLittleDistal',
  J_Bip_R_Little1:          'rightLittleProximal',
  J_Bip_R_Little2:          'rightLittleIntermediate',
  J_Bip_R_Little3:          'rightLittleDistal',
};

// ─── Finger bone groups requiring swizzle ─────────────────────────────────────
//
// When a VRMA was baked in Blender's Z-up armature space, quaternion values
// for finger bones carry a residual X-axis rotation of −90°.
// To undo this, we pre-multiply by Q(+90°, X):
//
//   Q_corrected = Q(+90°, X) * Q_baked
//
// This only applies to bones whose parent chain includes the hand,
// NOT to the whole-body bones which the VRM exporter handles via the scene root.
//
// Set APPLY_SWIZZLE = false if your VRMA was exported with
// "Apply Armature Transform" in Blender (already Y-up corrected).
const APPLY_SWIZZLE = false;   // ← set true if fingers still twist after name fix

// Pre-computed Q(+90°, X) = (w=cos45°, x=sin45°, y=0, z=0)
const SWIZZLE_COR = new THREE.Quaternion(Math.sin(Math.PI / 4), 0, 0, Math.cos(Math.PI / 4));

const SWIZZLE_BONE_PREFIXES = new Set([
  'rightIndex', 'rightMiddle', 'rightRing', 'rightLittle', 'rightThumb',
  'leftIndex',  'leftMiddle',  'leftRing',  'leftLittle',  'leftThumb',
  'rightHand', 'leftHand',
]);

function needsSwizzle(vrmaName: string): boolean {
  const lower = vrmaName.charAt(0).toLowerCase() + vrmaName.slice(1);
  return [...SWIZZLE_BONE_PREFIXES].some((p) => lower.startsWith(p));
}

// ─── Build a scene-node name lookup from the VRM ─────────────────────────────
//
// Three.js PropertyBinding matches track names against scene object *names*.
// We build a case-insensitive map: lowercase object-name → actual object-name.
function buildSceneNameMap(vrm: VRM): Map<string, string> {
  const map = new Map<string, string>();
  vrm.scene.traverse((obj) => {
    if (obj.name) map.set(obj.name.toLowerCase(), obj.name);
  });
  return map;
}

// ─── Lazy-built reverse map: canonical VRM name → all known aliases ──────────
// Built once on first use to speed up repeated lookups.
let _aliasToCanonical: Map<string, string> | null = null;
function getAliasMap(): Map<string, string> {
  if (_aliasToCanonical) return _aliasToCanonical;
  _aliasToCanonical = new Map<string, string>();
  for (const [alias, canonical] of Object.entries(BONE_NAME_ALIASES)) {
    // Key: normalized (lowercase, no dots/spaces/underscores removed) → canonical
    _aliasToCanonical.set(alias.toLowerCase(), canonical);
  }
  return _aliasToCanonical;
}

// ─── Resolve the correct scene-object name for a VRMA bone name ──────────────
function resolveTrackBoneName(
  vrmaBoneName: string,
  sceneNameMap: Map<string, string>,
  vrm: VRM,
): string | null {
  const tryCanonical = (canonical: string): string | null => {
    // a. Scene node with exactly that camelCase name
    if (sceneNameMap.has(canonical.toLowerCase())) {
      return sceneNameMap.get(canonical.toLowerCase())!;
    }
    // b. Normalized VRM bone node (virtual coordinate space)
    try {
      const node = vrm.humanoid?.getNormalizedBoneNode(canonical as never);
      if (node?.name) return node.name;
    } catch { /* bone not in spec */ }
    // c. Raw bone node (actual GLTF scene object — preferred for PropertyBinding)
    try {
      const node = vrm.humanoid?.getRawBoneNode(canonical as never);
      if (node?.name) return node.name;
    } catch { /* bone not in spec */ }
    return null;
  };

  // 1. Direct match in scene (already correct name)
  if (sceneNameMap.has(vrmaBoneName.toLowerCase())) {
    return sceneNameMap.get(vrmaBoneName.toLowerCase())!;
  }

  // 2. Exact alias lookup (covers PascalCase, Avaturn/Mixamo, Blender, J_Bip …)
  const canonical2 = BONE_NAME_ALIASES[vrmaBoneName];
  if (canonical2) {
    const r = tryCanonical(canonical2);
    if (r) return r;
  }

  // 3. Case-insensitive alias lookup (handles e.g. "righthandindex1" variants)
  const aliasMap = getAliasMap();
  const lower = vrmaBoneName.toLowerCase();
  const canonical3 = aliasMap.get(lower);
  if (canonical3) {
    const r = tryCanonical(canonical3);
    if (r) return r;
  }

  // 4. Fuzzy match: strip dots / numbers / underscores and try again
  //    Catches "f.index.01.R" → "findexr" → check alias keys normalized the same way
  const fuzzy = lower.replace(/[^a-z]/g, '');
  for (const [aliasKey, canonicalVal] of aliasMap.entries()) {
    if (aliasKey.replace(/[^a-z]/g, '') === fuzzy) {
      const r = tryCanonical(canonicalVal);
      if (r) return r;
    }
  }

  // Unresolvable
  return null;
}

// ─── Quaternion swizzle: undo Blender Z-up residual ─────────────────────────
const _sq = new THREE.Quaternion();
function applySwizzleToTrack(track: THREE.KeyframeTrack): void {
  const values = track.values as Float32Array;
  for (let i = 0; i < values.length; i += 4) {
    _sq.set(values[i], values[i + 1], values[i + 2], values[i + 3]);
    _sq.premultiply(SWIZZLE_COR);
    values[i]     = _sq.x;
    values[i + 1] = _sq.y;
    values[i + 2] = _sq.z;
    values[i + 3] = _sq.w;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Remap all KeyframeTracks in `clip` so their bone references match the VRM
 * scene graph, and optionally correct the quaternion axis orientation.
 *
 * Call this once per (clip, vrm) pair before passing the clip to
 * `mixer.clipAction(clip)`.
 *
 * @returns The same clip (mutated in-place for performance).
 */
export function remapClipForVRM(clip: THREE.AnimationClip, vrm: VRM): THREE.AnimationClip {
  if (!vrm.humanoid) return clip;

  const sceneMap = buildSceneNameMap(vrm);
  const skipped: string[] = [];
  const renamed: Array<{ from: string; to: string }> = [];

  for (const track of clip.tracks) {
    // Track name format: "boneName.propertyPath"  e.g. "RightIndexProximal.quaternion"
    const dotIdx = track.name.indexOf('.');
    if (dotIdx === -1) continue;

    const vrmaBone = track.name.slice(0, dotIdx);
    const prop     = track.name.slice(dotIdx);          // ".quaternion" / ".position" etc.

    const resolved = resolveTrackBoneName(vrmaBone, sceneMap, vrm);
    if (!resolved) {
      skipped.push(vrmaBone);
      continue;
    }

    const newName = resolved + prop;
    if (newName !== track.name) {
      renamed.push({ from: track.name, to: newName });
      track.name = newName;
    }

    if (APPLY_SWIZZLE && prop === '.quaternion' && needsSwizzle(vrmaBone)) {
      applySwizzleToTrack(track as THREE.QuaternionKeyframeTrack);
    }
  }

  if (process.env.NODE_ENV === 'development') {
    if (renamed.length > 0) {
      console.log(`[vrmaFingerRemapper] "${clip.name}" — renamed ${renamed.length} track(s)`);
      for (const r of renamed.slice(0, 6)) {
        console.log(`  ${r.from} → ${r.to}`);
      }
      if (renamed.length > 6) console.log(`  … and ${renamed.length - 6} more`);
    }
    if (skipped.length > 0) {
      console.warn(
        `[vrmaFingerRemapper] "${clip.name}" — ${skipped.length} unresolvable bone(s):`,
        [...new Set(skipped)].sort().join(', '),
      );
    }
    if (renamed.length === 0 && skipped.length === 0) {
      console.log(`[vrmaFingerRemapper] "${clip.name}" — all tracks already correct ✓`);
    }
  }

  return clip;
}

/**
 * Debug helper: print all VRM humanoid bone nodes and their scene-object names.
 * Call once after loading the VRM model (e.g. in handleLoad callback).
 *
 * Example:
 *   import { debugVRMBones } from './vrmaFingerRemapper';
 *   debugVRMBones(loadedVrm);
 */
export function debugVRMBones(vrm: VRM): void {
  if (!vrm.humanoid) {
    console.error('[debugVRMBones] VRM has no humanoid component');
    return;
  }

  console.groupCollapsed('[debugVRMBones] VRM humanoid bone → scene-node names');

  const ALL_VRM_BONES = [
    'hips','spine','chest','upperChest','neck','head',
    'leftShoulder','rightShoulder',
    'leftUpperArm','rightUpperArm',
    'leftLowerArm','rightLowerArm',
    'leftHand','rightHand',
    'leftThumbMetacarpal','leftThumbProximal','leftThumbIntermediate','leftThumbDistal',
    'leftIndexProximal','leftIndexIntermediate','leftIndexDistal',
    'leftMiddleProximal','leftMiddleIntermediate','leftMiddleDistal',
    'leftRingProximal','leftRingIntermediate','leftRingDistal',
    'leftLittleProximal','leftLittleIntermediate','leftLittleDistal',
    'rightThumbMetacarpal','rightThumbProximal','rightThumbIntermediate','rightThumbDistal',
    'rightIndexProximal','rightIndexIntermediate','rightIndexDistal',
    'rightMiddleProximal','rightMiddleIntermediate','rightMiddleDistal',
    'rightRingProximal','rightRingIntermediate','rightRingDistal',
    'rightLittleProximal','rightLittleIntermediate','rightLittleDistal',
    'leftUpperLeg','rightUpperLeg','leftLowerLeg','rightLowerLeg',
    'leftFoot','rightFoot','leftToes','rightToes',
  ] as const;

  const results: Array<{ bone: string; nodeName: string | null; status: string }> = [];

  for (const boneName of ALL_VRM_BONES) {
    try {
      const n = vrm.humanoid.getNormalizedBoneNode(boneName as never);
      results.push({
        bone: boneName,
        nodeName: n?.name ?? null,
        status: n ? '✅' : '❌ missing',
      });
    } catch {
      results.push({ bone: boneName, nodeName: null, status: '❌ error' });
    }
  }

  console.table(results);
  console.groupEnd();

  // Summarise finger coverage
  const fingerBones = results.filter((r) => r.bone.includes('Index') || r.bone.includes('Middle') || r.bone.includes('Ring') || r.bone.includes('Little') || r.bone.includes('Thumb'));
  const missingFingers = fingerBones.filter((r) => !r.nodeName);
  if (missingFingers.length === 0) {
    console.log('[debugVRMBones] 🎉 All finger bones found!');
  } else {
    console.warn('[debugVRMBones] ⚠ Missing finger bones:', missingFingers.map((r) => r.bone).join(', '));
    console.warn('[debugVRMBones] → Rename these in Blender to match VRM spec names, or add them to BONE_NAME_ALIASES in vrmaFingerRemapper.ts');
  }
}

/**
 * Quick finger-only bone check that can be called after VRM load.
 * Returns true if at least 8 of the 10 proximal finger bones are present.
 */
export function hasFingerBones(vrm: VRM): boolean {
  if (!vrm.humanoid) return false;
  const fingerProximals = [
    'rightIndexProximal','rightMiddleProximal','rightRingProximal','rightLittleProximal','rightThumbProximal',
    'leftIndexProximal', 'leftMiddleProximal', 'leftRingProximal', 'leftLittleProximal', 'leftThumbProximal',
  ] as const;
  let found = 0;
  for (const b of fingerProximals) {
    try {
      if (vrm.humanoid.getNormalizedBoneNode(b as never)) found++;
    } catch { /* skip */ }
  }
  return found >= 8;
}
