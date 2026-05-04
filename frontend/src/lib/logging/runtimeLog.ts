/**
 * Runtime logging — env-gated verbosity, stable prefixes, throttling helpers.
 * Avoids string work when the relevant channel is off (check flags before building messages).
 */
'use client';

export type LogDomain = 'MOTION' | 'TTS' | 'SYSTEM' | 'TRACE';

function envTruthy(raw: string | undefined): boolean {
  const v = (raw ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

/** Verbose motion diagnostics (scheduler / procedural / energy / MOTION_* tags). */
export function isDebugMotion(): boolean {
  if (typeof process === 'undefined') return false;
  return (
    envTruthy(process.env.NEXT_PUBLIC_DEBUG_MOTION) ||
    envTruthy(process.env.NEXT_PUBLIC_DEBUG_MOTION_DIAG)
  );
}

/** Verbose TTS client tracing ([TTS] start/end/play, BFF route, etc.). */
export function isDebugTts(): boolean {
  if (typeof process === 'undefined') return false;
  return envTruthy(process.env.NEXT_PUBLIC_DEBUG_TTS);
}

/** High-frequency pipeline / useFrame trace ([AVATAR_MOTION_TRACE] replacements). */
export function isDebugTrace(): boolean {
  if (typeof process === 'undefined') return false;
  return (
    envTruthy(process.env.NEXT_PUBLIC_DEBUG_TRACE) ||
    envTruthy(process.env.NEXT_PUBLIC_AVATAR_MOTION_TRACE)
  );
}

function allowVerbose(domain: LogDomain): boolean {
  switch (domain) {
    case 'MOTION':
      return isDebugMotion();
    case 'TTS':
      return isDebugTts();
    case 'TRACE':
      return isDebugTrace();
    case 'SYSTEM':
      return false;
    default:
      return false;
  }
}

function resolveMsg(message: string | (() => string)): string {
  return typeof message === 'function' ? message() : message;
}

export function logDebug(
  domain: LogDomain,
  message: string | (() => string),
  ...args: unknown[]
): void {
  if (!allowVerbose(domain)) return;
  // eslint-disable-next-line no-console -- intentional debug channel
  console.log(`[DEBUG][${domain}]`, resolveMsg(message), ...args);
}

export function logInfo(
  domain: LogDomain,
  message: string | (() => string),
  ...args: unknown[]
): void {
  if (!allowVerbose(domain)) return;
  // eslint-disable-next-line no-console -- intentional info channel
  console.info(`[INFO][${domain}]`, resolveMsg(message), ...args);
}

/** Always emitted — use for operational warnings (VRMA authority, auth, blocked providers). */
export function logWarn(domain: LogDomain, message: string | (() => string), ...args: unknown[]): void {
  // eslint-disable-next-line no-console -- intentional warn channel
  console.warn(`[WARN][${domain}]`, resolveMsg(message), ...args);
}

/** Always emitted — failures, invariant breaks, leak detectors. */
export function logError(domain: LogDomain, message: string | (() => string), ...args: unknown[]): void {
  // eslint-disable-next-line no-console -- intentional error channel
  console.error(`[ERROR][${domain}]`, resolveMsg(message), ...args);
}

const _throttleAt = new Map<string, number>();

/**
 * Log at most once per `intervalMs` per `key` (useFrame-safe). No message build if still throttled.
 */
export function logDebugThrottled(
  domain: LogDomain,
  throttleKey: string,
  intervalMs: number,
  message: string | (() => string),
  ...args: unknown[]
): void {
  if (!allowVerbose(domain)) return;
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const last = _throttleAt.get(throttleKey) ?? 0;
  if (now - last < intervalMs) return;
  _throttleAt.set(throttleKey, now);
  // eslint-disable-next-line no-console
  console.log(`[DEBUG][${domain}]`, resolveMsg(message), ...args);
}

/** Throttled emit — callback runs only when verbose + throttle window elapsed (lazy payload). */
export function logDebugThrottledCallback(
  domain: LogDomain,
  throttleKey: string,
  intervalMs: number,
  emit: () => void,
): void {
  if (!allowVerbose(domain)) return;
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const last = _throttleAt.get(throttleKey) ?? 0;
  if (now - last < intervalMs) return;
  _throttleAt.set(throttleKey, now);
  emit();
}

/** Trace-only warn; silent unless `NEXT_PUBLIC_DEBUG_TRACE` (or legacy AVATAR_MOTION_TRACE). */
export function logTraceWarn(message: string | (() => string), ...args: unknown[]): void {
  if (!isDebugTrace()) return;
  // eslint-disable-next-line no-console
  console.warn(`[WARN][TRACE]`, resolveMsg(message), ...args);
}
