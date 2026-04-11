/**
 * UnifiedGestureEngine — Cogni avatar gesture orchestration layer.
 *
 * Architecture (event-based, browser only):
 *   caller ─▶ play(name) ─▶ PriorityQueue ─▶ avatar:gesture CustomEvent
 *                                          ─▶ avatar:vrma:request CustomEvent
 *
 * VRMSkeletonManager owns actual bone / VRMA playback.
 * This engine only gates and sequences the event dispatch.
 *
 * Priority (lower = more urgent):
 *   CRITICAL(0) > HIGH(1) > NORMAL(2) > LOW(3) > BACKGROUND(4)
 *
 * Cross-fade: a brief 50 ms idle dispatch is fired before every transition
 * so VRMSkeletonManager can blend out the previous pose.
 */
'use client';

import { dispatchGestureFromActionText } from '@/ai/avatar/actions';
import type { BehaviorPayload } from '@/lib/behavior/types';
import { getGestureScheduler } from '@/lib/behavior/gestureScheduler';
import {
  GESTURE_FILENAME_MAP,
  GESTURE_FALLBACKS,
  GESTURE_PRIORITY_MAP,
  GESTURE_DURATION_MS,
  VRMA_TO_CANONICAL,
  CANONICAL_GESTURES,
  vrmaUrl,
  PRIORITY,
  type CanonicalGesture,
  type PriorityValue,
  type FallbackConfig,
} from '@/constants/gestures';

// ─── Dev helpers ─────────────────────────────────────────────────────────────

const IS_DEV = process.env.NODE_ENV === 'development';

type LogLevel = 'info' | 'warn' | 'error';
function devLog(level: LogLevel, msg: string, extra?: unknown): void {
  if (!IS_DEV) return;
  const line = `[UnifiedGestureEngine] ${msg}`;
  if (level === 'error') console.error(line, extra ?? '');
  else if (level === 'warn') console.warn(line, extra ?? '');
  else console.log(line, extra ?? '');
}

function perfNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

// ─── Normalizer (used to be gestureNormalizer.ts) ────────────────────────────

const LEGACY_TO_CANONICAL: Record<string, CanonicalGesture> = {
  look: 'idle', wave: 'wave', waving: 'wave', clap: 'clap', clapping: 'clap',
  test_elbow: 'test_elbow', testelbow: 'test_elbow', 'test-elbow': 'test_elbow',
  agree: 'agree', agreeing: 'agree',
  nod: 'agree',        // nod → agree (head nod posture in VRMSkeletonManager)
  idle: 'idle', explain: 'explain',
  point: 'point', think: 'think',
  openhand: 'explain', openhandgesture: 'explain',
  pointhand: 'point', beat: 'explain', cheer: 'clap', celebration: 'clap',
  goodbye: 'wave', relax: 'idle', rest: 'idle', blink: 'idle',
  peace: 'wave',       // peace → gentle wave (open hand)
  smile: 'agree',      // smile → agree (upbeat open posture)
  handsup: 'explain', hands_up: 'explain',
  leanforward: 'think', lean_forward: 'think',
  beckon: 'point', ack: 'agree',
  tilt: 'think',       // tilt → think (head tilt curiosity)
  head_down: 'think', shoulder_sigh: 'idle', lean_back: 'idle',
  curious: 'think', shrug: 'agree',
};

export { CanonicalGesture };
export type { PriorityValue };

export function toCanonicalGesture(raw: string): CanonicalGesture {
  const k = raw.replace(/\s+/g, '').toLowerCase();
  if (CANONICAL_GESTURES.has(k as CanonicalGesture)) return k as CanonicalGesture;
  const legacy = LEGACY_TO_CANONICAL[k];
  if (legacy) return legacy;
  // VRMA stems (Thinking, Idle1, standing-cheering, …) → procedural canonical
  for (const [stem, can] of Object.entries(VRMA_TO_CANONICAL)) {
    if (stem.replace(/\s+/g, '').toLowerCase() === k) return can;
  }
  return 'idle';
}

