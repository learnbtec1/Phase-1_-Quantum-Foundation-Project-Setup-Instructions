/**
 * Level 6.2 — Extra delay before motion execution (thinking / reaction feels).
 */

import type { Intent } from './intentTypes';

/** Additional ms to add to motion plan base delay. */
export function computeHesitation(intent: Intent): number {
  if (intent.type === 'thinking') {
    return 300 + Math.random() * 500;
  }
  if (intent.type === 'reacting') {
    return 100 + Math.random() * 200;
  }
  if (intent.type === 'greeting') {
    return 80 + Math.random() * 160;
  }
  if (intent.type === 'speaking') {
    return 40 + Math.random() * 120;
  }
  return 0;
}
