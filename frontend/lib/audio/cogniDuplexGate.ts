/**
 * Strict half-duplex / turn-taking: single `window.__cogniState` for TTS↔VAD coordination.
 */

'use client';

export type CogniWindowStateShape = {
  /** True only while audible TTS is playing (never during fetch/decode-only). */
  speaking: boolean;
  listening: boolean;
  lastTtsText: string | null;
  /** Dedupe anchor at TTS session **request** time (duplicate suppression window). Not VAD cooldown. */
  lastTtsTime: number;
  /**
   * True after TTS session is accepted until playback arms or aborts —
   * holds conversational floor without setting {@link speaking}.
   */
  outboundTtsReserved: boolean;
  /**
   * Wall-clock ms when outbound TTS `HTMLAudioElement` fired `ended` — VAD / mic cooldown anchor.
   */
  lastOutboundTtsEndWallMs: number;
};

declare global {
  interface Window {
    __cogniState?: CogniWindowStateShape;
    /**
     * When `true`, all mic-driven barge-in paths are no-ops (console / automation).
     * Independent of duplex `speaking` lock.
     */
    __cogniDisableBargeIn?: boolean;
  }
}

export const COGNI_duplex_RESUME_AFTER_END_MS = 1200;
export const COGNI_duplex_RESUME_AFTER_FAIL_MS = 500;

/** Same floor as mic resume delay — minimum 1200 ms (never below product safety 800 ms). */
export const COGNI_duplex_POST_TTS_VAD_COOLDOWN_MS = COGNI_duplex_RESUME_AFTER_END_MS;

/** After `HTMLAudioElement` `ended`, duplex unlock waits this long — output device / codec tail can lag the event (~100–150 ms). */
export const COGNI_duplex_NATURAL_END_TAIL_MS = 140;

const DUP_TEXT_WINDOW_MS = 3000;

function ensure(): CogniWindowStateShape | null {
  if (typeof window === 'undefined') return null;
  if (!window.__cogniState) {
    window.__cogniState = {
      speaking: false,
      listening: false,
      lastTtsText: null,
      lastTtsTime: 0,
      outboundTtsReserved: false,
      lastOutboundTtsEndWallMs: 0,
    };
  } else {
    const st = window.__cogniState!;
    if (typeof st.outboundTtsReserved !== 'boolean') {
      st.outboundTtsReserved = false;
    }
    if (typeof st.lastOutboundTtsEndWallMs !== 'number') {
      st.lastOutboundTtsEndWallMs = 0;
    }
  }
  return window.__cogniState ?? null;
}

/** Idempotent SSR-safe initializer (devtools / probes). */
export function cogniDuplexTryInit(): CogniWindowStateShape | null {
  return ensure();
}

export function cogniNormalizeTtsDedupeKey(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

export function cogniDuplexIsSpeaking(): boolean {
  return Boolean(ensure()?.speaking);
}

/** Call exactly from outbound TTS `HTMLAudioElement` `ended` (natural finish). Not for fetch/play failure. */
export function cogniDuplexStampOutboundPlaybackEnded(nowMs?: number): void {
  cogniDuplexTryInit();
  const s = ensure();
  if (!s) return;
  const n = typeof nowMs === 'number' && Number.isFinite(nowMs) ? nowMs : Date.now();
  s.lastOutboundTtsEndWallMs = n;
}

export function cogniDuplexIsWithinPostTtsVadCooldown(nowMs?: number): boolean {
  const s = ensure();
  if (!s) return false;
  const end = s.lastOutboundTtsEndWallMs;
  if (typeof end !== 'number' || !Number.isFinite(end) || end <= 0) return false;
  const now = typeof nowMs === 'number' && Number.isFinite(nowMs) ? nowMs : Date.now();
  return now - end < COGNI_duplex_POST_TTS_VAD_COOLDOWN_MS;
}

/**
 * True while outbound TTS holds the conversational floor — microphone must not
 * trigger barge-in or emit interrupt segments toward the WS turn.
 */
export function cogniDuplexBlocksUserBargeIn(): boolean {
  if (typeof window === 'undefined') return false;
  const win = window as Window & { __cogniDisableBargeIn?: boolean };
  if (win.__cogniDisableBargeIn === true) return true;
  cogniDuplexTryInit();
  const s = win.__cogniState;
  return Boolean(s?.speaking || s?.outboundTtsReserved);
}

export function cogniDuplexSyncListeningUi(active: boolean): void {
  const s = ensure();
  if (!s) return;
  s.listening = Boolean(active);
}

export function cogniDuplexLogState(where?: string): void {
  const s = ensure();
  if (!s) return;
  // eslint-disable-next-line no-console
  console.log('[STATE]', typeof window !== 'undefined' ? window.__cogniState : s, where ?? '');
}

/**
 * Pause mic pipeline before outbound TTS (HTTP or WS).
 * Mirrors useAgentAgent half-duplex pause.
 */
export function cogniDuplexPauseMic(reason: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('cogni:duplex:pause_mic', { detail: { reason } }),
  );
}

