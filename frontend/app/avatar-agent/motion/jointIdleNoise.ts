/**
 * Extra simplex octaves on wrists / hips — incommensurate scales so loops don’t repeat obviously
 * over long idle (e.g. 15+ minutes). Complements {@link presenceLayer} chest/spine noise.
 */
import { createNoise3D } from 'simplex-noise';

const n = createNoise3D(() => 0.271828);

/** +500% amplitude (×6): `NEXT_PUBLIC_MOTION_PATH_LEAK_DEBUG=true` — motion-path leak sanity check only. */
const JOINT_IDLE_NOISE_DIAG_MUL =
  typeof process !== 'undefined' &&
  process.env.NEXT_PUBLIC_MOTION_PATH_LEAK_DEBUG === 'true'
    ? 6
    : 1;

function saltForKey(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = (h * 31 + key.charCodeAt(i)) >>> 0;
  }
  return (h % 997) * 0.001;
}

export type JointIdleNoiseSample = { rx: number; ry: number; rz: number };

/**
 * @param tSec — wall elapsed (e.g. embodiment clock)
 * @param key — canonical pose key (hips, lh, rh, …)
 */
export function sampleJointIdleNoise(tSec: number, key: string): JointIdleNoiseSample {
  const s = saltForKey(key);
  const t = tSec * 0.073;
  const u = t * 0.619 + s;
  const v = t * 0.883 + s * 2.3;
  const ax = n(u, v * 0.47, t * 0.031 + 0.4);
  const ay = n(t * 0.051 + 1.1, u, v * 0.38);
  const az = n(v, t * 0.067 + s, u * 0.29);
  const hip = key === 'hips';
  const scale = (hip ? 0.0015 : 0.00225) * JOINT_IDLE_NOISE_DIAG_MUL;
  return {
    rx: ax * scale,
    ry: ay * scale * 0.88,
    rz: az * scale * 0.72,
  };
}
