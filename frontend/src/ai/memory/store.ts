/**
 * Short-term (in-memory) and long-term (localStorage) memory.
 * Stores language preference, pacing, mastered/weak topics.
 *
 * Hybrid Persona Kernel additions:
 *   • Motor memory  — gesture cooldown (avoid repeating same gesture twice in a row)
 *   • Emotional memory — failure/success counts per topic → adapt strategy
 *   • Progress memory  — correct/incorrect flags per topic (for adaptive scaffolding)
 */
const STORAGE_KEY = 'avatar-memory';
const MAX_TURNS   = 8; // Persona kernel: keep last 8 turns

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
  failureStreak: number;   // consecutive wrong answers
  successStreak: number;   // consecutive correct answers
}

// ─── In-memory session state ──────────────────────────────────────────────────
let shortTerm: Turn[] = [];

// ─── Motor memory — cooldown per gesture type ─────────────────────────────────
const GESTURE_COOLDOWNS_MS: Record<string, number> = {
  // wave: once per session (handled by _waveUsedThisSession flag)
  point:     8_000,
  wave:     12_000,  // 12-second cooldown (was session-gated once; now repeatable)
  openHand:  6_000,
  beat:      5_000,
};
const _lastGestureTime = new Map<string, number>();

// ─── Gesture audit log — last 5 gestures played this session ─────────────────
const _gestureLog: string[] = [];
const GESTURE_LOG_MAX = 5;

/** Record a played gesture into the session audit log. */
export function recordGestureLog(gestureType: string): void {
  _gestureLog.push(gestureType);
  if (_gestureLog.length > GESTURE_LOG_MAX) _gestureLog.shift();
}

/** Return a copy of the last N gesture types played this session. */
export function getLastGestureLog(): string[] {
  return [..._gestureLog];
}

/** Returns true if the gesture is "cooled down" and may be played. Updates timestamp. */
export function checkGestureCooldown(gestureType: string): boolean {
  const cooldown = GESTURE_COOLDOWNS_MS[gestureType] ?? 5_000;
  const last     = _lastGestureTime.get(gestureType) ?? 0;
  const now      = Date.now();
  if (now - last < cooldown) return false;
  _lastGestureTime.set(gestureType, now);
  return true;
}

// ─── Emotional memory — failure/success streaks ───────────────────────────────
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
  const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
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

export function addTurn(role: 'user' | 'assistant', content: string, meta?: { intent?: string; emotion?: string }): void {
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
