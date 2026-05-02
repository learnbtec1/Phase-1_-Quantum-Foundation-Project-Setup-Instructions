import { POLICY } from "@/lib/utils/policy";
import type {
  AssignmentContext,
  AssignmentSpecBrief,
  AssignmentSpecPayload,
  ConfidenceLabel,
  CorpusStatus,
  CriterionResult,
  ExtractedCriterion,
  PlagiarismSnapshot,
  StoredGrade,
  StudentImprovementPayload,
} from "@/lib/types/assessmentResult";

const DEFAULT_RATIONALE = "No explanation provided.";

export type { ConfidenceLabel, CorpusStatus } from "@/lib/types/assessmentResult";
export type PlagiarismOverallStatus = "safe" | "review" | "high_risk";

/** Unifies new `corpusStatus` with legacy `corpusUsed` / `corpusFallback` from localStorage. */
export function resolveCorpusStatus(p: PlagiarismSnapshot | undefined): CorpusStatus | undefined {
  if (!p) return undefined;
  if (p.corpusStatus) return p.corpusStatus;
  if (p.corpusFallback) return "fallback";
  if (p.corpusUsed === true) return "ok";
  if (p.corpusUsed === false) return "unavailable";
  return undefined;
}

function safeText(s: unknown, fallback: string): string {
  if (s == null) return fallback;
  const t = String(s).replace(/\s+/g, " ").trim();
  return t.length > 0 ? t : fallback;
}

/** Match backend PASS0 criterion key to row code (exact or normalized). */
function minimumAcceptableFromSpec(code: string, spec: AssignmentSpecPayload | undefined): string | undefined {
  if (!spec || spec.assignment_spec_ok !== true) return undefined;
  const crit = spec.criteria;
  if (!crit || typeof crit !== "object") return undefined;
  if (Object.prototype.hasOwnProperty.call(crit, code)) {
    const row = (crit as Record<string, { minimum_acceptable?: string }>)[code];
    const m = row?.minimum_acceptable;
    if (m && String(m).trim()) return String(m).trim();
  }
  const cu = code.toUpperCase().replace(/\s/g, "");
  for (const k of Object.keys(crit)) {
    if (k.toUpperCase().replace(/\s/g, "") === cu) {
      const row = (crit as Record<string, { minimum_acceptable?: string }>)[k];
      const m = row?.minimum_acceptable;
      if (m && String(m).trim()) return String(m).trim();
    }
  }
  return undefined;
}

function toStringList(v: unknown): string[] {
  if (v == null) return [];
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => (x == null ? "" : String(x).replace(/\s+/g, " ").trim()))
    .filter((x) => x.length > 0);
}

type RawSource = { source_file?: string; relevance?: number };

function toCitedSources(v: unknown): { source_file?: string; relevance?: number }[] {
  if (v == null) return [];
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => {
      if (x == null || typeof x !== "object") return null;
      const o = x as RawSource;
      const f = o.source_file != null ? String(o.source_file) : undefined;
      const r = typeof o.relevance === "number" && !Number.isNaN(o.relevance) ? o.relevance : undefined;
      return { source_file: f, relevance: r };
    })
    .filter((x) => x != null) as { source_file?: string; relevance?: number }[];
}

