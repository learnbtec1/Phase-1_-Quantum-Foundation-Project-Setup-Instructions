/**
 * Integration-style test for the **data path** shared by:
 * - `useAgentAgent` → `processFrame` / BrainState (Zustand)
 * - `VRMSkeletonManager` / lip pipeline → consume `useBrainStore` + `avatar:*` DOM events
 * - `LipSyncManager` → reads `interactionIntent` + PAD from `useBrainStore` each frame
 *
 * This does **not** mount React Three Fiber (no WebGL). It validates that a simulated WS reply
 * (`processFrame`) plus intent refresh (`tickIntentBrain`) produces the state LipSync and motion
 * layers read. Full R3F integration is covered by Playwright (`tests/e2e/avatar-agent-pipeline.spec.ts`).
 *
 * Run: npm run test:integration
 */
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import type { AgentFrame } from '@/types/ai';
import { useBrainStore } from '@/store/useBrainStore';
import { normalizeAvatarEvent } from '@/utils/events/normalizeAvatarEvents.ts';

function speechFrame(overrides: Partial<AgentFrame> = {}): AgentFrame {
  return {
    text: 'اختبار تكامل',
    emotion: 'encouraging',
    gesture: 'explain',
    gesture_duration_ms: 1200,
    expression: 'encouraging',
    voice: { pitch: 1, rate: 1 },
    thinking_time_ms: 0,
    ...overrides,
  };
}

describe('Brain ↔ motion event pipeline (integration)', () => {
  beforeEach(() => {
    useBrainStore.getState().reset();
  });

  it('WS-like frame → processFrame → tickIntentBrain yields stable intent for lip/motion consumers', () => {
    useBrainStore.getState().setTalking(true);
    useBrainStore.getState().processFrame(speechFrame());
    const { intent } = useBrainStore.getState().tickIntentBrain(Date.now());
    assert.ok(intent === 'explaining' || intent === 'emphasizing');
    const s = useBrainStore.getState();
    assert.equal(s.interactionIntent, intent);
    assert.ok(s.intentEnergy >= 0.15);
    assert.ok(s.cognitiveAvatarBrain);
  });

  it('normalized gesture tokens match what VRMSkeletonManager procedural path expects', () => {
    const g = normalizeAvatarEvent({ type: 'explain', duration: 2 }) as { type: string };
    assert.equal(g.type, 'explain');
    const wave = normalizeAvatarEvent({ type: 'wave' }) as { type: string };
    assert.equal(wave.type, 'wave');
  });

  it('interrupt resets pipeline so a new session can start clean', () => {
    useBrainStore.getState().setTalking(true);
    useBrainStore.getState().processFrame(speechFrame());
    useBrainStore.getState().tickIntentBrain(Date.now());
    useBrainStore.getState().interrupt();
    assert.equal(useBrainStore.getState().interactionIntent, 'idle');
  });
});
