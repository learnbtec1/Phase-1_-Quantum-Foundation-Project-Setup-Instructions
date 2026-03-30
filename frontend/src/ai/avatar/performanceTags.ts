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
  | { kind: 'gesture'; token: string }
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

  const anim = (cue.animation || '').toLowerCase();

  // Full animation key → VRMA key map (mirrors VRMA_PATHS in AvatarCanvas).
  const gMap: Record<string, string> = {
    // Core gestures
    wave:         'wave',
    waving:       'wave',
    think:        'think',
    thinking:     'think',
    point:        'point',
    pointing:     'point',
    point_forward:'point',
    beckon:       'beckon',
    beckoning:    'beckon',
    agree:        'agree',
    agreeing:     'agree',
    ack:          'ack',
    acknowledging:'ack',
    nod:          'ack',
    clap:         'clap',
    clapping:     'clap',
    cheer:        'cheer',
    celebrate:    'cheer',
    relax:        'relax',
    look:         'look',
    look2:        'look2',
    goodbye:      'goodbye',
    bye:          'goodbye',
    // Aliases used by LLM / system
    explain:      'think',
    explain_01:   'think',
    open_hand:    'openHand',
    openhand:     'openHand',
    encourage:    'ack',
    question:     'think',
    shrug:        'relax',
    // Emotion-gestures
    sad:          'sad',
    angry:        'angry',
    surprise:     'surprise',
    surprised:    'surprise',
    blush:        'blush',
    sleepy:       'sleepy',
    // MotionPack
    peace:        'peace',
    greet:        'greet',
    pose:         'pose',
  };

  if (anim && gMap[anim]) {
    return { kind: 'gesture', token: gMap[anim] };
  }

  // [GESTURE_XXX] tag support (backend-generated performance cues)
  if (tag.startsWith('[GESTURE_')) {
    const inner = tag.replace(/^\[GESTURE_/, '').replace(/\]$/, '').toLowerCase();
    const mapped = gMap[inner] ?? gMap[inner.replace(/_/g, '')] ?? null;
    if (mapped) return { kind: 'gesture', token: mapped };
    // Keyword fallbacks
    if (inner.includes('point'))   return { kind: 'gesture', token: 'point' };
    if (inner.includes('explain')) return { kind: 'gesture', token: 'think' };
    if (inner.includes('wave'))    return { kind: 'gesture', token: 'wave' };
    if (inner.includes('clap'))    return { kind: 'gesture', token: 'clap' };
    if (inner.includes('cheer'))   return { kind: 'gesture', token: 'cheer' };
    if (inner.includes('think'))   return { kind: 'gesture', token: 'think' };
    if (inner.includes('beckon'))  return { kind: 'gesture', token: 'beckon' };
    if (inner.includes('nod'))     return { kind: 'gesture', token: 'ack' };
    if (inner.includes('agree'))   return { kind: 'gesture', token: 'agree' };
    if (inner.includes('relax'))   return { kind: 'gesture', token: 'relax' };
    if (inner.includes('goodbye')) return { kind: 'gesture', token: 'goodbye' };
    return { kind: 'gesture', token: 'openHand' };
  }

  if (anim) {
    return { kind: 'gesture', token: gMap[anim] ?? 'openHand' };
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
