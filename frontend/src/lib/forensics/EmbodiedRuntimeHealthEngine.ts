'use client';

import type { EmbodimentQualityBreakdown } from './types';

/** Fuse diagnostics-driven shell score with embodiment quality cube (≈60s path only). */
export function computeEmbodiedRuntimeHealth(
  diagnosticsShellScore: number,
  quality: EmbodimentQualityBreakdown,
): number {
  const fused =
    diagnosticsShellScore * 0.42 +
    quality.overallEmbodiment * 0.33 +
    quality.facialEmbodiment * 0.15 +
    quality.spatialEmbodiment * 0.1;
  return Math.max(0, Math.min(100, Math.round(fused)));
}
