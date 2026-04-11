/**
 * avatar:performance → تعبيرات / إيماءات إجرائية (يتطلب مستمعاً في AvatarCanvas).
 */

import type { VRM } from '@pixiv/three-vrm';
import type { PerformanceCue } from '@/ai/avatar/performanceTags';
import { resolvePerformanceCue } from '@/ai/avatar/performanceTags';

/** Official baseline: performance-tag arm gestures ON — see `my memory/shared/COGNI_GESTURE_BASELINE.md`. */
const DISPATCH_PERFORMANCE_ARM_GESTURES = true;

export type SetExpressionMorph = (
  em: NonNullable<VRM['expressionManager']>,
  key: string,
  value: number,
) => void;

export function createAvatarPerformanceHandler(
  getVrm: () => VRM | null,
  setEM: SetExpressionMorph,
): (e: Event) => void {
  return (e: Event) => {
    const cue = (e as CustomEvent<PerformanceCue>).detail;
    if (!cue?.tag) return;
    const resolved = resolvePerformanceCue(cue);
    if (!resolved) {
      if (typeof console !== 'undefined' && process.env.NODE_ENV === 'development') {
        console.log(`[BRAIN] avatar:performance — unresolved: ${cue.tag}`);
      }
      return;
    }
    if (resolved.kind === 'emotion') {
      window.dispatchEvent(
        new CustomEvent('avatar:emotion', { detail: { emotion: resolved.emotion } }),
      );
      return;
    }
    if (resolved.kind === 'gesture') {
      if (!DISPATCH_PERFORMANCE_ARM_GESTURES) return;
      const dm = cue.duration_ms;
      const durationSec =
        typeof dm === 'number' && Number.isFinite(dm) && dm > 0
          ? Math.max(0.5, Math.min(4, dm / 1000))
          : 2.5;
      window.dispatchEvent(
        new CustomEvent('avatar:gesture', {
          detail: {
            type: resolved.token,
            duration: durationSec,
            side: 'right',
            fromPerformance: true,
          },
        }),
      );
      return;
    }
    const em = getVrm()?.expressionManager;
    if (em) {
      setEM(em, resolved.key, resolved.intensity);
    }
  };
}
