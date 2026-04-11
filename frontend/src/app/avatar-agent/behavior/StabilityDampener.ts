/**
 * Level 7.2 — When coherence is low, shrink instability budgets so the stack self-stabilizes.
 */

import type { InstabilityBudget } from './InstabilityBudget';

export function dampen(
  budget: InstabilityBudget,
  coherence: number,
): InstabilityBudget {
  const factor = Math.max(0.4, coherence);
  return {
    noise: budget.noise * factor,
    drift: budget.drift * factor,
    conflict: budget.conflict * factor,
    partial: budget.partial * factor,
    timing: budget.timing * factor,
  };
}
