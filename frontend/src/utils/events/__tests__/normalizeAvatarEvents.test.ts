/**
 * Unit tests for normalizeAvatarEvent() and dispatchAvatar().
 * Run: npm run test:normalize (Node native test runner; no Jest).
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  dispatchAvatar,
  normalizeAvatarEvent,
} from '../normalizeAvatarEvents.ts';

// ─── Gesture normalisation ────────────────────────────────────────────────────

describe('normalizeAvatarEvent — gesture', () => {
  it('maps type:openHand → type:openHand (passthrough, correct casing)', () => {
    const out = normalizeAvatarEvent({ type: 'openHand', side: 'right', intensity: 0.7 }) as {
      type: string;
      side: string;
      intensity: number;
    };
    assert.equal(out.type, 'openHand');
    assert.equal(out.side, 'right');
    assert.equal(out.intensity, 0.7);
  });

  it('maps name:openhand → type:openHand (alias key + fixes casing)', () => {
    const out = normalizeAvatarEvent({ name: 'openhand' });
    assert.equal((out as { type: string }).type, 'openHand');
  });

  it('maps name:open_hand → type:openHand', () => {
    const out = normalizeAvatarEvent({ name: 'open_hand' });
    assert.equal((out as { type: string }).type, 'openHand');
  });

  it('maps type:emphasis → type:beat (unsupported token fallback)', () => {
    const out = normalizeAvatarEvent({ type: 'emphasis' });
    assert.equal((out as { type: string }).type, 'beat');
  });

  it('keeps type:beat as beat (rig supports beat in VRMAvatar)', () => {
    const out = normalizeAvatarEvent({ type: 'beat' });
    assert.equal((out as { type: string }).type, 'beat');
  });

  it('keeps type:point correctly cased', () => {
    const out = normalizeAvatarEvent({ type: 'point' });
    assert.equal((out as { type: string }).type, 'point');
  });

  it('keeps type:wave correctly cased', () => {
    const out = normalizeAvatarEvent({ type: 'wave' });
    assert.equal((out as { type: string }).type, 'wave');
  });

  it('preserves procedural explain (was incorrectly mapped to idle)', () => {
    const out = normalizeAvatarEvent({ type: 'explain', duration: 3 });
    assert.equal((out as { type: string }).type, 'explain');
  });

  it('fills in defaults for side, duration, intensity, preroll', () => {
    const out = normalizeAvatarEvent({ type: 'openHand' }) as {
      side: string;
      duration: number;
      intensity: number;
      preroll: number;
    };
    assert.equal(out.side, 'right');
    assert.equal(out.duration, 2.0);
    assert.equal(out.intensity, 0.8);
    assert.equal(out.preroll, 0);
  });

  it('preserves caller-specified values', () => {
    const out = normalizeAvatarEvent({
      type: 'wave',
      side: 'both',
      duration: 3,
      intensity: 0.5,
      preroll: 200,
    }) as { side: string; duration: number; intensity: number; preroll: number };
    assert.equal(out.side, 'both');
    assert.equal(out.duration, 3);
    assert.equal(out.intensity, 0.5);
    assert.equal(out.preroll, 200);
  });
});

// ─── Emotion normalisation ────────────────────────────────────────────────────

describe('normalizeAvatarEvent — emotion', () => {
  it('maps emotion:proud → emotion:proud (passthrough)', () => {
    const out = normalizeAvatarEvent({ emotion: 'proud' });
    assert.equal((out as { emotion: string }).emotion, 'proud');
  });

  it('maps tag:attentive → emotion:attentive (alias key)', () => {
    const out = normalizeAvatarEvent({ tag: 'attentive', strength: 0.4, duration: 0.4 });
    assert.equal((out as { emotion: string }).emotion, 'attentive');
    assert.equal((out as { strength: number }).strength, 0.4);
    assert.equal((out as { duration: number }).duration, 0.4);
  });

  it('lowercases the emotion token', () => {
    const out = normalizeAvatarEvent({ emotion: 'HAPPY' });
    assert.equal((out as { emotion: string }).emotion, 'happy');
  });

  it('falls back to neutral when no emotion/tag provided', () => {
    const out = normalizeAvatarEvent({ emotion: undefined } as { emotion: undefined });
    assert.equal((out as { emotion: string }).emotion, 'neutral');
  });
});

// ─── Listening normalisation ─────────────────────────────────────────────────

describe('normalizeAvatarEvent — listening', () => {
  it('maps active:true → active:true (passthrough)', () => {
    const out = normalizeAvatarEvent({ active: true });
    assert.equal((out as { active: boolean }).active, true);
  });

  it('maps state:start → active:true', () => {
    const out = normalizeAvatarEvent({ state: 'start', reason: 'mic_open' });
    assert.equal((out as { active: boolean; reason?: string }).active, true);
    assert.equal((out as { active: boolean; reason?: string }).reason, 'mic_open');
  });

  it('maps state:stop → active:false', () => {
    const out = normalizeAvatarEvent({ state: 'stop', reason: 'sentence_final' });
    assert.equal((out as { active: boolean }).active, false);
  });

  it('maps active:false → active:false', () => {
    const out = normalizeAvatarEvent({ active: false });
    assert.equal((out as { active: boolean }).active, false);
  });
});

// ─── dispatchAvatar ───────────────────────────────────────────────────────────

function makeWindowMock(): Window {
  const listeners = new Map<string, Set<(e: Event) => void>>();
  return {
    addEventListener(
      type: string,
      fn: (e: Event) => void,
      _options?: boolean | AddEventListenerOptions,
    ) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    dispatchEvent(e: Event): boolean {
      const set = listeners.get(e.type);
      if (set) set.forEach((fn) => fn(e));
      return true;
    },
  } as unknown as Window;
}

describe('dispatchAvatar', () => {
  let dispatched: CustomEvent | null = null;

  beforeEach(() => {
    dispatched = null;
    const w = makeWindowMock();
    w.addEventListener('avatar:gesture', (e) => {
      dispatched = e as CustomEvent;
    });
    (globalThis as unknown as { window: Window }).window = w;
  });

  afterEach(() => {
    delete (globalThis as { window?: Window }).window;
  });

  it('dispatches a normalised gesture event', () => {
    dispatchAvatar('avatar:gesture', {
      type: 'openhand',
      side: 'right',
      intensity: 0.7,
      duration: 1.0,
    });
    assert.ok(dispatched);
    assert.equal(dispatched!.detail.type, 'openHand');
    assert.equal(dispatched!.detail.side, 'right');
    assert.equal(dispatched!.detail.intensity, 0.7);
  });

  it('does not throw when dispatching', () => {
    assert.doesNotThrow(() =>
      dispatchAvatar('avatar:gesture', { type: 'wave' }),
    );
  });
});
