// lib/evaluation/helpers.ts

/**
 * Helper utilities for evaluation:
 * - Text normalization
 * - Text trimming
 * - ISO timestamp generation
 * - Format utilities
 * - List comparison
 */

/**
 * Normalize text: remove extra spaces and newlines
 */
export function normalizeText(text: string): string {
  if (!text) return "";
  return text.replace(/\s+/g, " ").replace(/\n+/g, " ").trim();
}

/**
 * Trim text to max length
 */
export function trimLong(text: string, max = 280): string {
  if (!text) return "";
  return text.length > max ? text.substring(0, max) : text;
}

/**
 * Get current ISO timestamp
 */
export function nowISO(): string {
  return new Date().toISOString();
}

/**
 * Format evidence list as strings
 */
export function formatEvidenceList(
  arr: { quote: string; start: number; end: number }[]
): string[] {
  return arr.map((e) => {
    return `"${e.quote}" (position ${e.start} to ${e.end})`;
  });
}

/**
 * Format list with bullet points
 */
export function formatList(arr: string[]): string[] {
  return arr.map((x) => `- ${x}`);
}

/**
 * Deep equality check for arrays
 */
export function listsEqual(a: any[], b: any[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Normalize criterion code (P1, M2, D3 format)
 */
export function normalizeCriterionCode(code: string): string {
  return code.trim().toUpperCase();
}
