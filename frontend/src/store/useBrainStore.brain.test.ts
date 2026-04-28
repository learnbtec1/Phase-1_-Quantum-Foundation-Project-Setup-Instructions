/**
 * Unit tests for useBrainStore: **processFrame**, **tickIntentBrain**, **interrupt**.
 * Run: npm run test:brain — or full CI gate: npm run test:ci (includes integration tests).
 * Framework: **node:test** + **tsx** (not Jest).
 */
import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';
import type { AgentFrame } from '@/types/ai';
import { useBrainStore } from '@/store/useBrainStore';

function minimalFrame(overrides: Partial<AgentFrame> = {}): AgentFrame {
  return {
    text: 'رد تجريبي',
    emotion: 'neutral',
    gesture: 'idle',
    gesture_duration_ms: 800,
    expression: 'neutral',
    voice: { pitch: 1, rate: 1 },
    thinking_time_ms: 0,
    ...overrides,
  };
}

describe('useBrainStore.processFrame', () => {
  beforeEach(() => {
    useBrainStore.getState().reset();
  });

  it('maps backend emotion to emotionLabel and PAD, clears thinking, stores lastFrame', () => {
    useBrainStore.getState().setThinking(true);
    useBrainStore.getState().processFrame(
      minimalFrame({ emotion: 'happy', text: 'hello' }),
    );
    const s = useBrainStore.getState();
    assert.equal(s.emotionLabel, 'happy');
    assert.equal(s.thinking, false);
    assert.ok(s.lastFrame);
    assert.equal(s.lastFrame?.emotion, 'happy');
    assert.ok(typeof s.pad.pleasure === 'number');
  });

  it('defaults unknown emotion string to neutral label', () => {
    useBrainStore.getState().processFrame(
      minimalFrame({ emotion: 'totally_unknown_emotion_xyz' }),
    );
    assert.equal(useBrainStore.getState().emotionLabel, 'neutral');
  });

  it('feeds cognitive fields into orchestrator when cognitive_* present', () => {
    useBrainStore.getState().processFrame(
      minimalFrame({
        cognitive_intent: 'explaining',
        cognitive_intensity: 0.7,
        cognitive_tone: 'warm',
      }),
    );
    const s = useBrainStore.getState();
    assert.equal(s.lastFrame?.cognitive_intent, 'explaining');
  });

  it('blends user_pad from frame into avatar PAD when provided', () => {
    useBrainStore.getState().processFrame(
      minimalFrame({
        emotion: 'neutral',
        user_pad: { pleasure: 0.9, arousal: 0.4, dominance: 0.2 },
      }),
    );
    const p = useBrainStore.getState().pad;
    assert.ok(Math.abs(p.pleasure) > 0.01 || Math.abs(p.arousal) > 0.01);
  });
});

describe('useBrainStore.tickIntentBrain', () => {
  beforeEach(() => {
    useBrainStore.getState().reset();
  });

  it('when avatar is talking, raw intent resolves toward explaining or emphasizing', () => {
    useBrainStore.getState().setTalking(true);
    useBrainStore.getState().processFrame(minimalFrame({ emotion: 'neutral' }));
    const t0 = Date.now();
    const { intent } = useBrainStore.getState().tickIntentBrain(t0);
    assert.ok(
      intent === 'explaining' || intent === 'emphasizing',
      `expected explaining|emphasizing, got ${intent}`,
    );
    assert.equal(useBrainStore.getState().interactionIntent, intent);
  });

  it('returns changed:false when called twice at same intent epoch without state change', () => {
    useBrainStore.getState().setTalking(true);
    const t = 1_700_000_000_000;
    const a = useBrainStore.getState().tickIntentBrain(t);
    const b = useBrainStore.getState().tickIntentBrain(t + 5);
    assert.equal(b.changed, false);
    assert.equal(a.intent, b.intent);
  });

  it('when listening (mic on), raw intent tends to listening', () => {
    useBrainStore.getState().setTalking(false);
    useBrainStore.getState().setPhysical({ isListening: true });
    const { intent } = useBrainStore.getState().tickIntentBrain(Date.now());
    assert.equal(intent, 'listening');
  });

  it('when frame signals cognitive thinking emotion (not talking), intent resolves to thinking', () => {
    useBrainStore.getState().setTalking(false);
    useBrainStore.getState().setPhysical({ isListening: false });
    useBrainStore.getState().processFrame(
      minimalFrame({ emotion: 'thinking', thinking_time_ms: 0 }),
    );
    const { intent } = useBrainStore.getState().tickIntentBrain(Date.now());
    assert.equal(intent, 'thinking');
  });
});

describe('useBrainStore.interrupt (edge)', () => {
  beforeEach(() => {
    useBrainStore.getState().reset();
  });

  it('clears talking/thinking and resets interaction intent to idle', () => {
    useBrainStore.getState().setTalking(true);
    useBrainStore.getState().setThinking(true);
    useBrainStore.getState().processFrame(
      minimalFrame({ emotion: 'happy' }),
    );
    useBrainStore.getState().interrupt();
    const s = useBrainStore.getState();
    assert.equal(s.talking, false);
    assert.equal(s.thinking, false);
    assert.equal(s.interactionIntent, 'idle');
  });
});
