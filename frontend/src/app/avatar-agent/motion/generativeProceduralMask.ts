/**
 * Expands explicit generative locks to limb chains so procedural layers do not fight FK
 * on sibling/child bones (e.g. rla/rh when rua is held).
 */

const RIGHT_ARM: readonly string[] = [
  'rua',
  'rightUpperArm',
  'rla',
  'rightLowerArm',
  'rh',
  'rightHand',
  'rIndexProximal',
  'rMiddleProximal',
  'rRingProximal',
  'rLittleProximal',
  'rThumbProximal',
];

const LEFT_ARM: readonly string[] = [
  'lua',
  'leftUpperArm',
  'lla',
  'leftLowerArm',
  'lh',
  'leftHand',
  'lIndexProximal',
  'lMiddleProximal',
  'lRingProximal',
  'lLittleProximal',
  'lThumbProximal',
];

const RIGHT_LEG: readonly string[] = ['rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'rightToes'];
const LEFT_LEG: readonly string[] = ['leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'leftToes'];

function touchesRightArmChain(k: string): boolean {
  return (
    k === 'rua' ||
    k === 'rightUpperArm' ||
    k === 'rla' ||
    k === 'rightLowerArm' ||
    k === 'rh' ||
    k === 'rightHand' ||
    k.startsWith('rightIndex') ||
    k.startsWith('rightMiddle') ||
    k.startsWith('rightRing') ||
    k.startsWith('rightLittle') ||
    k.startsWith('rightThumb') ||
    (k.startsWith('r') && k.length <= 18 && /Proximal|Intermediate|Distal|Hand|Arm/i.test(k))
  );
}

function touchesLeftArmChain(k: string): boolean {
  return (
    k === 'lua' ||
    k === 'leftUpperArm' ||
    k === 'lla' ||
    k === 'leftLowerArm' ||
    k === 'lh' ||
    k === 'leftHand' ||
    k.startsWith('leftIndex') ||
    k.startsWith('leftMiddle') ||
    k.startsWith('leftRing') ||
    k.startsWith('leftLittle') ||
    k.startsWith('leftThumb') ||
    (k.startsWith('l') && k.length <= 18 && /Proximal|Intermediate|Distal|Hand|Arm/i.test(k))
  );
}

function touchesRightLegChain(k: string): boolean {
  return k === 'rightUpperLeg' || k === 'rightLowerLeg' || k === 'rightFoot' || k === 'rightToes';
}

function touchesLeftLegChain(k: string): boolean {
  return k === 'leftUpperLeg' || k === 'leftLowerLeg' || k === 'leftFoot' || k === 'leftToes';
}

export function expandGenerativeSuppressedKeys(locked: Iterable<string>): ReadonlySet<string> {
  const s = new Set<string>();
  for (const k of locked) s.add(k);

  let expandR = false;
  let expandL = false;
  let expandRLeg = false;
  let expandLLeg = false;
  for (const k of s) {
    if (touchesRightArmChain(k)) expandR = true;
    if (touchesLeftArmChain(k)) expandL = true;
    if (touchesRightLegChain(k)) expandRLeg = true;
    if (touchesLeftLegChain(k)) expandLLeg = true;
  }

  if (expandR) for (const x of RIGHT_ARM) s.add(x);
  if (expandL) for (const x of LEFT_ARM) s.add(x);
  if (expandRLeg) for (const x of RIGHT_LEG) s.add(x);
  if (expandLLeg) for (const x of LEFT_LEG) s.add(x);

  return s;
}
