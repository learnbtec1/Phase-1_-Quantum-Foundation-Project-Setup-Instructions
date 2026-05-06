/**
 * avatar.ts — Centralised avatar configuration.
 *
 * VRM_FALLBACKS is tried in order by loadVrmWithFallback() inside AvatarCanvas.
 * Set NEXT_PUBLIC_AVATAR_VRM_URL in .env.local to override the primary model
 * without touching source code.
 *
 * Feature flags — all default OFF so experimental code is never active in prod.
 *
 * === GLOBAL COORDINATE SYSTEM (world / scene) ===
 * +Z = forward — avatar faces this direction when `AvatarRoot` rotation is identity (VRM native).
 * +Y = up
 * +X = right
 * Three.js right-handed coordinate system (RHS).
 *
 * Note: procedural arm tuning uses **bone-local** axes (−/+X reach on normalized shoulders); that is
 * not the same label as world forward — see `armGestureReference.ts` / VRMSkeletonManager banner.
 */

import {
  FLOOR_SOURCE,
  WORLD_FLOOR_Y,
  getWorldFloorY,
  warnModelFloorAxisMisuse,
} from '@/app/avatar-agent/floor/worldFloor';

export { FLOOR_SOURCE, WORLD_FLOOR_Y, getWorldFloorY, warnModelFloorAxisMisuse };

/** Office room GLB served from `public/models/` — browser URL (not a filesystem path). */
export const OFFICE_GLB_PUBLIC_PATH = '/models/office.glb' as const;

/**
 * Base office room root (metres, Y-up) — pre–Blender-lock layout.
 * World placement uses `getRoomGroupPosition()` = base + `ROOM_Y_OFFSET` on Y only.
 */
export const FINAL_ROOM_POSITION: [number, number, number] = Object.freeze([
  -2.5776, -1.2839, -0.2279,
]) as [number, number, number];

/** Metres added to base room Y only (does not affect avatar / FloorLock). */
export const ROOM_Y_OFFSET = 3.0;

/** Actual `<group>` position for the office GLB: `[x, y + ROOM_Y_OFFSET, z]`. */
export function getRoomGroupPosition(): [number, number, number] {
  const [x, y, z] = FINAL_ROOM_POSITION;
  return [x, y + ROOM_Y_OFFSET, z];
}

/** Background mesh stays outside `RoomContentEdit` (name as in GLB / office_scene.default.json). */
export const OFFICE_BACKGROUND_MESH_NAME = 'Minimalistic_Modern_Office_Background_0' as const;

/**
 * Presentation: hide desk / workspace tabletop meshes inside the GLB (collisions unchanged).
 * Set `NEXT_PUBLIC_SHOW_OFFICE_DESK=1` to render them again.
 */
export function showOfficeDeskMeshes(): boolean {
  const v =
    typeof process !== 'undefined' && process.env.NEXT_PUBLIC_SHOW_OFFICE_DESK != null
      ? String(process.env.NEXT_PUBLIC_SHOW_OFFICE_DESK).trim().toLowerCase()
      : '';
  return v === '1' || v === 'true' || v === 'yes';
}

/**
 * Presentation: clear the WebGL buffer with alpha so the HTML background (`layout` + `new_env.png`) shows through empties.
 * Set `NEXT_PUBLIC_COGNIE_HTML_BG_OFF=1` for an opaque `#1a1a2e` canvas again (legacy).
 */
export function useCognieHtmlBackdropUnderCanvas(): boolean {
  const v =
    typeof process !== 'undefined' && process.env.NEXT_PUBLIC_COGNIE_HTML_BG_OFF != null
      ? String(process.env.NEXT_PUBLIC_COGNIE_HTML_BG_OFF).trim().toLowerCase()
      : '';
  if (v === '1' || v === 'true' || v === 'yes') return false;
  return true;
}

/** Panorama underlay (2:1 equirect PNG) — same asset as HTML `.cognie-html-env-bg` when used. */
export const AVATAR_EQUIRECT_ENV_PUBLIC_PATH = '/models/images/new_env.png' as const;

/**
 * When true (default), AvatarCanvas loads the equirect as `scene.background` + PMREM `scene.environment`
 * so orbit does not reveal black void; turquoise studio light affects PBR materials.
 * Set `NEXT_PUBLIC_AVATAR_EQUIRECT_BG_OFF=1` to use transparent canvas + HTML backdrop only (legacy).
 */
