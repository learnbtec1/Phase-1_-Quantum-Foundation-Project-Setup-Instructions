/**
 * Ring buffer of recent semantic events for forensics (not raw console spam).
 */

export type StreamEntry = {
  ts: number;
  channel: string;
  name: string;
  detail?: unknown;
};

const MAX = 200;
const buffer: StreamEntry[] = [];

export function resetEventStream(): void {
  buffer.length = 0;
}

export function pushEventStream(channel: string, name: string, detail?: unknown): void {
  buffer.push({ ts: performance.now(), channel, name, detail });
  if (buffer.length > MAX) buffer.shift();
}

export function getEventStream(): readonly StreamEntry[] {
  return buffer;
}

export function getEventStreamLength(): number {
  return buffer.length;
}
