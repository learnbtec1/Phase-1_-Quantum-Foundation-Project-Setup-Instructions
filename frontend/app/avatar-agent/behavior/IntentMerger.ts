/**
 * Level 6.1 — Soft-combine intents instead of hard drops where possible.
 */

import type { Intent, IntentType } from './intentTypes';

function priority(t: IntentType): number {
  const map: Record<IntentType, number> = {
    speaking: 5,
    reacting: 4,
    thinking: 3,
    greeting: 3,
    listening: 2,
    idle: 1,
  };
  return map[t] ?? 0;
}

/**
 * Merges previous cognitive sample with the new one (e.g. rapid events).
 */
export function mergeIntents(a: Intent | null, b: Intent): Intent {
  if (!a) return { ...b };

  if (a.type === b.type) {
    return {
      ...b,
      intensity: Math.min(1, (a.intensity + b.intensity) / 2),
      confidence: Math.min(1, (a.confidence + b.confidence) / 2),
      duration: b.duration ?? a.duration,
      source: b.source,
    };
  }

  if (a.type === 'thinking' && b.type === 'reacting') {
    return { ...b, intensity: Math.min(1, b.intensity + 0.06) };
  }

  if (a.type === 'reacting' && b.type === 'thinking') {
    return { ...a, intensity: Math.min(1, a.intensity + 0.04) };
  }

  if (priority(b.type) > priority(a.type)) return b;
  if (priority(a.type) > priority(b.type)) return a;
  return a.intensity >= b.intensity ? a : b;
}