function toRecord(raw: unknown): Record<string, unknown> | null {
  if (raw == null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as Record<string, unknown>;
}

function toCriterionResults(v: unknown): CriterionResult[] {
  if (v == null || !Array.isArray(v)) return [];
  return v
    .map((row) => {
      if (row == null || typeof row !== "object") return null;
      const o = row as Record<string, unknown>;
      const code = String(o.code ?? "").trim();
      if (!code) return null;
      const ev = o.evidence;
      const evList = Array.isArray(ev)
        ? ev.map((e) => String(e).trim()).filter((s) => s.length > 0)
        : [];
      const itemsRaw = o.evidence_items;
      const evidence_items =
        Array.isArray(itemsRaw) && itemsRaw.length > 0
          ? (itemsRaw
              .map((it) => {
                if (it == null || typeof it !== "object") return null;
                const p = it as Record<string, unknown>;
                const quote = String(p.quote ?? p.text ?? "").trim();
                const source_file = String(p.source_file ?? p.file ?? "").trim();
                if (!quote) return null;
                return { quote, source_file };
              })
              .filter((x) => x != null) as { quote: string; source_file: string }[])
          : undefined;
      const w = String(o.why_higher_tier_excluded ?? "").replace(/\s+/g, " ").trim();
      const cogl = String(o.observed_cognitive_level ?? "")
        .replace(/\s+/g, " ")
        .trim();
      const out: CriterionResult = {
        code,
        achieved: Boolean(o.achieved),
        justification: String(o.justification ?? "No justification provided.").replace(/\s+/g, " ").trim(),
        evidence: evList,
      };
      const rc = o.confidence;
      if (typeof rc === "number" && !Number.isNaN(rc)) out.confidence = rc;
      if (evidence_items && evidence_items.length > 0) out.evidence_items = evidence_items;
      if (w) out.why_higher_tier_excluded = w;
      if (cogl) out.observed_cognitive_level = cogl;
      const mam = o.meets_assignment_minimum;
      if (mam === null) out.meets_assignment_minimum = null;
      else if (typeof mam === "boolean") out.meets_assignment_minimum = mam;
      const wya = String(o.why_achieved ?? "").replace(/\s+/g, " ").trim();
      if (wya) out.why_achieved = wya.slice(0, 2000);
      const wna = String(o.why_not_achieved ?? "").replace(/\s+/g, " ").trim();
      if (wna) out.why_not_achieved = wna.slice(0, 2000);
      const ih = String(o.improvement_hint ?? "").replace(/\s+/g, " ").trim();
      if (ih) out.improvement_hint = ih.slice(0, 2000);
      const cre = o.confidence_reason;
      if (Array.isArray(cre) && cre.length > 0) {
        out.confidence_reason = cre
          .map((x) => String(x).trim())
          .filter((s) => s.length > 0)
          .slice(0, 20);
      }
      const csum = o.confidence_summary_ar;
      if (Array.isArray(csum) && csum.length > 0) {
        out.confidence_summary_ar = csum
          .map((x) => String(x).trim())
          .filter((s) => s.length > 0)
          .slice(0, 5);
      }
      return out;
    })
    .filter((x): x is CriterionResult => x != null);
}

function toExtracted(v: unknown): ExtractedCriterion[] {
  if (v == null || !Array.isArray(v)) return [];
  return v
    .map((row) => {
      if (row == null || typeof row !== "object") return null;
      const o = row as Record<string, unknown>;
      const code = String(o.code ?? "").trim();
      if (!code) return null;
      return {
        code,
        description: String(o.description ?? "").replace(/\s+/g, " ").trim() || "—",
      };
    })
    .filter((x) => x != null) as ExtractedCriterion[];
}

function toAssignmentContext(v: unknown): AssignmentContext {
  const d = (v && typeof v === "object" && !Array.isArray(v) ? v : {}) as Record<string, unknown>;
  const t = (k: string) => String(d[k] ?? "").replace(/\s+/g, " ").trim();
  return {
    scenario: t("scenario") || "—",
    task: t("task") || "—",
    expected_outcomes: t("expected_outcomes") || "—",
    criteria_summary: t("criteria_summary") || "—",
  };
}

/** +1 each for real rationale, strengths, improvements, sources, and criterion table from the API payload. */
export function gradeConfidenceFromRaw(raw: Record<string, unknown> | null): { score: number; label: ConfidenceLabel } {
  if (!raw) {
    return { score: 0, label: "Low" };
  }
  const r = String(raw.rationale ?? "").replace(/\s+/g, " ").trim();
  let score = 0;
  if (r.length > 0) score += 1;
  if (Array.isArray(raw.strengths) && raw.strengths.length > 0) score += 1;
  if (Array.isArray(raw.improvements) && raw.improvements.length > 0) score += 1;
  if (Array.isArray(raw.cited_sources) && raw.cited_sources.length > 0) score += 1;
  if (Array.isArray(raw.criteria_results) && raw.criteria_results.length > 0) score += 1;
  const label: ConfidenceLabel = score >= 4 ? "High" : score >= 2 ? "Medium" : "Low";
  return { score, label };
}

/**
 * Recovers confidence from a persisted, normalized `StoredGrade` (no original API object).
 */
export function confidenceFromStored(s: StoredGrade): { score: number; label: ConfidenceLabel } {
  if (typeof s.confidenceScore === "number" && s.confidenceLabel) {
    return { score: s.confidenceScore, label: s.confidenceLabel };
  }
  let score = 0;
  if (s.rationale && s.rationale !== DEFAULT_RATIONALE) score += 1;
  if (s.strengths && s.strengths.length > 0) score += 1;
  if (s.improvements && s.improvements.length > 0) score += 1;
  if (s.cited_sources && s.cited_sources.length > 0) score += 1;
  if (s.criteria_results && s.criteria_results.length > 0) score += 1;
  const label: ConfidenceLabel = score >= 4 ? "High" : score >= 2 ? "Medium" : "Low";
  return { score, label };
}

/**
 * If either local or corpus is above the policy max → "review" or "high_risk" by severity.
 */
export function plagiarismOverallStatus(
  plagiarism: PlagiarismSnapshot | undefined,
  maxSimilarity: number = POLICY.maxSimilarity,
): { status: PlagiarismOverallStatus; localPct: number | null; corpusPct: number | null } {
  const local = plagiarism?.localPercent ?? null;
  const corpus = plagiarism?.apiMaxCorpusPercent ?? null;

  const over = (v: number | null) => v != null && v > maxSimilarity;
  const localOver = over(local);
  const corpusOver = over(corpus);
  const SEVERE = 50;
  const veryHigh = (v: number | null) => v != null && v >= SEVERE;

  if (veryHigh(local) || veryHigh(corpus) || (localOver && corpusOver)) {
    return { status: "high_risk", localPct: local, corpusPct: corpus };
  }
  if (localOver || corpusOver) {
    return { status: "review", localPct: local, corpusPct: corpus };
  }
  return { status: "safe", localPct: local, corpusPct: corpus };
}

export function buildSmartContextMessages(ctx: {
  localPercent: number | null;
  hasAssignmentCriteria: boolean;
  wordCount: number;
  minWords: number;
}): string[] {
  const out: string[] = [];
  if (ctx.localPercent != null && ctx.localPercent > POLICY.maxSimilarity) {
    out.push("Answer may not be original (high text overlap).");
  }
  if (ctx.wordCount < ctx.minWords) {
    out.push("Response may be insufficient (below minimum word count).");
  }
  if (!ctx.hasAssignmentCriteria) {
    out.push("Evaluation may be incomplete (no assignment criteria provided).");
  }
  return out;
}

export type NormalizedContext = {
  plagiarism?: PlagiarismSnapshot;
  gradedAt?: string;
  wordCount?: number;
  hasAssignmentCriteria?: boolean;
};

export type NormalizeGradeResult = {
  stored: StoredGrade;
  confidence: { score: number; label: ConfidenceLabel };
  isIncomplete: boolean;
  plagiarismView: { status: PlagiarismOverallStatus; localPct: number | null; corpusPct: number | null };
  smartMessages: string[];
};

/**
 * Normalizes an API (or localStorage) object into a stable StoredGrade and derived UX metadata.
 */
export function normalizeGradeResult(raw: unknown, context: NormalizedContext = {}): NormalizeGradeResult {
  const r = toRecord(raw);
  const err = r && typeof r.error === "string" && r.error.trim() ? r.error.trim() : undefined;

  const base = (r ?? {}) as Record<string, unknown>;
  if (r == null) {
    const empty: StoredGrade = {
      grade_band: "Pending",
      rationale: DEFAULT_RATIONALE,
      strengths: [],
      improvements: [],
      cited_sources: [],
      criteria_results: [],
      criteria_extracted: [],
      assignment_context: toAssignmentContext({}),
      criteria_undetected: true,
      error: err,
      student_feedback: [],
    };
    if (context.plagiarism) empty.plagiarism = context.plagiarism;
    if (context.gradedAt) empty.gradedAt = context.gradedAt;
    const smartMessages = buildSmartContextMessages({
      localPercent: context.plagiarism?.localPercent ?? null,
      hasAssignmentCriteria: context.hasAssignmentCriteria ?? false,
      wordCount: context.wordCount ?? 0,
      minWords: POLICY.minWords,
    });
    return {
      stored: {
        ...empty,
        confidenceScore: 0,
        confidenceLabel: "Low",
        displayHints: smartMessages,
      },
      confidence: { score: 0, label: "Low" },
      isIncomplete: true,
      plagiarismView: plagiarismOverallStatus(context.plagiarism),
      smartMessages,
    };
  }

  const rawRationale = base.rationale;
  const hasRawRationale = String(rawRationale ?? "").replace(/\s+/g, " ").trim().length > 0;
  const strengths = toStringList(base.strengths);
  const improvements = toStringList(base.improvements);
  const cited = toCitedSources(base.cited_sources);

  let band = String(base.grade_band ?? "").replace(/\s+/g, " ").trim();
  if (!band) band = "Pending";

  const rationale = hasRawRationale ? safeText(rawRationale, DEFAULT_RATIONALE) : DEFAULT_RATIONALE;

  const confSource: Record<string, unknown> = { ...base };
  if (!hasRawRationale) confSource.rationale = "";
  const confidence = gradeConfidenceFromRaw(confSource);

  const retrieval = base.retrieval;
  const retrievalOut =
    retrieval && typeof retrieval === "object" && !Array.isArray(retrieval)
      ? {
          chunks_used:
            typeof (retrieval as { chunks_used?: number }).chunks_used === "number"
              ? (retrieval as { chunks_used: number }).chunks_used
              : undefined,
          sources: Array.isArray((retrieval as { sources?: unknown }).sources)
            ? (retrieval as { sources: string[] }).sources.map((s) => String(s))
            : undefined,
        }
      : undefined;

  const hasBandFromApi = String(base.grade_band ?? "").trim().length > 0;
  const hasAnyList = strengths.length > 0 || improvements.length > 0 || cited.length > 0;

  const isIncomplete =
    !!err ||
    !hasBandFromApi ||
    (!hasRawRationale && !hasAnyList);

  const smartMessages = buildSmartContextMessages({
    localPercent: context.plagiarism?.localPercent ?? null,
    hasAssignmentCriteria: context.hasAssignmentCriteria ?? false,
    wordCount: context.wordCount ?? 0,
    minWords: POLICY.minWords,
  });

  const plagiarismView = plagiarismOverallStatus(context.plagiarism);

  const critRes = toCriterionResults(base.criteria_results);
  const critExt = toExtracted(base.criteria_extracted);
  const assignCtx = toAssignmentContext(base.assignment_context);

  const stored: StoredGrade = {
    grade_band: band,
    rationale,
    strengths,
    improvements,
    cited_sources: cited,
    retrieval: retrievalOut,
    error: err,
    criteria_results: critRes,
    criteria_extracted: critExt,
    assignment_context: assignCtx,
    criteria_undetected: Boolean(base.criteria_undetected),
    confidenceScore: confidence.score,
    confidenceLabel: confidence.label,
    displayHints: smartMessages,
  };
  if (context.plagiarism) stored.plagiarism = context.plagiarism;
  if (context.gradedAt) stored.gradedAt = context.gradedAt;
  if (base.consistency_validation && typeof base.consistency_validation === "object")
    stored.consistency_validation = base.consistency_validation as NonNullable<
      StoredGrade["consistency_validation"]
    >;
  if (typeof base.evidence_diversity_ok === "boolean")
    stored.evidence_diversity_ok = base.evidence_diversity_ok;
  if (Array.isArray(base.files_used))
    stored.files_used = (base.files_used as unknown[]).map((s) => String(s));
  {
    const br = base as Record<string, unknown>;
    const sf = br["submission_format"];
    if (sf === "bullet_points" || sf === "slides_style" || sf === "essay" || sf === "mixed") {
      stored.submission_format = sf;
    }
    const sfl = br["submission_format_label"];
    if (typeof sfl === "string" && sfl.trim()) {
      stored.submission_format_label = sfl.trim();
    }
    const asp = br["assignment_spec"];
    if (asp != null && typeof asp === "object" && !Array.isArray(asp)) {
      stored.assignment_spec = asp as StoredGrade["assignment_spec"];
    }
    const sq = br["spec_quality"];
    if (typeof sq === "number" && !Number.isNaN(sq)) stored.spec_quality = sq;
    if (typeof br["spec_penalties_disabled"] === "boolean")
      stored.spec_penalties_disabled = br["spec_penalties_disabled"];
    if (typeof br["student_level"] === "string" && String(br["student_level"]).trim())
      stored.student_level = String(br["student_level"]).trim();
    if (typeof br["relax_thresholds"] === "boolean") stored.relax_thresholds = br["relax_thresholds"];
    const pma = br["progress_momentum_ar"];
    if (typeof pma === "string" && pma.trim()) stored.progress_momentum_ar = pma.trim();
    const cach = br["criterion_achievement"];
    if (cach != null && typeof cach === "object" && !Array.isArray(cach)) {
      const o = cach as Record<string, unknown>;
      if (
        typeof o.achieved === "number" &&
        typeof o.total === "number" &&
        typeof o.ratio === "number"
      ) {
        stored.criterion_achievement = {
          achieved: o.achieved,
          total: o.total,
          ratio: o.ratio,
        };
      }
    }
    if (typeof br["grade_band_stability_applied"] === "boolean")
      stored.grade_band_stability_applied = br["grade_band_stability_applied"];
    if (typeof br["grade_band_upper_guard_applied"] === "boolean")
      stored.grade_band_upper_guard_applied = br["grade_band_upper_guard_applied"];
    const oc = br["overall_confidence"];
    if (typeof oc === "number" && !Number.isNaN(oc)) stored.overall_confidence = oc;
    const aud = br["audit"];
    if (aud != null && typeof aud === "object" && !Array.isArray(aud)) {
      stored.audit = aud as NonNullable<StoredGrade["audit"]>;
    }
    if (typeof br["achievement_borderline"] === "boolean")
      stored.achievement_borderline = br["achievement_borderline"];
    const caw = br["criterion_achievement"];
    if (caw != null && typeof caw === "object" && !Array.isArray(caw)) {
      const o = caw as Record<string, unknown>;
      if (typeof o.achieved === "number" && typeof o.total === "number" && typeof o.ratio === "number") {
        stored.criterion_achievement = {
          achieved: o.achieved,
          total: o.total,
          ratio: o.ratio,
          ...(typeof o.weighted_ratio === "number" ? { weighted_ratio: o.weighted_ratio } : {}),
        };
      }
    }
  }
  if (Array.isArray(base.student_feedback) && base.student_feedback.length > 0)
    stored.student_feedback = base.student_feedback.map((s) => String(s).replace(/\s+/g, " ").trim());
  if (base.student_improvement === null) {
    stored.student_improvement = null;
  }
  const si = base.student_improvement;
  if (si != null && typeof si === "object" && !Array.isArray(si)) {
    const o = si as Record<string, unknown>;
    const improved = String(o.improved ?? "");
    const notes = Array.isArray(o.notes) ? o.notes.map((n) => String(n)) : [];
    if (improved || notes.length) {
      stored.student_improvement = {
        improved,
        notes,
        style_guard_triggered: Boolean(o.style_guard_triggered),
        similarity: typeof o.similarity === "number" ? o.similarity : undefined,
        mode: "guidance_only",
        target_level: String(o.target_level ?? ""),
        source_grade_band: o.source_grade_band != null ? String(o.source_grade_band) : undefined,
        diff_preview: o.diff_preview != null ? String(o.diff_preview) : undefined,
        error: o.error != null ? String(o.error) : undefined,
      };
    } else {
      stored.student_improvement = null;
    }
  }

  function readImprovementPayload(o: unknown): StudentImprovementPayload {
    if (o === null) return null;
    if (o == null || typeof o !== "object" || Array.isArray(o)) return null;
    const p = o as Record<string, unknown>;
    const improved = String(p.improved ?? "");
    const notes = Array.isArray(p.notes) ? p.notes.map((n) => String(n)) : [];
    if (!improved && notes.length === 0) return null;
    return {
      improved,
      notes,
      style_guard_triggered: Boolean(p.style_guard_triggered),
      similarity: typeof p.similarity === "number" ? p.similarity : undefined,
      mode: "guidance_only",
      target_level: String(p.target_level ?? ""),
      source_grade_band: p.source_grade_band != null ? String(p.source_grade_band) : undefined,
      diff_preview: p.diff_preview != null ? String(p.diff_preview) : undefined,
      error: p.error != null ? String(p.error) : undefined,
    };
  }

  if (base.teacher && typeof base.teacher === "object" && !Array.isArray(base.teacher)) {
    const t = base.teacher as Record<string, unknown>;
    const cs = Array.isArray(t.criteria_summary) ? t.criteria_summary : [];
    const criteria_summary = cs
      .map((x) => {
        if (x == null || typeof x !== "object" || Array.isArray(x)) return null;
        const c = x as Record<string, unknown>;
        const code = String(c.code ?? "").trim();
        if (!code) return null;
        const ma = c.minimum_acceptable != null ? String(c.minimum_acceptable).trim() : "";
        const cr = c.confidence_reason;
        const reasons =
          Array.isArray(cr) && cr.length > 0
            ? (cr
                .map((y) => String(y).trim())
                .filter((s) => s.length > 0)
                .slice(0, 20) as string[])
            : undefined;
        const ccv = c.criterion_confidence;
        const csum2 = c.confidence_summary_ar;
        const summary =
          Array.isArray(csum2) && csum2.length > 0
            ? (csum2
                .map((y) => String(y).trim())
                .filter((s) => s.length > 0)
                .slice(0, 5) as string[])
            : undefined;
        return {
          code,
          achieved: Boolean(c.achieved),
          ...(ma ? { minimum_acceptable: ma } : {}),
          ...(reasons && reasons.length > 0 ? { confidence_reason: reasons } : {}),
          ...(summary && summary.length > 0 ? { confidence_summary_ar: summary } : {}),
          ...(typeof ccv === "number" && !Number.isNaN(ccv) ? { criterion_confidence: ccv } : {}),
        };
      })
      .filter(
        (x): x is NonNullable<typeof x> & { code: string; achieved: boolean } => x != null,
      );
    const flags = Array.isArray(t.flags) ? t.flags.map((f) => String(f)) : [];
    const conf = t.confidence;
    const fmtRaw = t.submission_format;
    const sfmt =
      fmtRaw === "bullet_points" || fmtRaw === "slides_style" || fmtRaw === "essay" || fmtRaw === "mixed"
        ? fmtRaw
        : undefined;
    const sfLbl = t.submission_format_label != null ? String(t.submission_format_label).trim() : "";
    const asb = t.assignment_spec_brief;
    const assignment_spec_brief =
      asb != null && typeof asb === "object" && !Array.isArray(asb) && "ok" in (asb as object)
        ? (asb as AssignmentSpecBrief)
        : undefined;
    stored.teacher = {
      grade_band: t.grade_band != null && String(t.grade_band).trim() ? String(t.grade_band) : undefined,
      criteria_summary,
      flags,
      confidence: conf === null || typeof conf === "number" ? (conf as number | null) : null,
      evidence_diversity_ok: typeof t.evidence_diversity_ok === "boolean" ? t.evidence_diversity_ok : undefined,
      criteria_undetected: typeof t.criteria_undetected === "boolean" ? t.criteria_undetected : undefined,
      submission_format: sfmt,
      submission_format_label: sfLbl || undefined,
      assignment_spec_brief: assignment_spec_brief,
      ...(typeof t.spec_quality === "number" && !Number.isNaN(t.spec_quality) ? { spec_quality: t.spec_quality } : {}),
      ...(typeof t.spec_penalties_disabled === "boolean" ? { spec_penalties_disabled: t.spec_penalties_disabled } : {}),
      ...(typeof t.student_level === "string" && String(t.student_level).trim()
        ? { student_level: String(t.student_level).trim() }
        : {}),
      ...(typeof t.relax_thresholds === "boolean" ? { relax_thresholds: t.relax_thresholds } : {}),
      ...(typeof t.grade_band_stability_applied === "boolean"
        ? { grade_band_stability_applied: t.grade_band_stability_applied }
        : {}),
      ...(typeof t.grade_band_upper_guard_applied === "boolean"
        ? { grade_band_upper_guard_applied: t.grade_band_upper_guard_applied }
        : {}),
      ...(typeof t.overall_confidence === "number" && !Number.isNaN(t.overall_confidence)
        ? { overall_confidence: t.overall_confidence }
        : {}),
      ...(t.audit != null && typeof t.audit === "object" && !Array.isArray(t.audit)
        ? { audit: t.audit as NonNullable<StoredGrade["teacher"]>["audit"] }
        : {}),
    };
  } else {
      const cr = stored.criteria_results;
    if (cr && cr.length > 0) {
      const nums = cr.map((c) => c.confidence).filter((n): n is number => typeof n === "number");
      const meanC = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
      const br2 = base as Record<string, unknown>;
      const asp0 = br2["assignment_spec"];
      let asBrief: AssignmentSpecBrief | undefined;
      const specPayload =
        asp0 && typeof asp0 === "object" && !Array.isArray(asp0) ? (asp0 as AssignmentSpecPayload) : undefined;
      if (asp0 && typeof asp0 === "object" && !Array.isArray(asp0)) {
        const o = asp0 as Record<string, unknown>;
        asBrief = {
          ok: o["assignment_spec_ok"] === true,
          assignment_type: typeof o["assignment_type"] === "string" ? o["assignment_type"] : undefined,
          expected_format: typeof o["expected_format"] === "string" ? o["expected_format"] : undefined,
          evidence_count: Array.isArray(o["evidence_required"]) ? o["evidence_required"].length : 0,
          criteria_count:
            o["criteria"] && typeof o["criteria"] === "object" && o["criteria"] !== null
              ? Object.keys(o["criteria"] as object).length
              : 0,
        };
      }
      const br2b = base as Record<string, unknown>;
      const sq2 = br2b["spec_quality"];
      const spd = br2b["spec_penalties_disabled"];
      const slv = br2b["student_level"];
      const rtx = br2b["relax_thresholds"];
      const gbs = br2b["grade_band_stability_applied"];
      const gbu = br2b["grade_band_upper_guard_applied"];
      const ocv = br2b["overall_confidence"];
      const adt = br2b["audit"];
      stored.teacher = {
        grade_band: stored.grade_band,
        criteria_summary: cr.map((c) => {
          const m = minimumAcceptableFromSpec(c.code, specPayload);
          return {
            code: c.code,
            achieved: c.achieved,
            ...(m ? { minimum_acceptable: m } : {}),
            ...(c.confidence_reason && c.confidence_reason.length > 0 ? { confidence_reason: c.confidence_reason } : {}),
            ...(c.confidence_summary_ar && c.confidence_summary_ar.length > 0
              ? { confidence_summary_ar: c.confidence_summary_ar }
              : {}),
            ...(typeof c.confidence === "number" && !Number.isNaN(c.confidence)
              ? { criterion_confidence: c.confidence }
              : {}),
          };
        }),
        flags: stored.consistency_validation?.flags ?? [],
        confidence: meanC,
        evidence_diversity_ok: stored.evidence_diversity_ok,
        criteria_undetected: stored.criteria_undetected,
        submission_format: stored.submission_format,
        submission_format_label: stored.submission_format_label,
        assignment_spec_brief: asBrief,
        ...(typeof sq2 === "number" && !Number.isNaN(sq2) ? { spec_quality: sq2 } : {}),
        ...(typeof spd === "boolean" ? { spec_penalties_disabled: spd } : {}),
        ...(typeof slv === "string" && String(slv).trim() ? { student_level: String(slv).trim() } : {}),
        ...(typeof rtx === "boolean" ? { relax_thresholds: rtx } : {}),
        ...(typeof gbs === "boolean" ? { grade_band_stability_applied: gbs } : {}),
        ...(typeof gbu === "boolean" ? { grade_band_upper_guard_applied: gbu } : {}),
        ...(typeof ocv === "number" && !Number.isNaN(ocv) ? { overall_confidence: ocv } : {}),
        ...(adt != null && typeof adt === "object" && !Array.isArray(adt)
          ? { audit: adt as NonNullable<StoredGrade["teacher"]>["audit"] }
          : {}),
      };
    }
  }

  if (base.student && typeof base.student === "object" && !Array.isArray(base.student)) {
    const s = base.student as Record<string, unknown>;
    const feedback = Array.isArray(s.feedback) ? s.feedback.map((x) => String(x)) : [];
    const si: StudentImprovementPayload =
      s.improvement === undefined
        ? (stored.student_improvement ?? null)
        : readImprovementPayload(s.improvement) ?? stored.student_improvement ?? null;
    const momS = s.momentum != null ? String(s.momentum).replace(/\s+/g, " ").trim() : "";
    stored.student = {
      feedback,
      improvement: si,
      ...(momS ? { momentum: momS.slice(0, 2000) } : {}),
    };
  } else if (stored.criteria_results && stored.criteria_results.length > 0) {
    const fb = stored.student_feedback;
    const bpr = base as Record<string, unknown>;
    const momB =
      typeof bpr["progress_momentum_ar"] === "string" ? bpr["progress_momentum_ar"].replace(/\s+/g, " ").trim() : "";
    if ((fb && fb.length > 0) || stored.student_improvement || momB) {
      stored.student = {
        feedback: fb ?? [],
        improvement: stored.student_improvement ?? null,
        ...(momB ? { momentum: momB.slice(0, 2000) } : {}),
      };
    }
  }

  return {
    stored,
    confidence,
    isIncomplete,
    plagiarismView,
    smartMessages,
  };
}
