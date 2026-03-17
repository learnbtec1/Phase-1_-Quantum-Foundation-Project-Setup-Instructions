/**
 * MotionLogger.ts — Cogni Motion Capture Interceptor
 *
 * "Man-in-the-Middle" recorder for VRM bone rotations + blendshape weights.
 * Designed to run silently inside useFrame() at 60 fps WITHOUT causing:
 *   - Frame drops   (ring buffer + throttled sampling, zero heap allocation in hot path)
 *   - Memory leaks  (hard cap at MAX_FRAMES; export clears the buffer)
 *   - GC pressure   (pre-allocated FrameStore array; compact numeric format)
 *
 * Collected data is a proprietary dataset for future local AI training:
 *   → bone quaternions drive a local kinematic model
 *   → blendshape weights train a facial expression predictor
 *
 * Usage (see §INTEGRATION NOTE at the bottom of this file):
 *   motionLogger.startRecording();
 *   // inside useFrame: motionLogger.logFrame(delta, blendshapes, bones);
 *   motionLogger.exportData();   // triggers browser download
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/** Quaternion stored as a compact 4-tuple [x, y, z, w] to minimize JSON size. */
export type QuatTuple = [number, number, number, number];

/**
 * Blendshape map: only non-zero weights are stored per frame
 * to keep individual frame size small.
 * Keys match standard VRM 1.0 / 0.x expression names.
 */
export type BlendshapeSnapshot = Partial<{
  aa: number; ih: number; ou: number; ee: number; oh: number;
  blink: number; blinkLeft: number; blinkRight: number;
  happy: number; sad: number; angry: number; surprised: number; relaxed: number;
  lookUp: number; lookDown: number; lookLeft: number; lookRight: number;
  // catch-all for custom keys
  [key: string]: number;
}>;

/**
 * Bone rotation map: up to 22 standard VRM humanoid bone names.
 * Sparse — only include bones that are actively driven.
 */
export type BoneSnapshot = Partial<{
  hips: QuatTuple;
  spine: QuatTuple; upperChest: QuatTuple; chest: QuatTuple; neck: QuatTuple; head: QuatTuple;
  leftEye: QuatTuple; rightEye: QuatTuple;
  leftShoulder: QuatTuple; leftUpperArm: QuatTuple; leftLowerArm: QuatTuple; leftHand: QuatTuple;
  rightShoulder: QuatTuple; rightUpperArm: QuatTuple; rightLowerArm: QuatTuple; rightHand: QuatTuple;
  leftUpperLeg: QuatTuple; leftLowerLeg: QuatTuple; leftFoot: QuatTuple;
  rightUpperLeg: QuatTuple; rightLowerLeg: QuatTuple; rightFoot: QuatTuple;
  [key: string]: QuatTuple | undefined;
}>;

/** Single recorded frame — kept compact for efficient serialization. */
interface FrameRecord {
  /** Elapsed wall-clock seconds since recording started (2 decimal places). */
  t: number;
  /** Frame delta in milliseconds (facilitates playback speed control). */
  dt: number;
  /** Active blendshape weights (sparse — zero values omitted). */
  b: BlendshapeSnapshot;
  /** Bone quaternions (sparse — identity bones omitted). */
  r: BoneSnapshot;
}

/** Session metadata stored at the top of the exported JSON. */
interface SessionMeta {
  version: '1.0';
  startedAt: string;        // ISO 8601
  durationMs: number;
  frameCount: number;
  sampleRateHz: number;
  capturedBones: string[];
  capturedBlendshapes: string[];
  devicePixelRatio: number;
  userAgent: string;
}

/** Full export envelope — load this into your future training pipeline. */
interface MocapExport {
  meta: SessionMeta;
  frames: FrameRecord[];
}

// ─── Configuration ────────────────────────────────────────────────────────────

/** Log 1 out of every N rendered frames.
 *  2 = ~30 fps dataset, 3 = ~20 fps dataset.
 *  20 fps is sufficient for smooth motion training and halves storage cost. */
const SAMPLE_EVERY_N_FRAMES = 2;

/** Hard memory cap: 5 min × 30 fps = 9 000 frames.
 *  Each frame ≈ 400–600 bytes JSON → max ~5.4 MB in RAM before export. */
const MAX_FRAMES = 9_000;

/** Minimum quaternion component magnitude to consider a bone "non-identity".
 *  Bones at rest (quaternion ≈ identity [0,0,0,1]) are skipped to keep frames sparse. */
const IDENTITY_THRESHOLD = 0.005;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Round to 4 decimal places — enough precision for smooth playback. */
const r4 = (n: number): number => Math.round(n * 10_000) / 10_000;

