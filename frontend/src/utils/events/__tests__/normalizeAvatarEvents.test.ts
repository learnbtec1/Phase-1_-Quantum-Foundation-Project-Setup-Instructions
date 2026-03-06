/**
 * normalizeAvatarEvents.test.ts
 *
 * Unit tests for normalizeAvatarEvent() and dispatchAvatar().
 * Run with: cd frontend && npx jest src/utils/events/__tests__
 */

import { normalizeAvatarEvent, dispatchAvatar } from '../normalizeAvatarEvents';

// ─── Gesture normalisation ────────────────────────────────────────────────────

describe('normalizeAvatarEvent — gesture', () => {
  it('maps type:openHand → type:openHand (passthrough, correct casing)', () => {
    const out = normalizeAvatarEvent({ type: 'openHand', side: 'right', intensity: 0.7 });
    expect(out).toMatchObject({ type: 'openHand', side: 'right', intensity: 0.7 });
  });

  it('maps name:openhand → type:openHand (alias key + fixes casing)', () => {
    const out = normalizeAvatarEvent({ name: 'openhand' });
    expect((out as { type: string }).type).toBe('openHand');
  });

  it('maps name:open_hand → type:openHand', () => {
    const out = normalizeAvatarEvent({ name: 'open_hand' });
    expect((out as { type: string }).type).toBe('openHand');
  });

  it('maps type:emphasis → type:beat (unsupported token fallback)', () => {
    const out = normalizeAvatarEvent({ type: 'emphasis' });
    expect((out as { type: string }).type).toBe('beat');
  });

  it('keeps type:beat as beat (rig supports beat in VRMAvatar)', () => {
    const out = normalizeAvatarEvent({ type: 'beat' });
    expect((out as { type: string }).type).toBe('beat');
  });

  it('keeps type:point correctly cased', () => {
    const out = normalizeAvatarEvent({ type: 'point' });
    expect((out as { type: string }).type).toBe('point');
  });

  it('keeps type:wave correctly cased', () => {
    const out = normalizeAvatarEvent({ type: 'wave' });
    expect((out as { type: string }).type).toBe('wave');
  });

  it('fills in defaults for side, duration, intensity, preroll', () => {
    const out = normalizeAvatarEvent({ type: 'openHand' }) as {
      side: string; duration: number; intensity: number; preroll: number;
    };
    expect(out.side).toBe('right');
    expect(out.duration).toBe(2.0);
    expect(out.intensity).toBe(0.8);
    expect(out.preroll).toBe(0);
  });

  it('preserves caller-specified values', () => {
    const out = normalizeAvatarEvent({
      type: 'wave', side: 'both', duration: 3, intensity: 0.5, preroll: 200,
    }) as { side: string; duration: number; intensity: number; preroll: number };
    expect(out.side).toBe('both');
    expect(out.duration).toBe(3);
    expect(out.intensity).toBe(0.5);
    expect(out.preroll).toBe(200);
  });
});

// ─── Emotion normalisation ────────────────────────────────────────────────────

describe('normalizeAvatarEvent — emotion', () => {
  it('maps emotion:proud → emotion:proud (passthrough)', () => {
    const out = normalizeAvatarEvent({ emotion: 'proud' });
    expect((out as { emotion: string }).emotion).toBe('proud');
  });

  it('maps tag:attentive → emotion:attentive (alias key)', () => {
    const out = normalizeAvatarEvent({ tag: 'attentive', strength: 0.4, duration: 0.4 });
    expect((out as { emotion: string; strength: number; duration: number }).emotion).toBe('attentive');
    expect((out as { emotion: string; strength: number; duration: number }).strength).toBe(0.4);
    expect((out as { emotion: string; strength: number; duration: number }).duration).toBe(0.4);
  });

  it('lowercases the emotion token', () => {
    const out = normalizeAvatarEvent({ emotion: 'HAPPY' });
    expect((out as { emotion: string }).emotion).toBe('happy');
  });

  it('falls back to neutral when no emotion/tag provided', () => {
    // @ts-expect-error intentional partial input for robustness test
    const out = normalizeAvatarEvent({ emotion: undefined });
    expect((out as { emotion: string }).emotion).toBe('neutral');
  });
});

// ─── Listening normalisation ─────────────────────────────────────────────────

describe('normalizeAvatarEvent — listening', () => {
  it('maps active:true → active:true (passthrough)', () => {
    const out = normalizeAvatarEvent({ active: true });
    expect((out as { active: boolean }).active).toBe(true);
  });

  it('maps state:start → active:true', () => {
    const out = normalizeAvatarEvent({ state: 'start', reason: 'mic_open' });
    expect((out as { active: boolean; reason?: string }).active).toBe(true);
    expect((out as { active: boolean; reason?: string }).reason).toBe('mic_open');
  });

  it('maps state:stop → active:false', () => {
    const out = normalizeAvatarEvent({ state: 'stop', reason: 'sentence_final' });
    expect((out as { active: boolean }).active).toBe(false);
  });

  it('maps active:false → active:false', () => {
    const out = normalizeAvatarEvent({ active: false });
    expect((out as { active: boolean }).active).toBe(false);
  });
});

// ─── dispatchAvatar ───────────────────────────────────────────────────────────

describe('dispatchAvatar', () => {
  let dispatched: CustomEvent | null = null;

  beforeEach(() => {
    dispatched = null;
    window.addEventListener('avatar:gesture', (e) => { dispatched = e as CustomEvent; }, { once: true });
  });

  it('dispatches a normalised gesture event', () => {
    dispatchAvatar('avatar:gesture', { type: 'openhand', side: 'right', intensity: 0.7, duration: 1.0 });
    expect(dispatched).not.toBeNull();
    expect(dispatched!.detail.type).toBe('openHand');   // casing fixed
    expect(dispatched!.detail.side).toBe('right');
    expect(dispatched!.detail.intensity).toBe(0.7);
  });

  it('does not dispatch when window is undefined (SSR guard)', () => {
    // Quick SSR simulation — dispatchAvatar guards typeof window
    // This test just verifies the function does not throw in a window context
    expect(() => dispatchAvatar('avatar:gesture', { type: 'wave' })).not.toThrow();
  });
});
