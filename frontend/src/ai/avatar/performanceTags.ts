/**
 * Performance Tag System — sync LLM `performance[]` cues with avatar timing.
 * Word index → ms via Azure `word_cues` when present; else linear estimate over dialogue duration.
 */

export interface PerformanceCue {
  tag: string;
  start_word: number;
  /** إن وُجد، يُفضَّل على start_word لجدولة التوقيت بالمللي ثانية من بداية الكلام */
  start_ms?: number;
  /** Extra lead/lag vs playback anchor (from LLM `cospeech_offset_ms` / `lead_ms`) */
  cospeech_offset_ms?: number;
  /** مدة نافذة الإيماءة (من LLM gestures[]) بالمللي ثانية */
  duration_ms?: number;
  blendshape?: string;
  intensity?: number;
  animation?: string;
}

export interface WordCue {
  t: number;
  w?: string;
}

/** Normalize unknown WS payload entries into PerformanceCue[]. */
/**
 * حقل `gestures` المنفصل في إطار WebSocket (بالإضافة إلى performance).
 */
export function normalizeGesturesArrayFromWs(raw: unknown): PerformanceCue[] {
  if (!Array.isArray(raw)) return [];
  const out: PerformanceCue[] = [];
  const animMap: Record<string, string> = {
    wave: 'wave',
    point: 'point',
    think: 'think',
    nod: 'ack',
    smile: 'happy',
    shrug: 'relax',
    beckon: 'beckon',
    clap: 'clap',
    openhand: 'openHand',
    openHand: 'openHand',
  };
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const typ = typeof o.type === 'string' ? o.type.trim().toLowerCase() : '';
    if (!typ) continue;
    const startMs = Math.max(0, Math.round(Number(o.start_ms ?? 0) || 0));
    let inten = 0.75;
    const ri = Number(o.intensity);
    if (Number.isFinite(ri)) inten = Math.max(0, Math.min(1, ri));
    const safe = typ.replace(/[^a-z0-9_]+/gi, '_');
    const anim = animMap[typ] ?? typ;
    const durRaw = Number(o.duration_ms);
    const duration_ms =
      Number.isFinite(durRaw) && durRaw > 0
        ? Math.max(500, Math.min(4000, Math.round(durRaw)))
        : undefined;
    let cosOff: number | undefined;
    const coRaw = o.cospeech_offset_ms ?? o.co_speech_offset_ms ?? o.lead_ms;
    if (coRaw !== undefined && coRaw !== null) {
      const c = Number(coRaw);
      if (Number.isFinite(c)) cosOff = Math.max(-2000, Math.min(8000, Math.round(c)));
    }
    out.push({
      tag: `[GESTURE_${safe.toUpperCase()}]`,
      start_word: 0,
      start_ms: startMs,
      animation: anim,
      intensity: inten,
      ...(duration_ms !== undefined ? { duration_ms } : {}),
      ...(cosOff !== undefined ? { cospeech_offset_ms: cosOff } : {}),
    });
  }
  return out;
}

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
    if (o.start_ms !== undefined && o.start_ms !== null) {
      const sms = Number(o.start_ms);
      if (Number.isFinite(sms)) cue.start_ms = Math.max(0, Math.round(sms));
    }
    if (typeof o.blendshape === 'string' && o.blendshape.trim()) {
      cue.blendshape = o.blendshape.trim();
    }
    if (typeof o.animation === 'string' && o.animation.trim()) {
      cue.animation = o.animation.trim();
    }
    if (o.duration_ms !== undefined && o.duration_ms !== null) {
      const dm = Number(o.duration_ms);
      if (Number.isFinite(dm) && dm > 0) {
        cue.duration_ms = Math.max(500, Math.min(4000, Math.round(dm)));
      }
    }
    const coRaw = (o as { cospeech_offset_ms?: unknown }).cospeech_offset_ms
      ?? (o as { co_speech_offset_ms?: unknown }).co_speech_offset_ms
      ?? (o as { lead_ms?: unknown }).lead_ms;
    if (coRaw !== undefined && coRaw !== null) {
      const c = Number(coRaw);
      if (Number.isFinite(c)) {
        cue.cospeech_offset_ms = Math.max(-2000, Math.min(8000, Math.round(c)));
      }
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
    cheer:        'clap',
    celebrate:    'clap',
    relax:        'relax',
    look:         'wave',
    look2:        'wave',
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
    // MotionPack aliases → rig tokens we still handle
    peace:        'wave',
    greet:        'wave',
    pose:         'relax',
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
    if (inner.includes('cheer'))   return { kind: 'gesture', token: 'clap' };
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
  opts?: { anchorMs?: number },
): number[] {
  const timers: number[] = [];
  if (typeof window === 'undefined' || !performance?.length) return timers;
  const anchor = Math.max(0, Math.round(opts?.anchorMs ?? 0));
  for (const cue of performance) {
    const base =
      typeof cue.start_ms === 'number' && Number.isFinite(cue.start_ms)
        ? Math.max(0, cue.start_ms)
        : startWordToDelayMs(cue.start_word, speech, wordCues, fallbackTotalMs);
    const co = Number(cue.cospeech_offset_ms);
    const extra = Number.isFinite(co) ? co : 0;
    const delay = Math.max(0, anchor + base + extra);
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
