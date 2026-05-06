'use client';

/**
 * Temporal embodiment façade — delegates disk snapshots to diagnostics recorder,
 * exposes typed accessors for the embodiment nervous system (no duplicate timers).
 */

import type { RuntimeTimelineSnapshot } from '@/lib/diagnostics/diagnosticsTypes';

export function getTemporalTransitionLabels(): string[] {
  if (typeof window === 'undefined') return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  const g = w.__TEMPORAL_TRANSITION_GRAPH;
  return Array.isArray(g) ? (g as string[]) : [];
}

export function getLastTimelineSnapshotEmbodied(): RuntimeTimelineSnapshot | null {
  if (typeof window === 'undefined') return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = (window as any).__TIMELINE_LAST_SNAPSHOT as RuntimeTimelineSnapshot | undefined;
  return s && typeof s === 'object' ? s : null;
}

export function getBehavioralChainsEmbodied(): Array<{
  rootCause: string;
  timeline: string[];
  confidence: number;
  fileHint?: string;
  fnHint?: string;
  lineHint?: number;
}> {
  if (typeof window === 'undefined') return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = (window as any).__BEHAVIORAL_FORENSICS_CHAINS;
  return Array.isArray(c) ? c : [];
}
