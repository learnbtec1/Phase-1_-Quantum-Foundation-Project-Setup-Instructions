"use client";

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { getBackendUrl, readFastApiDetail, shouldSignOutOn401, signOutOnUnauthorized } from "@/lib/api";
import type {
  ConfidenceLabel,
  CriterionResult,
  ExtractedCriterion,
  AssignmentContext,
  CorpusStatus,
  GradeResult,
  PlagiarismSnapshot,
  StoredGrade,
} from "@/lib/types/assessmentResult";
import { fileToBase64 } from "@/lib/fileBase64";
import { parseDocumentToText } from "@/lib/parseFileClient";
import { countWords, POLICY, computeLocalScore, runPolicy, validatePreSubmit } from "@/lib/utils/policy";
import type { PolicyResult } from "@/lib/utils/policy";
import { normalizeGradeResult } from "@/lib/utils/gradeResult";

export type {
  AssignmentContext,
  ConfidenceLabel,
  CriterionResult,
  ExtractedCriterion,
  CorpusStatus,
  GradeResult,
  PlagiarismSnapshot,
  StoredGrade,
};

const LAST_GRADE_KEY = "last-grade";

/** Light API calls (auth, health, etc. if used here). */
const REQUEST_TIMEOUT_DEFAULT_MS = 20_000;
/** Embedding + ANN; allow headroom when not proxied through Next. */
const REQUEST_TIMEOUT_VECTORS_MS = 120_000;
/** RAG + LLM — often 30s–2m+; must exceed any reverse-proxy default (~10s). */
const REQUEST_TIMEOUT_GRADE_MS = 180_000;

function requestTimeoutMs(url: string): number {
  if (url.includes("/assessment/grade")) return REQUEST_TIMEOUT_GRADE_MS;
  if (url.includes("/vectors/search")) return REQUEST_TIMEOUT_VECTORS_MS;
  return REQUEST_TIMEOUT_DEFAULT_MS;
}

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1_000;

/** API shape for POST /assessment/teacher-edit `record` */
export type TeacherEditRecord = {
  patterns?: string[];
  timestamp?: string;
  quality_passed?: boolean;
  quality?: { passed?: boolean; reasons?: string[]; similarity?: number };
  global_scopes_bumped?: string[];
};

export type TeacherEditSaveResult = { ok: boolean; record?: TeacherEditRecord; error?: string };

/** Thrown when safeFetch has already shown a user-facing toast for this failure. */
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

/**
 * Central fetch: AbortController timeout, limited retries (network + timeout only), HTTP 4xx handled without retry.
 * strict: timeout/network terminal errors → error toast, throws UserFacingError
 * soft:  terminal → warning toast, throws UserFacingError (caller continues without failing grade)
 */
