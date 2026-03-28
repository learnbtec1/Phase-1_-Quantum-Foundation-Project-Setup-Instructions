/**
 * avatar:performance listener logic — kept in a separate module so Turbopack does not
 * incorrectly drop the handler while preserving addEventListener('…', onPerformance)
 * references (runtime ReferenceError: onPerformance is not defined).
 */

import type { VRM } from '@pixiv/three-vrm';
import type { PerformanceCue } from '@/ai/avatar/performanceTags';
import { resolvePerformanceCue } from '@/ai/avatar/performanceTags';
import { checkGestureCooldown, recordGestureLog } from '@/ai/memory/store';

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
      console.log(`[BRAIN] avatar:performance — unresolved: ${cue.tag}`);
      return;
    }
    if (resolved.kind === 'emotion') {
      window.dispatchEvent(new CustomEvent('avatar:emotion', { detail: { emotion: resolved.emotion } }));
      console.log(`[BRAIN] avatar:performance → emotion ${resolved.emotion}`);
      return;
    }
    if (resolved.kind === 'gesture') {
      const side = resolved.side ?? cue.side ?? 'right';
      const durationSec =
        typeof cue.duration === 'number' && cue.duration > 0 ? cue.duration : 2.5;
      if (
        !checkGestureCooldown(resolved.token, {
          fromAI: true,
          explicitActionToken: resolved.token,
        })
      ) {
        console.warn(
          `[avatar:performance] Cooldown blocked gesture "${resolved.token}" (tag=${cue.tag})`,
        );
        return;
      }
      recordGestureLog(resolved.token);
      window.dispatchEvent(
        new CustomEvent('avatar:gesture', {
          detail: {
            type: resolved.token,
            duration: durationSec,
            side,
            fromPerformance: true,
            fromAI: true,
          },
        }),
      );
      console.log(
        `[BRAIN] avatar:performance → gesture ${resolved.token} side=${side} dur=${durationSec}s`,
      );
      return;
    }
    const em = getVrm()?.expressionManager;
    if (em) {
      setEM(em, resolved.key, resolved.intensity);
      console.log(`[BRAIN] avatar:performance → blendshape ${resolved.key} @ ${resolved.intensity}`);
    }
  };
}
