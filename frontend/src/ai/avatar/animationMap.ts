/**
 * animationMap.ts — maps LLM intent keywords to VRMA file paths.
 *
 * Used by AvatarCanvas `avatar:play-gesture` handler:
 *   playCogniAnimation(getRandomAnimationPath(intent))
 *
 * Keys MUST match lowercase tokens the LLM produces inside [brackets].
 * All paths must reference sanitized (lowercase, hyphenated) filenames.
 */

const A = '/models/animations/';
const MP = `${A}VRMA_MotionPack/vrma/`;

/** Map: intent keyword → one or more VRMA file paths (randomly sampled). */
export const ANIMATION_MAP: Readonly<Record<string, readonly string[]>> = {
  // ── Core teaching gestures ────────────────────────────────────────────────
  wave:        [`${A}waving.vrma`],
  think:       [`${A}thinking.vrma`],
  point:       [`${A}pointing.vrma`],
  beckon:      [`${A}beckoning.vrma`],
  agree:       [`${A}agreeing.vrma`, `${A}acknowledging.vrma`],
  ack:         [`${A}acknowledging.vrma`],
  clap:        [`${A}clapping.vrma`],
  cheer:       [`${A}standing-cheering.vrma`],
  relax:       [`${A}relax.vrma`],
  look:        [`${A}look-around.vrma`, `${A}look-around2.vrma`],
  goodbye:     [`${A}goodbye.vrma`],
  // ── Emotions ─────────────────────────────────────────────────────────────
  sad:         [`${A}sad.vrma`],
  angry:       [`${A}angry.vrma`],
  surprise:    [`${A}surprised.vrma`],
  surprised:   [`${A}surprised.vrma`],
  blush:       [`${A}blush.vrma`],
  sleepy:      [`${A}sleepy.vrma`],
  // ── Sitting poses ────────────────────────────────────────────────────────
  sit:         [`${A}sitting.vrma`],
  sittalk:     [`${A}sitting-talking.vrma`],
  sitpoint:    [`${A}sitting-and-pointing.vrma`],
  // ── MotionPack ────────────────────────────────────────────────────────────
  greet:       [`${MP}VRMA_02.vrma`, `${A}waving.vrma`],
  peace:       [`${MP}VRMA_03.vrma`],
  pose:        [`${MP}VRMA_06.vrma`],
  spin:        [`${MP}VRMA_05.vrma`],
  // ── Aliases used by [gesture] inline notation ─────────────────────────────
  salute:      [`${A}waving.vrma`],
  explain:     [`${A}pointing.vrma`, `${A}acknowledging.vrma`],
  encourage:   [`${A}acknowledging.vrma`, `${A}agreeing.vrma`],
  celebrate:   [`${A}standing-cheering.vrma`, `${A}clapping.vrma`],
  question:    [`${A}thinking.vrma`, `${A}pointing.vrma`],
  nod:         [`${A}acknowledging.vrma`],
  shrug:       [`${A}relax.vrma`],
  // ── Jordanian teaching idioms ────────────────────────────────────────────
  // [wait]   — رفع اليد باليمين بإصبع واحد: "لحظة معي"
  wait:        [`${A}beckoning.vrma`],
  // [focus]  — الإشارة إلى العين ثم للأمام: "ركّز معي"
  focus:       [`${A}pointing.vrma`],
  // [yalla]  — إيماءة مشجّعة للأمام: "يلا، واصل"
  yalla:       [`${A}beckoning.vrma`, `${A}acknowledging.vrma`],
  // [mashy]  — الإيماء برأسه إلى الأمام مع ابتسامة: "ماشي، ممتاز"
  mashy:       [`${A}agreeing.vrma`],
  // [tayyib] — فتح الكفّين للأعلى: "طيّب، كيف نشرحها؟"
  tayyib:      [`${A}relax.vrma`, `${A}beckoning.vrma`],
} as const;

/** Return one file path for the given intent (random when multiple options). */
export function getRandomAnimationPath(intent: string): string {
  const key = (intent ?? '').toLowerCase().replace(/[^a-z]/g, '');
  const paths = ANIMATION_MAP[key];
  if (!paths || paths.length === 0) {
    // Soft fallback: acknowledging is a safe neutral gesture
    return `${A}acknowledging.vrma`;
  }
  return paths[Math.floor(Math.random() * paths.length)];
}

/** All available animation keys (for LLM prompt generation). */
export const ANIMATION_KEYS = Object.keys(ANIMATION_MAP);
