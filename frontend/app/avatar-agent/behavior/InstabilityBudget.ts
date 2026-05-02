/**
 * Level 7.2 — Caps how much layered randomness can stack (noise, drift, conflict, partial, timing).
 */

export type InstabilityBudget = {
  noise: number;
  drift: number;
  conflict: number;
  partial: number;
  timing: number;
};

/** Safe human-like upper bounds (relative weights, not seconds). */
export const defaultBudget: InstabilityBudget = {
  noise: 0.15,
  drift: 0.1,
  conflict: 0.08,
  partial: 0.12,
  timing: 0.1,
};
