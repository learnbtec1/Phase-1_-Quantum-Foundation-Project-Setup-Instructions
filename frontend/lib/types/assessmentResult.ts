export type ConfidenceLabel = "High" | "Medium" | "Low";

export type CriterionResult = {
  code: string;
  achieved: boolean;
  justification: string;
  /** Per-criterion model confidence 0–1 (when API returns it). */
  confidence?: number;
  evidence: string[];
  /** Verbatim quote + file (when API returns structured evidence). */
  evidence_items?: { quote: string; source_file: string }[];
  /** e.g. "M1 not met: no cause–effect …" (BTEC strict mode). */
  why_higher_tier_excluded?: string;
  /** Model read of what the work actually does for this code: describe | explain | analyse | evaluate */
  observed_cognitive_level?: string;
  /** When PASS0 exists: whether work meets the brief’s `minimum_acceptable` for this code. */
  meets_assignment_minimum?: boolean | null;
  /** One-line explainability when achieved (from grader + PASS0 bar). */
  why_achieved?: string;
  /** When not achieved: what was missing vs the fair minimum. */
  why_not_achieved?: string;
  /** When not achieved: one practical tip to improve. */
  improvement_hint?: string;
  /** Machine tags describing what moved `confidence` (teacher transparency). */
  confidence_reason?: string[];
  /** 2–3 short Arabic lines derived from `confidence_reason`. */
  confidence_summary_ar?: string[];
};

export type ExtractedCriterion = {
  code: string;
  description: string;
};

export type AssignmentContext = {
  scenario: string;
  task: string;
  expected_outcomes: string;
  criteria_summary: string;
};

/** Heuristic layout of student work (backend `detect_submission_format`) — not the assignment brief genre. */
export type SubmissionFormatKind = "bullet_points" | "slides_style" | "essay" | "mixed";

/** PASS 0: fair minimum per criterion from assignment brief (backend). */
export type AssignmentCriterionSpec = {
  skill?: string;
  requirement?: string;
  minimum_acceptable?: string;
  common_student_format?: string;
};

export type AssignmentSpecPayload = {
  /** True when PASS 0 produced a valid brief (same key as API). */
  assignment_spec_ok?: boolean;
  learning_aim?: string | null;
  scenario?: string | null;
  task?: string | null;
  assignment_type?: string;
  expected_format?: string;
  evidence_required?: string[];
  criteria?: Record<string, AssignmentCriterionSpec>;
};

export type AssignmentSpecBrief = {
  ok: boolean;
  assignment_type?: string;
  expected_format?: string;
  evidence_count?: number;
  criteria_count?: number;
};

/** وضع المعلم: سريع، تقرار، دون تفصيل تربوي طويل. */
export type TeacherViewPayload = {
  grade_band?: string;
  criteria_summary: {
    code: string;
    achieved: boolean;
    minimum_acceptable?: string;
    confidence_reason?: string[];
    confidence_summary_ar?: string[];
    criterion_confidence?: number;
  }[];
  flags: string[];
  /** متوسط ثقة صفوف المعايير (إن وُجدت) */
  confidence: number | null;
  evidence_diversity_ok?: boolean;
  criteria_undetected?: boolean;
  submission_format?: SubmissionFormatKind;
  submission_format_label?: string;
  /** Summary of PASS 0 assignment understanding. */
  assignment_spec_brief?: AssignmentSpecBrief;
  /** 0–1 quality of PASS0 minimums; if low, spec-based penalties were skipped. */
  spec_quality?: number;
  spec_penalties_disabled?: boolean;
  student_level?: string;
  relax_thresholds?: boolean;
  /** True when band was raised to at least Pass because most rows were achieved. */
  grade_band_stability_applied?: boolean;
  /** Capped Merit/Distinction when no achieved M/D row. */
  grade_band_upper_guard_applied?: boolean;
  overall_confidence?: number;
  audit?: {
    spec_quality?: number;
    spec_penalties_disabled?: boolean;
    stability_applied?: boolean;
    upper_guard_applied?: boolean;
    student_level?: string;
    weighted_achievement_ratio?: number;
    simple_achievement_ratio?: number;
    achievement_borderline?: boolean;
    overall_confidence?: number;
  };
};

