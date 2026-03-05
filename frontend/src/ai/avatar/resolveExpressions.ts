/**
 * resolveExpressions.ts
 * ──────────────────────────────────────────────────────────────────────────
 * Maps canonical expression names → the first available key found in a VRM
 * model's expression manager or morph-target list.
 *
 * Call once after VRM load, then reuse the returned Map<string,string> for
 * all expression lookups to avoid per-frame string searching.
 *
 * @example
 *   const available = new Set(vrm.expressionManager?.expressionMap.keys() ?? []);
 *   const exprMap = resolveExpressionKeys(available);
 *   // exprMap.get(ExpressionNames.BLINK) → 'blink' | 'Blink' | undefined
 */
import { ExpressionCandidates } from '@/constants/avatar/ExpressionAliases';
import type { ExpressionName } from '@/constants/avatar/ExpressionNames';

/**
 * Build a canonical→actual key map using the given set of available keys.
 *
 * @param available   Set of expression/morph-target keys that the model exposes.
 * @param logPrefix   If supplied, logs the resolved map once for debugging.
 * @returns           Map from canonical ExpressionName → actual model key.
 */
export function resolveExpressionKeys(
  available: Set<string>,
  logPrefix?: string
): Map<ExpressionName, string> {
  const resolved = new Map<ExpressionName, string>();

  for (const [canon, candidates] of Object.entries(ExpressionCandidates)) {
    const hit = candidates.find((k) => available.has(k));
    if (hit) resolved.set(canon as ExpressionName, hit);
  }

  if (logPrefix && resolved.size > 0) {
    const summary = [...resolved.entries()]
      .map(([k, v]) => `${k}→${v}`)
      .join(', ');
    console.debug(`${logPrefix} resolved ${resolved.size} expression keys: ${summary}`);
  }

  return resolved;
}

/**
 * Build an available-keys Set from a VRM instance.
 * Works with VRM1 (expressionManager) and VRM0 (blendShapeProxy).
 */
export function getAvailableExpressionKeys(vrm: any): Set<string> {
  const keys = new Set<string>();

  // VRM 1.x
  const mgr = vrm?.expressionManager;
  if (mgr?.expressionMap) {
    for (const k of Object.keys(mgr.expressionMap)) keys.add(k);
  }

  // VRM 0.x
  const proxy = vrm?.blendShapeProxy;
  if (proxy?.expressions) {
    for (const k of Object.keys(proxy.expressions)) keys.add(k);
  } else if (proxy?.blendShapeGroups) {
    for (const g of proxy.blendShapeGroups) {
      if (g?.name) keys.add(g.name);
    }
  }

  // Also collect morph-target names from skinned meshes
  if (vrm?.scene) {
    vrm.scene.traverse((obj: any) => {
      if (obj.morphTargetDictionary) {
        for (const k of Object.keys(obj.morphTargetDictionary)) keys.add(k);
      }
    });
  }

  return keys;
}