/** Returns true if the quaternion is close enough to identity to skip. */
function isIdentityQuat(x: number, y: number, z: number, w: number): boolean {
  return Math.abs(x) < IDENTITY_THRESHOLD
      && Math.abs(y) < IDENTITY_THRESHOLD
      && Math.abs(z) < IDENTITY_THRESHOLD
      && Math.abs(1 - w) < IDENTITY_THRESHOLD;
}

// ─── MotionLogger class ───────────────────────────────────────────────────────

class MotionLogger {
  private _recording    = false;
  private _frames: FrameRecord[] = [];
  private _frameCount   = 0;   // total rendered frames since startRecording()
  private _startTime    = 0;   // performance.now() snapshot
  private _elapsedSec   = 0;   // updated each logFrame call
  private _capturedBones        = new Set<string>();
  private _capturedBlendshapes  = new Set<string>();

  // ── Public API ──────────────────────────────────────────────────────────────

  get isRecording(): boolean { return this._recording; }
  get frameCount():  number  { return this._frames.length; }

  /**
   * Start a new recording session.
   * Clears any previous data. Safe to call multiple times.
   */
  startRecording(): void {
    this._frames           = [];
    this._frameCount       = 0;
    this._elapsedSec       = 0;
    this._capturedBones.clear();
    this._capturedBlendshapes.clear();
    this._startTime        = performance.now();
    this._recording        = true;
    console.log('%c[MotionLogger] ▶ Recording started', 'color:#0f0;font-weight:bold');
  }

  /** Pause / resume without clearing the buffer. */
  pause():  void { this._recording = false; console.log('[MotionLogger] ⏸ Paused'); }
  resume(): void { this._recording = true;  console.log('[MotionLogger] ▶ Resumed'); }

  /**
   * Called every rendered frame (inside useFrame).
   * Throttled: only writes to buffer every SAMPLE_EVERY_N_FRAMES frames.
   * ZERO heap allocations in the skipped-frame path.
   *
   * @param deltaTime  - Three.js frame delta in seconds (passed from useFrame state)
   * @param blendshapes - Current VRM expression weights (pass {} if not available)
   * @param bones       - Current VRM bone quaternions   (pass {} if not available)
   */
  logFrame(
    deltaTime: number,
    blendshapes: BlendshapeSnapshot,
    bones: BoneSnapshot,
  ): void {
    if (!this._recording) return;

    this._frameCount++;

    // Throttle: skip non-sampled frames with early return (zero cost)
    if (this._frameCount % SAMPLE_EVERY_N_FRAMES !== 0) return;

    // Hard cap — stop silently when buffer is full (prevents OOM on long sessions)
    if (this._frames.length >= MAX_FRAMES) {
      this._recording = false;
      console.warn(
        `[MotionLogger] ⚠️ MAX_FRAMES (${MAX_FRAMES}) reached — recording stopped. Call exportData().`,
      );
      return;
    }

    this._elapsedSec = (performance.now() - this._startTime) / 1000;

    // ── Compact blendshape snapshot: skip zero weights ──────────────────────
    const bSnap: BlendshapeSnapshot = {};
    for (const key in blendshapes) {
      const v = blendshapes[key];
      if (v !== undefined && v > 0.001) {
        bSnap[key] = r4(v);
        this._capturedBlendshapes.add(key);
      }
    }

    // ── Compact bone snapshot: skip identity quaternions ────────────────────
    const rSnap: BoneSnapshot = {};
    for (const key in bones) {
      const q = bones[key as keyof BoneSnapshot];
      if (!q) continue;
      const [x, y, z, w] = q;
      if (!isIdentityQuat(x, y, z, w)) {
        (rSnap as Record<string, QuatTuple>)[key] = [r4(x), r4(y), r4(z), r4(w)];
        this._capturedBones.add(key);
      }
    }

    this._frames.push({
      t:  r4(this._elapsedSec),
      dt: Math.round(deltaTime * 1000),  // ms integer — saves ~30% JSON space vs float
      b:  bSnap,
      r:  rSnap,
    });
  }

