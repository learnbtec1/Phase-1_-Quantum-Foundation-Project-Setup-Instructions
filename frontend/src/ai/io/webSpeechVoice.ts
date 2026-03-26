/**
 * Stable Web Speech API voice selection for Cogni (Arabic Jordanian male bias).
 *
 * Browsers return voices in non-deterministic order; without caching + tie-break
 * sorting, `getVoices().find(...)` can pick a different voice each utterance.
 */
'use client';

let _cachedVoiceUri: string | null = null;

const MALE_HINTS =
  /omar|taim|male|hamed|hamid|naayf|khalid|mohammed|محمد|ahmad|ahmed|zayd|zaid|fadl|mamdouh|riadh|maged/i;
const FEMALE_HINTS =
  /female|sana|layla|maysoon|noura|salma|dalia|zaynab|amina|lina|hala|maram|فاطمة|هدى/i;

export interface PickWebSpeechVoiceOptions {
  /** BCP-47 tag, e.g. ar-JO, en-US */
  langHint?: string;
  /** When true (default), prefer male-sounding Arabic voices for Dr. Hamza / Cogni */
  preferMale?: boolean;
}

/** Clear cached URI (e.g. after `voiceschanged` or for tests). */
export function invalidateStableWebSpeechVoiceCache(): void {
  _cachedVoiceUri = null;
}

function _normalizeLang(l: string): string {
  return (l || '').toLowerCase().replace(/_/g, '-');
}

function _scoreVoice(
  v: SpeechSynthesisVoice,
  langHint: string,
  preferMale: boolean,
): number {
  const l = _normalizeLang(v.lang);
  const hint = _normalizeLang(langHint);
  const primary = hint.split('-')[0] || 'ar';

  if (primary === 'ar') {
    if (!l.startsWith('ar')) return Number.NEGATIVE_INFINITY;
  } else if (!l.startsWith(primary)) {
    return Number.NEGATIVE_INFINITY;
  }

  let score = 0;
  if (l === hint) score += 120;
  else if (l === 'ar-jo') score += 112;
  else if (l.startsWith('ar-jo')) score += 108;
  else if (l === 'ar-sa') score += 96;
  else if (l.startsWith('ar')) score += 78;
  else if (l === 'en-us') score += 100;
  else if (l.startsWith('en')) score += 85;

  const blob = `${v.name} ${v.voiceURI}`.toLowerCase();
  if (preferMale) {
    if (FEMALE_HINTS.test(blob)) score -= 80;
    if (MALE_HINTS.test(blob)) score += 40;
  } else {
    if (MALE_HINTS.test(blob)) score -= 25;
    if (FEMALE_HINTS.test(blob)) score += 40;
  }

  return score;
}

/**
 * Pick one voice deterministically (highest score, then voiceURI sort) and cache by URI.
 */
export function getStableWebSpeechVoice(
  synth: SpeechSynthesis,
  options?: PickWebSpeechVoiceOptions,
): SpeechSynthesisVoice | null {
  const langHint = options?.langHint ?? 'ar-JO';
  const preferMale = options?.preferMale !== false;

  const voices = synth.getVoices();
  if (!voices.length) return null;

  if (_cachedVoiceUri) {
    const still = voices.find((x) => x.voiceURI === _cachedVoiceUri);
    if (still) return still;
    _cachedVoiceUri = null;
  }

  let best: SpeechSynthesisVoice | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  let bestKey = '';

  for (const v of voices) {
    const s = _scoreVoice(v, langHint, preferMale);
    if (!Number.isFinite(s)) continue;
    const tie = `${v.voiceURI}\0${v.name}`;
    if (s > bestScore || (s === bestScore && tie.localeCompare(bestKey) < 0)) {
      bestScore = s;
      best = v;
      bestKey = tie;
    }
  }

  if (best) {
    _cachedVoiceUri = best.voiceURI;
  }
  return best;
}

let _voicesHookAttached = false;

/** Re-pick after the browser lazy-loads voices (deterministic → same voice again). */
export function ensureWebSpeechVoicesChangeHook(): void {
  if (typeof window === 'undefined' || _voicesHookAttached) return;
  _voicesHookAttached = true;
  const synth = window.speechSynthesis;
  const onChange = () => invalidateStableWebSpeechVoiceCache();
  try {
    synth.addEventListener('voiceschanged', onChange);
  } catch {
    synth.onvoiceschanged = onChange;
  }
}

ensureWebSpeechVoicesChangeHook();