/** Call after HTMLAudioElement `play()` resolves — audible session only. */
export function cogniDuplexMarkOutboundPlaybackStarted(): void {
  cogniDuplexTryInit();
  const s = ensure();
  if (!s) return;
  s.outboundTtsReserved = false;
  s.speaking = true;
  s.listening = false;
  // eslint-disable-next-line no-console
  console.log('[TTS LOCK]', true);
  // eslint-disable-next-line no-console
  console.log('[VAD BLOCKED]', true);
  cogniDuplexLogState('playback started');
}

/** After natural playback end (post `ended` tail) or hard stop: clear speaking/reservation flags. */
export function cogniDuplexMarkSpeakingEnded(): void {
  const s = ensure();
  if (!s) return;
  console.log('[TTS LOCK]', false);
  cogniDuplexLogState('after playback end');
  s.speaking = false;
  s.outboundTtsReserved = false;
}

/**
 * Duplicate HTTP TTS suppression (normalized text within 3s window).
 */
export function cogniDuplexShouldSkipDuplicateTts(trimmedFullText: string): boolean {
  const s = ensure();
  if (!s) return false;
  const key = cogniNormalizeTtsDedupeKey(trimmedFullText);
  if (!key) return false;
  const now = Date.now();
  if (key === s.lastTtsText && now - s.lastTtsTime < DUP_TEXT_WINDOW_MS) {
    // eslint-disable-next-line no-console
    console.log('[TTS SKIPPED DUPLICATE]', {
      snippet: key.slice(0, 120),
      deltaMs: now - s.lastTtsTime,
    });
    return true;
  }
  return false;
}

export type BeginHttpDuplex =
  | { ok: true }
  | { ok: false; reason: 'busy' | 'duplicate' };

/**
 * Acquire strict lock for HTTP `speakWithTTS`: blocks concurrent TTS & pauses capture.
 */
export function cogniDuplexTryBeginHttpTtsSession(trimmedFullText: string): BeginHttpDuplex {
  cogniDuplexTryInit();
  const s = ensure();
  if (!s) return { ok: true };

  if (s.speaking || s.outboundTtsReserved) {
    cogniDuplexLogState('[TTS LOCK] reject — concurrent');
    // eslint-disable-next-line no-console
    console.warn('[useAgentAgent] TTS suppressed — duplex speaking lock active');
    return { ok: false, reason: 'busy' };
  }

  if (cogniDuplexShouldSkipDuplicateTts(trimmedFullText)) {
    return { ok: false, reason: 'duplicate' };
  }

  const key = cogniNormalizeTtsDedupeKey(trimmedFullText);
  const now = Date.now();
  s.lastTtsText = key;
  s.lastTtsTime = now;
  s.outboundTtsReserved = true;
  s.listening = false;
  // eslint-disable-next-line no-console
  console.log('[TTS RESERVED]', true);
  cogniDuplexLogState('reserved http tts (pre-play)');

  cogniDuplexPauseMic('http_tts');

  return { ok: true };
}

/**
 * Acquire lock for WS `speech_data` playback (same element as HTTP — no overlaps).
 */
export function cogniDuplexTryBeginWsTtsSession(resumeDedupeSnippet?: string | null): BeginHttpDuplex {
  cogniDuplexTryInit();
  const s = ensure();
  if (!s) return { ok: true };

  if (s.speaking || s.outboundTtsReserved) {
    cogniDuplexLogState('[TTS LOCK] ws reject — concurrent');
    // eslint-disable-next-line no-console
    console.warn('[WS TTS] speech_data ignored — duplex speaking lock active');
    return { ok: false, reason: 'busy' };
  }

  const snip = resumeDedupeSnippet?.trim?.() ?? '';
  if (
    snip
    && s.lastTtsText === cogniNormalizeTtsDedupeKey(snip)
    && Date.now() - s.lastTtsTime < DUP_TEXT_WINDOW_MS
  ) {
    // eslint-disable-next-line no-console
    console.log('[TTS SKIPPED DUPLICATE]', { source: 'ws', snippet: snip.slice(0, 80) });
    return { ok: false, reason: 'duplicate' };
  }

  if (snip) {
    const key = cogniNormalizeTtsDedupeKey(snip);
    s.lastTtsText = key;
    s.lastTtsTime = Date.now();
  }

  s.outboundTtsReserved = true;
  s.listening = false;
  // eslint-disable-next-line no-console
  console.log('[TTS RESERVED]', true);
  cogniDuplexLogState('reserved ws_tts (pre-play)');
  cogniDuplexPauseMic('ws_tts');

  return { ok: true };
}

/**
 * Abort before/during playback (fetch fail, decode fail): release lock + reschedule capture.
 */
export function cogniDuplexAbortTtsSession(reason?: string): void {
  cogniDuplexTryInit();
  const s = ensure();
  if (!s) return;
  if (!s.speaking && !s.outboundTtsReserved) return;
  s.speaking = false;
  s.outboundTtsReserved = false;
  console.log('[TTS LOCK]', false);
  cogniDuplexLogState(reason ? `tts abort (${reason})` : 'tts abort');
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('cogni:duplex:tts_aborted', {
        detail: { delayMs: COGNI_duplex_RESUME_AFTER_FAIL_MS, reason: reason ?? 'unknown' },
      }),
    );
  }
}