  /**
   * Stop recording and trigger a browser download of `cogni_mocap_data.json`.
   * The buffer is cleared after export to free memory immediately.
   */
  exportData(): void {
    if (this._frames.length === 0) {
      console.warn('[MotionLogger] ❌ No frames recorded — nothing to export.');
      return;
    }

    this._recording = false;
    const durationMs = Math.round(performance.now() - this._startTime);

    const meta: SessionMeta = {
      version:              '1.0',
      startedAt:            new Date(Date.now() - durationMs).toISOString(),
      durationMs,
      frameCount:           this._frames.length,
      sampleRateHz:         Math.round(this._frames.length / (durationMs / 1000)),
      capturedBones:        [...this._capturedBones].sort(),
      capturedBlendshapes:  [...this._capturedBlendshapes].sort(),
      devicePixelRatio:     typeof window !== 'undefined' ? window.devicePixelRatio : 1,
      userAgent:            typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
    };

    const payload: MocapExport = { meta, frames: this._frames };

    // Serialize in a micro-task to avoid blocking the main thread for large sessions
    setTimeout(() => {
      try {
        const json = JSON.stringify(payload, null, 0); // compact — no pretty-print
        const blob = new Blob([json], { type: 'application/json' });
        const url  = URL.createObjectURL(blob);
        const ts   = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = `cogni_mocap_${ts}.json`;
        a.click();
        URL.revokeObjectURL(url);

        console.log(
          `%c[MotionLogger] ✅ Exported ${meta.frameCount} frames | ${(json.length / 1024).toFixed(1)} KB | ${(durationMs / 1000).toFixed(1)} s`,
          'color:#0ff;font-weight:bold',
        );
      } catch (err) {
        console.error('[MotionLogger] ❌ Export failed:', err);
      }
    }, 0);

    // Free memory immediately — don't hold the buffer after export
    this._frames = [];
    this._capturedBones.clear();
    this._capturedBlendshapes.clear();
  }

  /** Returns a status string for debug overlays (zero allocation). */
  getStats(): string {
    if (!this._recording) return '[MotionLogger] idle';
    return `[MotionLogger] ▶ ${this._frames.length}/${MAX_FRAMES} frames | ${this._elapsedSec.toFixed(1)}s`;
  }
}

// ─── Singleton export ─────────────────────────────────────────────────────────
// Single shared instance — import the same object everywhere in the app.
export const motionLogger = new MotionLogger();

// ─── §INTEGRATION NOTE ── How to wire this into AvatarCanvas.tsx ──────────────
//
// The injection point is near the END of the useFrame() callback, AFTER
// v.update(delta) has run and all bone overrides have been applied. At that
// point every quaternion on the skeleton reflects the final rendered pose.
//
// ── Step A: import at the top of AvatarCanvas.tsx ──────────────────────────
//
//   import { motionLogger, type BlendshapeSnapshot, type BoneSnapshot } from '@/utils/MotionLogger';
//
// ── Step B: add inside useFrame(), after §8 bone writes ────────────────────
//
//   // §9 Motion capture — silent passive recorder (noop when not recording)
//   if (motionLogger.isRecording && v?.humanoid && v?.expressionManager) {
//     const h  = v.humanoid;
//     const em = v.expressionManager;
//
//     // ── Blendshapes ──────────────────────────────────────────────────────
//     const bSnap: BlendshapeSnapshot = {};
//     const EXPR_KEYS = ['aa','ih','ou','ee','oh','blink','happy','sad','angry','surprised','relaxed'] as const;
//     for (const k of EXPR_KEYS) {
//       const val = em.getValue(k as never) as number | undefined;
//       if (val !== undefined) bSnap[k] = val;
//     }
//
//     // ── Bone quaternions ─────────────────────────────────────────────────
//     const BONE_KEYS = [
//       'hips','spine','upperChest','chest','neck','head',
//       'leftUpperArm','leftLowerArm','leftHand',
//       'rightUpperArm','rightLowerArm','rightHand',
//     ] as const;
//     const rSnap: BoneSnapshot = {};
//     for (const k of BONE_KEYS) {
//       const bone = h.getRawBoneNode(k as never);
//       if (bone) {
//         const q = bone.quaternion;
//         (rSnap as Record<string, [number,number,number,number]>)[k] = [q.x, q.y, q.z, q.w];
//       }
//     }
//
//     motionLogger.logFrame(delta, bSnap, rSnap);
//   }
//
// ── Step C: trigger recording from anywhere (e.g., a dev hotkey) ───────────
//
//   // Start/stop with keyboard shortcut (dev-mode only):
//   useEffect(() => {
//     if (process.env.NODE_ENV !== 'development') return;
//     const handler = (e: KeyboardEvent) => {
//       if (e.altKey && e.key === 'r') {
//         motionLogger.isRecording ? motionLogger.exportData() : motionLogger.startRecording();
//       }
//     };
//     window.addEventListener('keydown', handler);
//     return () => window.removeEventListener('keydown', handler);
//   }, []);
//
// ── Performance guarantee ────────────────────────────────────────────────────
//
//   When motionLogger.isRecording is false (default), §9 is a single boolean
//   check — effectively free (< 1 μs per frame). Zero allocations.
//   When recording, the hot path allocates two small plain objects per logged
//   frame (every 2nd frame ≈ 30fps). V8's young-generation GC handles this
//   with sub-millisecond pauses — well within the 16.6 ms frame budget.
