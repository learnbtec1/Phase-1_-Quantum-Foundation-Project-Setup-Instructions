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
  /** V20 — teaching gestures: faster re-fire */
  point:     1_200,
  openHand:  1_200,
  wave:      6_000,
  beat:      2_500,
  think:     3_250,
  peace:     3_500,
  agree:     2_750,
  /** V50 — performance / bridge tokens */
  thumbUp:   1_200,
  beckon:    1_200,
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

export interface GestureCooldownOpts {
  /** Backend `action` / gesture field explicitly requests this token — allow closer repeats. */
  explicitActionToken?: string;
  /**
   * V50 — performance tags / explicit LLM gesture: shorten consecutive-repeat window to 1.5s
   * (was up to 3s for non–point/openHand) so back-to-back AI cues are not swallowed.
   */
  fromAI?: boolean;
}

/**
 * Returns true if the gesture may be played (passes all memory gates).
 * Gates applied in order:
 *   1. Wave: once-per-session
 *   2. Consecutive: same type back-to-back blocked within a short window (1.2s teaching / 3s general)
 *   3. Cooldown: per-type time window
 * Updates internal state on approval.
 */
export function checkGestureCooldown(gestureType: string, opts?: GestureCooldownOpts): boolean {
  // Gate 1 — wave is a once-per-session gesture
  if (gestureType === 'wave') {
    if (_waveUsedThisSession) return false;
    _waveUsedThisSession = true;
    _lastGestureTime.set(gestureType, Date.now());
    console.log('[HUMANIZE][GESTURE] wave allowed (first use this session)');
    return true;
  }
  const nowMs = Date.now();
  const explicit = opts?.explicitActionToken?.trim().toLowerCase() ?? '';
  const explicitDemands =
    !!explicit
    && (explicit === gestureType
      || explicit.includes(gestureType)
      || gestureType.includes(explicit));
  const consecutiveMinMs = opts?.fromAI
    ? 1_500
    : gestureType === 'openHand' || gestureType === 'point'
      ? 1_200
      : 3_000;
  if (
    !explicitDemands
    && _gestureLog.length > 0
    && _gestureLog[_gestureLog.length - 1] === gestureType
  ) {
    const lastSame = _lastGestureTime.get(gestureType) ?? 0;
    if (nowMs - lastSame < consecutiveMinMs) {
      console.log(`[HUMANIZE][GESTURE] ${gestureType} blocked (consecutive repeat <${consecutiveMinMs}ms)`);
      return false;
    }
  }
  // Gate 3 — time-based cooldown
  const cooldown = GESTURE_COOLDOWNS_MS[gestureType] ?? 2_000;
  const last     = _lastGestureTime.get(gestureType) ?? 0;
  const now      = nowMs;
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
