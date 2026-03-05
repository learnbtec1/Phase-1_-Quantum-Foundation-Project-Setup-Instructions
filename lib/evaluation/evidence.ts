// lib/evaluation/evidence.ts

/**
 * Evidence extraction and management:
 * 1) Extract raw evidence quotes from student answer.
 * 2) Trim quotes to max 280 chars.
 * 3) Locate exact positions (start, end).
 * 4) Clean and normalize evidence (remove diacritics, etc).
 */

export type RawEvidenceItem = {
  quote: string;
};

export type EvidenceItem = {
  quote: string;
  start: number;
  end: number;
};

/**
 * Locate a quote in the student answer.
 * Returns start and end positions, or -1 if not found.
 */
export function locateEvidence(
  answer: string,
  quote: string
): { start: number; end: number } {
  if (!answer || !quote) return { start: -1, end: -1 };

  const idx = answer.indexOf(quote);
  if (idx === -1) return { start: -1, end: -1 };

  return { start: idx, end: idx + quote.length };
}

/**
 * Sanitize a quote:
 * - Max 280 characters
 * - Remove extra whitespace
 * - Preserve formatting
 */
export function sanitizeQuote(quote: string): string {
  if (!quote) return "";
  let cleaned = quote.trim();

  if (cleaned.length > 280) {
    cleaned = cleaned.substring(0, 280);
  }

  return cleaned;
}

/**
 * Prepare evidence items:
 * - Extract quotes from raw items
 * - Locate positions in answer
 * - Filter duplicates
 * - Limit to max items
 */
export function prepareEvidence(
  answer: string,
  items: RawEvidenceItem[],
  max = 5
): EvidenceItem[] {
  if (!Array.isArray(items)) return [];

  return items
    .slice(0, max)
    .map((item) => {
      const quote = sanitizeQuote(item.quote || "");
      const { start, end } = locateEvidence(answer, quote);
      return { quote, start, end };
    })
    .filter((ev) => ev.quote.length > 0);
}

/**
 * Generate a fingerprint hash for evidence:
 * SHA-256 of normalized evidence items
 * Used to detect if evidence has changed
 */
import crypto from "crypto";

export function evidenceFingerprint(items: EvidenceItem[]): string {
  try {
    const normalized = items.map((e) => ({
      quote: e.quote,
      start: e.start,
      end: e.end,
    }));

    return crypto
      .createHash("sha256")
      .update(JSON.stringify(normalized), "utf8")
      .digest("hex");
  } catch {
    return "";
  }
}
