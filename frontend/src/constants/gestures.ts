/**
 * Cogni Gesture System Constants
 * ─────────────────────────────────────────────────────────────────────────
 * Kinematic philosophy (idle / VRMA / generative interplay) is defined in
 * `frontend/src/app/avatar-agent/kinematicStandards.ts` and
 * `frontend/src/app/avatar-agent/semanticCommand.ts` (empirical right-arm −X/−Z, mirrored left).
 *
 * Single source of truth for:
 *  - All 40 confirmed VRMA files (from generatedGestures.ts)
 *  - Virtual gesture names that have smart fallback strategies
 *  - Priority levels (CRITICAL → BACKGROUND)
 *  - Dispatch duration hints (ms)
 *
 * NOTE: VRMSkeletonManager owns actual bone-level playback.
 *       This module only defines metadata used by UnifiedGestureEngine
 *       to dispatch `avatar:vrma:play` and head-only `avatar:gesture` (motion: vrma) events.
 */

// ─── Confirmed VRMA filenames (public/models/animations/) ───────────────────

export const VRMA_FILES = [
  'Acknowledging.vrma',
  'Agreeing.vrma',
  'Angry.vrma',
  'Beckoning.vrma',
  'Blush.vrma',
  'Clapping.vrma',
  'Goodbye.vrma',
  'Idle1.vrma',
  'Idle2.vrma',
  'Idle3.vrma',
  'Idle4.vrma',
  'Jump.vrma',
  'jump-high.vrma',
  'look-around.vrma',
  'look-around2.vrma',
  'pacing-and-talking-on-a-phone.vrma',
  'Pointing.vrma',
  'Relax.vrma',
  'Sad.vrma',
  'sitting.vrma',
  'sitting-and-pointing.vrma',
  'sitting-and-talking.vrma',
  'sitting-disapproval.vrma',
  'sitting-talking.vrma',
  'Sleepy.vrma',
  'standing-cheering.vrma',
  'stop-walking.vrma',
  'Surprised.vrma',
  'Thinking.vrma',
  'Typing.vrma',
  'Untitled.vrma',
  'VRMA_01.vrma',
  'VRMA_02.vrma',
  'VRMA_03.vrma',
  'VRMA_04.vrma',
  'VRMA_05.vrma',
  'VRMA_06.vrma',
  'VRMA_07.vrma',
  'Walking.vrma',
  'Waving.vrma',
] as const;

export type VRMAFilename = typeof VRMA_FILES[number];

// ─── Gesture categories ──────────────────────────────────────────────────────

export const VRMA_GESTURES = {
  /** Idle/ambient loops — cycle when nothing else is queued */
  IDLE: ['Idle1', 'Idle2', 'Idle3', 'Idle4', 'Relax'] as const,

  /** Primary interactive gestures (Cogni teaching contexts) */
  INTERACTIVE: {
    THINK:       'Thinking',
    WAVE:        'Waving',
    CLAP:        'Clapping',
    POINT:       'Pointing',
    AGREE:       'Agreeing',
    ACKNOWLEDGE: 'Acknowledging',
    GOODBYE:     'Goodbye',
    BECKON:      'Beckoning',
  } as const,

  /** Emotional state animations */
  EMOTIONAL: {
    SAD:       'Sad',
    ANGRY:     'Angry',
    SURPRISED: 'Surprised',
    BLUSH:     'Blush',
    SLEEPY:    'Sleepy',
  } as const,

  /** Motion / locomotion */
  MOVEMENT: {
    WALK:      'Walking',
    JUMP:      'Jump',
    JUMP_HIGH: 'jump-high',
    STOP_WALK: 'stop-walking',
    PACING:    'pacing-and-talking-on-a-phone',
  } as const,

  /** Keyboard/tech activity */
  ACTIVITY: {
    TYPING: 'Typing',
  } as const,

  /** Sitting poses */
  SITTING: {
    SIT:         'sitting',
    SIT_TALK:    'sitting-and-talking',
    SIT_POINT:   'sitting-and-pointing',
    SIT_DISAPPROVAL: 'sitting-disapproval',
    SIT_TALKING: 'sitting-talking',
  } as const,

  /** Standing social */
  SOCIAL: {
    CHEER:       'standing-cheering',
    LOOK_AROUND: 'look-around',
    LOOK_AROUND2:'look-around2',
  } as const,

  /** Generic VRMA packs (useful for background variety) */
  PACKS: ['VRMA_01', 'VRMA_02', 'VRMA_03', 'VRMA_04', 'VRMA_05', 'VRMA_06', 'VRMA_07', 'Untitled'] as const,
} as const;