let normalizerAttached = false;
export function initGestureNormalizer(): void {
  if (typeof window === 'undefined' || normalizerAttached) return;
  normalizerAttached = true;
  const onGesture = (evt: Event) => {
    if (!(evt instanceof CustomEvent)) return;
    if (typeof window !== 'undefined' && (window as Window & { __COGNI_DISABLE_GESTURE_NORMALIZER__?: boolean }).__COGNI_DISABLE_GESTURE_NORMALIZER__) {
      return;
    }
    const d = evt.detail as Record<string, unknown> | null;
    if (!d || d._normalized === true) return;
    const raw = (typeof d.gesture === 'string' && d.gesture.trim())
      ? d.gesture.trim()
      : (typeof d.type === 'string' && d.type.trim())
        ? d.type.trim()
        : (typeof d.name === 'string' && d.name.trim()) ? d.name.trim() : 'idle';
    d.gesture = toCanonicalGesture(raw);
    if (typeof d.type !== 'string' || !d.type.trim()) d.type = raw;
    d._normalized = true;
  };
  window.addEventListener('avatar:gesture', onGesture, true);
  devLog('info', 'capture normalizer attached');
}

// ─── Gesture descriptor (for AgentDirector / planGestures backward compat) ───

export interface GestureDescriptor {
  type: 'wave' | 'point' | 'openHand' | 'beat';
  side?: 'left' | 'right' | 'both';
  intensity?: number;
  duration?: number;
  speed?: number;
}

// ─── Priority queue entry ─────────────────────────────────────────────────────

interface QueueEntry {
  name: string;
  priority: PriorityValue;
  ts: number;
  durationMs: number;
  crossFade: boolean;
  intensity?: number;
  mood?: string;
}

// ─── Engine ──────────────────────────────────────────────────────────────────

/** Action-text → procedural GestureDescriptor (legacy AgentDirector path) */
const EMOTION_HINTS: Record<string, Partial<GestureDescriptor>> = {
  celebrate:   { type: 'wave',      intensity: 1.3, duration: 3.0 },
  encouraging: { type: 'openHand',  intensity: 1.0, duration: 2.0 },
  thinking:    { type: 'beat',      intensity: 0.6, duration: 1.5 },
  friendly:    { type: 'openHand',  intensity: 0.8, duration: 1.5 },
  strict:      { type: 'point',     intensity: 0.9, duration: 1.5 },
  neutral:     { type: 'beat',      intensity: 0.5, duration: 1.0 },
};
const ACTION_PATTERNS: Array<{ pattern: RegExp; gesture: Partial<GestureDescriptor> }> = [
  { pattern: /يميل|lean forward/i,       gesture: { type: 'openHand', intensity: 0.8 } },
  { pattern: /يشير|points?|index finger/i, gesture: { type: 'point',   intensity: 0.9 } },
  { pattern: /يلوّح|wave|waves?/i,        gesture: { type: 'wave',     intensity: 1.0 } },
  { pattern: /يصفق|clap|enthusiastic/i,   gesture: { type: 'wave',     intensity: 1.3 } },
  { pattern: /يفرد|spread|open (palm|hand)/i, gesture: { type: 'openHand', intensity: 0.9 } },
  { pattern: /يضع يده|hand on chest/i,   gesture: { type: 'beat',     intensity: 0.6 } },
  { pattern: /يومئ|nod|يهز/i,            gesture: { type: 'beat',     intensity: 0.5 } },
];

export class UnifiedGestureEngine {
  // Perf snapshot
  readonly #stats = { plays: 0, interrupts: 0, fallbacks: 0, errors: 0, lastMs: 0 };
  // Queue
  readonly #queue: QueueEntry[] = [];
  // Current active gesture info
  #currentName: string | null = null;
  #currentPriority: PriorityValue = PRIORITY.BACKGROUND + 1 as PriorityValue;
  #currentTimer: ReturnType<typeof setTimeout> | null = null;
  #processing = false;
  // VRMA URL cache
  readonly #vrmaCache = new Map<string, string>();

  getStats(): Readonly<{
    plays: number;
    interrupts: number;
    fallbacks: number;
    errors: number;
    lastMs: number;
    /** Name of the gesture currently executing, or null if idle */
    currentGesture: string | null;
    /** Number of gestures waiting in the priority queue */
    queueLength: number;
    /** Numerical priority of the current gesture (0=CRITICAL … 4=BACKGROUND), or null */
    currentPriority: PriorityValue | null;
    /** True while a gesture is executing */
    isPlaying: boolean;
  }> {
    return {
      ...this.#stats,
      currentGesture:  this.#currentName,
      queueLength:     this.#queue.length,
      currentPriority: this.#currentName !== null ? this.#currentPriority : null,
      isPlaying:       this.#processing,
    };
  }

