/**
 * Decides when lip-sync may trust `HTMLAudioElement` playhead + analyser fallback.
 * Without viseme cues, strict HAVE_CURRENT_DATA would freeze the mouth until decode catches up.
 */

/** RMS floor — aligned with LipSyncManager `LIP_RMS_SILENCE` semantics */
const RMS_GATE = 0.0026;

export function isAudioReadyForLipSync(
  audio: HTMLAudioElement | null,
  queueLen: number,
  hasAnalyser: boolean,
  lipRms: number,
): boolean {
  if (!audio || Number.isNaN(audio.currentTime) || audio.currentTime < 0) return false;

  const HAVE_CURRENT_DATA = 2;
  const HAVE_METADATA = 1;

  const strict =
    audio.readyState >= HAVE_CURRENT_DATA ||
    (queueLen > 0 && !audio.paused && audio.readyState >= HAVE_METADATA);

  /** Timeline absent — drive mouth from analyser energy even at HAVE_METADATA */
  const analyserFallback =
    queueLen === 0 &&
    hasAnalyser &&
    (audio.readyState >= HAVE_METADATA ||
      (!audio.paused && lipRms > RMS_GATE * 1.25));

  return strict || analyserFallback;
}