export type StudentImprovementPayload = {
  improved: string;
  notes: string[];
  style_guard_triggered: boolean;
  similarity?: number;
  mode: "guidance_only";
  target_level: string;
  source_grade_band?: string;
  diff_preview?: string;
  error?: string;
  /** True when per-user teacher style priors were merged into the rewrite system prompt (not the grade). */
  teacher_memory_used?: boolean;
  /** Short Arabic lines explaining which aggregated teaching nudges influenced the *optional* system prompt. */
  memory_explanation?: string[];
} | null;

/** وضع الطالب: feedback + improvement في حزمة واحدة. */
export type StudentViewPayload = {
  feedback: string[];
  improvement: StudentImprovementPayload;
  /** Encouragement when most criteria are met but not all (Arabic). */
  momentum?: string;
};

export type GradeResult = {
  grade_band?: string;
  rationale?: string;
  strengths?: string[];
  improvements?: string[];
  cited_sources?: { source_file?: string; relevance?: number }[];
  retrieval?: { chunks_used?: number; sources?: string[] };
  error?: string;
  /** Per-criterion assessment (BTEC P/M/D). */
  criteria_results?: CriterionResult[];
  /** Codes parsed from the assignment. */
  criteria_extracted?: ExtractedCriterion[];
  /** Structured understanding of the brief. */
  assignment_context?: AssignmentContext;
  /** True when the model could not align criteria codes with the text. */
  criteria_undetected?: boolean;
  /** Post-grade checks: re-run, uncertain if two model passes disagree, etc. */
  consistency_validation?: {
    regraded_once?: boolean;
    uncertain_grading?: boolean;
    autocorrected?: boolean;
    flags?: string[];
  };
  evidence_diversity_ok?: boolean;
  files_used?: string[];
  /** Detected submission layout (bullets / slides / essay / mixed). */
  submission_format?: SubmissionFormatKind;
  /** Arabic label for `submission_format` (teacher UI). */
  submission_format_label?: string;
  /** PASS 0: structured understanding of the brief (fair minimums per criterion). */
  assignment_spec?: AssignmentSpecPayload;
  /** تغذية راجعة موجّهة لكل معيار (نصوص عربية من `feedback_generator`). */
  student_feedback?: string[];
  /** مثال إرشادي للخطوة التالية (ليس إجابة جاهزة) + Style Guard. */
  student_improvement?: StudentImprovementPayload;
  /** PASS0 criteria minimum quality; low → backend skipped spec penalties. */
  spec_quality?: number;
  spec_penalties_disabled?: boolean;
  student_level?: string;
  relax_thresholds?: boolean;
  /** Overall achievement ratio narrative for students. */
  progress_momentum_ar?: string;
  criterion_achievement?: {
    achieved: number;
    total: number;
    ratio: number;
    weighted_ratio?: number;
  };
  grade_band_stability_applied?: boolean;
  /** Merit/Distinction trimmed when no achieved M or D row. */
  grade_band_upper_guard_applied?: boolean;
  /** Mean row confidence, clamped 0.4–0.9 (achieved rows only). */
  overall_confidence?: number;
  /** Compact audit for logs / UI. */
  audit?: TeacherViewPayload["audit"];
  achievement_borderline?: boolean;
  /** مخرج موجز للمعلم (نفس `teacher` في API). */
  teacher?: TeacherViewPayload;
  /** مخرج تعلّم للطالب (نفس `student` في API). */
  student?: StudentViewPayload;
};

/** Vector corpus (embedding) path for this submission — single source of truth for UI. */
export type CorpusStatus = "ok" | "fallback" | "unavailable";

export type PlagiarismSnapshot = {
  localPercent: number | null;
  localStatus: "acceptable" | "high" | "n/a";
  apiMaxCorpusPercent: number | null;
  corpusStatus?: CorpusStatus;
  /** @deprecated use `corpusStatus` */
  corpusUsed?: boolean;
  /** @deprecated use `corpusStatus` */
  corpusFallback?: boolean;
};

export type StoredGrade = GradeResult & {
  plagiarism?: PlagiarismSnapshot;
  gradedAt?: string;
  /** Set when persisting a normalized result (for replay without raw API). */
  confidenceScore?: number;
  confidenceLabel?: ConfidenceLabel;
  /** Smart UX hints (similarity, word count, criteria) at submit time. */
  displayHints?: string[];
};