/**
 * Flat lookup: display stem (case-insensitive key) → vrma filename stem
 * Used by the engine to resolve any string the caller passes.
 */
export const GESTURE_FILENAME_MAP: Readonly<Record<string, string>> = {
  // Interactive
  explain:            'Pointing',
  nod:                'Agreeing',
  /** Ambient idle shift — same family as look-around2 (scheduler). */
  idle_shift:         'look-around2',
  thinking:           'Thinking',
  think:              'Thinking',
  waving:             'Waving',
  wave:               'Waving',
  greeting:           'greeting',
  greet:              'greeting',
  welcome:            'greeting',
  clapping:           'Clapping',
  clap:               'Clapping',
  pointing:           'Pointing',
  point:              'Pointing',
  agreeing:           'Agreeing',
  agree:              'Agreeing',
  acknowledging:      'Acknowledging',
  acknowledge:        'Acknowledging',
  goodbye:            'Goodbye',
  bye:                'Goodbye',
  beckoning:          'Beckoning',
  beckon:             'Beckoning',
  // Emotional
  sad:                'Sad',
  angry:              'Angry',
  surprised:          'Surprised',
  surprise:           'Surprised',
  blush:              'Blush',
  sleepy:             'Sleepy',
  sleep:              'Sleepy',
  // Movement
  walking:            'Acknowledging',
  walk:               'Acknowledging',
  jump:               'Acknowledging',
  jumping:            'Acknowledging',
  'jump-high':        'Acknowledging',
  jumphigh:           'Acknowledging',
  'stop-walking':     'Acknowledging',
  stopwalking:        'Acknowledging',
  pacing:             'Acknowledging',
  'pacing-and-talking-on-a-phone': 'Acknowledging',
  // Activity
  typing:             'Acknowledging',
  type:               'Acknowledging',
  // Sitting
  sitting:            'sitting',
  sit:                'sitting',
  'sitting-and-talking': 'sitting-and-talking',
  sittingtalking:     'sitting-and-talking',
  'sitting-and-pointing': 'sitting-and-pointing',
  sittingpointing:    'sitting-and-pointing',
  'sitting-disapproval': 'sitting-disapproval',
  sittingdisapproval: 'sitting-disapproval',
  'sitting-talking':  'sitting-talking',
  // Social
  'standing-cheering':'Clapping',
  standingcheering:   'Clapping',
  cheering:           'Clapping',
  cheer:              'Clapping',
  'look-around':      'look-around',
  lookaround:         'look-around',
  'look-around2':     'look-around2',
  lookaround2:        'look-around2',
  untitled:           'Untitled',
  // Idle
  idle1:              'Idle1',
  idle2:              'Idle2',
  idle3:              'Idle3',
  idle4:              'Idle4',
  relax:              'Relax',
  // Packs
  vrma_01:            'VRMA_01',
  vrma01:             'VRMA_01',
  vrma_02:            'VRMA_02',
  vrma02:             'VRMA_02',
  vrma_03:            'VRMA_03',
  vrma03:             'VRMA_03',
  vrma_04:            'VRMA_04',
  vrma04:             'VRMA_04',
  vrma_05:            'VRMA_05',
  vrma05:             'VRMA_05',
  vrma_06:            'VRMA_06',
  vrma06:             'VRMA_06',
  vrma_07:            'VRMA_07',
  vrma07:             'VRMA_07',
};

// ─── Priority levels ─────────────────────────────────────────────────────────

