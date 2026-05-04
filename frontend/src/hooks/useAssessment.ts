"use client";

/**
 * Unified assessment engine (parallel to legacy assessment page flows).
 * Merges Phase-2-style networking (timeouts, corpus soft-fail, /assessment/grade body)
 * with Phase-1 academic normalization + Cogni coaching persistence.
 *
 * Not wired into UI by default — safe to import for staged migration.
 */

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

import type { EvaluationResult } from "@/lib/assessmentNormalize";
import { normalizeIntegratedResult } from "@/lib/assessmentNormalize";
import {
  buildAssessmentCoachingPayload,
  getCogniFocusSubject,
  persistAssessmentCoaching,
} from "@/lib/cogniSessionContext";
import {
  apiBase,
  authHeaders,
  clearAccessToken,
  getAccessToken,
  notifyAuthChanged,
} from "@/lib/auth";
import { fileToBase64 } from "@/lib/fileBase64";
import type { CorpusStatus, GradeResult, PlagiarismSnapshot, StoredGrade } from "@/lib/types/assessmentResult";

import { getStudentIdForEvaluation } from "@/lib/studentDeviceId";

export type {
  CorpusStatus,
  CriterionResult,
  GradeResult,
  PlagiarismSnapshot,
  StoredGrade,
} from "@/lib/types/assessmentResult";

/** --- Inlined similarity (Phase-2 utils) — avoids new util files ------------------------------------------------ */
const WORD = /\S+/g;

function normalizeWords(text: string): string[] {
  return (
    (text || "")
      .toLowerCase()
      .replace(/[\u2018\u2019]/g, "'")
      .match(WORD) ?? []
  );
}

