/**
 * Optional motion / intent pipeline diagnostics (no WebGL touches; console only when enabled).
 */

export const MOTION_PIPELINE_DEBUG =
  typeof process !== 'undefined' &&
  (process.env.NEXT_PUBLIC_DEBUG_MOTION_PIPELINE === 'true' ||
    process.env.NEXT_PUBLIC_DEBUG_AVATAR === 'true');

let intentMotorTransitionCount = 0;
let lastIntentMotorSig = '';

/** Call when intent motor signature changes (throttled once per unique sig). */
export function recordIntentMotorSignature(sig: string): void {
  if (!MOTION_PIPELINE_DEBUG) return;
  if (sig === lastIntentMotorSig) return;
  lastIntentMotorSig = sig;
  intentMotorTransitionCount += 1;
  // eslint-disable-next-line no-console -- intentional debug path
  console.log('[motionPipeline] intentMotor transition', intentMotorTransitionCount, sig);
}

export function getMotionPipelineDiagnostics(): Readonly<{
  intentMotorTransitionCount: number;
  lastIntentMotorSig: string;
  debugEnabled: boolean;
}> {
  return {
    intentMotorTransitionCount,
    lastIntentMotorSig,
    debugEnabled: MOTION_PIPELINE_DEBUG,
  };
}