export const PRIORITY = {
  CRITICAL:   0,   // error, surprised, angry — interrupts everything
  HIGH:       1,   // greetings, celebrations — interrupts NORMAL/LOW
  NORMAL:     2,   // thinking, pointing, wave, explain
  LOW:        3,   // idle, look-around, relax
  BACKGROUND: 4,   // sleepy, blush, minor fidgets
} as const;

export type PriorityLevel = keyof typeof PRIORITY;
export type PriorityValue = typeof PRIORITY[PriorityLevel];

/** Named gesture → numerical priority */
export const GESTURE_PRIORITY_MAP: Readonly<Record<string, PriorityValue>> = {
  // CRITICAL
  angry:       PRIORITY.CRITICAL,
  surprised:   PRIORITY.CRITICAL,
  error:       PRIORITY.CRITICAL,
  // HIGH
  wave:        PRIORITY.HIGH,
  waving:      PRIORITY.HIGH,
  goodbye:     PRIORITY.HIGH,
  celebrate:   PRIORITY.HIGH,
  cheering:    PRIORITY.HIGH,
  'standing-cheering': PRIORITY.HIGH,
  greeting:    PRIORITY.HIGH,
  jump:        PRIORITY.HIGH,
  'jump-high': PRIORITY.HIGH,
  // NORMAL
  explain:     PRIORITY.NORMAL,
  nod:         PRIORITY.LOW,
  idle_shift:  PRIORITY.LOW,
  thinking:    PRIORITY.NORMAL,
  think:       PRIORITY.NORMAL,
  pointing:    PRIORITY.NORMAL,
  point:       PRIORITY.NORMAL,
  clapping:    PRIORITY.NORMAL,
  clap:        PRIORITY.NORMAL,
  agreeing:    PRIORITY.NORMAL,
  agree:       PRIORITY.NORMAL,
  acknowledging: PRIORITY.NORMAL,
  beckoning:   PRIORITY.NORMAL,
  typing:      PRIORITY.NORMAL,
  walking:     PRIORITY.NORMAL,
  pacing:      PRIORITY.NORMAL,
  // LOW
  idle:        PRIORITY.LOW,
  idle1:       PRIORITY.LOW,
  idle2:       PRIORITY.LOW,
  idle3:       PRIORITY.LOW,
  idle4:       PRIORITY.LOW,
  relax:       PRIORITY.LOW,
  'look-around': PRIORITY.LOW,
  lookaround:  PRIORITY.LOW,
  'look-around2': PRIORITY.LOW,
  sitting:     PRIORITY.LOW,
  // BACKGROUND
  blush:       PRIORITY.BACKGROUND,
  sleepy:      PRIORITY.BACKGROUND,
  sad:         PRIORITY.BACKGROUND,
  // Fallback virtuals
  listening:   PRIORITY.LOW,
  processing:  PRIORITY.LOW,
  curious:     PRIORITY.LOW,
} as const;

// ─── Duration hints (ms) ─────────────────────────────────────────────────────

export const GESTURE_DURATION_MS: Readonly<Record<string, number>> = {
  explain: 2200,
  nod: 1800,
  idle_shift: 2200,
  default:       2000,
  test_elbow:    2800,
  testelbow:     2800,
  thinking:      3500,
  angry:         2200,
  surprised:      900,
  wave:          2500,
  waving:        2500,
  clapping:      2200,
  agreeing:      2200,
  acknowledging: 2200,
  pointing:      2200,
  beckoning:     2200,
  goodbye:       2500,
  jump:          1800,
  'jump-high':   1800,
  typing:        3000,
  sitting:       0,      // holds until interrupted
  'sitting-and-talking': 0,
  pacing:        0,
  walking:       0,
  blush:         2000,
  sleepy:        2500,
  sad:           2500,
  relax:         3000,
  'look-around': 2200,
  'look-around2':2200,
  idle1:         3000,
  idle2:         3000,
  idle3:         3000,
  idle4:         3000,
  listening:     3000,
  processing:    2500,
  curious:       2000,
};

// ─── Fallback strategies for virtual gestures (not direct VRMA) ─────────────

export type FallbackStrategy = 'blend' | 'sequence' | 'single';