function trigramsFromWords(words: string[]): string[] {
  if (words.length < 3) return [];
  const out: string[] = [];
  for (let i = 0; i <= words.length - 3; i++) {
    out.push(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
  }
  return out;
}

function textTrigramJaccard(a: string, b: string): number {
  const ta = new Set(trigramsFromWords(normalizeWords(a)));
  const tb = new Set(trigramsFromWords(normalizeWords(b)));
  if (ta.size === 0 && tb.size === 0) return 0;
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  ta.forEach((t) => {
    if (tb.has(t)) inter++;
  });
  const union = ta.size + tb.size - inter;
  return union === 0 ? 0 : inter / union;
}

function splitSelfJaccard(student: string): number | null {
  const w = normalizeWords(student);
  if (w.length < 40) return null;
  const mid = Math.floor(w.length / 2);
  const left = w.slice(0, mid).join(" ");
  const right = w.slice(mid).join(" ");
  return textTrigramJaccard(left, right);
}

function localPlagiarismPercent(
  student: string,
  options: { referenceOrCriteria: string } | { useSplitSelf: true },
): number | null {
  if ("useSplitSelf" in options && options.useSplitSelf) {
    const s = splitSelfJaccard(student);
    return s == null ? null : s * 100;
  }
  const r =
    (
      options as {
        referenceOrCriteria: string;
      }
    ).referenceOrCriteria?.trim() ?? "";
  if (r.length >= 30) {
    return textTrigramJaccard(student, r) * 100;
  }
  const s = splitSelfJaccard(student);
  return s == null ? null : s * 100;
}

function similarityStatus(percent: number, max: number): "acceptable" | "high" {
  return percent <= max ? "acceptable" : "high";
}

/** --- Inlined policy (Phase-2 utils) ---------------------------------------------------------------------------- */
export const POLICY = {
  maxSimilarity: 25,
  minWords: 150,
} as const;

export function countWords(text: string): number {
  const t = (text || "").trim();
  if (!t) return 0;
  return t.split(/\s+/).filter(Boolean).length;
}

export type PolicyResult = {
  pass: boolean;
  reasons: string[];
  localSimilarityPercent: number | null;
  localStatus: "acceptable" | "high" | "n/a";
};

export function validatePreSubmit(
  unit: string,
  studentWork: string,
): { ok: boolean; message?: string } {
  const u = (unit || "").trim();
  if (!u) return { ok: false, message: "Select a BTEC unit / criterion." };
  const w = (studentWork || "").trim();
  if (!w) return { ok: false, message: "Student work is required." };
  const n = countWords(w);
  if (n < POLICY.minWords) {
    return {
      ok: false,
      message: `At least ${POLICY.minWords} words required (currently ${n}).`,
    };
  }
  return { ok: true };
}

export function runPolicy(localSimilarityPercent: number | null): PolicyResult {
  const reasons: string[] = [];
  const pct =
    typeof localSimilarityPercent === "number" && Number.isFinite(localSimilarityPercent)
      ? localSimilarityPercent
      : null;
  if (pct == null) {
    reasons.push("Local 3-gram score not computed (add criteria/reference or more text).");
    return { pass: true, reasons, localSimilarityPercent: null, localStatus: "n/a" };
  }
  const st = similarityStatus(pct, POLICY.maxSimilarity);
  if (st === "high") {
    reasons.push(
      `Local n-gram overlap is ${pct.toFixed(1)}% (max ${POLICY.maxSimilarity}% before review).`,
    );
  } else {
    reasons.push(`Local n-gram overlap is ${pct.toFixed(1)}% (within ${POLICY.maxSimilarity}% target).`);
  }
  const pass = st === "acceptable";
  return { pass, reasons, localSimilarityPercent: pct, localStatus: st };
}

export function computeLocalScore(student: string, comparisonText: string): number | null {
  const c = (comparisonText || "").trim();
  const raw =
    c.length >= 30
      ? localPlagiarismPercent(student, { referenceOrCriteria: c })
      : localPlagiarismPercent(student, { useSplitSelf: true });
  if (raw == null) return null;
  return Number.isFinite(raw) ? raw : null;
}

/** --- FastAPI + auth helpers (adapted from Phase-2 lib/api, Cogni Phase-1 tokens) ---------------------------- */
export function normalizeErrorDetail(detail: unknown): string {
  if (detail == null) return "";
  if (typeof detail === "string") return detail.trim();
  if (Array.isArray(detail)) {
    return detail
      .map((x) =>
        typeof x === "object" && x !== null && "msg" in x
          ? String((x as { msg: unknown }).msg)
          : String(x),
      )
      .join(" ")
      .trim();
  }
  return String(detail).trim();
}

export async function readFastApiDetail(res: Response): Promise<string> {
  const j = (await res.clone().json().catch(() => ({}))) as { detail?: unknown };
  return normalizeErrorDetail(j.detail);
}

export function shouldSignOutOn401(detail: string): boolean {
  const s = detail.toLowerCase();
  if (!s) return true;
  if (s.includes("incorrect email or password")) return false;
  if (s.includes("two-factor")) return false;
  return (
    s.includes("not authenticated") ||
    s.includes("invalid or expired") ||
    s.includes("expired token") ||
    s.includes("invalid subject") ||
    s.includes("user not found") ||
    s.includes("could not validate credentials") ||
    s.includes("credentials could not be validated")
  );
}

function signOutOnUnauthorizedPhase1(): void {
  clearAccessToken();
  notifyAuthChanged();
}

/** Direct backend URL (avoids short proxy timeouts for long-running grade / vectors). */
export function getBackendUrl(path: string): string {
  const origin = apiBase().replace(/\/+$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${origin}${p}`;
}

const LAST_GRADE_KEY = "last-grade";

const REQUEST_TIMEOUT_DEFAULT_MS = 20_000;
const REQUEST_TIMEOUT_VECTORS_MS = 120_000;
const REQUEST_TIMEOUT_GRADE_MS = 180_000;

export function requestTimeoutMs(url: string): number {
  if (url.includes("/assessment/grade")) return REQUEST_TIMEOUT_GRADE_MS;
  if (url.includes("/vectors/search")) return REQUEST_TIMEOUT_VECTORS_MS;
  return REQUEST_TIMEOUT_DEFAULT_MS;
}

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1_000;

class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserFacingError";
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAbortError(e: unknown): boolean {
  if (e instanceof DOMException) return e.name === "AbortError";
  if (e instanceof Error) return e.name === "AbortError";
  return false;
}

function isNetworkError(e: unknown): boolean {
  if (e instanceof TypeError) {
    const m = e.message.toLowerCase();
    return m.includes("failed to fetch") || m.includes("network") || m.includes("fetch");
  }
  if (e instanceof Error) {
    const m = e.message.toLowerCase();
    if (m.includes("load failed") || m.includes("network error")) return true;
  }
  return false;
}

type SafeFetchMode = "strict" | "soft";

async function safeFetch(
  input: string,
  init: RequestInit,
  mode: SafeFetchMode = "strict",
): Promise<Response> {
  const maxAttempts = MAX_RETRIES + 1;
  const baseHeaders = new Headers(init.headers as HeadersInit);
  baseHeaders.set("Content-Type", "application/json");

  const auth = authHeaders() as Record<string, string>;
  if (auth.Authorization) baseHeaders.set("Authorization", String(auth.Authorization));

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeoutMs = requestTimeoutMs(input);
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    let settled = false;

    try {
      const res = await fetch(input, { ...init, headers: baseHeaders, signal: controller.signal });
      clearTimeout(timeoutId);
      settled = true;

      if (res.status === 401) {
        const detail = await readFastApiDetail(res);
        if (shouldSignOutOn401(detail)) {
          toast.error("Session expired. Please sign in.");
          signOutOnUnauthorizedPhase1();
        } else {
          console.warn("401 without session-style detail:", detail);
          toast.error(detail || "Unauthorized");
        }
        return res;
      }
      if (res.status === 400 || res.status === 403) {
        const body = (await res.clone().json().catch(() => ({}))) as { detail?: string };
        toast.error(body.detail || "Something went wrong.");
        return res;
      }
      if (res.status >= 500) {
        return res;
      }
      return res;
    } catch (e) {
      clearTimeout(timeoutId);

      if (settled) {
        if (e instanceof UserFacingError) throw e;
        if (mode === "soft") {
          toast.warning("Corpus similarity could not be loaded; grading still runs.");
        } else {
          toast.error("Something went wrong.");
        }
        throw new UserFacingError("http-parse");
      }

      const retryable =
        (isAbortError(e) || isNetworkError(e)) && attempt < MAX_RETRIES;
      if (retryable) {
        await delay(RETRY_DELAY_MS);
        continue;
      }

      if (isAbortError(e)) {
        if (mode === "soft") {
          toast.warning("Corpus check timed out. Grading continues without corpus match.");
        } else {
          toast.error("Request timed out. Please try again.");
        }
        throw new UserFacingError("Request timeout");
      }

      if (isNetworkError(e)) {
        if (mode === "soft") {
          toast.warning("Corpus check failed (network). Grading continues without corpus match.");
        } else {
          toast.error("Network error. Check connection.");
        }
        throw new UserFacingError("Network error");
      }

      if (mode === "soft") {
        toast.warning("Corpus similarity could not be loaded; grading still runs.");
        throw new UserFacingError("corpus other");
      }
      toast.error("Something went wrong.");
      throw new UserFacingError("unknown");
    }
  }
  toast.error("Something went wrong.");
  throw new UserFacingError("exhausted");
}

export type TeacherEditRecord = {
  patterns?: string[];
  timestamp?: string;
  quality_passed?: boolean;
  quality?: { passed?: boolean; reasons?: string[]; similarity?: number };
  global_scopes_bumped?: string[];
};

export type TeacherEditSaveResult = { ok: boolean; record?: TeacherEditRecord; error?: string };

type SubmitFail = {
  ok: false;
  reason?: "locked";
  policy?: PolicyResult;
};

type SubmitOk = { ok: true; result: StoredGrade; policy: PolicyResult };

export type UnifiedSubmitAssessmentOk = SubmitOk & {
  normalizedEvaluation: EvaluationResult;
  coachingApplied: boolean;
};

export type UnifiedSubmitAssessmentResult =
  | SubmitFail
  | Omit<UnifiedSubmitAssessmentOk, "ok"> & { ok: true };

type VectorHit = { similarity: number };

const CORPUS_USER_TOAST_THROTTLE_MS = 5_000;
let lastCorpusUserToastAt = 0;

function throttledCorpusUserToast(run: () => void) {
  const now = Date.now();
  if (now - lastCorpusUserToastAt > CORPUS_USER_TOAST_THROTTLE_MS) {
    run();
    lastCorpusUserToastAt = now;
  }
}

function toastCorpusVectorFailure(detail: string) {
  throttledCorpusUserToast(() => {
    const d = detail || "";
    if (d.includes("EMBEDDING_ERROR")) {
      toast.error(
        "تعذر الاتصال بخدمة التضمين (OpenAI). يُكمل التقييم بدون مقارنة النص مع الـ corpus.",
      );
    } else if (d.includes("DB_VECTOR_ERROR")) {
      toast.error("تعذر الوصول لقاعدة البيانات (pgvector). يُكمل التقييم بدون مقارنة مع الـ corpus.");
    } else {
      toast.error("تعذر إجراء المقارنة مع الـ corpus. يُكمل التقييم بشكل طبيعي.");
    }
  });
}

export type CorpusSearchOutcome = {
  apiMaxCorpusPercent: number | null;
  corpusStatus: CorpusStatus;
};

export function normalizeStudentWorkForCorpusQuery(studentWork: string): string {
  return studentWork.replace(/\s+/g, " ").trim().slice(0, 12_000);
}

/** Stable short key for deduplicating in-flight corpus searches (djb2). */
export function hashCorpusDedupKey(normalizedQuery: string): string {
  let h = 5381;
  for (let i = 0; i < normalizedQuery.length; i++) {
    h = (h * 33) ^ normalizedQuery.charCodeAt(i);
  }
  return (h >>> 0).toString(36);
}

const _corpusSearchInFlight = new Map<string, Promise<CorpusSearchOutcome>>();

export function dedupFetchCorpusSearch(
  key: string,
  fn: () => Promise<CorpusSearchOutcome>,
): Promise<CorpusSearchOutcome> {
  const existing = _corpusSearchInFlight.get(key);
  if (existing) return existing;
  const p = fn().finally(() => {
    _corpusSearchInFlight.delete(key);
  });
  _corpusSearchInFlight.set(key, p);
  return p;
}

export async function fetchCorpusSearchOutcomeSafe(
  studentWork: string,
): Promise<CorpusSearchOutcome> {
  const q = normalizeStudentWorkForCorpusQuery(studentWork);
  if (q.length < 40) {
    return { apiMaxCorpusPercent: null, corpusStatus: "unavailable" };
  }

  const url = getBackendUrl("/api/v1/vectors/search");
  const payload = { query: q, top_k: 12, include_integrity: false };
  let res: Response;
  try {
    res = await safeFetch(
      url,
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
      "soft",
    );
  } catch (e) {
    console.warn("Corpus search failed, continue grading", e);
    return { apiMaxCorpusPercent: null, corpusStatus: "unavailable" };
  }

  if (res.status === 401) {
    return { apiMaxCorpusPercent: null, corpusStatus: "unavailable" };
  }
  if (res.status === 503) {
    const detail = await readFastApiDetail(res);
    toastCorpusVectorFailure(detail);
    return { apiMaxCorpusPercent: null, corpusStatus: "unavailable" };
  }
  if (res.status >= 500) {
    const detail = await readFastApiDetail(res);
    toastCorpusVectorFailure(detail);
    return { apiMaxCorpusPercent: null, corpusStatus: "unavailable" };
  }
  if (!res.ok) {
    const d = (await res.json().catch(() => ({}))) as { detail?: string };
    throttledCorpusUserToast(() => {
      toast.warning(d.detail || "تعذر تحميل تشابه الـ corpus؛ يستمر التقييم.");
    });
    return { apiMaxCorpusPercent: null, corpusStatus: "unavailable" };
  }

  let out: { results?: VectorHit[]; fallback?: boolean };
  try {
    out = (await res.json()) as { results?: VectorHit[]; fallback?: boolean };
  } catch {
    throttledCorpusUserToast(() => {
      toast.warning("تعذر قراءة نتيجة الـ corpus؛ يستمر التقييم.");
    });
    return { apiMaxCorpusPercent: null, corpusStatus: "unavailable" };
  }

  if (out.fallback) {
    throttledCorpusUserToast(() => {
      toast.info("تم التقييم دون مقارنة متقدمة بمكتبة النصوص (embedding)؛ يُكمَل التقييم بشكل طبيعي.");
    });
    return { apiMaxCorpusPercent: null, corpusStatus: "fallback" };
  }

  const results = out.results || [];
  if (results.length === 0) {
    return { apiMaxCorpusPercent: null, corpusStatus: "ok" };
  }
  const scaled = results
    .map((r) => {
      const s = r?.similarity;
      if (s == null || !Number.isFinite(s)) return null;
      return s * 100;
    })
    .filter((v): v is number => v != null);
  if (scaled.length === 0) {
    return { apiMaxCorpusPercent: null, corpusStatus: "ok" };
  }
  return {
    apiMaxCorpusPercent: Math.max(...scaled),
    corpusStatus: "ok",
  };
}

/** Phase-2-compatible file → text bridge; Phase-1 prefers `/api/extract-text`. */
export async function parseDocumentToText(file: File): Promise<string> {
  const name = (file.name || "").toLowerCase();
  if (name.endsWith(".txt") || name.endsWith(".md")) {
    return new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result ?? ""));
      fr.onerror = () => reject(fr.error ?? new Error("read failed"));
      fr.readAsText(file);
    });
  }

  try {
    const fdTry = new FormData();
    fdTry.append("file", file, file.name);
    const pf = await fetch("/api/parse-file", {
      method: "POST",
      headers: { ...authHeaders() },
      body: fdTry,
    });
    if (pf.ok) {
      const j = (await pf.json().catch(() => ({}))) as { text?: string };
      if (typeof j.text === "string" && j.text.trim()) return j.text.trim();
    }
  } catch {
    /* optional route — ignore */
  }

  const fd = new FormData();
  fd.append("files", file, file.name);
  const res = await fetch("/api/extract-text", {
    method: "POST",
    headers: { ...authHeaders() },
    body: fd,
  });
  if (!res.ok) {
    throw new Error(`extract-text failed: ${res.status}`);
  }
  const data = (await res.json().catch(() => ({}))) as { text?: string };
  return typeof data.text === "string" ? data.text.trim() : "";
}

export async function buildEffectiveStudentWork(studentWork: string, files: File[] | undefined): Promise<string> {
  const t = (studentWork || "").trim();
  if (process.env.NODE_ENV === "development" && t.length > 0) {
    logAssessmentContractDev(
      files?.length
        ? "buildEffectiveStudentWork: non-empty studentWork with files merges two sources — prefer contentSource=\"files\" and pass \"\"."
        : "buildEffectiveStudentWork: non-empty studentWork — ensure this is intentional (grade path uses \"\" when uploads are authoritative).",
    );
  }
  if (!files?.length) return t;
  const parts: string[] = [];
  for (const f of files) {
    try {
      const x = await parseDocumentToText(f);
      if (x.trim()) parts.push(x.trim());
    } catch {
      /* skip unreadable */
    }
  }
  if (parts.length && t) return `${parts.join("\n\n")}\n\n${t}`;
  if (parts.length) return parts.join("\n\n");
  return t;
}

/** Dev-only: catch accidental double-pastes / merged duplicates without blocking submit. */
function warnEffectivePossibleDuplication(text: string): void {
  if (process.env.NODE_ENV !== "development") return;
  const s = text.trim();
  if (s.length < 400) return;
  const needleLen = Math.min(140, Math.floor(s.length / 5));
  if (needleLen < 48) return;
  const needle = s.slice(0, needleLen);
  const idx2 = s.indexOf(needle, needleLen);
  if (idx2 !== -1) {
    console.warn(
      "[useAssessment] effective may contain a duplicated long segment — review merged content.",
    );
  }
}

function snapshotStoredGrade(
  data: GradeResult,
  plagiarism: PlagiarismSnapshot,
  gradedAt: string,
): StoredGrade {
  return { ...(data as GradeResult), plagiarism, gradedAt };
}

/** Map API grade shape → forensic-style payload for Phase-1 normalization. */
function evaluationPayloadFromStoredGrade(sg: StoredGrade): unknown {
  const ext = sg as StoredGrade &
    GradeResult & { criteria?: unknown; consolidated_summary?: string };
  const cr = sg.criteria_results;
  if (ext.criteria && typeof ext.criteria === "object" && ext.criteria !== null && !Array.isArray(ext.criteria)) {
    return {
      criteria: ext.criteria,
      final_grade: sg.grade_band ?? (ext as { final_grade?: string }).final_grade,
      consolidated_summary:
        typeof ext.consolidated_summary === "string"
          ? ext.consolidated_summary
          : sg.rationale,
      summary:
        typeof (ext as { summary?: unknown }).summary === "string"
          ? (ext as { summary: string }).summary
          : sg.rationale,
    };
  }

  const rows = Array.isArray(cr) ? cr : [];
  if (!rows.length) {
    return {
      criteria: {},
      final_grade: sg.grade_band ?? "PENDING",
      consolidated_summary: sg.rationale ?? "",
    };
  }

  return {
    criteria: rows.map((row) => ({
      code: row.code,
      achieved: row.achieved,
      verdict: row.achieved ? "Achieved" : "Not Achieved",
      reasons: row.justification ? [String(row.justification)] : [],
      evidence: (row.evidence || []).map((q) => ({
        quote: String(q),
        start: 0,
        end: String(q).length,
      })),
      recommendations: row.improvement_hint ? [String(row.improvement_hint)] : [],
    })),
    final_grade: sg.grade_band ?? "PENDING",
    consolidated_summary: sg.rationale ?? "",
  };
}

/**
 * Source of graded student narrative for submissions.
 *
 * - `text`: Use **textarea only** (`studentWork`). Uploaded files must not participate; `submission_files` is never sent.
 * - `files`: Use **uploads only** (`submissionFiles`). `studentWork` should be blank at the grading boundary; parsed file text feeds `effective`.
 * - `auto`: If `submissionFiles` has entries, behaves like **`files`**; otherwise like **`text`**. Omit this field for the same legacy behavior.
 */
export type AssessmentContentSource = "text" | "files" | "auto";

export type SubmitGradeInput = {
  btecUnit: string;
  studentWork: string;
  submissionFiles?: File[];
  /** Omit or `auto`: files-only merge when blobs exist; otherwise textarea. Overrides must be explicit from UI when both exist. */
  contentSource?: AssessmentContentSource;
  assignmentCriteria: string;
  acknowledgeHighSimilarity: boolean;
  academicContext?: { grade: string; term: string; subject: string };
};

export type SubmitAssessmentInput = SubmitGradeInput & {
  subjectLabel?: string;
  /** Defaults true — writes Cogni coaching via `persistAssessmentCoaching`. */
  persistCoaching?: boolean;
};

const GRADE_CONTRACT_RETRY_STATUSES = new Set([400, 422]);

function logAssessmentContractDev(message: string, detail?: unknown): void {
  if (process.env.NODE_ENV !== "development") return;
  if (detail === undefined) {
    console.warn(`[useAssessment] ${message}`);
  } else {
    console.warn(`[useAssessment] ${message}`, detail);
  }
}

/**
 * Backend `GradePayload` (Forensic) expects `assignment_text` + `student_text`.
 * Preserves Phase-2 field names alongside so future APIs can consume them — unknown keys are ignored by FastAPI/Pydantic.
 */
export function adaptToBackendPayload(
  input: SubmitGradeInput,
  effectiveStudentWork: string,
  studentId: string | undefined,
): Record<string, unknown> {
  const unitLine = input.btecUnit.trim();
  const criteria = input.assignmentCriteria.trim();
  const assignment_text = [unitLine, criteria].filter(Boolean).join("\n");
  const body: Record<string, unknown> = {
    assignment_text,
    student_text: effectiveStudentWork.trim(),
    btec_unit: unitLine || undefined,
    /** Same narrative as `student_text` / `effective` — avoids diverging from UI-only `studentWork`. */
    student_work: effectiveStudentWork.trim(),
    assignment_criteria: criteria || undefined,
  };
  if (studentId) body.student_id = studentId;
  if (
    input.academicContext &&
    (input.academicContext.grade || input.academicContext.term || input.academicContext.subject)
  ) {
    body.academic_context = {
      grade: input.academicContext.grade,
      term: input.academicContext.term,
      subject: input.academicContext.subject,
    };
  }
  return body;
}

export function useAssessment() {
  const [loading, setLoading] = useState(false);
  const inFlightRef = useRef(false);

  const persistLastGrade = useCallback((r: StoredGrade) => {
    try {
      localStorage.setItem(LAST_GRADE_KEY, JSON.stringify(r));
    } catch {
      /* ignore */
    }
  }, []);

  const loadLastGrade = useCallback((): StoredGrade | null => {
    try {
      const raw = localStorage.getItem(LAST_GRADE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as StoredGrade;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
      return null;
    } catch {
      return null;
    }
  }, []);

  const clearLastGrade = useCallback(() => {
    try {
      localStorage.removeItem(LAST_GRADE_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const submitGrade = useCallback(
    async (input: SubmitGradeInput): Promise<SubmitOk | SubmitFail> => {
      const {
        btecUnit,
        studentWork,
        submissionFiles: rawSubmissionFiles,
        contentSource,
        assignmentCriteria,
        acknowledgeHighSimilarity,
        academicContext,
      } = input;

      let submissionFiles = rawSubmissionFiles;
      if (contentSource === "text") {
        submissionFiles = undefined;
      }

      const mode: AssessmentContentSource = contentSource ?? "auto";

      if (
        process.env.NODE_ENV === "development" &&
        contentSource === "text" &&
        rawSubmissionFiles != null &&
        rawSubmissionFiles.length > 0
      ) {
        console.warn(
          "[useAssessment] Files provided but ignored when contentSource is 'text'; change contentSource or strip files.",
        );
      }

      let effective: string;
      if (mode === "files") {
        effective =
          submissionFiles != null && submissionFiles.length > 0
            ? await buildEffectiveStudentWork("", submissionFiles)
            : "";
      } else if (mode === "text") {
        effective = (studentWork || "").trim();
      } else {
        if (submissionFiles != null && submissionFiles.length > 0) {
          effective = await buildEffectiveStudentWork("", submissionFiles);
        } else {
          effective = (studentWork || "").trim();
        }
      }
      const pre = validatePreSubmit(btecUnit, effective);
      if (!pre.ok) {
        toast.error(pre.message ?? "Validation failed");
        return { ok: false };
      }

      const localPct = computeLocalScore(effective, assignmentCriteria);
      const pol = runPolicy(localPct);

      if (!pol.pass && !acknowledgeHighSimilarity) {
        toast.error(
          `Local 3-gram overlap is ${
            typeof pol.localSimilarityPercent === "number" &&
            Number.isFinite(pol.localSimilarityPercent)
              ? pol.localSimilarityPercent.toFixed(1)
              : "—"
          }% (limit ${POLICY.maxSimilarity}%). Acknowledge to continue.`,
        );
        return { ok: false, policy: pol };
      }

      if (!getAccessToken()) {
        toast.error("Not signed in");
        return { ok: false };
      }

      if (inFlightRef.current) {
        console.warn("Submit blocked: already in progress");
        return { ok: false, reason: "locked" };
      }
      inFlightRef.current = true;
      setLoading(true);

      try {
        warnEffectivePossibleDuplication(effective);

        const shouldSendFiles = mode !== "text" && submissionFiles != null && submissionFiles.length > 0;

        const dedupKey = hashCorpusDedupKey(normalizeStudentWorkForCorpusQuery(effective));
        const [corpusOutcome, parts] = await Promise.all([
          dedupFetchCorpusSearch(dedupKey, () => fetchCorpusSearchOutcomeSafe(effective)),
          shouldSendFiles && submissionFiles
            ? Promise.all(
                submissionFiles.map(async (f) => ({
                  filename: f.name || "upload.bin",
                  content_base64: await fileToBase64(f),
                })),
              )
            : Promise.resolve(null),
        ]);

        const gradeUrl = getBackendUrl("/api/v1/assessment/grade");
        const sid = getStudentIdForEvaluation();

        const phaseTwoPayload: Record<string, unknown> = {
          btec_unit: btecUnit.trim(),
          student_work: effective.trim(),
          ...(parts ? { submission_files: parts } : {}),
          assignment_criteria: assignmentCriteria.trim() || undefined,
          ...(sid ? { student_id: sid } : {}),
          ...(academicContext &&
          (academicContext.grade || academicContext.term || academicContext.subject)
            ? {
                academic_context: {
                  grade: academicContext.grade,
                  term: academicContext.term,
                  subject: academicContext.subject,
                },
              }
            : {}),
        };

        const postGrade = (payload: Record<string, unknown>) =>
          safeFetch(gradeUrl, { method: "POST", body: JSON.stringify(payload) }, "strict");

        logAssessmentContractDev("POST grade (phase-2 shape)", { keys: Object.keys(phaseTwoPayload) });

        let res = await postGrade(phaseTwoPayload);

        if (GRADE_CONTRACT_RETRY_STATUSES.has(res.status)) {
          const peek = await res.clone().json().catch(() => ({}));
          logAssessmentContractDev(`grade rejected (${res.status}), retry forensic shape`, peek);
          const adaptedPayload = adaptToBackendPayload(
            {
              btecUnit,
              studentWork,
              submissionFiles,
              assignmentCriteria,
              acknowledgeHighSimilarity,
              academicContext,
            },
            effective,
            sid || undefined,
          );
          logAssessmentContractDev("POST grade (adapted shape)", {
            keys: Object.keys(adaptedPayload),
            assignmentLen:
              typeof adaptedPayload.assignment_text === "string"
                ? (adaptedPayload.assignment_text as string).length
                : null,
          });
          res = await postGrade(adaptedPayload);
          logAssessmentContractDev("adapted POST status", res.status);
        }

        if (!res.ok) {
          if (res.status === 401 || res.status === 400 || res.status === 403) {
            return { ok: false, policy: pol };
          }
          const data = (await res.json().catch(() => ({}))) as { detail?: string };
          toast.error(data.detail || "Something went wrong.");
          return { ok: false, policy: pol };
        }

        const data = (await res.json()) as GradeResult;
        const gradedAt = new Date().toISOString();
        const plagiarism: PlagiarismSnapshot = {
          localPercent: pol.localSimilarityPercent,
          localStatus: pol.localStatus,
          apiMaxCorpusPercent:
            corpusOutcome.apiMaxCorpusPercent != null &&
            Number.isFinite(corpusOutcome.apiMaxCorpusPercent)
              ? corpusOutcome.apiMaxCorpusPercent
              : null,
          corpusStatus: corpusOutcome.corpusStatus,
        };
        const stored = snapshotStoredGrade(data, plagiarism, gradedAt);

        const fg =
          typeof (data as { final_grade?: string }).final_grade === "string"
            ? (data as { final_grade: string }).final_grade
            : undefined;
        const hasCriteriaRows =
          Array.isArray(stored.criteria_results) && stored.criteria_results.length > 0;
        const critObj = (stored as StoredGrade & { criteria?: unknown }).criteria;
        const hasCriteriaObject =
          critObj !== null &&
          typeof critObj === "object" &&
          !Array.isArray(critObj) &&
          Object.keys(critObj as object).length > 0;
        let isIncomplete = !hasCriteriaRows && !hasCriteriaObject && !fg;
        if (fg === "ERROR") isIncomplete = true;
        if (
          typeof (stored as StoredGrade & { error?: unknown }).error === "string" &&
          String((stored as { error?: string }).error).trim()
        ) {
          isIncomplete = true;
        }
        if (!hasCriteriaObject) {
          if (isIncomplete) {
            toast.warning("Incomplete grading result — review manually.");
          } else {
            toast.success("Grading complete");
          }
          if (stored.criteria_undetected) {
            toast.warning(
              "Assignment criteria not detected clearly — add explicit P/M/D lines to the rubric.",
            );
          }
        } else {
          toast.success("Grading complete");
        }
        persistLastGrade(stored);
        return { ok: true, result: stored, policy: pol };
      } catch (e) {
        if (e instanceof UserFacingError) {
          return { ok: false, policy: localPct !== null ? pol : undefined };
        }
        console.error(e);
        toast.error("Something went wrong.");
        const polCatch = runPolicy(localPct ?? null);
        return { ok: false, policy: polCatch };
      } finally {
        inFlightRef.current = false;
        setLoading(false);
      }
    },
    [persistLastGrade],
  );

  /** Unified entry — Phase-2 POST + Phase-1 `normalizeIntegratedResult` + Cogni coaching. */
  const submitAssessment = useCallback(
    async (input: SubmitAssessmentInput): Promise<UnifiedSubmitAssessmentResult> => {
      const base = await submitGrade(input);
      if (!base.ok) return base;

      const normalizedEvaluation = normalizeIntegratedResult(evaluationPayloadFromStoredGrade(base.result));
      const subject =
        (input.subjectLabel || "").trim() ||
        getCogniFocusSubject() ||
        "—";

      let coachingApplied = false;
      if (input.persistCoaching !== false) {
        persistAssessmentCoaching(buildAssessmentCoachingPayload(normalizedEvaluation, subject));
        coachingApplied = true;
      }

      return {
        ok: true,
        result: base.result,
        policy: base.policy,
        normalizedEvaluation,
        coachingApplied,
      };
    },
    [submitGrade],
  );

  const submitTeacherEdit = useCallback(
    async (input: {
      originalText: string;
      aiSuggestion: string;
      teacherEditedText: string;
      gradeBand: string;
      targetBand: string;
      assignmentType: string;
    }): Promise<TeacherEditSaveResult> => {
      if (!getAccessToken()) {
        toast.error("Not signed in");
        return { ok: false };
      }
      const url = getBackendUrl("/api/v1/assessment/teacher-edit");
      try {
        const res = await safeFetch(
          url,
          {
            method: "POST",
            body: JSON.stringify({
              original_text: input.originalText,
              ai_suggestion: input.aiSuggestion,
              teacher_edited_text: input.teacherEditedText,
              grade_band: input.gradeBand,
              target_band: input.targetBand,
              assignment_type: input.assignmentType,
            }),
          },
          "strict",
        );
        if (!res.ok) {
          if (res.status === 401 || res.status === 400 || res.status === 403) {
            return { ok: false };
          }
          const data = (await res.json().catch(() => ({}))) as { detail?: string };
          toast.error(data.detail || "Request failed");
          return { ok: false };
        }
        const data = (await res.json()) as {
          ok?: boolean;
          record?: TeacherEditRecord;
          error?: string;
          message?: string;
        };
        if (!data.ok) {
          toast.error(data.message || data.error || "Could not save teacher edit");
          return { ok: false, record: data.record };
        }
        return { ok: true, record: data.record };
      } catch (e) {
        if (e instanceof UserFacingError) return { ok: false };
        console.error(e);
        toast.error("Something went wrong.");
        return { ok: false };
      }
    },
    [],
  );

  return {
    loading,
    submitGrade,
    submitAssessment,
    submitTeacherEdit,
    loadLastGrade,
    clearLastGrade,
  };
}
