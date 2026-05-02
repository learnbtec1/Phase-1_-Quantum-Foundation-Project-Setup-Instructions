/**
 * Azure-compatible viseme ID → VRM expression weights.
 *
 * Viseme IDs follow Microsoft's spec (0-21):
 *   https://learn.microsoft.com/azure/ai-services/speech-service/how-to-speech-synthesis-viseme
 *
 * Mapped to three VRM 0.0 / 1.0 blend-shape groups:
 *   aa  — wide open (ɑ)
 *   ih  — front/small opening (ɛ, ɪ, consonants)
 *   ou  — rounded lips (u, o, w)
 *
 * These three cover every mouth shape a VRM 0.0 model exposes as expressions.
 */

export interface VisemeWeights {
  aa: number;   // 0-1
  ih: number;   // 0-1
  ou: number;   // 0-1
}

/** Silence / closed mouth */
const SILENCE: VisemeWeights = { aa: 0, ih: 0, ou: 0 };

/**
 * Azure viseme ID 0-21 → blend weights.
 * Source: Microsoft Cognitive Services Speech viseme reference chart.
 */
const WEIGHTS: Record<number, VisemeWeights> = {
  0:  SILENCE,                           // silent

  /* ── Vowels ─────────────────────────────────────────────────────── */
  1:  { aa: 0.55, ih: 0.20, ou: 0.00 }, // æ, ə, ʌ  (schwa / strut)
  2:  { aa: 1.00, ih: 0.00, ou: 0.00 }, // ɑ         (wide open / father)
  3:  { aa: 0.30, ih: 0.00, ou: 0.70 }, // ɔ         (thought)
  4:  { aa: 0.20, ih: 0.65, ou: 0.00 }, // ɛ, ʊ      (dress / foot)
  5:  { aa: 0.15, ih: 0.50, ou: 0.00 }, // ɝ, ɜː     (nurse / bird)
  6:  { aa: 0.00, ih: 0.90, ou: 0.00 }, // j, i, ɪ   (yod / fleece / kit)
  7:  { aa: 0.00, ih: 0.00, ou: 0.90 }, // w, uː     (witch / goose)
  8:  { aa: 0.20, ih: 0.00, ou: 0.70 }, // oʊ        (goat)
  9:  { aa: 0.80, ih: 0.00, ou: 0.30 }, // aʊ        (mouth — starts open)
  10: { aa: 0.30, ih: 0.00, ou: 0.60 }, // ɔɪ        (choice)
  11: { aa: 0.90, ih: 0.00, ou: 0.00 }, // aɪ        (price — starts open)

  /* ── Consonants ──────────────────────────────────────────────────── */
  12: { aa: 0.10, ih: 0.20, ou: 0.00 }, // h          (aspiration)
  13: { aa: 0.05, ih: 0.25, ou: 0.00 }, // ɹ, ɚ      (red, butter)
  14: { aa: 0.10, ih: 0.30, ou: 0.00 }, // l          (let)
  15: { aa: 0.00, ih: 0.15, ou: 0.00 }, // s, z       (sip, zip)
  16: { aa: 0.00, ih: 0.20, ou: 0.10 }, // ʃ, tʃ, dʒ (ship, chip, gin)
  17: { aa: 0.05, ih: 0.10, ou: 0.00 }, // ð, θ      (this, thin)
  18: { aa: 0.00, ih: 0.10, ou: 0.00 }, // f, v       (fan, van)
  19: { aa: 0.05, ih: 0.15, ou: 0.00 }, // d, t, n, θ (den, ten, net)
  20: { aa: 0.00, ih: 0.08, ou: 0.00 }, // k, g, ŋ   (cap, gap, sing)
  21: { aa: 0.00, ih: 0.22, ou: 0.00 }, // p, b, m    (pop, bob, mom — lips contact)
};

/**
 * Return the VRM blend-shape weights for an Azure viseme ID.
 * Falls back to SILENCE for unknown IDs.
 */
export function azureVisemeToWeights(id: number): VisemeWeights {
  return WEIGHTS[id] ?? SILENCE;
}

export { SILENCE as VISEME_SILENCE };
