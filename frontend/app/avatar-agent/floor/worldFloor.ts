/**
 * Single source of truth for avatar / walk floor height (world metres, Y-up).
 * Do not derive floor from GLB Box3 or model mesh bounds — hidden geometry breaks that.
 */

export const FLOOR_SOURCE = 'WORLD' as const;

export const WORLD_FLOOR_Y = 0;

export function getWorldFloorY(): number {
  return WORLD_FLOOR_Y;
}

/**
 * Dev-only guard: call if legacy code still treats `Box3.min.y` (or similar) as floor height.
 * Prefer `getWorldFloorY()` everywhere for grounding.
 */
export function warnModelFloorAxisMisuse(context: string): void {
  if (typeof process !== 'undefined' && process.env.NODE_ENV === 'development') {
    console.warn('[floor] DO NOT USE MODEL FLOOR (e.g. Box3.min.y) —', context, '— use getWorldFloorY().');
  }
}
