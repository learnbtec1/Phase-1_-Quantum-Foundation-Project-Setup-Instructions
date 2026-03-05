// lib/evaluation/fingerprint.ts

/**
 * Evaluation fingerprinting:
 * 1) Create unique fingerprint from evaluation inputs.
 * 2) Used to detect if evaluation should be re-run or frozen.
 * 3) Components:
 *    - Hash of student answer
 *    - Hash of evidence
 *    - Hash of rubric ID + version
 *    - Hash of system prompt
 *    - Hash of criteria codes
 */

import crypto from "crypto";
import { EvidenceItem } from "./evidence";

export type FingerprintComponents = {
  studentAnswer: string;
  evidence: EvidenceItem[];
  rubricId: string;
  rubricVersion: string;
  systemPrompt: string;
  criteriaCodes: string[];
};

/**
 * SHA-256 hash of any value
 */
export function hash(value: any): string {
  try {
    const txt = typeof value === "string" ? value : JSON.stringify(value);
    return crypto.createHash("sha256").update(txt, "utf8").digest("hex");
  } catch {
    return "";
  }
}

/**
 * Hash of evidence fingerprint
 * Used to detect if evidence has changed
 */
export function evidenceHash(evidence: EvidenceItem[]): string {
  const simplified = evidence.map((e) => ({
    quote: e.quote,
    start: e.start,
    end: e.end,
  }));

  return hash(simplified);
}

/**
 * Hash of normalized student answer
 * Removes extra whitespace and newlines
 */
export function answerHash(answer: string): string {
  const normalized = answer
    .replace(/\s+/g, " ")
    .replace(/\n+/g, " ")
    .trim();

  return hash(normalized);
}

/**
 * Hash of rubric (combines ID and version)
 */
export function rubricHash(rubricId: string, rubricVersion: string): string {
  return hash(`${rubricId}__${rubricVersion}`);
}

/**
 * Hash of criteria codes (P/M/D)
 * Used to detect if criteria set has changed
 */
export function criteriaHash(criteriaCodes: string[]): string {
  return hash(criteriaCodes.sort());
}

/**
 * Hash of system prompt
 * Used to detect if evaluation instructions changed
 */
export function promptHash(prompt: string): string {
  return hash(prompt);
}

/**
 * Create complete evaluation fingerprint
 * Combines hashes of all components
 * Used for freeze logic: if fingerprint matches, skip re-evaluation
 */
export function createEvaluationFingerprint(c: FingerprintComponents): string {
  const combined = {
    answerHash: answerHash(c.studentAnswer),
    evidenceHash: evidenceHash(c.evidence),
    rubricHash: rubricHash(c.rubricId, c.rubricVersion),
    criteriaHash: criteriaHash(c.criteriaCodes),
    promptHash: promptHash(c.systemPrompt),
  };

  return hash(combined);
}
