/**
 * Gates random / timer-driven gesture micro-injectors (behavior brain, spontaneous, TTS nods, co-speech).
 * Set `NEXT_PUBLIC_DISABLE_AUTOMATIC_GESTURE_INJECTORS=true` for a single authority (e.g. VRMA + direct play only).
 */
export function automaticGestureInjectorsDisabled(): boolean {
  return typeof process !== 'undefined' && process.env.NEXT_PUBLIC_DISABLE_AUTOMATIC_GESTURE_INJECTORS === 'true';
}