export function useAvatarEquirectSceneBackground(): boolean {
  const v =
    typeof process !== 'undefined' && process.env.NEXT_PUBLIC_AVATAR_EQUIRECT_BG_OFF != null
      ? String(process.env.NEXT_PUBLIC_AVATAR_EQUIRECT_BG_OFF).trim().toLowerCase()
      : '';
  if (v === '1' || v === 'true' || v === 'yes') return false;
  return true;
}

/**
 * When true (default): avatar canvas uses a real **6 m × 6 m** footprint box room (**4 m** ceiling) instead of equirect / HTML‑only backdrop.
 * Set `NEXT_PUBLIC_AVATAR_BOUNDED_ROOM=0` | `false` | `off` to restore panorama / layered backdrop behaviour.
 */
export function useAvatarBoundedRoomScene(): boolean {
  const v =
    typeof process !== 'undefined' && process.env.NEXT_PUBLIC_AVATAR_BOUNDED_ROOM != null
      ? String(process.env.NEXT_PUBLIC_AVATAR_BOUNDED_ROOM).trim().toLowerCase()
      : '';
  if (v === '0' || v === 'false' || v === 'off' || v === 'no') return false;
  return true;
}

/**
 * نسبة ارتفاع أطلس `new_env.png` المخصّصة لشريط الأرضية (‎v ∈ [0, cut]) لتلاقي قطاع الجدران عند boundary واحد مع الشبكة 3D.
 * جرّب 0.30–0.42 إن ظهر خط فاصل بين «أرضية الصورة» وخط المشهد؛ يتطلّب إعادة بناء عند NEXT_PUBLIC_*.
 */
export function readBoundedRoomAtlasFloorVMaxEnv(): number {
  if (typeof process === 'undefined') return 0.34;
  const raw = process.env.NEXT_PUBLIC_BOUNDED_ATLAS_FLOOR_V_MAX ?? '';
  if (!raw.trim()) return 0.34;
  const v = parseFloat(raw.trim().replace(',', '.'));
  if (!Number.isFinite(v) || v <= 0.08 || v >= 0.6) return 0.34;
  return v;
}

/**
 * Bounded mini-room: world Y target for average foot‑bone snap = `ROOM_BOUNDS.floorY` **plus** this offset.
 * Many VRMs place `leftFoot`/`rightFoot` above the visible sole (~8–11 cm); default **0.10 m** when unset.
 * Set `NEXT_PUBLIC_BOUNDED_FOOT_CALIB_Y_OFFSET=0` to lock bones to the exact floor plane.
 */
export function readBoundedFootCalibYOffsetM(): number {
  if (typeof process === 'undefined') return 0.1;
  const raw = process.env.NEXT_PUBLIC_BOUNDED_FOOT_CALIB_Y_OFFSET ?? '';
  if (!raw.trim()) return 0.1;
  const v = parseFloat(raw.trim().replace(',', '.'));
  if (!Number.isFinite(v) || v < 0 || v > 0.5) return 0.1;
  return v;
}

/** Same as `WORLD_FLOOR_Y` / `getWorldFloorY()` — kept for older imports. */
export const MANUAL_FLOOR_Y = WORLD_FLOOR_Y;

/**
 * Default placement for `office.glb` + VRM in `AvatarCanvas` (metres, Y-up).
 *
 * Coordinate convention: +Y up, +Z forward (VRM native).
 * Camera sits on −Z, looks toward +Z (avatar face direction).
 *
 * avatarPosition.Y = 0   → avatar root at world floor; `applyFootFloorCalib` (liftNode)
 *                           handles the sole→foot-bone gap automatically so feet land exactly
 *                           on WORLD_FLOOR_Y = 0 regardless of model rig.
 * avatarPosition.Z = 0   → avatar centred in world XZ; no desk-Z offset needed.
 *
 * Override fine-tuning with `NEXT_PUBLIC_AVATAR_STAND_Y_OFFSET` (added to avatar Y).
 */
export const AVATAR_OFFICE_SCENE_DEFAULTS = {
  /** Locked room root position — same as `FINAL_ROOM_POSITION`. */
  officePosition: FINAL_ROOM_POSITION,
  officeScale: 1.0,
  // Y=0 → applyFootFloorCalib snaps feet to WORLD_FLOOR_Y (no manual offset needed).
  // Z=0 → centred; camera placed at [0, eyeY, -distance] looking at [0, lookY, 0].
  avatarPosition: [0, 0, 0] as [number, number, number],
  avatarScale: 1.0,
  /**
   * @deprecated Legacy sideline sample kept for backwards-compatible snapshots / tooling only.
   * AvatarCanvas runtime camera is computed from avatarX/Z + eye-height + Z-offset constants.
   */
  cameraPosition: [0, 1.55, -5.0] as [number, number, number],
  /**
   * @deprecated Orbit anchor — AvatarCanvas sets OrbitControls.target from avatar face + avatarZ.
   */
  orbitTarget: [0, 1.42, 0] as [number, number, number],
} as const;

