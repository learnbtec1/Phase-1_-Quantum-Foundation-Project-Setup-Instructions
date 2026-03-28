/**
 * Performance Tag System — sync LLM `performance[]` cues with avatar timing.
 * Word index → ms via Azure `word_cues` when present; else linear estimate over dialogue duration.
 */

export interface PerformanceCue {
  tag: string;
  start_word: number;
  blendshape?: string;
  intensity?: number;
  animation?: string;
  /** V50 — `'left' | 'right' | 'both'` from LLM JSON when present */
  side?: 'left' | 'right' | 'both';
  /**
   * V50 — duration in **seconds** (after normalize). Raw payload may be ms (≥100 → divided by 1000).
   */
  duration?: number;
}

export interface WordCue {
  t: number;
  w?: string;
}

/** Normalize unknown WS payload entries into PerformanceCue[]. */
export function normalizePerformanceList(raw: unknown): PerformanceCue[] {
  if (!Array.isArray(raw)) return [];
  const out: PerformanceCue[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const tag = typeof o.tag === 'string' ? o.tag.trim() : '';
    if (!tag) continue;
    let sw = 0;
    try {
      sw = Math.max(0, Math.floor(Number(o.start_word ?? 0)));
    } catch {
      sw = 0;
    }
    const cue: PerformanceCue = { tag, start_word: sw };
    if (typeof o.blendshape === 'string' && o.blendshape.trim()) {
      cue.blendshape = o.blendshape.trim();
    }
    if (typeof o.animation === 'string' && o.animation.trim()) {
      cue.animation = o.animation.trim();
    }
    let inten = 0.5;
    try {
      inten = Number(o.intensity);
      if (!Number.isFinite(inten)) inten = 0.5;
    } catch {
      inten = 0.5;
    }
    cue.intensity = Math.max(0, Math.min(1, inten));
    const sd = o.side;
    if (sd === 'left' || sd === 'right' || sd === 'both') cue.side = sd;
    const durRaw = o.duration ?? o.duration_sec;
    if (typeof durRaw === 'number' && Number.isFinite(durRaw) && durRaw > 0) {
      cue.duration = durRaw >= 100 ? durRaw / 1000 : durRaw;
    }
    out.push(cue);
  }
  return out;
}

/**
 * Time (ms) when the word at `startWord` begins (aligned to Azure word_cues when possible).
 */
export function startWordToDelayMs(
  startWord: number,
  speechText: string,
  wordCues: WordCue[] | undefined,
  fallbackTotalMs: number,
): number {
  const words = speechText.trim().split(/\s+/).filter(Boolean);
  const idx = Math.min(Math.max(0, startWord), Math.max(0, words.length - 1));
  if (wordCues && wordCues.length > 0) {
    if (startWord < wordCues.length) {
      const t = wordCues[startWord]?.t;
      if (typeof t === 'number' && Number.isFinite(t)) return Math.max(0, t);
    }
    const last = wordCues[wordCues.length - 1]?.t;
    if (typeof last === 'number' && startWord >= wordCues.length && words.length > 0) {
      const extra = startWord - (wordCues.length - 1);
      const per = last / Math.max(1, wordCues.length - 1);
      return Math.min(fallbackTotalMs, Math.round(last + extra * per));
    }
  }
  const n = Math.max(1, words.length);
  const frac = n > 1 ? idx / (n - 1) : 0;
  return Math.round(frac * Math.max(200, fallbackTotalMs));
}

export type ResolvedPerformance =
  | { kind: 'emotion'; emotion: string }
  | { kind: 'gesture'; token: string; side?: 'left' | 'right' | 'both' }
  | { kind: 'blendshape'; key: string; intensity: number };

/**
 * Map a cue tag / animation / blendshape to concrete avatar actions (VRMA + emotion + morphs).
 */
export function resolvePerformanceCue(cue: PerformanceCue): ResolvedPerformance | null {
  const tag = (cue.tag || '').toUpperCase();
  const intensity = cue.intensity ?? 0.5;

  if (cue.blendshape?.trim()) {
    return { kind: 'blendshape', key: cue.blendshape.trim(), intensity };
  }

  if (tag.startsWith('[EMOTE_')) {
    const inner = tag.replace(/^\[EMOTE_/, '').replace(/\]$/, '').toLowerCase();
    const emoMap: Record<string, string> = {
      neutral: 'neutral',
      surprise: 'surprised',
      surprised: 'surprised',
      happy: 'happy',
      sad: 'sad',
      angry: 'angry',
      thinking: 'thinking',
      calm: 'calm',
      encouraging: 'encouraging',
    };
    return { kind: 'emotion', emotion: emoMap[inner] ?? 'neutral' };
  }

  const anim = (cue.animation || '').toLowerCase().replace(/\s+/g, '_');
  const gMap: Record<string, { token: string; side?: 'left' | 'right' | 'both' }> = {
    point_forward: { token: 'point' },
    point: { token: 'point' },
    point_left: { token: 'point', side: 'left' },
    point_right: { token: 'point', side: 'right' },
    open_hand: { token: 'openHand' },
    open_hand_left: { token: 'openHand', side: 'left' },
    open_hand_right: { token: 'openHand', side: 'right' },
    explain_01: { token: 'think' },
    explain: { token: 'think' },
    thinking: { token: 'think' },
    wave: { token: 'wave' },
    clap: { token: 'clap' },
    cheer: { token: 'cheer' },
    beckon: { token: 'beckon' },
    two_fingers: { token: 'peace' },
    thumbs_up: { token: 'thumbUp' },
    thumb_up: { token: 'thumbUp' },
  };
  if (anim && gMap[anim]) {
    const g = gMap[anim];
    return { kind: 'gesture', token: g.token, side: g.side ?? cue.side };
  }
  if (tag.startsWith('[GESTURE_')) {
    if (tag.includes('POINT')) return { kind: 'gesture', token: 'point', side: cue.side };
    if (tag.includes('EXPLAIN')) return { kind: 'gesture', token: 'think', side: cue.side };
    if (tag.includes('WAVE')) return { kind: 'gesture', token: 'wave', side: cue.side };
    if (tag.includes('CLAP')) return { kind: 'gesture', token: 'clap', side: cue.side };
    if (tag.includes('OPEN')) return { kind: 'gesture', token: 'openHand', side: cue.side };
    return { kind: 'gesture', token: 'openHand', side: cue.side };
  }
  if (anim) {
    console.warn(
      `[performanceTags] Unknown performance animation "${cue.animation}" (tag=${cue.tag}) — falling back to openHand`,
    );
    return { kind: 'gesture', token: 'openHand', side: cue.side ?? 'right' };
  }
  return null;
}

export function schedulePerformanceCues(
  speech: string,
  performance: PerformanceCue[] | undefined,
  wordCues: WordCue[] | undefined,
  fallbackTotalMs: number,
  onFire: (cue: PerformanceCue) => void,
): ReturnType<typeof setTimeout>[] {
  const timers: ReturnType<typeof setTimeout>[] = [];
  if (typeof window === 'undefined' || !performance?.length) return timers;
  for (const cue of performance) {
    const delay = startWordToDelayMs(cue.start_word, speech, wordCues, fallbackTotalMs);
    const id = window.setTimeout(() => {
      try {
        onFire(cue);
      } catch {
        /* ignore */
      }
    }, delay);
    timers.push(id);
  }
  return timers;
}
