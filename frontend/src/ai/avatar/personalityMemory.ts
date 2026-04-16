/**
 * personalityMemory — familiarity and light trait adaptation across returning sessions.
 * Storage: localStorage `cogni:pem` (bounded deltas, no PII).
 */
'use client';

import * as THREE from 'three';

const STORAGE_KEY = 'cogni:pem';

export type PersonalityMemoryState = {
  familiarity: number;
  visitCount: number;
  warmthBias: number;
  expressivenessBias: number;
  lastVisitDayKey: string;
};

const DEFAULT_STATE: PersonalityMemoryState = {
  familiarity: 0,
  visitCount: 0,
  warmthBias: 0,
  expressivenessBias: 0,
  lastVisitDayKey: '',
};

const MAX_BIAS = 0.08;
const FAMILIARITY_PER_RETURN = 0.035;
const WARMTH_PER_VISIT = 0.012;

let _state: PersonalityMemoryState = { ...DEFAULT_STATE };
let _dirty = false;
let _initialized = false;

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function clampState(s: PersonalityMemoryState): PersonalityMemoryState {
  return {
    familiarity: THREE.MathUtils.clamp(s.familiarity, 0, 1),
    visitCount: Math.max(0, Math.floor(s.visitCount)),
    warmthBias: THREE.MathUtils.clamp(s.warmthBias, 0, MAX_BIAS),
    expressivenessBias: THREE.MathUtils.clamp(s.expressivenessBias, -0.04, MAX_BIAS),
    lastVisitDayKey: s.lastVisitDayKey,
  };
}

export function initPersonalityMemory(): void {
  if (typeof window === 'undefined') return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<PersonalityMemoryState>;
      _state = clampState({
        familiarity: typeof p.familiarity === 'number' ? p.familiarity : 0,
        visitCount: typeof p.visitCount === 'number' ? p.visitCount : 0,
        warmthBias: typeof p.warmthBias === 'number' ? p.warmthBias : 0,
        expressivenessBias: typeof p.expressivenessBias === 'number' ? p.expressivenessBias : 0,
        lastVisitDayKey: typeof p.lastVisitDayKey === 'string' ? p.lastVisitDayKey : '',
      });
    } else {
      _state = { ...DEFAULT_STATE };
    }
  } catch {
    _state = { ...DEFAULT_STATE };
  }
  _initialized = true;
}

export function flushPersonalityMemory(): void {
  if (typeof window === 'undefined' || !_dirty) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(_state));
    _dirty = false;
  } catch {
    /* */
  }
}

export function getPersonalityMemoryState(): PersonalityMemoryState {
  if (!_initialized) initPersonalityMemory();
  return { ..._state };
}

/**
 * Call once per browser session when the avatar experience mounts (e.g. AvatarCanvas).
 * Returning users on a new calendar day get a small familiarity / warmth bump.
 */
export function recordPersonalitySessionVisit(): PersonalityMemoryState {
  if (!_initialized) initPersonalityMemory();
  const day = todayKey();
  if (_state.lastVisitDayKey !== day) {
    _state.visitCount += 1;
    _state.lastVisitDayKey = day;
    _state.familiarity = THREE.MathUtils.clamp(
      _state.familiarity + FAMILIARITY_PER_RETURN,
      0,
      1,
    );
    _state.warmthBias = THREE.MathUtils.clamp(
      _state.warmthBias + WARMTH_PER_VISIT,
      0,
      MAX_BIAS,
    );
    _state.expressivenessBias = THREE.MathUtils.clamp(
      _state.expressivenessBias + 0.004,
      -0.04,
      MAX_BIAS,
    );
    _state = clampState(_state);
    _dirty = true;
    flushPersonalityMemory();
  }
  return { ..._state };
}

export function resetPersonalityMemory(): void {
  _state = { ...DEFAULT_STATE };
  _dirty = true;
  flushPersonalityMemory();
}