  /** Backward compat: GestureCalibrator uses playCanonical */
  playCanonical(g: CanonicalGesture, _crossFade = true): Promise<void> {
    return this.play(g, { priority: PRIORITY.NORMAL, crossFade: _crossFade });
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Play a gesture by name (display stem, alias, or virtual fallback name).
   * Priority: **lower numeric value = more urgent** (CRITICAL=0 … BACKGROUND=4).
   * Idle / no active gesture uses sentinel `PRIORITY.BACKGROUND + 1` (5) internally.
   */
  async play(
    name: string,
    opts: {
      priority?: PriorityValue;
      durationMs?: number;
      crossFade?: boolean;
      intensity?: number;
      mood?: string;
    } = {},
  ): Promise<void> {
    if (!name?.trim()) return;
    const normalised = name.trim();
    const priority: PriorityValue = opts.priority ?? this.#resolvePriority(normalised);
    const durationMs = opts.durationMs ?? this.#resolveDuration(normalised);
    const crossFade = opts.crossFade !== false;

    const entry: QueueEntry = { name: normalised, priority, ts: Date.now(), durationMs, crossFade, intensity: opts.intensity, mood: opts.mood };

    if (priority <= this.#currentPriority) {
      const idleSlot = (PRIORITY.BACKGROUND + 1) as PriorityValue;
      const note =
        this.#currentPriority === idleSlot
          ? ' (current=idle sentinel, not a conflict)'
          : '';
      this.#interrupt(`play(${normalised}) incomingPrio=${priority} ≤ currentPrio=${this.#currentPriority}${note}`);
      this.#stats.interrupts += 1;
      await this.#execute(entry);
    } else {
      // Enqueue, sorted by priority then timestamp
      this.#queue.push(entry);
      this.#queue.sort((a, b) => a.priority !== b.priority ? a.priority - b.priority : a.ts - b.ts);
      devLog('info', `queued "${normalised}" (priority=${priority}, queue=${this.#queue.length})`);
      if (!this.#processing) void this.#drain();
    }
  }

  /** Shorthand methods */
  think()   { return this.play('Thinking',           { priority: PRIORITY.NORMAL }); }
  wave()    { return this.play('Waving',             { priority: PRIORITY.HIGH   }); }
  clap()    { return this.play('Clapping',           { priority: PRIORITY.NORMAL }); }
  agree()   { return this.play('Agreeing',           { priority: PRIORITY.NORMAL }); }
  listen()  { return this.play('listening',          { priority: PRIORITY.LOW    }); }
  process() { return this.play('processing',         { priority: PRIORITY.LOW    }); }
  error()   { return this.play('error',              { priority: PRIORITY.CRITICAL }); }
  curious() { return this.play('curious',            { priority: PRIORITY.LOW    }); }
  idle()    { return this.play(this.#randomIdle(),   { priority: PRIORITY.LOW, crossFade: false }); }

  /** Cancel all pending + stop current */
  cancelAll(): void {
    this.#queue.length = 0;
    this.#interrupt('cancelAll');
  }

  // ── Behavior JSON scheduling (gestureScheduler bridge) ──────────────────────

  scheduleBehavior(payload: BehaviorPayload | null | undefined, speechStartDelay = 0): void {
    try {
      getGestureScheduler().schedule(payload, speechStartDelay);
    } catch (e) {
      this.#stats.errors += 1;
      devLog('error', 'scheduleBehavior', e);
    }
  }

  cancelScheduledBehavior(): void {
    try { getGestureScheduler().cancelAll(); } catch { /* ignore */ }
  }

  // ── Legacy AgentDirector API (planGestures / playFromActionText) ─────────────

  playFromActionText(actionText: string, emotion?: string): void {
    if (!actionText) return;
    const desc = this.#resolveDescriptor(actionText, emotion);
    const hasText = ACTION_PATTERNS.some(({ pattern }) => pattern.test(actionText));
    const hasEmo = emotion !== undefined && Boolean(EMOTION_HINTS[emotion]);
    if (desc.type === 'beat' && desc.intensity === 0.5 && !hasText && !hasEmo) {
      try { dispatchGestureFromActionText(actionText); } catch { /* ignore */ }
      return;
    }
    this.#dispatchDescriptor(desc);
  }

  planGestures(
    actionText: string,
    emotion: string,
    speechDurationMs: number,
  ): Array<{ descriptor: GestureDescriptor; fireAtMs: number }> {
    const primary = this.#resolveDescriptor(actionText, emotion);
    const result: Array<{ descriptor: GestureDescriptor; fireAtMs: number }> = [
      { descriptor: primary, fireAtMs: 0 },
    ];
    const HIGH_ENERGY = ['excited', 'celebrate', 'celebration', 'encouraging', 'happy', 'proud'];
    if (HIGH_ENERGY.includes(emotion) && speechDurationMs > 2000) {
      result.push({
        descriptor: { type: 'beat', side: 'right', intensity: 0.55, duration: 1.2 },
        fireAtMs: Math.round(speechDurationMs * 0.48),
      });
    }
    return result;
  }

  playDescriptor(descriptor: GestureDescriptor): void { this.#dispatchDescriptor(descriptor); }
  celebrate():    void { this.#dispatchDescriptor({ type: 'wave',     side: 'right', intensity: 1.3, duration: 3.0 }); }
  explain():      void { this.#dispatchDescriptor({ type: 'point',    side: 'right', intensity: 0.9, duration: 2.0 }); }
  empathize():    void { this.#dispatchDescriptor({ type: 'openHand', side: 'right', intensity: 0.7, duration: 1.8 }); }
  warmGreeting(): void { this.#queueDescriptor({ type: 'wave',  side: 'right', intensity: 0.9, duration: 2.5, speed: 0.8 }); }
  emphaticPoint():void { this.#queueDescriptor({ type: 'point', side: 'right', intensity: 1.1, duration: 1.5, speed: 1.2 }); }
  waveBothHands(d: number): void { this.#dispatchDescriptor({ type: 'wave', side: 'both', intensity: 1.3, duration: d }); }

  headTilt(direction: 'left' | 'right', angle: number, durationMs: number): void {
    if (typeof window === 'undefined') return;
    const yaw = direction === 'left' ? -angle : angle;
    try { window.dispatchEvent(new CustomEvent('avatar:headpose', { detail: { yaw, pitch: 0, duration: durationMs } })); } catch { /* ignore */ }
  }

  headJerks(): void {
    if (typeof window === 'undefined') return;
    try {
      window.dispatchEvent(new CustomEvent('avatar:headpose', { detail: { yaw: 0.08, pitch: -0.05, duration: 200 } }));
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('avatar:headpose', { detail: { yaw: -0.06, pitch: 0, duration: 200 } }));
      }, 220);
    } catch { /* ignore */ }
  }

  /** VRMA URL resolver with cache */
  resolveVrmaUrl(stem: string): string {
    const cached = this.#vrmaCache.get(stem);
    if (cached) return cached;
    const url = vrmaUrl(stem);
    this.#vrmaCache.set(stem, url);
    return url;
  }

  // ── Internal execution ──────────────────────────────────────────────────────

  async #drain(): Promise<void> {
    this.#processing = true;
    while (this.#queue.length > 0) {
      const next = this.#queue.shift();
      if (!next) break;
      if (!this.#processing) break; // interrupted externally
      await this.#execute(next);
    }
    this.#processing = false;
  }

  async #execute(entry: QueueEntry): Promise<void> {
    const t0 = perfNow();
    this.#currentName = entry.name;
    this.#currentPriority = entry.priority;
    this.#processing = true;

    devLog('info', `🎭 Playing: ${entry.name} (priority=${entry.priority} duration=${entry.durationMs}ms)`);

    try {
      // Cross-fade: brief idle to let VRMSkeletonManager blend out previous
      if (entry.crossFade && typeof window !== 'undefined') {
        this.#rawDispatch({ gesture: 'idle', type: 'idle', intensity: 0.3, duration: 0.08, priority: entry.priority });
        await this.#delay(50);
      }

      // Resolve name to VRMA stem or fallback
      const stem = this.#lookupStem(entry.name);
      if (stem) {
        await this.#dispatchVrma(stem, entry.durationMs, entry.priority, entry.intensity, entry.mood);
      } else {
        const fallback = GESTURE_FALLBACKS[entry.name.toLowerCase().replace(/\s+/g, '')];
        if (fallback) {
          await this.#executeFallback(fallback, entry);
        } else {
          // Last resort: action-text path
          devLog('warn', `"${entry.name}" has no VRMA or fallback — action-text dispatch`);
          this.#stats.fallbacks += 1;
          try { dispatchGestureFromActionText(entry.name); } catch { /* ignore */ }
          if (entry.durationMs > 0) await this.#delay(Math.min(entry.durationMs, 3000));
        }
      }

      this.#stats.plays += 1;
    } catch (e) {
      this.#stats.errors += 1;
      devLog('error', `execute "${entry.name}" failed`, e);
    } finally {
      this.#stats.lastMs = perfNow() - t0;
      if (this.#currentName === entry.name) {
        this.#currentName = null;
        this.#currentPriority = (PRIORITY.BACKGROUND + 1) as PriorityValue;
      }
      devLog('info', `done "${entry.name}" in ${this.#stats.lastMs.toFixed(1)}ms`);
    }
  }

  async #dispatchVrma(stem: string, durationMs: number, priority: PriorityValue, intensity?: number, mood?: string): Promise<void> {
    const canonical = VRMA_TO_CANONICAL[stem] ?? 'idle';
    const url = this.resolveVrmaUrl(stem);
    const loop = /^Idle[1-4]$/i.test(stem) || stem === 'Relax';

    devLog('info', `📡 Dispatching gesture: ${stem} → ${canonical} url=${url} intensity=${intensity ?? 0.82} mood=${mood ?? 'neutral'}`);

    // Dispatch procedural canonical for VRMSkeletonManager arm system
    this.#rawDispatch({
      gesture: canonical,
      type: canonical,
      intensity: intensity ?? 0.82,
      mood: mood ?? 'neutral',
      duration: Math.max(0.5, durationMs / 1000),
      side: 'right',
      vrma: url,
      priority,
      vrmaStem: stem,
    });

    if (typeof window !== 'undefined') {
      try {
        window.dispatchEvent(
          new CustomEvent('avatar:vrma:request', {
            detail: {
              filename: `${stem}.vrma`,
              url,
              vrmaPath: url,
              blendTime: 0.3,
              loop,
              priority,
            },
          }),
        );
      } catch { /* no loader mounted — safe to ignore */ }
    }

    if (durationMs > 0) await this.#delay(durationMs);
  }

  async #executeFallback(fb: FallbackConfig, entry: QueueEntry): Promise<void> {
    this.#stats.fallbacks += 1;
    devLog('info', `fallback "${entry.name}" strategy=${fb.strategy} gestures=[${fb.gestures.join(',')}]`);

    const each = fb.eachDurationMs ?? this.#resolveDuration(fb.gestures[0] ?? 'idle');

    switch (fb.strategy) {
      case 'single': {
        const stem = this.#lookupStem(fb.gestures[0] ?? 'idle');
        if (stem) {
          await this.#dispatchVrma(stem, each, entry.priority, entry.intensity, entry.mood);
        } else {
          try { dispatchGestureFromActionText(fb.gestures[0] ?? 'idle'); } catch { /* ignore */ }
          if (each > 0) await this.#delay(Math.min(each, 3000));
        }
        break;
      }
      case 'blend': {
        // Fire gestures with a short crossFade between them
        for (const g of fb.gestures) {
          if (this.#currentName !== entry.name) break; // interrupted
          const stem = this.#lookupStem(g);
          if (stem) {
            await this.#dispatchVrma(stem, each, entry.priority, entry.intensity, entry.mood);
          } else {
            try { dispatchGestureFromActionText(g); } catch { /* ignore */ }
            if (each > 0) await this.#delay(Math.min(each, 3000));
          }
          if (fb.blendMs && fb.blendMs > 0) await this.#delay(fb.blendMs);
        }
        break;
      }
      case 'sequence': {
        const gap = fb.gapMs ?? 200;
        for (const g of fb.gestures) {
          if (this.#currentName !== entry.name) break; // interrupted
          const stem = this.#lookupStem(g);
          if (stem) {
            await this.#dispatchVrma(stem, each, entry.priority, entry.intensity, entry.mood);
          } else {
            try { dispatchGestureFromActionText(g); } catch { /* ignore */ }
            if (each > 0) await this.#delay(Math.min(each, 3000));
          }
          if (gap > 0) await this.#delay(gap);
        }
        break;
      }
    }
  }

  #interrupt(reason: string): void {
    devLog('info', `interrupt: ${reason}`);
    if (this.#currentTimer) {
      clearTimeout(this.#currentTimer);
      this.#currentTimer = null;
    }
    this.#currentName = null;
    this.#currentPriority = (PRIORITY.BACKGROUND + 1) as PriorityValue;
    this.#processing = false;
  }

  // ── Resolution helpers ───────────────────────────────────────────────────────

  #lookupStem(name: string): string | null {
    const key = name.toLowerCase().replace(/\s+/g, '');
    const stem = GESTURE_FILENAME_MAP[key];
    return stem ?? null;
  }

  #resolvePriority(name: string): PriorityValue {
    const key = name.toLowerCase().replace(/\s+/g, '');
    // Check exact, then prefix match
    const exact = GESTURE_PRIORITY_MAP[key];
    if (exact !== undefined) return exact;
    for (const [k, v] of Object.entries(GESTURE_PRIORITY_MAP)) {
      if (key.includes(k) || k.includes(key)) return v;
    }
    return PRIORITY.NORMAL;
  }

  #resolveDuration(name: string): number {
    const key = name.toLowerCase().replace(/\s+/g, '');
    return GESTURE_DURATION_MS[key] ?? GESTURE_DURATION_MS['default'] ?? 2000;
  }

  #randomIdle(): string {
    const idles = ['Idle1', 'Idle2', 'Idle3', 'Idle4'];
    return idles[Math.floor(Math.random() * idles.length)];
  }

  // ── Procedural descriptor (AgentDirector) ────────────────────────────────────

  #resolveDescriptor(actionText: string, emotion?: string): GestureDescriptor {
    for (const { pattern, gesture } of ACTION_PATTERNS) {
      if (pattern.test(actionText)) {
        const eh = emotion ? EMOTION_HINTS[emotion] : undefined;
        return {
          type:      gesture.type      ?? 'openHand',
          side:      gesture.side      ?? 'right',
          intensity: Math.min(1.5, (gesture.intensity ?? 0.8) * (eh?.intensity ?? 1.0)),
          duration:  gesture.duration  ?? eh?.duration ?? 2.0,
        };
      }
    }
    if (emotion && EMOTION_HINTS[emotion]) {
      const h = EMOTION_HINTS[emotion];
      return { type: h.type ?? 'openHand', side: 'right', intensity: h.intensity ?? 0.8, duration: h.duration ?? 2.0 };
    }
    return { type: 'beat', side: 'right', intensity: 0.5, duration: 1.5 };
  }

