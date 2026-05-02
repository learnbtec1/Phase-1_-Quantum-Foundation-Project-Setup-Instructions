/**
 * Level 7 — Last published mind frame (read-only for tools / debug).
 */

import type { GlobalMindFrame } from './GlobalMindFrame';

let frame: GlobalMindFrame | null = null;

export function setGlobalFrame(next: GlobalMindFrame): void {
  frame = next;
}

export function getGlobalFrame(): GlobalMindFrame | null {
  return frame;
}

export function clearGlobalFrame(): void {
  frame = null;
}
