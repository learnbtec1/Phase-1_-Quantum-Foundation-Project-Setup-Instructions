/**
 * avatar:performance listener logic — kept in a separate module so Turbopack does not
 * incorrectly drop the handler while preserving addEventListener('…', onPerformance)
 * references (runtime ReferenceError: onPerformance is not defined).
 */

import type { VRM } from '@pixiv/three-vrm';
import type { PerformanceCue } from '@/ai/avatar/performanceTags';
import { resolvePerformanceCue } from '@/ai/avatar/performanceTags';

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
      window.dispatchEvent(
        new CustomEvent('avatar:gesture', {
          detail: { type: resolved.token, duration: 2.5, side: 'right' },
        }),
      );
      console.log(`[BRAIN] avatar:performance → gesture ${resolved.token}`);
      return;
    }
    const em = getVrm()?.expressionManager;
    if (em) {
      setEM(em, resolved.key, resolved.intensity);
      console.log(`[BRAIN] avatar:performance → blendshape ${resolved.key} @ ${resolved.intensity}`);
    }
  };
}
