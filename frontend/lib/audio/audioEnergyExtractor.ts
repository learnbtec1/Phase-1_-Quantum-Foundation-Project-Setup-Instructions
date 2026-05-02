/**
 * Time-domain RMS from AnalyserNode — stable voice energy for motion modulation.
 * Frequency-only estimates (getByteFrequencyData) are kept elsewhere for lip energy.
 */
'use client';

/** Normalize RMS of [-1,1] float signal to ~[0,1] with gentle curve */
export function readAnalyserRms01(
  analyser: AnalyserNode,
  bufRef: { current: Uint8Array | null },
): number {
  const n = analyser.fftSize;
  let buf = bufRef.current;
  if (!buf || buf.length !== n) {
    buf = new Uint8Array(n);
    bufRef.current = buf;
  }
  analyser.getByteTimeDomainData(buf as Parameters<AnalyserNode['getByteTimeDomainData']>[0]);
  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    const v = (buf[i]! - 128) / 128;
    sumSq += v * v;
  }
  const rms = Math.sqrt(sumSq / Math.max(1, n));
  const shaped = Math.min(1, rms * 2.85);
  return Math.min(1, Math.max(0, shaped));
}