export interface FallbackConfig {
  strategy: FallbackStrategy;
  /** Canonical canonical gesture names (must exist in GESTURE_FILENAME_MAP or be canonical) */
  gestures: string[];
  /** For blend: crossFadeMs before firing each subsequent gesture */
  blendMs?: number;
  /** For sequence: gap between each gesture (ms) */
  gapMs?: number;
  /** Per-gesture duration override (ms); 0 = use GESTURE_DURATION_MS default */
  eachDurationMs?: number;
}

export const GESTURE_FALLBACKS: Readonly<Record<string, FallbackConfig>> = {
  // Virtual states — no direct VRMA
  listening: {
    strategy: 'blend',
    gestures: ['Acknowledging', 'Idle1'],
    blendMs: 300,
    eachDurationMs: 3000,
  },
  processing: {
    strategy: 'blend',
    gestures: ['Thinking', 'Agreeing'],
    blendMs: 200,
    eachDurationMs: 2500,
  },
  error: {
    strategy: 'sequence',
    gestures: ['Surprised', 'Sad', 'Surprised'],
    gapMs: 200,
    eachDurationMs: 800,
  },
  curious: {
    strategy: 'blend',
    gestures: ['Agreeing', 'Pointing'],
    blendMs: 400,
    eachDurationMs: 2000,
  },
  // Aliases / alternative spellings for gestures not in GESTURE_FILENAME_MAP
  greet:      { strategy: 'single', gestures: ['Waving'],     eachDurationMs: 2000 },
  greeting:   { strategy: 'single', gestures: ['Waving'],     eachDurationMs: 2000 },
  celebrate:  { strategy: 'sequence', gestures: ['Agreeing', 'Acknowledging'], gapMs: 120, eachDurationMs: 2000 },
  talking:    { strategy: 'single', gestures: ['sitting-and-talking'], eachDurationMs: 0 },
  explain:    { strategy: 'single', gestures: ['Pointing'],   eachDurationMs: 2200 },
  explan:     { strategy: 'single', gestures: ['Pointing'],   eachDurationMs: 2200 },
  board:      { strategy: 'single', gestures: ['Pointing'],   eachDurationMs: 2200 },
  thankful:   { strategy: 'single', gestures: ['Acknowledging'], eachDurationMs: 2000 },
  meeting:    { strategy: 'blend', gestures: ['Acknowledging', 'Idle1'], blendMs: 300, eachDurationMs: 2800 },
  havingameeting: { strategy: 'blend', gestures: ['Acknowledging', 'Idle1'], blendMs: 300, eachDurationMs: 2800 },
  'standing-clapping': { strategy: 'single', gestures: ['Agreeing'], eachDurationMs: 2200 },
  standingclapping: { strategy: 'single', gestures: ['Agreeing'], eachDurationMs: 2200 },
  'sitting-victory': { strategy: 'single', gestures: ['Acknowledging'], eachDurationMs: 2000 },
  sittingvictory: { strategy: 'single', gestures: ['Acknowledging'], eachDurationMs: 2000 },
  // Fallback idle alias
  idle:  { strategy: 'single', gestures: ['Idle1'], eachDurationMs: 3000 },
};

// ─── Canonical procedural gestures (VRMSkeletonManager arm/head procedural) ─

export type CanonicalGesture =
  | 'idle'
  | 'explain'
  | 'point'
  | 'think'
  | 'wave'
  | 'clap'
  | 'agree'
  | 'test_elbow';
export const CANONICAL_GESTURES = new Set<CanonicalGesture>([
  'idle', 'explain', 'point', 'think', 'wave', 'clap', 'agree', 'test_elbow',
]);