/**
 * Browsers can only load `http(s):`, site-relative `/...`, or same-origin relative paths.
 * Reject `E:\\...`, `file://`, etc. (they break WebGL loaders and show a black canvas).
 */
export function normalizePublicModelUrl(url: string, fallback: string): string {
  const u = (url || '').trim();
  if (!u) return fallback;
  if (/^https?:\/\//i.test(u)) return u;
  if (/^[a-zA-Z]:[\\/]/.test(u) || /^file:/i.test(u)) {
    if (typeof console !== 'undefined' && process.env.NODE_ENV === 'development') {
      console.warn(
        '[avatar] Ignoring invalid model URL (browsers cannot load local file paths). Use a path under public/, e.g. /models/.... Got:',
        u,
      );
    }
    return fallback;
  }
  const posix = u.replace(/\\/g, '/');
  if (posix.startsWith('/')) return posix;
  return `/${posix}`;
}

// ── VRM URL chain ─────────────────────────────────────────────────────────────
const _envVrm = (
  typeof process !== 'undefined' && process.env.NEXT_PUBLIC_AVATAR_VRM_URL?.trim()
    ? normalizePublicModelUrl(process.env.NEXT_PUBLIC_AVATAR_VRM_URL.trim(), '')
    : ''
);

/**
 * CANONICAL AVATAR: 195_Uta01/cogni.vrm — VRM 1.0 (converted from VRM 0.x via UniVRM in Unity 2022.3.22f1)
 * - 16 preset expressions (aa/ih/oh/ou/ee + happy/angry/sad/relaxed + blink/blinkLeft/blinkRight + look*)
 * - 54 humanoid bones (includes leftEye/rightEye + leftThumbMetacarpal/rightThumbMetacarpal)
 * - VRM 1.0: no rotateVRM0 needed, no combineSkeletons, no VRM 0.x workarounds
 * All old models (195_Uta01.vrm, avaturn_avatar.vrm) are DEPRECATED.
 */
export const VRM_FALLBACKS: readonly string[] = [
  ...(_envVrm ? [_envVrm] : []),
  '/models/195_Uta01/cogni.vrm',  // PRIMARY — VRM 1.0 canonical model
];

/**
 * Returns the primary VRM URL — always points to the canonical VRM 1.0 model.
 * ALL components must call this — NEVER hardcode paths.
 */
export function pickVrmUrl(): string {
  if (
    typeof process !== 'undefined' &&
    process.env.NEXT_PUBLIC_AVATAR_VRM_URL?.trim()
  ) {
    return normalizePublicModelUrl(
      process.env.NEXT_PUBLIC_AVATAR_VRM_URL.trim(),
      '/models/195_Uta01/cogni.vrm',
    );
  }
  return '/models/195_Uta01/cogni.vrm';
}

// ── Feature flags ─────────────────────────────────────────────────────────────

/**
 * Full-body + mouse gesture calibration UIs — **disabled for product UI** (sliders/panels confuse learners).
 * Env flags are ignored; re-enable only by editing this function during local gesture tuning.
 */
export function showGestureCalibrationUi(): boolean {
  return false;
}

/**
 * Office scene JSON editor (translate/rotate panel). Default off — `NEXT_PUBLIC_SHOW_OFFICE_SCENE_EDITOR=true` to enable.
 */
export function showOfficeSceneEditorUi(): boolean {
  if (typeof process === 'undefined') return false;
  const v = (process.env.NEXT_PUBLIC_SHOW_OFFICE_SCENE_EDITOR ?? '').trim().toLowerCase();
  return v === 'true' || v === '1';
}

/** Inverse kinematics for arm pointing. Default OFF — heavy, requires three-ik. */
export const USE_IK =
  typeof process !== 'undefined' &&
  process.env.NEXT_PUBLIC_USE_IK === 'true';

/** Use device camera for gaze targeting (requires user consent). Default OFF. */
export const USE_CAMERA_GAZE =
  typeof process !== 'undefined' &&
  process.env.NEXT_PUBLIC_USE_CAMERA_GAZE === 'true';

/**
 * Level 6 — single-authority intent pipeline: AgentDirector stops `avatar:gesture` / `avatar:emotion`;
 * `BehaviorBrainHost` owns motion side-effects. Enable with `NEXT_PUBLIC_LEVEL6_UNIFIED_BEHAVIOR=true`.
 *
 * When **true**: `BehaviorBrainHost` runs (avatar:gesture → VRMAPlayer map); many AgentDirector body paths
 * no-op (`_fireGesture`, neutral-break VRMA, etc.). When **false**: AgentDirector + UnifiedGestureEngine
 * can dispatch `avatar:vrma:play`. Omit or `false` if you need director-driven VRMA.
 */
export const LEVEL6_UNIFIED_BEHAVIOR =
  typeof process !== 'undefined' &&
  (process.env.NEXT_PUBLIC_LEVEL6_UNIFIED_BEHAVIOR === 'true' ||
    process.env.NEXT_PUBLIC_LEVEL6_UNIFIED_BEHAVIOR === '1');

/**
 * Single motion authority: `useBrainStore.avatarBehavior` + {@link VRMSkeletonManager} drive body;
 * {@link AgentDirector} stops competing gestures / VRMA from director; `behaviorMotionBrain` / spontaneous idle are bypassed.
 * Opt out: `NEXT_PUBLIC_AVATAR_BEHAVIOR_SINGLE_CONTROLLER=false`.
 */
export const AVATAR_BEHAVIOR_SINGLE_CONTROLLER =
  typeof process !== 'undefined' &&
  process.env.NEXT_PUBLIC_AVATAR_BEHAVIOR_SINGLE_CONTROLLER !== 'false' &&
  process.env.NEXT_PUBLIC_AVATAR_BEHAVIOR_SINGLE_CONTROLLER !== '0';

/**
 * Default looping VRMA after VRM load (`avatar:vrma:play` from `VRMAPlayer`).
 * `VRMA_Idle.vrma` is not shipped — requests for that path resolve to this URL in the player.
 */
export const DEFAULT_BASE_LOOP_VRMA_URL =
  '/models/animations/VRMA_MotionPack/vrma/VRMA_02.vrma';

/**
 * Optional: public URL to a `.vrma` file — dispatched once after VRM load as `avatar:vrma:play` (smoke test).
 * Example: `/models/animations/VRMA_MotionPack/vrma/VRMA_02.vrma`
 */
export function readVrmaPlayOnLoadUrl(): string {
  if (typeof process === 'undefined') return '';
  const v = (process.env.NEXT_PUBLIC_VRMA_PLAY_ON_LOAD ?? '').trim();
  return v;
}

/** Viseme prediction (lookahead). Default OFF — may cause mouth-pop artefacts. */
export const USE_VISEME_PREDICT =
  typeof process !== 'undefined' &&
  process.env.NEXT_PUBLIC_USE_VISEME_PREDICT === 'true';

/**
 * MIME mode — bypass all browser/API TTS; simulate speaking duration from text length
 * (~65 ms/char) for gesture/expression testing without audio latency or failures.
 * Enable via env: NEXT_PUBLIC_MIME_MODE=true  (or keep false for production).
 */
export const ENABLE_MIME_MODE: boolean =
  typeof process !== 'undefined' &&
  process.env.NEXT_PUBLIC_MIME_MODE === 'true';

/**
 * طبقة الحركة الإجرائية في `AvatarCanvas` / `VRMSkeletonManager`: تنفّس، ميل رقبة/رأس، إيماءات idle للذراعين، نظر سكادي.
 */
export const ENABLE_PROCEDURAL_LIFE = true as boolean;

/**
 * Preview-only yaw hook for motion lab scenes — production uses identity **AvatarRoot** and **+Z** world forward.
 */
export const FORWARD_ROTATION_Y = 0;

/**
 * @deprecated Always `0` — legacy yaw hacks removed; world forward is **+Z** with identity `AvatarRoot`.
 * Retained only so older snippets / forks keep compiling.
 */
export const AVATAR_GROUP_ROTATION_Y = 0 as const;

/** Ignore duplicate WS speech audio starts within this window (ms) — reduces echo from double dispatch. */
export const AUDIO_DEDUP_WINDOW_MS = 300 as const;

/** World-space vertical breathe amplitude (m) — used by `VRMSkeletonManager` (+ optional Canvas tuning). */
export const BREATHING_AMPLITUDE = 0.004;
/** Breathe phase speed (rad/s along time `t`). */
export const BREATHING_SPEED = 1.8;
/** ARM_RELAX quaternion slerp weight scale per frame (0–1؛ أقل = أنعم مقارنة بـ bind pose). */
export const ARM_RELAX_BLEND = 0.35;

export const ENABLE_SACCADIC_EYES = true as boolean;
export const ENABLE_MICRO_EXPRESSIONS = true as boolean;
/** Expression lerp factor per frame for micro-gesture morphs (0.05–0.2 typical). */
export const MICRO_EXPR_BLEND_SPEED = 0.08;

// ── Auto blink (VRMSkeletonManager + expressionManager) ─────────────────────
export const ENABLE_AUTO_BLINK = true as boolean;
export const BLINK_INTERVAL_MIN_S = 2.5;
export const BLINK_INTERVAL_MAX_S = 6.0;
export const BLINK_DURATION_S = 0.15;

// ── Auto micro-expressions while idle/listening ──────────────────────────────
export const ENABLE_AUTO_MICRO_EXPR = true as boolean;
export const AUTO_MICRO_INTERVAL_MIN_S = 4.0;
export const AUTO_MICRO_INTERVAL_MAX_S = 9.0;

/**
 * Whole-group Y breathing applied in VRMSkeletonManager (useFrame -1).
 * When true, AvatarCanvas skips its own `groupBreatheY` to avoid doubling.
 */
export const ENABLE_GROUP_Y_BREATHING = true as boolean;
/** Aliased to spine/root tuning — keep in sync with `BREATHING_*` unless you split intentionally. */
export const GROUP_Y_BREATH_AMPLITUDE = BREATHING_AMPLITUDE;
export const GROUP_Y_BREATH_SPEED = BREATHING_SPEED;

/** Head + neck procedural layers run even if `ENABLE_PROCEDURAL_LIFE` is false. */
export const ALWAYS_ENABLE_HEAD_NECK = true as boolean;

/**
 * تحريك جسدي كامل إضافي (ورك/أكتاف في طبقة §6-B) — **معطّل ثابتاً** (الكتلة معطّلة في `VRMSkeletonManager`).
 */
export const ENABLE_FULL_BODY_PROCEDURAL = false as boolean;

// ── Humanization tuning ───────────────────────────────────────────────────────

/** Respiratory rate (Hz) — ~13 breaths/min at 0.22 */
export const BREATHE_BASE_HZ  = 0.22;
/** @deprecated Prefer BREATHE_AMP_STANDING / BREATHE_AMP_SITTING + proceduralLife */
export const BREATHE_BASE_AMP = 0.022;
/** Second harmonic multiplier on top of BREATHE_HZ (legacy spine layer) */
export const BREATHE_HARMONIC = 1.60;

/** V20 — alias for breathing frequency */
export const BREATHE_HZ = BREATHE_BASE_HZ;
/** V20 — spine / chest procedural amplitude (radians-scale) */
export const BREATHE_AMP_STANDING = 0.012;
export const BREATHE_AMP_SITTING  = 0.006;
/** V20 — weight of second harmonic (less mechanical breathing) */
export const BREATHE_HARMONIC_STRENGTH = 0.3;
/** V20 — second harmonic frequency multiplier (not the old BREATHE_HARMONIC name clash) */
export const BREATHE_HARMONIC_FREQ = 2.1;
/** V20 — tiny world-space Y bounce on avatar group (before physics resolve) */
export const BREATHE_GROUP_BOUNCE_M = 0.002;

/** V20 — slow weight-shift on X (metres, peak) */
export const WEIGHT_SHIFT_AMP_STANDING = 0.012;
export const WEIGHT_SHIFT_AMP_SITTING   = 0.004;
/** V20 — long-cycle head roll bias (rad), toggled ~1 min */
export const LONG_HEAD_TILT_RAD = 0.02;
/** V20 — shoulder asymmetry (rad) applied to upper-arm Z */
export const SHOULDER_DROP_RAD = 0.022;
/** V20 — idle foot yaw wiggle (rad, peak) */
export const FOOT_IDLE_YAW_RAD = 0.014;
/** V20 — micro-expression idle interval (ms) */
/** V29 — idle micro-expressions every ~6–12 s */
export const MICRO_EXPR_MIN_MS = 6_000;
export const MICRO_EXPR_MAX_MS = 12_000;

/** مضاعف طبقة الحياة الإجرائية أثناء نافذة إيماءة نشطة (مؤقتات الوكيل / co-speech)، 0–1 */
export const PROC_LIFE_GESTURE_OVERLAY = 0.52;
/** V30 — clap / cheer temporary elbow spread multiplier duration (ms) */
export const HAND_SEPARATION_PULSE_MS = 520;
/** V30 — require this much calm idle time before first auto micro-gesture */
export const IDLE_MICRO_GESTURE_MIN_MS = 5_000;
/** V30 — cooldown between auto micro-gestures */
export const IDLE_MICRO_GESTURE_COOLDOWN_MIN_MS = 8_000;
export const IDLE_MICRO_GESTURE_COOLDOWN_MAX_MS = 14_000;

/** Per-emotion breathing modulation { hz, amp } */
export const EMOTION_BREATHE: Readonly<Record<string, { hz: number; amp: number }>> = {
  angry:   { hz: 3.0, amp: 0.030 },
  excited: { hz: 2.5, amp: 0.028 },
  sad:     { hz: 1.2, amp: 0.015 },
  calm:    { hz: 0.9, amp: 0.012 },
  relax:   { hz: 0.9, amp: 0.012 },
};

/** Subconscious life — human-like blink spacing (~3–7 s). */
export const BLINK_MIN_SEC     = 3.0;
export const BLINK_MAX_SEC     = 7.0;
export const BLINK_DURATION_MS = 160;
export const PARTIAL_BLINK_CHANCE = 0.25;  // 25 % of blinks are partial (70 % closure)

export const SACCADE_AMP_M        = 0.012; // ±12 mm look-at jitter
/** Fixation hold between saccades when idle (ms) — 2–5 s feels less “darting robot”. */
export const GAZE_FIXATE_IDLE_MIN_MS = 2000;
export const GAZE_FIXATE_IDLE_MAX_MS = 5000;
export const SACCADE_IDLE_HZ      = 0.5;  // update freq while idle
export const SACCADE_SPEAK_HZ     = 0.25; // slower while speaking
export const SACCADE_LISTEN_HZ    = 1.0;  // faster while listening

/** Natural reply delay (ms) before TTS starts. Sampled uniformly in [min,max]. */
export const REPLY_DELAY_MIN_MS = 500;
export const REPLY_DELAY_MAX_MS = 1500;

// ── WS / voice protocol constants ─────────────────────────────────────────

/** Timeout (ms) for a single STT/WS round-trip before retry. */
export const REQ_TIMEOUT_MS = 5_000;

/** Max STT retries on network failure (0 = no retry). */
export const MAX_STT_RETRY = 1;

/** WS heartbeat period in seconds — must match HEARTBEAT_INTERVAL_SEC in backend/.env */
export const HEARTBEAT_INTERVAL_SEC = 15;

/** Consecutive TTS failures before circuit opens and falls back to text-only mode. */
export const TTS_CIRCUIT_BREAKER_THRESHOLD = 2;

/** Seconds the TTS circuit breaker stays open before auto-closing. */
export const TTS_COOLDOWN_SEC = 60;

// ── WS protocol version ───────────────────────────────────────────────────────

/** WS protocol version stamped on all outgoing frames. */
export const WS_PROTOCOL_VERSION = 1.1;

// ── Proactive silence timings ─────────────────────────────────────────────────

/** Ms of user silence before avatar dispatches a minor idle gesture. */
export const PROACTIVE_GESTURE_MS = 20_000;

/** Ms of user silence before avatar sends a proactive mentor check-in via WS (Phase 21). */
export const PROACTIVE_QUESTION_MS = 20_000;

// ── Locomotion (Checkpoint #40 — AvatarCanvas `onWalk` + §8 + clap separation) ─
export const WALK_SPEED_MPS = 1.2;
export const WALK_STEP_DURATION = 0.6;
export const WALK_CYCLE_RAD_PER_S = 3.8;
export const WALK_DEFAULT_DISTANCE_METERS = 2.0;
export const WALK_WRIST_MIN_SEP_M = 0.15;

// ── Rapier / avatar-environment physics (AvatarCanvas + WorldColliders) ─────

/** Tuning for Rapier world, character capsule, and static furniture colliders. */
export const PHYSICS_CONFIG = {
  gravity: [0, -9.81, 0] as const,
  avatar: {
    mass: 70,
    friction: 0.5,
    restitution: 0.2,
    capsuleRadius: 0.3,
    /** Total capsule length along Y (segment + spherical caps — see rapierColliders). */
    capsuleHeight: 1.6,
  },
  environment: {
    friction: 0.7,
    restitution: 0.1,
  },
  layers: {
    AVATAR: 0b0001,
    DESK: 0b0010,
    CHAIR: 0b0100,
    FLOOR: 0b1000,
  },
} as const;

// ── Env-driven avatar / floor tuning (AvatarCanvas, RoomShell) ───────────────

export function readAvatarStandYOffsetEnv(): number {
  if (typeof process === 'undefined') return 0;
  const v = parseFloat(process.env.NEXT_PUBLIC_AVATAR_STAND_Y_OFFSET ?? '0');
  return Number.isFinite(v) ? v : 0;
}

/**
 * Legacy env tweak for room Y. **AvatarCanvas** no longer adds this after `FINAL_ROOM_POSITION`
 * production lock — adjust `FINAL_ROOM_POSITION` in this file instead.
 */
export function readOfficeEnvYOffsetEnv(): number {
  if (typeof process === 'undefined') return 0;
  const v = parseFloat(process.env.NEXT_PUBLIC_OFFICE_ENV_Y_OFFSET ?? '0');
  return Number.isFinite(v) ? v : 0;
}

/** Default office layout `[x,y,z]` — matches runtime room group (`getRoomGroupPosition`). */
export function getDefaultOfficePosition(): [number, number, number] {
  return getRoomGroupPosition();
}

/** World position for VRM root in office scene; includes `NEXT_PUBLIC_AVATAR_STAND_Y_OFFSET`. */
export function getAvatarOfficeScenePosition(): [number, number, number] {
  const [x, y, z] = AVATAR_OFFICE_SCENE_DEFAULTS.avatarPosition;
  return [x, y + readAvatarStandYOffsetEnv(), z];
}

/** Radians added to body yaw for VRM 0.x vs 1.0 rigs; null = auto from meta. */
export function readAvatarFacingYawBaseEnv(): number | null {
  if (typeof process === 'undefined') return null;
  const raw = process.env.NEXT_PUBLIC_AVATAR_FACING_YAW_BASE?.trim();
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export const AVATAR_BREATHE_SCALE_VRM1 = 0.78;

export const SIT_UPPER_LEG_X_VRM0 = -1.22;
export const SIT_UPPER_LEG_X_VRM1 = -1.05;
export const SIT_LOWER_LEG_X_SEATED = 1.42;

export function readAvatarSitWorldYOffsetEnv(): number {
  if (typeof process === 'undefined') return 0;
  const v = parseFloat(process.env.NEXT_PUBLIC_AVATAR_SIT_WORLD_Y_OFFSET ?? '0');
  return Number.isFinite(v) ? v : 0;
}

export function readAvatarDebugForceStandEnv(): boolean {
  return (
    typeof process !== 'undefined' &&
    process.env.NEXT_PUBLIC_AVATAR_DEBUG_FORCE_STAND === 'true'
  );
}

/** Extra metres above rug AABB top for foot / walk surface (default 1.5 cm). */
export function readRugWalkSurfaceYExtraEnv(): number {
  if (typeof process === 'undefined') return 0.015;
  const v = parseFloat(process.env.NEXT_PUBLIC_RUG_WALK_SURFACE_Y_EXTRA ?? '0.015');
  return Number.isFinite(v) ? v : 0.015;
}

/**
 * Added to `ROOM_BOUNDS.floorY` (static default and optional GLB-derived baseline).
 * Try e.g. +0.05 / +0.1 if feet float slightly; negative if feet sink.
 */
export function readFloorBaselineOffsetEnv(): number {
  if (typeof process === 'undefined') return 0;
  const v = parseFloat(process.env.NEXT_PUBLIC_FLOOR_Y_OFFSET ?? '0');
  return Number.isFinite(v) ? v : 0;
}

/**
 * Legacy: GLB `Box3.min.y` floor sync is **disabled** — floor is always `getWorldFloorY()` (+ optional
 * `readFloorBaselineOffsetEnv()` in `ROOM_BOUNDS`). If env is set to opt into old behaviour, we warn
 * and still ignore the model.
 */
export function readFloorAutoFromGlbEnv(): boolean {
  if (typeof process === 'undefined') return false;
  const raw = (process.env.NEXT_PUBLIC_FLOOR_AUTO_FROM_GLB ?? '').trim().toLowerCase();
  const legacyOn = raw === 'true' || raw === '1' || raw === 'on';
  if (legacyOn) {
    warnModelFloorAxisMisuse('NEXT_PUBLIC_FLOOR_AUTO_FROM_GLB is ignored; floor source is WORLD.');
  }
  return false;
}

/** Show a grid at `ROOM_BOUNDS.floorY` (dev alignment). `NEXT_PUBLIC_DEBUG_FLOOR_GRID=true` */
export function readDebugFloorGridEnv(): boolean {
  return (
    typeof process !== 'undefined' && process.env.NEXT_PUBLIC_DEBUG_FLOOR_GRID === 'true'
  );
}

/**
 * Drift watchdog: re-runs foot calibration on an interval when feet drift from target (default OFF).
 * Enable with `NEXT_PUBLIC_FLOOR_CALIB_WATCHDOG=true` — can fight animation / duplicate bounds and cause loops.
 */
export function readFloorCalibWatchdogEnv(): boolean {
  return (
    typeof process !== 'undefined' && process.env.NEXT_PUBLIC_FLOOR_CALIB_WATCHDOG === 'true'
  );
}

// ── 3D scene environment (carpet vs office GLB) — AvatarCanvas `NEXT_PUBLIC_ACTIVE_ENV` ─

export type ActiveEnvKey = 'DEFAULT' | 'OFFICE';

/**
 * Registry for floor GLB + physics alignment.
 * DEFAULT and OFFICE both use the shipped office shell (`/models/office.glb`); legacy carpet GLBs were archived.
 */
export const ENV_MODELS: Record<
  ActiveEnvKey,
  {
    path: string;
    /** World Y of the rigid floor (docs) — live `ROOM_BOUNDS.floorY` is `getWorldFloorY()` + env offset, not GLB. */
    physicsY: number;
    /** Metres above physics base for the walk surface (soles target). OFFICE uses this; DEFAULT uses `readRugWalkSurfaceYExtraEnv()` on top of carpet AABB max.y. */
    rugExtra: number;
  }
> = {
  DEFAULT: {
    path: OFFICE_GLB_PUBLIC_PATH,
    physicsY: 0,
    rugExtra: 0.05,
  },
  OFFICE: {
    path: OFFICE_GLB_PUBLIC_PATH,
    physicsY: 0,
    rugExtra: 0.05,
  },
};

/**
 * Build-time: `NEXT_PUBLIC_ACTIVE_ENV` → DEFAULT | OFFICE (كلاهما يستخدمان `OFFICE_GLB_PUBLIC_PATH` بعد أرشفة السجادات).
 * فارغ أو غير معروف → OFFICE.
 */
const ACTIVE_ENV_FROM_BUILD = (() => {
  if (typeof process === 'undefined') return '';
  return (process.env.NEXT_PUBLIC_ACTIVE_ENV || '').trim().toUpperCase();
})();

export const ACTIVE_ENV_RAW = ACTIVE_ENV_FROM_BUILD;

export const ACTIVE_ENV: ActiveEnvKey =
  ACTIVE_ENV_FROM_BUILD === 'DEFAULT' ? 'DEFAULT' : 'OFFICE';

export function getActiveEnvKey(): ActiveEnvKey {
  return ACTIVE_ENV;
}

export function getActiveEnvModel(): (typeof ENV_MODELS)[ActiveEnvKey] {
  return ENV_MODELS[getActiveEnvKey()];
}

/** Rug layer: DEFAULT = env-driven (same as legacy carpet); OFFICE = `ENV_MODELS.OFFICE.rugExtra`. */
export function getEffectiveRugExtraForActiveEnv(): number {
  return getActiveEnvKey() === 'OFFICE' ? ENV_MODELS.OFFICE.rugExtra : readRugWalkSurfaceYExtraEnv();
}

/** Walk-plane Y when not using carpet AABB (OFFICE): `physicsY + rugExtra`. */
export function getFixedWalkPlaneYFromEnvConfig(): number {
  const m = ENV_MODELS.OFFICE;
  return m.physicsY + getEffectiveRugExtraForActiveEnv();
}

export const SIT_WORLD_Y_TRIM_VRM1 = 0.02;
export const BREATHE_AMP_STANDING_VRM1 = 0.01;
export const BREATHE_AMP_SITTING_VRM1 = 0.0055;

export function getMimeMode(): boolean {
  return ENABLE_MIME_MODE;
}
