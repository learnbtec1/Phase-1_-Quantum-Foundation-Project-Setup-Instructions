/**
 * Short-term (in-memory) and long-term (localStorage) memory.
 * Stores language preference, pacing, mastered/weak topics.
 *
 * Hybrid Persona Kernel additions:
 *   - Motor memory  -- gesture cooldown (avoid repeating same gesture twice in a row)
 *   - Emotional memory -- failure/success counts per topic -> adapt strategy
 *   - Progress memory  -- correct/incorrect flags per topic (for adaptive scaffolding)
 */
const STORAGE_KEY = 'avatar-memory';
const MAX_TURNS   = 8;

export interface Turn {
  role: 'user' | 'assistant';
  content: string;
  intent?: string;
  emotion?: string;
  ts: number;
}

export interface ProgressFlag {
  topic: string;
  correct: boolean;
  ts: number;
}

export interface MemorySnapshot {
  language: string;
  turns: Turn[];
  masteredTopics: string[];
  weakTopics: string[];
  progressFlags: ProgressFlag[];
  failureStreak: number;
  successStreak: number;
}

// ── In-memory session state ────────────────────────────────────────────────────
let shortTerm: Turn[] = [];

// ── Motor memory — cooldown per gesture type ──────────────────────────────────
const GESTURE_COOLDOWNS_MS: Record<string, number> = {
  point:     8_000,
  wave:     12_000,
  openHand:  6_000,
  beat:      5_000,
};
const _lastGestureTime = new Map<string, number>();

// ── Wave-once-per-session gate ────────────────────────────────────────────────
let _waveUsedThisSession = false;

/** Reset wave gate (call on page/session re-initialisation). */
export function resetWaveGate(): void { _waveUsedThisSession = false; }

// ── Gesture audit log — last 5 gestures played this session ──────────────────
const _gestureLog: string[] = [];
const GESTURE_LOG_MAX = 5;

/** Record a played gesture into the session audit log. */
export function recordGestureLog(gestureType: string): void {
  _gestureLog.push(gestureType);
  if (_gestureLog.length > GESTURE_LOG_MAX) _gestureLog.shift();
}

/** Return a copy of the last gesture types played this session. */
export function getLastGestureLog(): string[] {
  return [..._gestureLog];
}

/**
 * Returns true if the gesture may be played (passes all memory gates).
 * Gates applied in order:
 *   1. Wave: once-per-session
 *   2. Consecutive: never repeat same type twice in a row
 *   3. Cooldown: per-type time window
 * Updates internal state on approval.
 */
export function checkGestureCooldown(gestureType: string): boolean {
  // Gate 1 — wave is a once-per-session gesture
  if (gestureType === 'wave') {
    if (_waveUsedThisSession) return false;
    _waveUsedThisSession = true;
    _lastGestureTime.set(gestureType, Date.now());
    console.log('[HUMANIZE][GESTURE] wave allowed (first use this session)');
    return true;
  }
  // Gate 2 — consecutive repetition prevention
  if (_gestureLog.length > 0 && _gestureLog[_gestureLog.length - 1] === gestureType) {
    console.log(`[HUMANIZE][GESTURE] ${gestureType} blocked (consecutive repeat)`);
    return false;
  }
  // Gate 3 — time-based cooldown
  const cooldown = GESTURE_COOLDOWNS_MS[gestureType] ?? 5_000;
  const last     = _lastGestureTime.get(gestureType) ?? 0;
  const now      = Date.now();
  if (now - last < cooldown) {
    const rem = Math.round((cooldown - (now - last)) / 1000);
    console.log(`%c[GESTURE] ${gestureType} blocked (cooldown: ${rem}s remaining)`, 'color:#64748b');
    return false;
  }
  _lastGestureTime.set(gestureType, now);
  return true;
}

// ── Emotional memory — failure/success streaks ────────────────────────────────
let _failureStreak = 0;
let _successStreak = 0;
const _progressFlags: ProgressFlag[] = [];

export function recordProgress(topic: string, correct: boolean): void {
  _progressFlags.push({ topic, correct, ts: Date.now() });
  if (correct)  { _successStreak++; _failureStreak = 0; }
  else          { _failureStreak++; _successStreak = 0; }
}

/** Returns the current emotional adaptation hint for the cognitive loop. */
export function getEmotionalHint(): { increaseEncouragement: boolean; reduceScaffolding: boolean } {
  return {
    increaseEncouragement: _failureStreak >= 2,
    reduceScaffolding:     _successStreak >= 3,
  };
}

export function getStreaks(): { failureStreak: number; successStreak: number } {
  return { failureStreak: _failureStreak, successStreak: _successStreak };
}

export function getProgressFlags(): ProgressFlag[] {
  return [..._progressFlags];
}

export function getMemorySnapshot(studentId?: string): MemorySnapshot {
  const stored = typeof window !== 'undefined' && studentId
    ? tryParse(localStorage.getItem(`${STORAGE_KEY}-${studentId}`))
    : null;
  const turns = shortTerm.slice(-MAX_TURNS);
  const arr = (v: unknown): string[] =>
    (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  return {
    language: (typeof stored?.language === 'string' ? stored.language : 'ar'),
    turns,
    masteredTopics: arr(stored?.masteredTopics),
    weakTopics: arr(stored?.weakTopics),
    progressFlags: _progressFlags.slice(-20),
    failureStreak: _failureStreak,
    successStreak: _successStreak,
  };
}

export function addTurn(
  role: 'user' | 'assistant',
  content: string,
  meta?: { intent?: string; emotion?: string },
): void {
  shortTerm.push({ role, content, ts: Date.now(), ...meta });
  if (shortTerm.length > MAX_TURNS) shortTerm = shortTerm.slice(-MAX_TURNS);
}

export function setLanguage(lang: string, studentId?: string): void {
  if (typeof window === 'undefined' || !studentId) return;
  const key = `${STORAGE_KEY}-${studentId}`;
  const prev = tryParse(localStorage.getItem(key)) ?? {};
  localStorage.setItem(key, JSON.stringify({ ...prev, language: lang }));
}

function tryParse(s: string | null): Record<string, unknown> | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as Record<string, unknown>;
  } catch {
    return null;
  }
}