/** Map any VRMA stem → best canonical procedural gesture for blended state */
export const VRMA_TO_CANONICAL: Readonly<Record<string, CanonicalGesture>> = {
  Thinking:    'think',
  Waving:      'wave',
  greeting:    'wave',
  Clapping:    'clap',
  Pointing:    'point',
  Agreeing:    'agree',
  Acknowledging: 'agree',
  Goodbye:     'wave',
  Beckoning:   'point',
  // Emotional — mapped to best procedural body silhouette
  Sad:         'agree',      // was think — drooped shoulders; agree gives open/lowered arms
  Angry:       'point',      // assertive pointing — correct
  Surprised:   'explain',    // open-arm surprise — more open than wave
  Blush:       'idle',       // subtle embarrassment — quiet idle
  Sleepy:      'idle',       // relaxed drooping — idle
  // Motion
  Walking:     'explain',
  Jump:        'clap',       // arms up = clap silhouette
  'jump-high': 'clap',
  Typing:      'think',
  // Sitting
  sitting:             'idle',
  'sitting-and-talking': 'explain',  // actively talking while sitting
  'sitting-and-pointing': 'point',
  'sitting-disapproval': 'think',
  'sitting-talking':    'explain',
  // Social/movement
  'standing-cheering': 'clap',
  'stop-walking':      'idle',
  'look-around':       'idle',
  'look-around2':      'idle',
  'pacing-and-talking-on-a-phone': 'think',
  Relax:       'idle',
  Untitled:    'idle',
  Idle1:       'idle',
  Idle2:       'idle',
  Idle3:       'idle',
  Idle4:       'idle',
  VRMA_01:     'idle',
  VRMA_02:     'idle',
  VRMA_03:     'idle',
  VRMA_04:     'idle',
  VRMA_05:     'idle',
  VRMA_06:     'idle',
  VRMA_07:     'idle',
};

// ─── VRMA base path ──────────────────────────────────────────────────────────

export const VRMA_BASE_PATH = '/models/animations/';

export function vrmaUrl(stem: string): string {
  const filename = stem.endsWith('.vrma') ? stem : `${stem}.vrma`;
  return `${VRMA_BASE_PATH}${filename}`;
}

/**
 * Game-like / locomotion / full-body pack clips — replace with conversational upper-body-safe stems.
 * Files remain on disk; callers should run stems through this before `vrmaUrl()`.
 */
export const VRMA_CONVERSATIONAL_REDIRECT: Readonly<Record<string, string>> = {
  Typing: 'Acknowledging',
  Walking: 'Acknowledging',
  Jump: 'Acknowledging',
  'jump-high': 'Acknowledging',
  'stop-walking': 'Acknowledging',
  'pacing-and-talking-on-a-phone': 'Acknowledging',
  'standing-cheering': 'Clapping',
  VRMA_01: 'VRMA_02',
  VRMA_03: 'VRMA_02',
  VRMA_04: 'VRMA_02',
  VRMA_05: 'VRMA_02',
  VRMA_06: 'VRMA_02',
  VRMA_07: 'VRMA_02',
  Untitled: 'Acknowledging',
  havingameeting: 'Acknowledging',
  'look-around': 'Acknowledging',
  'look-around2': 'Agreeing',
};

/** Stems permitted after redirects — anything else maps to {@link PRODUCTION_FALLBACK_STEMS}. */
export const PRODUCTION_ALLOWED_VRMA_STEMS: ReadonlySet<string> = new Set([
  'Acknowledging',
  'Thinking',
  'Agreeing',
  'VRMA_02',
  'Waving',
  'greeting',
  'Pointing',
  'Clapping',
  'Idle1',
  'Idle2',
  'Idle3',
  'Idle4',
  'Relax',
  'Goodbye',
  'Beckoning',
  'Surprised',
  'Sad',
  'Angry',
  'Sleepy',
  'Blush',
  'thankful',
  'explan',
  'board',
  'talking',
  'sitting',
  'sitting-and-talking',
  'sitting-and-pointing',
  'sitting-disapproval',
  'sitting-talking',
  'sitting-victory',
]);

/** Deterministic fallback pool when a stem is not production-safe. */
export const PRODUCTION_FALLBACK_STEMS = ['Acknowledging', 'Thinking', 'Agreeing', 'VRMA_02'] as const;

