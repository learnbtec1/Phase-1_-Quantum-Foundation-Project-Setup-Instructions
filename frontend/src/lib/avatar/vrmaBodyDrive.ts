/**
 * Pose-driven VRMA gate for embodiment layers — trust `motionSource` from the skeleton blend stack, not motionAuthority.
 * Stabilization: idle/cinematic/micro layers always apply when invoked (no VRMA-only dead zone).
 */
export function isBodyDrivenByVRMA(_opts: { motionSource?: string }): boolean {
  return true;
}