  #descriptorToCanonical(t: GestureDescriptor['type']): CanonicalGesture {
    if (t === 'wave') return 'wave';
    if (t === 'point') return 'point';
    return 'explain';
  }

  #dispatchDescriptor(g: GestureDescriptor): void {
    this.#rawDispatch({
      type: g.type,
      gesture: this.#descriptorToCanonical(g.type),
      side: g.side ?? 'right',
      intensity: g.intensity ?? 0.8,
      duration: g.duration ?? 2.0,
      speed: g.speed ?? 1.0,
    });
  }

  #queueDescriptor(g: GestureDescriptor): void {
    void this.play(g.type, {
      priority: PRIORITY.NORMAL,
      durationMs: (g.duration ?? 2.0) * 1000,
    });
  }

  // ── Raw event dispatch ───────────────────────────────────────────────────────

  #rawDispatch(detail: Record<string, unknown>): void {
    if (typeof window === 'undefined') return;
    try {
      window.dispatchEvent(new CustomEvent('avatar:gesture', { detail }));
    } catch (e) {
      this.#stats.errors += 1;
      devLog('error', '#rawDispatch', e);
    }
  }

  #delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.#currentTimer = setTimeout(() => {
        this.#currentTimer = null;
        resolve();
      }, ms);
    });
  }
}

// ─── Singleton exports ────────────────────────────────────────────────────────

export const unifiedGestureEngine = new UnifiedGestureEngine();
/** Backward compat: AgentDirector imports `gestureEngine` from this path */
export const gestureEngine = unifiedGestureEngine;
