// File: frontend/src/utils/LipSyncAudioAnalyzer.ts
export function analyzeAudioVolume(audioBuffer: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < audioBuffer.length; i++) sum += Math.abs(audioBuffer[i]);
  return sum / audioBuffer.length; // القيمة بين 0 .. 1
}