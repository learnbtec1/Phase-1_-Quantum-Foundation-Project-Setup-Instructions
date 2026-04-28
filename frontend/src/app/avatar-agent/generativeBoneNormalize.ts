/**
 * Maps incoming generative / semantic bone names → canonical pose keys used in bind + finalPose.
 * Built from `VRM_HUMANOID_TO_POSE_KEY` plus legacy short aliases (rua, lh, …).
 */
import { VRM_HUMANOID_TO_POSE_KEY } from '@/app/avatar-agent/motion/PoseComposer';

const LOWER_TO_POSE: Record<string, string> = {};

for (const [vrmName, poseKey] of Object.entries(VRM_HUMANOID_TO_POSE_KEY)) {
  const k = vrmName.replace(/\s+/g, '').toLowerCase();
  if (!(k in LOWER_TO_POSE)) LOWER_TO_POSE[k] = poseKey;
}

/** Extra aliases not covered by humanoid table iteration. */
const LEGACY_ALIASES: Record<string, string> = {
  rua: 'rua',
  lua: 'lua',
  rla: 'rla',
  lla: 'lla',
  rh: 'rh',
  lh: 'lh',
  rightarm: 'rua',
  leftarm: 'lua',
  rightforearm: 'rla',
  leftforearm: 'lla',
  righthand: 'rh',
  lefthand: 'lh',
  rightwrist: 'rh',
  leftwrist: 'lh',
  hip: 'hips',
  upperchest: 'chest',
  rshoulder: 'rightShoulder',
  lshoulder: 'leftShoulder',
};

for (const [a, pk] of Object.entries(LEGACY_ALIASES)) {
  if (!(a in LOWER_TO_POSE)) LOWER_TO_POSE[a] = pk;
}

export function normalizeGenerativeBoneKey(raw: string): string | null {
  const s = raw.replace(/\s+/g, '').toLowerCase();
  return LOWER_TO_POSE[s] ?? null;
}
