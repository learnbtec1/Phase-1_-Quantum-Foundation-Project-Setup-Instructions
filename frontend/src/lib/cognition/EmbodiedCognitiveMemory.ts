'use client';

import type { CognitiveMemoryEvent } from './types';

const WINDOW_MS = 10 * 60 * 1000;
const MAX_EVENTS = 240;
const _events: CognitiveMemoryEvent[] = [];

export function cognitionMemoryRecord(kind: string, payload: string): void {
  _events.push({ ts: Date.now(), kind, payload });
  while (_events.length > MAX_EVENTS) _events.shift();
}

export function cognitionMemoryPrune(): void {
  const cutoff = Date.now() - WINDOW_MS;
  while (_events.length > 0 && _events[0].ts < cutoff) _events.shift();
}

export function cognitionMemorySnapshot(): { windowMs: number; events: CognitiveMemoryEvent[] } {
  cognitionMemoryPrune();
  return { windowMs: WINDOW_MS, events: [..._events] };
}