async function safeFetch(input: string, init: RequestInit, mode: SafeFetchMode = "strict"): Promise<Response> {
  const maxAttempts = MAX_RETRIES + 1;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeoutMs = requestTimeoutMs(input);
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    let settled = false;

    try {
      const res = await fetch(input, { ...init, signal: controller.signal });
      clearTimeout(timeoutId);
      settled = true;

      if (res.status === 401) {
        const detail = await readFastApiDetail(res);
        if (shouldSignOutOn401(detail)) {
          toast.error("Session expired. Please sign in.");
          signOutOnUnauthorized();
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
      // Server errors: never use the retry loop in `catch` for these — return once (caller may soft-fail).
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

      const retryable = (isAbortError(e) || isNetworkError(e)) && attempt < MAX_RETRIES;
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

type SubmitFail = {
  ok: false;
  reason?: "locked";
  policy?: PolicyResult;
};

type SubmitOk = { ok: true; result: StoredGrade; policy: PolicyResult };

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

/**
 * Map backend EMBEDDING_ERROR / DB_VECTOR_ERROR prefixes to a clear Arabic message.
 * Grading should always continue; corpus similarity is optional metadata.
 */
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

/** Same normalization as the corpus /vectors/search `query` body (dedup key must match). */
export function normalizeStudentWorkForCorpusQuery(studentWork: string): string {
  return studentWork.replace(/\s+/g, " ").trim().slice(0, 12_000);
}

/** Stable short key for deduplicating in-flight corpus searches (djb2). */
function hashCorpusDedupKey(normalizedQuery: string): string {
  let h = 5381;
  for (let i = 0; i < normalizedQuery.length; i++) {
    h = (h * 33) ^ normalizedQuery.charCodeAt(i);
  }
  return (h >>> 0).toString(36);
}

const _corpusSearchInFlight = new Map<string, Promise<CorpusSearchOutcome>>();

/**
 * Coalesces concurrent requests for the same normalized student text to one network call.
 */
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

/**
 * Soft-fail: never blocks grading. `corpusStatus` is `ok` | `fallback` | `unavailable`.
 */
export async function fetchCorpusSearchOutcomeSafe(studentWork: string): Promise<CorpusSearchOutcome> {
  const q = normalizeStudentWorkForCorpusQuery(studentWork);
  if (q.length < 40) {
    return { apiMaxCorpusPercent: null, corpusStatus: "unavailable" };
  }

  const url = getBackendUrl("/api/v1/vectors/search");
  const payload = {
    query: q,
    top_k: 12,
    include_integrity: false,
    count_toward_usage: false,
  };
  let res: Response;
  try {
    res = await safeFetch(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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

/**
 * Textarea + optional uploaded files: same basis as server merge for local policy, corpus, and /grade body.
 * Exported for UI previews (word count / policy) in assessment page.
 */
export async function buildEffectiveStudentWork(
  studentWork: string,
  files: File[] | undefined
): Promise<string> {
  const t = (studentWork || "").trim();
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
      const parsed: unknown = JSON.parse(raw);
      const p =
        typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
          ? (parsed as { plagiarism?: PlagiarismSnapshot; gradedAt?: string })
          : null;
      return normalizeGradeResult(parsed, {
        plagiarism: p?.plagiarism,
        gradedAt: p?.gradedAt,
      }).stored;
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
    async (input: {
      btecUnit: string;
      studentWork: string;
      /** Solution PDF/DOCX/PPTX/txt/md; merged server-side with [FILE: …] markers. */
      submissionFiles?: File[];
      assignmentCriteria: string;
      acknowledgeHighSimilarity: boolean;
      /** Grade / term / subject for context-aware RAG (optional). */
      academicContext?: { grade: string; term: string; subject: string };
    }): Promise<SubmitOk | SubmitFail> => {
      const { btecUnit, studentWork, submissionFiles, assignmentCriteria, acknowledgeHighSimilarity, academicContext } = input;

      const effective = await buildEffectiveStudentWork(studentWork, submissionFiles);
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
            typeof pol.localSimilarityPercent === "number" && Number.isFinite(pol.localSimilarityPercent)
              ? pol.localSimilarityPercent.toFixed(1)
              : "—"
          }% (limit ${POLICY.maxSimilarity}%). Acknowledge to continue.`,
        );
        return { ok: false, policy: pol };
      }

      if (inFlightRef.current) {
        console.warn("Submit blocked: already in progress");
        return { ok: false, reason: "locked" };
      }
      inFlightRef.current = true;
      setLoading(true);

      try {
        const dedupKey = hashCorpusDedupKey(normalizeStudentWorkForCorpusQuery(effective));
        const [corpusOutcome, parts] = await Promise.all([
          dedupFetchCorpusSearch(dedupKey, () => fetchCorpusSearchOutcomeSafe(effective)),
          submissionFiles && submissionFiles.length > 0
            ? Promise.all(
                submissionFiles.map(async (f) => ({
                  filename: f.name || "upload.bin",
                  content_base64: await fileToBase64(f),
                })),
              )
            : Promise.resolve(null),
        ]);

        const gradeUrl = getBackendUrl("/api/v1/assessment/grade");
        const res = await safeFetch(
          gradeUrl,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              btec_unit: btecUnit.trim(),
              student_work: (studentWork || "").trim(),
              ...(parts ? { submission_files: parts } : {}),
              assignment_criteria: assignmentCriteria.trim() || undefined,
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
            }),
          },
          "strict",
        );

        if (!res.ok) {
          if (res.status === 401 || res.status === 400 || res.status === 403) {
            return { ok: false, policy: pol };
          }
          const data = (await res.json().catch(() => ({}))) as { detail?: string };
          const detail = (data as { detail?: string }).detail;
          toast.error(detail || "Something went wrong.");
          return { ok: false, policy: pol };
        }

        const data = (await res.json()) as GradeResult;
        const gradedAt = new Date().toISOString();
        const plagiarism: PlagiarismSnapshot = {
          localPercent: pol.localSimilarityPercent,
          localStatus: pol.localStatus,
          apiMaxCorpusPercent:
            corpusOutcome.apiMaxCorpusPercent != null && Number.isFinite(corpusOutcome.apiMaxCorpusPercent)
              ? corpusOutcome.apiMaxCorpusPercent
              : null,
          corpusStatus: corpusOutcome.corpusStatus,
        };
        const normalized = normalizeGradeResult(data, {
          plagiarism,
          gradedAt,
          wordCount: countWords(effective),
          hasAssignmentCriteria: assignmentCriteria.trim().length > 0,
        });
        if (normalized.isIncomplete) {
          toast.warning("Incomplete grading result — review manually.");
        } else {
          toast.success("Grading complete");
        }
        if (normalized.stored.criteria_undetected) {
          toast.warning("Assignment criteria not detected clearly — add explicit P/M/D lines to the rubric.");
        }
        persistLastGrade(normalized.stored);
        return { ok: true, result: normalized.stored, policy: pol };
      } catch (e) {
        if (e instanceof UserFacingError) {
          return { ok: false, policy: pol };
        }
        console.error(e);
        toast.error("Something went wrong.");
        return { ok: false, policy: pol };
      } finally {
        inFlightRef.current = false;
        setLoading(false);
      }
    },
    [persistLastGrade],
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
      const url = getBackendUrl("/api/v1/assessment/teacher-edit");
      try {
        const res = await safeFetch(
          url,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
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
    submitTeacherEdit,
    loadLastGrade,
    clearLastGrade,
  };
}