function stemHash32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Last step in resolution: conversational redirects + whitelist. */
export function enforceProductionVrmaStem(stem: string): string {
  const base = stem.replace(/\.vrma$/i, '').trim();
  if (PRODUCTION_ALLOWED_VRMA_STEMS.has(base)) return base;
  const idx = stemHash32(base) % PRODUCTION_FALLBACK_STEMS.length;
  return PRODUCTION_FALLBACK_STEMS[idx];
}

/** Normalize engine stem (no extension) to a conversational-safe VRMA stem. */
export function sanitizeVrmaStem(stem: string): string {
  const base = stem.replace(/\.vrma$/i, '').trim();
  const redirected = VRMA_CONVERSATIONAL_REDIRECT[base] ?? base;
  return enforceProductionVrmaStem(redirected);
}

/**
 * Last-line defense when a full URL is dispatched (bypasses stem map). Same policy as {@link sanitizeVrmaStem}.
 */
export function sanitizeVrmaAssetUrl(url: string): string {
  if (!url || typeof url !== 'string') return url;
  const n = url.replace(/\\/g, '/').toLowerCase();
  if (n.includes('typing.vrma')) return `${VRMA_BASE_PATH}Acknowledging.vrma`;
  if (n.includes('walking.vrma')) return `${VRMA_BASE_PATH}Acknowledging.vrma`;
  if (n.includes('jump-high.vrma')) return `${VRMA_BASE_PATH}Acknowledging.vrma`;
  if (n.includes('/jump.vrma')) return `${VRMA_BASE_PATH}Acknowledging.vrma`;
  if (n.includes('stop-walking.vrma')) return `${VRMA_BASE_PATH}Acknowledging.vrma`;
  if (n.includes('pacing-and-talking-on-a-phone.vrma')) return `${VRMA_BASE_PATH}Acknowledging.vrma`;
  if (n.includes('standing-cheering.vrma')) return `${VRMA_BASE_PATH}Clapping.vrma`;
  if (n.includes('vrma_01.vrma')) return `${VRMA_BASE_PATH}VRMA_MotionPack/vrma/VRMA_02.vrma`;
  if (/vrma_0[3-7]\.vrma/i.test(n)) return `${VRMA_BASE_PATH}VRMA_MotionPack/vrma/VRMA_02.vrma`;
  if (n.includes('havingameeting.vrma')) return `${VRMA_BASE_PATH}Acknowledging.vrma`;
  return url;
}

/**
 * Maps free-form mood / heuristic labels (usually lowercase) → `UnifiedGestureEngine.play()` name.
 * Values are VRMA stems, virtual keys in GESTURE_FALLBACKS, or GESTURE_FILENAME_MAP aliases.
 */
export const EMOTION_TO_GESTURE_PLAY: Readonly<Record<string, string>> = {
  surprised: 'Surprised',
  angry: 'Angry',
  error: 'Surprised',
  excited: 'Agreeing',
  proud: 'Agreeing',
  joy: 'Agreeing',
  happy: 'Agreeing',
  encouraging: 'Agreeing',
  thinking: 'Thinking',
  confused: 'Thinking',
  processing: 'processing',
  curious: 'curious',
  sad: 'Sad',
  tired: 'Sleepy',
  sleepy: 'Sleepy',
  bored: 'Sleepy',
  greeting: 'greeting',
  greet: 'greeting',
  welcome: 'greeting',
  farewell: 'Goodbye',
  goodbye: 'Goodbye',
  grateful: 'thankful',
  thankful: 'thankful',
  explaining: 'Pointing',
  explan: 'Pointing',
  teaching: 'board',
  board: 'board',
  meeting: 'listening',
  havingameeting: 'listening',
  neutral: 'Idle1',
  calm: 'Relax',
  relaxed: 'Relax',
  attentive: 'listening',
  concerned: 'Thinking',
  empathetic: 'Acknowledging',
  anxious: 'Thinking',
  question: 'Thinking',
};

/** Resolve a mood string to a play() name, or null if unknown. */
export function resolveEmotionGesturePlay(emotion: string): string | null {
  const k = emotion.replace(/\s+/g, '').toLowerCase();
  return EMOTION_TO_GESTURE_PLAY[k] ?? null;
}
