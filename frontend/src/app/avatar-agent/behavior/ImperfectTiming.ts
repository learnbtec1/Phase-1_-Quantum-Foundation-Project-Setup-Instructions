/**
 * Level 7.1 — Non-fixed delays / durations (dynamic 90–160 ms class variation on top of base).
 */

function frac01(x: number): number {
  return x - Math.floor(x);
}

/** Warp delay toward human-irregular spacing (ms). `strength` 0 = identity, 1 = full 7.1 warp. */
export function warpDelayMs(
  baseMs: number,
  mindTimeMs: number,
  strength = 1,
): number {
  const t = mindTimeMs * 0.0024;
  const osc = 0.82 + 0.22 * Math.sin(t);
  const wobble = Math.sin(mindTimeMs * 0.0033) * 38 + Math.cos(mindTimeMs * 0.0017) * 22;
  const warped = Math.max(35, baseMs * osc + wobble * frac01(mindTimeMs * 0.00051));
  const s = Math.max(0, Math.min(1, strength));
  return baseMs + (warped - baseMs) * s;
}

/** Slight duration drift (ms). `strength` 0 = identity, 1 = full 7.1 warp. */
export function warpDurationMs(
  baseMs: number,
  mindTimeMs: number,
  strength = 1,
): number {
  const t = mindTimeMs * 0.0019;
  const osc = 0.9 + 0.14 * Math.cos(t * 1.3);
  const warped = Math.max(120, baseMs * osc + Math.sin(mindTimeMs * 0.0028) * 55);
  const s = Math.max(0, Math.min(1, strength));
  return baseMs + (warped - baseMs) * s;
}
