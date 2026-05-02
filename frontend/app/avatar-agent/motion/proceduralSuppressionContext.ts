/**
 * While generative kinematic locks are active, procedural layers skip additive deltas on
 * suppressed pose keys (see `generativeProceduralMask.expandGenerativeSuppressedKeys`).
 */
let activeSuppressedPoseKeys: ReadonlySet<string> | undefined;

export function runWithProceduralSuppression<T>(
  keys: ReadonlySet<string> | undefined,
  fn: () => T,
): T {
  const prev = activeSuppressedPoseKeys;
  activeSuppressedPoseKeys = keys;
  try {
    return fn();
  } finally {
    activeSuppressedPoseKeys = prev;
  }
}

export function isPoseKeyProcedurallySuppressed(poseKey: string): boolean {
  return activeSuppressedPoseKeys ? activeSuppressedPoseKeys.has(poseKey) : false;
}
