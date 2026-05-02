"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import {
  ClipboardCheck,
  Loader2,
  GraduationCap,
  BookOpen,
  Layers,
  ChevronDown,
  FileText,
  ArrowRight,
  Zap,
  Users,
  BarChart3,
  Globe,
  Moon,
  Code2,
  Microscope,
  Stethoscope,
  PenTool,
  Utensils,
  Briefcase,
  Radar,
  ScanSearch,
} from "lucide-react";

import { useAppTheme } from "@/contexts/ThemeContext";
import { useAssessment, type StoredGrade, type TeacherEditSaveResult } from "@/hooks/useAssessment";
import { countWords, computeLocalScore, runPolicy, POLICY as policyConst } from "@/lib/utils/policy";
import { consumeEduverseDraftText } from "@/lib/eduverseDraft";
import { getSubmitSourceFromFormEvent, trackAssessmentCtaClick } from "@/lib/analytics";
import { AssessmentCtaButton, type CtaBlockReason } from "@/components/assessment/assessment-cta-button";
import { confidenceFromStored, resolveCorpusStatus } from "@/lib/utils/gradeResult";
import { cn } from "@/lib/utils";
import { fetchUsageMe, isAtLimit, isNearLimit, type UsageMe } from "@/lib/usage";
import { fetchWithSession } from "@/lib/api";
import { Button } from "@/components/lovable-ui/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/lovable-ui/ui/card";
import { Skeleton } from "@/components/lovable-ui/ui/skeleton";
import {
  CriterionStatusBlock,
  TeacherCriterionStatusStrip,
} from "@/components/assessment/criterion-status-block";
import { BtecGradeScale } from "@/components/assessment/btec-grade-scale";
import { UltraTutor } from "@/components/assessment/ultra-tutor";
import { GuidanceGapSection } from "@/components/assessment/guidance-gap-section";
import { analyzeAssignmentBrief, type BtecBriefLadder } from "@/lib/assessment/briefLadder";
import {
  buildGuidanceGapPayload,
  type CriterionGapAnalysis,
} from "@/lib/assessment/guidanceGapPayload";
import TeacherAvatar from "@/components/lovable-ui/TeacherAvatar";
import StudentAvatar from "@/components/lovable-ui/StudentAvatar";
import SpeechBubble from "@/components/lovable-ui/SpeechBubble";
import { GradingResultHints } from "@/components/lovable-ui/GradingResultHints";
import AcademicCard from "@/components/lovable-ui/AcademicCard";
import { AIIntegrityWarning } from "@/components/assessment/ai-integrity-warning";
import type { CriterionResult } from "@/lib/types/assessmentResult";

/* ==============================
   بيانات أكاديمية — BTEC الأردن: صف → ثلاثة فصول → وحدات
================================ */
const ACADEMIC_DATA = {
  "الصف العاشر": {
    "الفصل الأول": [
      "مقدّمة في عالم الأعمال",
      "الغرض من إنشاء شركة",
      "مؤسسات الأعمال",
      "التنبؤ",
      "خطة التسويق",
    ],
    "الفصل الثاني": [
      "إنشاء شركة صغيرة",
      "العمل ضمن فريق",
      "إدارة الشؤون المالية",
    ],
    "الفصل الثالث": [
      "تقييم أداء المشروع",
      "التواصل في بيئة الأعمال",
      "مشروع تطبيقي — شركة ناشئة",
    ],
  },
  "الأول ثانوي": {
    "الفصل الأول": [
      "إدارة الأعمال",
      "البيئة التنظيمية والقانونية",
      "تنسيق وظائف الأعمال",
    ],
    "الفصل الثاني": [
      "التمويل",
      "المحاسبة الإدارية",
      "اتخاذ القرار المالي",
    ],
    "الفصل الثالث": [
      "ريادة الأعمال",
      "تطوير نموذج أعمال",
      "مشروع بحث / عرض",
    ],
  },
  التوجيهي: {
    "الفصل الأول": ["اتخاذ القرارات", "موارد بشرية - الجزء الأول"],
    "الفصل الثاني": [
      "الموارد البشرية - الجزء الثاني",
      "خدمة العملاء",
      "مبادئ الإدارة",
    ],
    "الفصل الثالث": [
      "أخلاقيات الأعمال - الجزء الأول",
      "أخلاقيات الأعمال - الجزء الثاني",
    ],
  },
};

/* ==============================
   Network: /api/parse-file → { text: string }
================================ */
async function parseFileViaNextRoute(file: File): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch("/api/parse-file", { method: "POST", body: formData });
  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(errBody.error || res.statusText || "Parse failed");
  }
  const data = (await res.json()) as { text?: string; error?: string };
  if (data.error) throw new Error(String(data.error));
  return (data.text ?? "").trim();
}

/* ==============================
   🎨 Helpers
================================ */
function gradeVisual(band?: string) {
  if (!band) return "border border-border/60 bg-muted/40 text-foreground transition-shadow duration-200";
  const b = band.toLowerCase();
  if (b.includes("distinction")) return "status-achieved";
  if (b.includes("merit")) return "border border-sky-500/20 bg-sky-500/10 text-sky-600 dark:text-sky-400 transition-shadow duration-200";
  if (b.includes("pass")) return "status-warning";
  return "status-not-achieved";
}

/** Localized label for the overall band (API may return English BTEC strings). */
function gradeBandLabelAr(band?: string) {
  if (!band) return "—";
  const b = band.toLowerCase();
  if (b.includes("not yet")) return "لم يتم تحقيق المستوى المطلوب بعد";
  if (b.includes("distinction")) return "متميّز (Distinction)";
  if (b.includes("merit")) return "جيد (Merit)";
  if (b.includes("pass")) return "ناجح (Pass)";
  return band;
}

/** Backend `confidence_reason` tags → short Arabic for teacher panel. */
const CONFIDENCE_REASON_AR: Record<string, string> = {
  meets_assignment_minimum: "تم الاعتماد على تلبية الحد الأدنى (الواجب) ✓",
  meets_minimum_boost: "دفعة لأن الحد الأدنى من الواجب متحقق",
  flexible_minimum_recovery: "تعويض لطيف: حد أدنى متحقق رغم أدلة قابلة للتقوية",
  confidence_floor: "حد أدنى أعلى/منع الانهيار — مع اعتماد الاستيفاء عند الاقتضاء",
  weak_validated_evidence: "تحقق الاقتباس محدود — يُنصح باقتباسات أوثق (المعيار قد يبقى متحققًا)",
  thin_evidence_penalty: "أدلة اقتباسية أقل — ثقة معدّلة مع التركيز على التحسين المستقبلي",
  below_spec_minimum_penalty: "دون حد العدالة من وصف الواجب (PASS0) — خفض ثقة",
  format_adjustment: "تسامح/تصحيح مرتبط بنقاط/شرائح/تنسيق",
  multi_file_m_d_bias: "عدة ملفات لكن الأدلة من ملف واحد (M/D — خفض ثقة)",
  justification_tension: "تناقض بسيط بين الصياغة و«متحقق» (خفض ثقة)",
  d1_depth_soft: "D1: عمق تقييمي أقل — ثقة مُنخفضة قليلًا",
  d1_evaluative_triad_partial: "D1: جزء من عناصر التقييم (ثقة مُنخفضة)",
  criterion_not_achieved: "المعيار غير محقق — لا مضاعفة ثقة",
};

function isFiniteNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function formatFixed1(n: unknown): string {
  return typeof n === "number" && Number.isFinite(n) ? n.toFixed(1) : "0.0";
}

function formatWordCount(n: unknown): string {
  return typeof n === "number" && Number.isFinite(n) ? String(n) : "0";
}

function studentUpgradeFeedback(row: CriterionResult): string {
  const h = row.improvement_hint?.trim();
  if (h) return h;
  const w = row.why_not_achieved?.trim();
  if (w) return w;
  const j = row.justification.trim();
  return j || "—";
}

/** @/rtl-dark-theme/client/pages/Index.tsx — strings only (en/ar) */
type IndexLandingT = {
  heroTitle: string;
  heroSubtitle: string;
  heroDescription: string;
  getStarted: string;
  exploreCourses: string;
  uploadCriteria: string;
  uploadWork: string;
  teachingConcept: string;
  studentResponse: string;
  academicTitle: string;
  academicSubtitle: string;
  featuresTitle: string;
  ctaTitle: string;
  ctaDescription: string;
  ctaButton: string;
  academics: {
    icon: LucideIcon;
    title: string;
    description: string;
    color: "blue" | "purple" | "green" | "orange" | "pink" | "cyan";
  }[];
  features: { icon: LucideIcon; title: string; description: string }[];
};

const INDEX_LANDING: Record<"en" | "ar", IndexLandingT> = {
  en: {
    heroTitle: "Welcome to EDUVERSE",
    heroSubtitle: "Your AI-Powered Learning Companion",
    heroDescription:
      "Learn smarter, not harder. Our intelligent AI teacher adapts to your pace, style, and goals.",
    getStarted: "Start Learning Now",
    exploreCourses: "Explore Courses",
    uploadCriteria: "Upload Criteria",
    uploadWork: "Upload Work",
    teachingConcept: "Let me explain this concept to you step by step",
    studentResponse: "I understand! Can you show me more examples?",
    academicTitle: "Academic Specializations",
    academicSubtitle: "Choose your learning path from our diverse academic programs",
    featuresTitle: "Why EDUVERSE?",
    ctaTitle: "Ready to Transform Your Learning?",
    ctaDescription: "Join thousands of students achieving their goals on EDUVERSE",
    ctaButton: "Join Free Today",
    academics: [
      { icon: Code2, title: "Information Technology", description: "Master programming, web development, and software engineering", color: "blue" },
      { icon: Microscope, title: "Science & Research", description: "Explore physics, chemistry, biology, and advanced research methods", color: "green" },
      { icon: Stethoscope, title: "Healthcare & Medicine", description: "Comprehensive medical education and healthcare administration", color: "pink" },
      { icon: PenTool, title: "Creative Arts", description: "Design, digital art, creative writing, and multimedia production", color: "purple" },
      { icon: Utensils, title: "Culinary Excellence", description: "Professional cooking, pastry arts, and food science", color: "orange" },
      { icon: Briefcase, title: "Business & Management", description: "Entrepreneurship, leadership, marketing, and strategic planning", color: "cyan" },
    ],
    features: [
      { icon: Zap, title: "AI-Powered Teaching", description: "Intelligent algorithms adapt to your learning style in real-time" },
      { icon: Users, title: "Live Community", description: "Connect with students and mentors from around the world" },
      { icon: BarChart3, title: "Smart Analytics", description: "Track progress with detailed insights and personalized recommendations" },
      { icon: Globe, title: "RTL-First Design", description: "Perfectly optimized for Arabic and right-to-left languages" },
      { icon: BookOpen, title: "Rich Content Library", description: "Thousands of interactive lessons, projects, and resources" },
      { icon: Moon, title: "Dark Mode Ready", description: "Eye-friendly interface for comfortable learning anytime" },
    ],
  },
  ar: {
    heroTitle: "مرحباً بك في EDUVERSE",
    heroSubtitle: "رفيقك في التعلم المدعوم بالذكاء الاصطناعي",
    heroDescription:
      "تعلم بذكاء، وليس بجهد. يتكيف معك معلمنا الذكي حسب السرعة والأسلوب والأهداف.",
    getStarted: "ابدأ التعلم الآن",
    exploreCourses: "استكشف الدورات",
    uploadCriteria: "رفع معايير الواجب",
    uploadWork: "رفع حل الطالب",
    teachingConcept: "دعني أشرح لك هذا المفهوم خطوة بخطوة",
    studentResponse: "فهمت! هل يمكنك أن تريني المزيد من الأمثلة؟",
    academicTitle: "التخصصات الأكاديمية",
    academicSubtitle: "اختر مسار التعلم الخاص بك من برامجنا الأكاديمية المتنوعة",
    featuresTitle: "لماذا EDUVERSE؟",
    ctaTitle: "هل أنت مستعد لتحويل التعلم الخاص بك؟",
    ctaDescription: "انضم إلى آلاف الطلاب الذين يحققون أهدافهم على EDUVERSE",
    ctaButton: "انضم مجاناً اليوم",
    academics: [
      { icon: Code2, title: "تكنولوجيا المعلومات", description: "أتقن البرمجة وتطوير الويب وهندسة البرمجيات", color: "blue" },
      { icon: Microscope, title: "العلوم والبحث", description: "استكشف الفيزياء والكيمياء والأحياء وطرق البحث المتقدمة", color: "green" },
      { icon: Stethoscope, title: "الصحة والطب", description: "تعليم طبي شامل وإدارة الرعاية الصحية", color: "pink" },
      { icon: PenTool, title: "الفنون الإبداعية", description: "التصميم والفن الرقمي والكتابة الإبداعية والإنتاج متعدد الوسائط", color: "purple" },
      { icon: Utensils, title: "التميز في الطهي", description: "الطهي المهني والحلويات وعلوم الغذاء", color: "orange" },
      { icon: Briefcase, title: "الأعمال والإدارة", description: "ريادة الأعمال والقيادة والتسويق والتخطيط الاستراتيجي", color: "cyan" },
    ],
    features: [
      { icon: Zap, title: "التدريس المدعوم بالذكاء الاصطناعي", description: "خوارزميات ذكية تتكيف مع أسلوب التعلم لديك في الوقت الفعلي" },
      { icon: Users, title: "مجتمع حي", description: "تواصل مع الطلاب والمرشدين من جميع أنحاء العالم" },
      { icon: BarChart3, title: "تحليلات ذكية", description: "تتبع التقدم برؤى مفصلة وتوصيات مخصصة" },
      { icon: Globe, title: "تصميم RTL أولاً", description: "محسّن بشكل مثالي للعربية واللغات من اليمين إلى اليسار" },
      { icon: BookOpen, title: "مكتبة محتوى غنية", description: "آلاف الدروس التفاعلية والمشاريع والموارد" },
      { icon: Moon, title: "جاهز للوضع الليلي", description: "واجهة صديقة للعين للتعلم المريح في أي وقت" },
    ],
  },
};

/* ==============================
   🚀 Component
================================ */
export default function AssessmentPage() {
  const { language } = useAppTheme();
  const ar = language === "ar";
  const { loading, submitGrade, loadLastGrade, submitTeacherEdit } = useAssessment();

  const [selectedClass, setSelectedClass] = useState("");
  const [selectedSection, setSelectedSection] = useState("");
  const [selectedSubject, setSelectedSubject] = useState("");

  const availableSections = useMemo(
    () =>
      selectedClass
        ? Object.keys(ACADEMIC_DATA[selectedClass as keyof typeof ACADEMIC_DATA] || {})
        : [],
    [selectedClass]
  );

  const availableSubjects = useMemo(
    () =>
      selectedClass && selectedSection
        ? (ACADEMIC_DATA[selectedClass as keyof typeof ACADEMIC_DATA] as Record<string, string[]>)[
            selectedSection
          ] || []
        : [],
    [selectedClass, selectedSection]
  );

  const finalUnit = `${selectedClass} - ${selectedSection} - ${selectedSubject}`;

  const [assignmentCriteria, setAssignmentCriteria] = useState("");
  const [studentWork, setStudentWork] = useState("");
  const [ackHighSimilarity, setAckHighSimilarity] = useState(false);
  const [result, setResult] = useState<StoredGrade | null>(null);
  const [viewMode, setViewMode] = useState<"teacher" | "student">("teacher");
  const [uploadBusyKey, setUploadBusyKey] = useState<"criteria" | "student" | null>(null);
  const [teacherEditDraft, setTeacherEditDraft] = useState("");
  const [teacherEditBusy, setTeacherEditBusy] = useState(false);
  const [usage, setUsage] = useState<UsageMe | null>(null);
  const [subscriptionPlan, setSubscriptionPlan] = useState<string>("free");
  /** Progressive disclosure: student must accept BTEC disclaimer before seeing AI-guided improvement text. */
  const [guidedImprovementUnlocked, setGuidedImprovementUnlocked] = useState(false);
  const [gapByCode, setGapByCode] = useState<Record<string, CriterionGapAnalysis> | null>(null);
  const [gapLoading, setGapLoading] = useState(false);
  const [btecLadder, setBtecLadder] = useState<BtecBriefLadder | null>(null);
  const [btecLadderLoading, setBtecLadderLoading] = useState(false);
  /** Which P/M/D code the Ultra Tutor is focused on (driven from Upgrade Opportunities). */
  const [ultraTutorCriterion, setUltraTutorCriterion] = useState("P1");

  const loadUsage = useCallback(async () => {
    const u = await fetchUsageMe();
    setUsage(u);
  }, []);

  const criteriaFileInputRef = useRef<HTMLInputElement>(null);
  const studentFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setResult(loadLastGrade());
  }, [loadLastGrade]);

  useEffect(() => {
    void loadUsage();
  }, [loadUsage]);

  /** Golden Flow: draft handoff from Workspace (one-shot). */
  useEffect(() => {
    const d = consumeEduverseDraftText();
    if (d) setStudentWork(d);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetchWithSession("/api/v1/auth/me", { method: "GET" });
        if (r.ok) {
          const j = (await r.json()) as { subscription_plan?: string };
          setSubscriptionPlan((j.subscription_plan || "free").toLowerCase());
        } else {
          setSubscriptionPlan("free");
        }
      } catch {
        setSubscriptionPlan("free");
      }
    })();
  }, []);

  useEffect(() => {
    setTeacherEditDraft("");
  }, [result?.gradedAt]);

  useEffect(() => {
    if (!result?.criteria_results || result.criteria_results.length === 0) {
      setGapByCode(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setGapLoading(true);
      try {
        const body = buildGuidanceGapPayload(studentWork, result);
        const res = await fetchWithSession("/api/v1/assessment/guidance-gap", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          if (!cancelled) setGapByCode(null);
          return;
        }
        const data = (await res.json()) as { criterion_analysis: CriterionGapAnalysis[] };
        if (cancelled) return;
        const m: Record<string, CriterionGapAnalysis> = {};
        for (const a of data.criterion_analysis || []) {
          m[a.criterion] = a;
        }
        setGapByCode(m);
      } catch {
        if (!cancelled) setGapByCode(null);
      } finally {
        if (!cancelled) setGapLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [result, studentWork]);

  const words = useMemo(() => countWords(studentWork), [studentWork]);
  const localPct = useMemo(
    () => computeLocalScore(studentWork, assignmentCriteria),
    [studentWork, assignmentCriteria]
  );
  const policy = useMemo(() => runPolicy(localPct), [localPct]);
  const resultConfidence = useMemo(() => (result ? confidenceFromStored(result) : null), [result]);
  const corpusStatusUi = useMemo(() => resolveCorpusStatus(result?.plagiarism), [result?.plagiarism]);

  const teacherPanel = useMemo(() => result?.teacher, [result]);
  const studentFeedbackBlocks = useMemo(() => {
    const raw: unknown = result?.student?.feedback ?? result?.student_feedback;
    if (Array.isArray(raw)) return raw as string[];
    if (typeof raw === "string" && raw.trim()) return [raw.trim()];
    return [];
  }, [result]);
  const studentImprovementPayload = useMemo(
    () => result?.student?.improvement ?? result?.student_improvement,
    [result]
  );

  const studentCriteriaSecured = useMemo(
    () => (result?.criteria_results ?? []).filter((r) => r.achieved),
    [result?.criteria_results],
  );
  const studentCriteriaGap = useMemo(
    () => (result?.criteria_results ?? []).filter((r) => !r.achieved),
    [result?.criteria_results],
  );

  useEffect(() => {
    setGuidedImprovementUnlocked(false);
  }, [result?.gradedAt, studentImprovementPayload?.improved]);

  const progressMomentum = useMemo(
    () =>
      (result?.student?.momentum ?? result?.progress_momentum_ar ?? "").toString().trim() || null,
    [result]
  );

  const assessLimitBlocked = useMemo(
    () =>
      usage != null &&
      usage.assessments_limit >= 0 &&
      isAtLimit(usage.assessments_used, usage.assessments_limit),
    [usage]
  );
  const assessNearLimit = useMemo(
    () =>
      usage != null &&
      usage.assessments_limit >= 0 &&
      isNearLimit(usage.assessments_used, usage.assessments_limit) &&
      !isAtLimit(usage.assessments_used, usage.assessments_limit),
    [usage]
  );

  const showUpgradePromo = useMemo(() => {
    if (!usage || usage.assessments_limit < 0) return false;
    if (isAtLimit(usage.assessments_used, usage.assessments_limit)) return false;
    if (!isNearLimit(usage.assessments_used, usage.assessments_limit)) return false;
    if (subscriptionPlan === "unlimited") return false;
    return true;
  }, [usage, subscriptionPlan]);

  const upgradePromoMode = useMemo((): "pro" | "unlimited" | null => {
    if (subscriptionPlan === "pro") return "unlimited";
    if (subscriptionPlan === "free" || !subscriptionPlan) return "pro";
    return "pro";
  }, [subscriptionPlan]);

  const hasStudentAnswer = useMemo(() => (studentWork || "").trim().length > 0, [studentWork]);

  const ctaBlockReason = useMemo((): CtaBlockReason => {
    if (uploadBusyKey) return "uploading";
    if (!hasStudentAnswer) return "missing_answer";
    if (!selectedClass || !selectedSection || !selectedSubject) return "academic_incomplete";
    if (
      policy &&
      isFiniteNumber(localPct) &&
      localPct > policyConst.maxSimilarity &&
      !ackHighSimilarity
    ) {
      return "needs_confirmation";
    }
    return null;
  }, [
    hasStudentAnswer,
    selectedClass,
    selectedSection,
    selectedSubject,
    uploadBusyKey,
    policy,
    localPct,
    ackHighSimilarity,
  ]);

  const ctaFormBlocked = ctaBlockReason !== null;

  const primaryCtaRef = useRef<HTMLElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const [stickyCtaVisible, setStickyCtaVisible] = useState(false);

  useEffect(() => {
    const el = primaryCtaRef.current;
    if (typeof window === "undefined" || !el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        const e = entries[0];
        if (!e) return;
        setStickyCtaVisible(!e.isIntersecting);
      },
      { root: null, threshold: 0.2, rootMargin: "0px 0px -100px 0px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const openUltraTutorForCriterion = useCallback(
    (code: string) => {
      if (!assignmentCriteria.trim()) {
        toast.error(
          ar
            ? "ألصق أو ارفع معايير الواجب أولاً — ثم سيظهر المعلم الذكي (Ultra Tutor) أعلى الصفحة."
            : "Paste or upload assignment criteria first — then Ultra Tutor appears above.",
        );
        document.getElementById("assignment-criteria")?.focus();
        return;
      }
      setUltraTutorCriterion(code);
      requestAnimationFrame(() => {
        document.getElementById("ultra-tutor")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    },
    [ar, assignmentCriteria],
  );

  const handleTeacherEditSave = useCallback(async () => {
    if (!result || !teacherEditDraft.trim()) {
      toast.error("أدخل النصّ الذي عدّلته كمعلم في الحقل أدناه.");
      return;
    }
    const orig = (studentWork || "").trim();
    if (!orig) {
      toast.error("لا يوجد نص أصلي لحل الطالب للمقارنة.");
      return;
    }
    const aiSug = typeof studentImprovementPayload?.improved === "string" ? studentImprovementPayload.improved : "";
    const gb = (result.grade_band || "Pass").trim() || "Pass";
    const tb = (studentImprovementPayload?.target_level || "Merit").trim() || "Merit";
    const at = selectedSubject ? `btec-${selectedSubject.replace(/\s+/g, "-").slice(0, 64)}` : "general";
    setTeacherEditBusy(true);
    try {
      const out: TeacherEditSaveResult = await submitTeacherEdit({
        originalText: orig,
        aiSuggestion: aiSug,
        teacherEditedText: teacherEditDraft.trim(),
        gradeBand: gb,
        targetBand: tb,
        assignmentType: at,
      });
      if (out.ok && out.record && out.record.quality_passed === false) {
        const rs = (out.record.quality?.reasons as string[] | undefined)?.join("، ");
        toast.warning(
          `سُجّلت العينة لأغراض سجلية فقط — لم تُضف إلى التعلم الجماعي (فلتر جودة).${rs ? ` السبب: ${rs}` : ""}`,
        );
      } else if (out.ok && out.record?.patterns && out.record.patterns.length > 0) {
        toast.success(`سُجّلت أنماط التعديل: ${out.record.patterns.join("، ")}`);
      } else if (out.ok) {
        toast.success("سُجّل تعديلك — يُستخدم لاحقاً كتلميحات أسلوب لطيفة للتحسين الإرشادي (دون تغيير الدرجات).");
      }
    } finally {
      setTeacherEditBusy(false);
    }
  }, [result, studentWork, teacherEditDraft, studentImprovementPayload, selectedSubject, submitTeacherEdit]);

  const handleCriteriaUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      console.warn("UPLOAD CLICKED (criteria)", "INPUT FIRED", e.type);
      const files = Array.from(e.target.files || []);
      console.warn("FILES SELECTED:", files);
      console.warn("FILES LENGTH:", files.length);
      if (!files.length) {
        console.warn("No files selected");
        e.target.value = "";
        return;
      }
      setUploadBusyKey("criteria");
      const loadingId = toast.loading("جاري استخراج نص المعايير…");
      let successCount = 0;
      for (const f of files) {
        try {
          console.warn("Processing (criteria):", f.name);
          const text = await parseFileViaNextRoute(f);
          if (!text) {
            console.warn("Empty extract (criteria):", f.name);
            continue;
          }
          setAssignmentCriteria((prev) => (prev.trim() ? `${prev}\n\n${text}` : text));
          successCount++;
        } catch (err) {
          console.error("File failed (criteria):", f.name, err);
          toast.error("فشل الملف: " + f.name);
        }
      }
      e.target.value = "";
      setUploadBusyKey(null);
      if (successCount > 0) {
        console.warn("CRITERIA UPLOAD OK:", successCount);
        toast.success(`تم دمج ${successCount} ملف(ات) في صندوق المعايير.`, { id: loadingId });
      } else {
        toast.error("لم يُستخرج نص من الملفات.", { id: loadingId });
      }

      const firstPdf = files.find((f) => f.name.toLowerCase().endsWith(".pdf"));
      if (firstPdf) {
        setBtecLadderLoading(true);
        setBtecLadder(null);
        try {
          const ladder = await analyzeAssignmentBrief(firstPdf);
          setBtecLadder(ladder);
          toast.success(
            language === "ar"
              ? "تم تحليل موجز الـ PDF وملء سلّم P/M/D (AI BTEC Decoder)."
              : "Assignment brief (PDF) decoded — P/M/D ladder updated.",
          );
          requestAnimationFrame(() => {
            document.getElementById("btec-grade-scale")?.scrollIntoView({ behavior: "smooth", block: "start" });
          });
        } catch (err) {
          setBtecLadder(null);
          const msg = err instanceof Error ? err.message : String(err);
          toast.error(
            language === "ar" ? `تعذّر فك الموجز: ${msg}` : `Could not decode brief: ${msg}`,
          );
        } finally {
          setBtecLadderLoading(false);
        }
      }
    },
    [language],
  );

  const handleStudentWorkUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    console.warn("UPLOAD CLICKED (student)", "INPUT FIRED", e.type);
    const files = Array.from(e.target.files || []);
    console.warn("FILES SELECTED:", files);
    console.warn("FILES LENGTH:", files.length);
    if (!files.length) {
      console.warn("No files selected");
      e.target.value = "";
      return;
    }
    setUploadBusyKey("student");
    const loadingId = toast.loading("جاري استخراج نص حل الطالب…");
    let successCount = 0;
    for (const f of files) {
      try {
        console.warn("Processing (student):", f.name);
        const text = await parseFileViaNextRoute(f);
        if (!text) {
          console.warn("Empty extract (student):", f.name);
          continue;
        }
        setStudentWork((prev) => (prev.trim() ? `${prev}\n\n${text}` : text));
        successCount++;
      } catch (err) {
        console.error("File failed (student):", f.name, err);
        toast.error("فشل الملف: " + f.name);
      }
    }
    e.target.value = "";
    setUploadBusyKey(null);
    if (successCount > 0) {
      console.warn("STUDENT UPLOAD OK:", successCount);
      toast.success(`تمت إضافة نص ${successCount} ملف(ات) إلى حل الطالب.`, { id: loadingId });
    } else {
      toast.error("لم يُستخرج نص من الملفات.", { id: loadingId });
    }
  }, []);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    if (loading) return;

    const source = getSubmitSourceFromFormEvent(e);

    if (assessLimitBlocked) {
      trackAssessmentCtaClick({ source, blocked: true, reason: "limit" });
      return;
    }
    if (ctaFormBlocked && ctaBlockReason) {
      trackAssessmentCtaClick({
        source,
        blocked: true,
        reason: ctaBlockReason,
      });
      if (ctaBlockReason === "academic_incomplete") {
        toast.error("يرجى إكمال تحديد المسار الأكاديمي أولاً");
      }
      return;
    }

    trackAssessmentCtaClick({ source, blocked: false, reason: "none" });
    requestAnimationFrame(() => {
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });

    const r = await submitGrade({
      btecUnit: finalUnit,
      studentWork,
      assignmentCriteria,
      acknowledgeHighSimilarity: ackHighSimilarity,
      academicContext: {
        grade: selectedClass,
        term: selectedSection,
        subject: selectedSubject,
      },
    });

    if (r.ok) {
      setResult(r.result);
      void loadUsage();
    }
  }

  const dropdownFields = [
    { label: "الصف الدراسي", icon: <GraduationCap className="w-5 h-5" />, val: selectedClass, set: setSelectedClass, opts: Object.keys(ACADEMIC_DATA), dis: false },
    { label: "الفصل الدراسي", icon: <BookOpen className="w-5 h-5" />, val: selectedSection, set: setSelectedSection, opts: availableSections, dis: !selectedClass },
    { label: "المادة التعليمية", icon: <Layers className="w-5 h-5" />, val: selectedSubject, set: setSelectedSubject, opts: availableSubjects, dis: !selectedSection },
  ];

  const t = useMemo(() => INDEX_LANDING[language === "ar" ? "ar" : "en"], [language]);

  return (
    <div
      className="relative min-h-0 w-full font-sans text-slate-100"
      dir={language === "ar" ? "rtl" : "ltr"}
    >
      <div
        className="pointer-events-none fixed inset-0 -z-20 bg-[#030712]"
        aria-hidden
      />
      <div
        className="pointer-events-none fixed -left-[10%] top-0 -z-20 h-[min(60vh,32rem)] w-[min(60vh,32rem)] animate-pulse rounded-full bg-fuchsia-600/25 blur-[120px] motion-reduce:animate-none"
        style={{ animationDuration: "8s" }}
        aria-hidden
      />
      <div
        className="pointer-events-none fixed -right-[8%] bottom-0 -z-20 h-[min(55vh,28rem)] w-[min(55vh,28rem)] animate-pulse rounded-full bg-amber-500/20 blur-[100px] motion-reduce:animate-none"
        style={{ animationDuration: "10s" }}
        aria-hidden
      />
      <div
        className="pointer-events-none fixed left-1/2 top-1/4 -z-20 h-[24rem] w-[24rem] -translate-x-1/2 animate-pulse rounded-full bg-cyan-500/10 blur-[140px] motion-reduce:animate-none"
        style={{ animationDuration: "12s" }}
        aria-hidden
      />

      <section className="relative overflow-hidden px-4 py-16 md:py-24">
        <div className="container relative z-0 mx-auto max-w-6xl">
          <div className="mb-12 text-center md:mb-16">
            <h1 className="mb-6 text-4xl font-bold leading-tight text-transparent drop-shadow-[0_0_28px_rgba(250,204,21,0.25)] sm:text-5xl md:text-6xl">
              <span className="bg-gradient-to-r from-amber-300 via-yellow-500 to-amber-200 bg-clip-text">
                {t.heroTitle}
              </span>
            </h1>
            <h2 className="mb-6 text-2xl font-semibold text-cyan-300/95 md:text-3xl [text-shadow:0_0_20px_rgba(34,211,238,0.35)]">
              {t.heroSubtitle}
            </h2>
            <p className="mx-auto mb-10 max-w-3xl text-lg leading-relaxed text-slate-400">
              {t.heroDescription}
            </p>
            <div className="flex flex-col items-center justify-center gap-3 sm:flex-row sm:flex-wrap sm:gap-4">
              <Button
                type="button"
                size="lg"
                className="h-12 border border-cyan-500/30 bg-slate-950/60 px-8 text-base font-semibold text-cyan-100 shadow-[0_0_25px_rgba(6,182,212,0.2)] transition-all duration-500 ease-out hover:border-cyan-400/50 hover:shadow-[0_0_35px_rgba(6,182,212,0.45)]"
                onClick={() => criteriaFileInputRef.current?.click()}
                disabled={uploadBusyKey === "criteria"}
              >
                {uploadBusyKey === "criteria" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {t.uploadCriteria}
                <ArrowRight className="ms-2 h-4 w-4" />
              </Button>
              <Button
                type="button"
                size="lg"
                variant="outline"
                className="h-12 border border-fuchsia-500/40 bg-slate-950/50 px-8 text-base font-semibold text-fuchsia-100 shadow-[0_0_22px_rgba(168,85,247,0.25)] transition-all duration-500 ease-out hover:border-fuchsia-400/60 hover:shadow-[0_0_38px_rgba(168,85,247,0.45)]"
                onClick={() => studentFileInputRef.current?.click()}
                disabled={uploadBusyKey === "student"}
              >
                {uploadBusyKey === "student" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {t.uploadWork}
                <ArrowRight className="ms-2 h-4 w-4" />
              </Button>
            </div>
            <p className="mt-4 flex flex-wrap items-center justify-center gap-4 text-sm text-slate-500">
              <Button variant="link" asChild className="h-auto p-0 text-amber-300/90">
                <Link href="/">{t.exploreCourses}</Link>
              </Button>
              <span className="text-slate-600">·</span>
              <Button variant="link" asChild className="h-auto p-0 text-violet-300 hover:text-violet-200">
                <Link
                  href="/plagiarism"
                  className="[text-shadow:0_0_12px_rgba(167,139,250,0.5)]"
                >
                  فحص الانتحال
                </Link>
              </Button>
            </p>
          </div>

          <div className="grid grid-cols-1 items-center gap-8 md:grid-cols-2 md:gap-12">
            <div className="flex flex-col items-center">
              <div className="mb-6 h-48 w-48 drop-shadow-[0_0_24px_rgba(34,211,238,0.35)] transition-transform duration-500 ease-out hover:scale-[1.02] md:h-56 md:w-56">
                <TeacherAvatar isAnimating={true} />
              </div>
              <SpeechBubble
                text={t.teachingConcept}
                position={language === "ar" ? "right" : "left"}
                className="max-w-xs text-center text-slate-200"
              />
            </div>

            <div className="flex flex-col items-center">
              <div className="mb-6 h-48 w-48 drop-shadow-[0_0_24px_rgba(192,132,252,0.4)] transition-transform duration-500 ease-out hover:scale-[1.02] md:h-56 md:w-56 [animation:float_3s_ease-in-out_infinite] motion-reduce:animate-none">
                <StudentAvatar isAnimating={true} />
              </div>
              <SpeechBubble
                text={t.studentResponse}
                position={language === "ar" ? "left" : "right"}
                className="max-w-xs text-center text-slate-200"
              />
            </div>
          </div>
        </div>
      </section>

      <form ref={formRef} onSubmit={onSubmit} className="contents" id="assessment-form">
        <section
          className="border-t border-white/5 bg-slate-950/40 px-4 py-16 md:py-24"
          id="academic-grid"
        >
          <div className="container mx-auto max-w-6xl">
            <div className="mb-16 text-center">
              <h2 className="mb-4 bg-gradient-to-l from-amber-200/90 to-yellow-500/90 bg-clip-text text-3xl font-bold text-transparent md:text-4xl">
                {t.academicTitle}
              </h2>
              <p className="mx-auto max-w-2xl text-lg text-slate-400">
                {t.academicSubtitle}
              </p>
            </div>

            <div className="mb-10 grid grid-cols-1 gap-6 md:grid-cols-3">
              {dropdownFields.map((field, idx) => (
                <Card
                  key={field.label}
                  className="group rounded-2xl border border-white/10 bg-white/[0.02] shadow-[0_4px_30px_rgba(0,0,0,0.5)] backdrop-blur-2xl transition-all duration-500 ease-out hover:border-cyan-500/50 hover:shadow-[0_0_32px_rgba(34,211,238,0.12)]"
                >
                  <CardContent className="p-6">
                    <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-300 transition-transform duration-500 group-hover:scale-110 group-hover:shadow-[0_0_20px_rgba(34,211,238,0.35)]">
                      {field.icon}
                    </div>
                    <label
                      htmlFor={`academic-select-${idx}`}
                      className="mb-2 block text-base font-bold text-slate-200"
                    >
                      {field.label}
                    </label>
                    <div className="relative">
                      <select
                        id={`academic-select-${idx}`}
                        name={idx === 0 ? "academic_class" : idx === 1 ? "academic_term" : "academic_subject"}
                        value={field.val}
                        onChange={(e) => {
                          field.set(e.target.value);
                          if (idx === 0) {
                            setSelectedSection("");
                            setSelectedSubject("");
                          }
                          if (idx === 1) setSelectedSubject("");
                        }}
                        disabled={field.dis}
                        className="w-full cursor-pointer appearance-none rounded-xl border border-white/10 bg-slate-950/60 py-2.5 ps-3 pe-10 text-sm text-slate-200 shadow-sm transition-all duration-500 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-500/50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <option value="">—</option>
                        {field.opts.map((o: string) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="pointer-events-none absolute end-3 top-1/2 h-5 w-5 -translate-y-1/2 text-cyan-400/60" />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
              {t.academics.map((academic, idx) => (
                <div
                  key={idx}
                  className="rounded-2xl border border-white/5 bg-white/[0.02] p-1 shadow-[0_4px_30px_rgba(0,0,0,0.4)] transition-all duration-500 ease-out hover:border-violet-500/30 hover:shadow-[0_0_28px_rgba(139,92,246,0.2)]"
                >
                  <AcademicCard
                    icon={academic.icon}
                    title={academic.title}
                    description={academic.description}
                    color={academic.color}
                    className="border-0 bg-transparent !shadow-none"
                  />
                </div>
              ))}
            </div>
          </div>
        </section>

        <section
          className="border-t border-white/5 px-4 py-10 md:py-14"
          aria-labelledby="btec-scale-heading"
        >
          <div className="container mx-auto max-w-6xl">
            <BtecGradeScale
              language={language === "ar" ? "ar" : "en"}
              data={btecLadder}
              loading={btecLadderLoading}
            />
          </div>
        </section>

        {assignmentCriteria.trim().length > 0 ? (
          <section
            className="border-t border-white/5 px-4 py-10 md:py-14"
            aria-label={language === "ar" ? "الرفيق التفاعلي الالترا" : "Ultra interactive tutor"}
            id="ultra-tutor"
          >
            <div className="container mx-auto max-w-6xl">
              <UltraTutor
                key={ultraTutorCriterion}
                briefId="inline-assessment"
                briefText={assignmentCriteria}
                currentCriterion={ultraTutorCriterion}
              />
            </div>
          </section>
        ) : null}

        <section className="border-t border-white/5 px-4 py-12 md:py-16">
          <div className="container mx-auto max-w-6xl">
            <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
              <Card className="rounded-2xl border border-cyan-500/20 bg-white/[0.02] shadow-[0_4px_30px_rgba(0,0,0,0.5)] backdrop-blur-2xl transition-all duration-500 ease-out hover:border-cyan-400/40 hover:shadow-[0_0_36px_rgba(6,182,212,0.15)]">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg text-cyan-100">
                    <FileText className="h-5 w-5 text-cyan-400 drop-shadow-[0_0_8px_rgba(34,211,238,0.6)]" />
                    سياق BTEC (المعايير)
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                <input
                  ref={criteriaFileInputRef}
                  id="assessment-criteria-files"
                  name="assignment_criteria_files"
                  type="file"
                  className="hidden"
                  accept=".pdf,.docx,.pptx,.txt"
                  multiple
                  disabled={uploadBusyKey === "criteria"}
                  onChange={(ev) => void handleCriteriaUpload(ev)}
                />
                <div className="mb-4 flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    size="lg"
                    className="h-12 border border-cyan-500/40 bg-slate-950/70 px-6 text-cyan-100 transition-all duration-500 hover:border-cyan-400/70 hover:shadow-[0_0_28px_rgba(6,182,212,0.3)]"
                    disabled={uploadBusyKey === "criteria"}
                    onClick={() => criteriaFileInputRef.current?.click()}
                  >
                    {uploadBusyKey === "criteria" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    رفع ملفات المعايير/الواجب
                  </Button>
                  {uploadBusyKey === "criteria" && <span className="text-xs text-cyan-200/60">جاري الاستخراج…</span>}
                </div>
                <label htmlFor="assignment-criteria" className="mb-2 block text-sm text-slate-400">
                  معايير التقييم / وصف الواجب (اختياري)
                </label>
                <textarea
                  id="assignment-criteria"
                  name="assignment_criteria"
                  value={assignmentCriteria}
                  onChange={(e) => setAssignmentCriteria(e.target.value)}
                  placeholder="ألصق معايير P/M/D أو ارفع ملفات (يُحلل النص عبر /api/parse-file)…"
                  className="min-h-[120px] w-full resize-y rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-200 ring-offset-slate-950 placeholder:text-slate-600 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-500/50"
                />
                </CardContent>
              </Card>

              <Card className="rounded-2xl border border-fuchsia-500/20 bg-white/[0.02] shadow-[0_4px_30px_rgba(0,0,0,0.5)] backdrop-blur-2xl transition-all duration-500 ease-out hover:border-fuchsia-400/40 hover:shadow-[0_0_36px_rgba(192,132,252,0.2)]">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg text-fuchsia-100">
                    <FileText className="h-5 w-5 text-fuchsia-400 drop-shadow-[0_0_8px_rgba(192,132,252,0.7)]" />
                    إجابة الطالب (الحل)
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                <input
                  ref={studentFileInputRef}
                  id="assessment-student-work-files"
                  name="student_work_files"
                  type="file"
                  className="hidden"
                  accept=".pdf,.docx,.pptx,.txt"
                  multiple
                  disabled={uploadBusyKey === "student"}
                  onChange={(ev) => void handleStudentWorkUpload(ev)}
                />
                <div className="mb-4 flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    size="lg"
                    variant="secondary"
                    className="h-12 border border-fuchsia-500/50 bg-slate-950/70 px-6 text-fuchsia-100 transition-all duration-500 hover:border-fuchsia-400 hover:shadow-[0_0_32px_rgba(168,85,247,0.45)]"
                    disabled={uploadBusyKey === "student"}
                    onClick={() => studentFileInputRef.current?.click()}
                  >
                    {uploadBusyKey === "student" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    رفع ملفات إجابة الطالب
                  </Button>
                  {uploadBusyKey === "student" && <span className="text-xs text-fuchsia-200/50">جاري الاستخراج…</span>}
                </div>
                <label htmlFor="student-work" className="mb-2 block text-sm text-slate-400">
                  نص الحل (يُلحق به النص المستخرج من الملفات عبر /api/parse-file)
                </label>
                <textarea
                  id="student-work"
                  name="student_work"
                  value={studentWork}
                  onChange={(e) => setStudentWork(e.target.value)}
                  placeholder="ألصق نص الحل أو ارفع ملفات — يجب أن يظهر النص المستخرج هنا بعد الرفع…"
                  className="min-h-[220px] w-full resize-y rounded-xl border border-fuchsia-500/15 bg-slate-950/60 px-3 py-2 font-mono text-sm text-slate-200 ring-offset-slate-950 placeholder:text-slate-600 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fuchsia-500/50 md:min-h-[240px]"
                />
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                  <span>عدد الكلمات: {formatWordCount(words)}</span>
                  {policy && isFiniteNumber(localPct) && (
                    <span className={localPct > policyConst.maxSimilarity ? "text-rose-400" : "text-emerald-400"}>
                      مؤشر التشابه: {formatFixed1(localPct)}%
                    </span>
                  )}
                </div>
                {policy && isFiniteNumber(localPct) && localPct > policyConst.maxSimilarity && (
                  <label
                    htmlFor="ack-high-similarity"
                    className="mt-3 flex cursor-pointer items-start gap-2 text-sm text-amber-200/90"
                  >
                    <input
                      id="ack-high-similarity"
                      name="ack_high_similarity"
                      type="checkbox"
                      className="mt-1"
                      checked={ackHighSimilarity}
                      onChange={(e) => setAckHighSimilarity(e.target.checked)}
                    />
                    <span>أوافق على المتابعة رغم ارتفاع مؤشر التشابه المحلي (مطلوب لإرسال التقييم).</span>
                  </label>
                )}
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        <section
          ref={primaryCtaRef}
          className="border-t border-amber-500/30 bg-gradient-to-b from-amber-950/30 via-slate-950/60 to-slate-950/90 px-4 py-10 md:py-12"
          aria-labelledby="assessment-primary-cta-heading"
        >
          <div
            className="container mx-auto max-w-3xl text-center"
            dir={language === "ar" ? "rtl" : "ltr"}
          >
            <div
              className="mb-6 flex flex-col items-center justify-center gap-2"
              role="group"
              aria-label={language === "en" ? "View mode" : "وضع العرض"}
            >
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                {language === "en" ? "View as" : "وضع العرض"}
              </p>
              <div className="inline-flex flex-wrap items-center justify-center gap-1 rounded-2xl border border-white/10 bg-slate-950/60 p-1 shadow-[0_0_24px_rgba(0,0,0,0.35)] backdrop-blur-md">
                <button
                  type="button"
                  onClick={() => setViewMode("teacher")}
                  className={cn(
                    "rounded-xl px-4 py-2 text-sm font-semibold transition-all duration-300",
                    viewMode === "teacher"
                      ? "bg-cyan-500/20 text-cyan-100 shadow-[0_0_16px_rgba(6,182,212,0.25)]"
                      : "text-slate-500 hover:text-cyan-200/90"
                  )}
                >
                  {language === "en" ? "Teacher (formal)" : "معلم — تقييم رسمي"}
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("student")}
                  className={cn(
                    "rounded-xl px-4 py-2 text-sm font-semibold transition-all duration-300",
                    viewMode === "student"
                      ? "bg-fuchsia-500/20 text-fuchsia-100 shadow-[0_0_16px_rgba(192,132,252,0.3)]"
                      : "text-slate-500 hover:text-fuchsia-200/90"
                  )}
                >
                  {language === "en" ? "Student (pre-submit scan)" : "طالب — فحص مسبق"}
                </button>
              </div>
            </div>

            {viewMode === "student" ? (
              <>
                <h2
                  id="assessment-primary-cta-heading"
                  className="mb-2 text-lg font-semibold text-fuchsia-100/95 md:text-xl"
                >
                  {language === "en" ? "Pre-Submit Scanner" : "الفحص المسبق للعلامة (Pre-Submit Scanner)"}
                </h2>
                <p className="mb-6 text-sm text-slate-300 md:text-base">
                  {language === "en" ? (
                    <>
                      Scan your work, find gaps, and push toward Merit or Distinction before the real
                      hand-in — on your terms.
                    </>
                  ) : (
                    "افحص واجبك، اكتشف الأخطاء، وارفع علامتك إلى Merit أو Distinction قبل تسليمه لمعلمك."
                  )}
                </p>
              </>
            ) : (
              <>
            <h2
              id="assessment-primary-cta-heading"
              className="mb-2 text-lg font-semibold text-amber-100/95 md:text-xl"
            >
              {language === "en" ? "Run fair grading" : "تشغيل التقييم العادل"}
            </h2>
            <p className="mb-6 text-sm text-slate-400 md:text-base">
              {language === "en"
                ? "When your criteria and student answer are ready, start the assessment here — no need to scroll to the bottom of the page."
                : "عندما تكون معايير الواجب وإجابة الطالب جاهزة، اضغط هنا — لا حاجة للنزول لآخر الصفحة."}
            </p>
              </>
            )}
            {assessLimitBlocked && (
              <p
                className="mb-4 rounded-xl border border-rose-500/35 bg-rose-950/40 px-4 py-3 text-sm text-rose-100"
                role="alert"
              >
                {language === "en"
                  ? "You have reached your monthly assessment limit. Please upgrade your plan."
                  : "لقد وصلتَ إلى الحد الشهري للتقييمات. يرجى ترقية الخطة."}
              </p>
            )}
            {assessNearLimit && !assessLimitBlocked && (
              <p
                className="mb-4 rounded-xl border border-amber-500/40 bg-amber-950/30 px-4 py-3 text-sm text-amber-100"
                role="status"
              >
                ⚠️{" "}
                {language === "en"
                  ? "You are close to your monthly assessment limit."
                  : "اقتربت من الحد المسموح للتقييمات هذا الشهر."}
              </p>
            )}
            <AssessmentCtaButton
              source="primary"
              id="assessment-submit"
              data-onboarding="assessment-run"
              name="assessment_submit"
              language={language === "ar" ? "ar" : "en"}
              size="lg"
              variant="secondary"
              wrapClassName="flex w-full justify-center"
              branding={viewMode === "student" ? "scanner" : "default"}
              className={cn(
                "h-16 w-full min-h-[4rem] max-w-xl border-2 px-8 text-lg font-bold transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] motion-reduce:transition-none motion-reduce:hover:scale-100 motion-reduce:active:scale-100 disabled:opacity-50 disabled:hover:scale-100 active:disabled:scale-100 md:w-auto md:min-w-[20rem] md:px-14",
                viewMode === "student"
                  ? "border-fuchsia-400/50 bg-gradient-to-b from-fuchsia-500/20 to-violet-900/20 text-fuchsia-50 shadow-[0_0_36px_rgba(192,132,252,0.35)] hover:border-fuchsia-300/80 hover:from-fuchsia-500/30 hover:shadow-[0_0_52px_rgba(192,132,252,0.45)]"
                  : "border-amber-400/70 bg-gradient-to-b from-amber-500/25 to-amber-700/20 text-amber-50 shadow-[0_0_32px_rgba(234,179,8,0.25)] hover:border-amber-300 hover:from-amber-500/35 hover:shadow-[0_0_48px_rgba(234,179,8,0.4)]",
                viewMode === "student" && !loading && !ctaFormBlocked && !assessLimitBlocked && "animate-pulse",
              )}
              loading={loading}
              assessLimitBlocked={assessLimitBlocked}
              ctaFormBlocked={ctaFormBlocked}
              ctaBlockReason={ctaBlockReason}
            />
            {loading && viewMode === "student" ? (
              <div
                className="mx-auto mt-6 flex max-w-md flex-col items-center gap-4 rounded-2xl border border-emerald-500/20 bg-slate-950/70 p-6 shadow-[0_0_32px_rgba(16,185,129,0.12)] backdrop-blur-xl"
                role="status"
                aria-live="polite"
                aria-busy
              >
                <div className="relative flex h-24 w-24 items-center justify-center">
                  <span
                    className="absolute inset-0 rounded-full border-2 border-emerald-400/30"
                    aria-hidden
                  />
                  <span
                    className="absolute inset-0 animate-ping rounded-full border border-emerald-400/40"
                    style={{ animationDuration: "1.5s" }}
                    aria-hidden
                  />
                  <ScanSearch
                    className="relative h-10 w-10 text-emerald-400 drop-shadow-[0_0_12px_rgba(52,211,153,0.5)]"
                    aria-hidden
                  />
                </div>
                <p className="text-center text-sm leading-relaxed text-emerald-100/90">
                  {language === "en" ? (
                    <>Scanning your work and matching it to strict Pearson BTEC expectations…</>
                  ) : (
                    "جاري مسح الواجب ومطابقته مع معايير Pearson BTEC الصارمة…"
                  )}
                </p>
              </div>
            ) : null}
            <p className="mt-2 text-center text-sm text-muted-foreground">
              {viewMode === "student"
                ? language === "en"
                  ? "No backend change — same fair engine, student-first framing."
                  : "نفس المحرك العادل — إطار نفسي مخصص للطالب."
                : language === "en"
                  ? "Instant AI grading with detailed feedback"
                  : "تقييم فوري بالذكاء الاصطناعي مع شرح مفصّل"}
            </p>
            {ctaBlockReason === "academic_incomplete" && !uploadBusyKey ? (
              <p className="mt-2 text-center text-xs text-amber-200/80" role="status">
                {language === "en"
                  ? "Choose class, term, and unit from the dropdowns above."
                  : "اختر الصف والفصل والمادة من القوائم أعلاه."}
              </p>
            ) : null}
          </div>
        </section>

        <section className="border-t border-white/5 px-4 py-16 md:py-24">
          <div className="container mx-auto max-w-6xl">
            <div className="mb-16 text-center">
              <h2 className="mb-4 bg-gradient-to-r from-amber-200 via-yellow-400 to-amber-300 bg-clip-text text-3xl font-bold text-transparent drop-shadow-[0_0_24px_rgba(234,179,8,0.25)] md:text-4xl">
                {t.featuresTitle}
              </h2>
            </div>

            <div className="grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-3">
              {t.features.map((feature, idx) => {
                const Icon = feature.icon;
                return (
                  <Card
                    key={idx}
                    className="group rounded-2xl border border-white/10 bg-white/[0.02] shadow-[0_4px_30px_rgba(0,0,0,0.5)] backdrop-blur-2xl transition-all duration-500 ease-out hover:border-cyan-500/40 hover:shadow-[0_0_32px_rgba(6,182,212,0.12)]"
                  >
                    <CardContent className="p-6">
                      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-cyan-500/20 bg-cyan-500/5 transition-transform duration-500 group-hover:scale-110 group-hover:border-cyan-400/50">
                        <Icon className="h-6 w-6 text-cyan-300 drop-shadow-[0_0_8px_rgba(34,211,238,0.5)]" />
                      </div>
                      <h3 className="mb-2 text-lg font-bold text-slate-100">{feature.title}</h3>
                      <p className="text-slate-400">{feature.description}</p>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        </section>

        {showUpgradePromo && upgradePromoMode && (
          <section className="border-t border-cyan-500/20 bg-gradient-to-r from-fuchsia-950/30 via-slate-950/60 to-cyan-950/30 px-4 py-10 md:py-12">
            <div
              className="container relative mx-auto max-w-3xl overflow-hidden rounded-2xl border border-amber-400/30 bg-white/[0.04] p-6 shadow-[0_0_40px_rgba(234,179,8,0.12)] backdrop-blur-xl md:p-8"
              dir={language === "ar" ? "rtl" : "ltr"}
            >
              <div
                className="pointer-events-none absolute -end-6 -top-6 h-32 w-32 rounded-full bg-amber-400/20 blur-3xl"
                aria-hidden
              />
              <div className="relative flex flex-col gap-4 text-start md:flex-row md:items-center md:justify-between">
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-amber-300/90">
                    {language === "en" ? "You're using Eduverse to the max" : "تستخدم المنصة بكامل طاقتها"}
                  </p>
                  <h3 className="text-lg font-bold text-slate-100 md:text-xl">
                    {language === "en"
                      ? upgradePromoMode === "pro"
                        ? "Unlock more assessments & headroom on Pro"
                        : "Go Unlimited — no monthly caps"
                      : upgradePromoMode === "pro"
                        ? "أطلق المزيد من التقييمات والمساحة مع Pro"
                        : "ترقية Unlimited — بلا سقف شهري"}
                  </h3>
                  <ul className="space-y-1.5 text-sm text-slate-300">
                    <li className="flex items-start gap-2">
                      <Zap className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                      {language === "en" ? "More fair-use capacity each month" : "سعة أعلى شهرياً لاستخدام عادل"}
                    </li>
                    <li className="flex items-start gap-2">
                      <Zap className="mt-0.5 h-4 w-4 shrink-0 text-cyan-400" />
                      {language === "en" ? "Faster path through grading & checks" : "مسار أسرع للتقييم والفحوصات"}
                    </li>
                    <li className="flex items-start gap-2">
                      <Zap className="mt-0.5 h-4 w-4 shrink-0 text-fuchsia-400" />
                      {language === "en" ? "Advanced scale when your classes grow" : "توسّع أقوى مع نمو فصولك"}
                    </li>
                  </ul>
                </div>
                <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
                  <Button
                    asChild
                    className="h-12 border border-amber-400/50 bg-amber-500/10 px-8 font-semibold text-amber-100 shadow-[0_0_24px_rgba(234,179,8,0.25)] transition-all duration-500 hover:border-amber-300 hover:bg-amber-500/20 hover:shadow-[0_0_36px_rgba(234,179,8,0.35)]"
                  >
                    <Link href="/pricing">
                      {language === "en" ? "Upgrade now" : "ترقية الآن"}
                    </Link>
                  </Button>
                  <p className="text-center text-xs text-slate-500 sm:text-end">
                    {language === "en" ? "Secure checkout via Stripe" : "دفع آمن عبر Stripe"}
                  </p>
                </div>
              </div>
            </div>
          </section>
        )}

        <section className="relative overflow-hidden border-t border-white/10 px-4 py-16 md:py-24">
          <div
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(234,179,8,0.1),transparent_55%)]"
            aria-hidden
          />
          <div className="relative container mx-auto max-w-3xl text-center">
            <h2 className="mb-6 bg-gradient-to-r from-amber-200 via-yellow-400 to-amber-100 bg-clip-text text-3xl font-bold text-transparent drop-shadow-[0_0_20px_rgba(234,179,8,0.2)] md:text-4xl">
              {t.ctaTitle}
            </h2>
            <p className="mb-8 text-lg text-slate-300">{t.ctaDescription}</p>
            {assessLimitBlocked && (
              <p
                className="mb-4 rounded-xl border border-rose-500/35 bg-rose-950/40 px-4 py-3 text-sm text-rose-100"
                role="alert"
              >
                {language === "en"
                  ? "You have reached your monthly assessment limit. Please upgrade your plan."
                  : "لقد وصلتَ إلى الحد الشهري للتقييمات. يرجى ترقية الخطة."}
              </p>
            )}
            {assessNearLimit && !showUpgradePromo && (
              <p
                className="mb-4 rounded-xl border border-amber-500/40 bg-amber-950/30 px-4 py-3 text-sm text-amber-100"
                role="status"
              >
                ⚠️ {language === "en" ? "You are close to your monthly assessment limit." : "اقتربت من الحد المسموح للتقييمات هذا الشهر."}
              </p>
            )}
            <AssessmentCtaButton
              source="footer"
              id="assessment-submit-footer"
              data-onboarding="assessment-run-footer"
              name="assessment_submit_footer"
              language={language === "ar" ? "ar" : "en"}
              size="lg"
              variant="secondary"
              compact
              wrapClassName="flex justify-center"
              branding={viewMode === "student" ? "scanner" : "default"}
              className={cn(
                "h-14 min-w-[12.5rem] border px-10 text-base font-semibold transition-all duration-200 hover:scale-[1.01] ease-out active:scale-[0.99] disabled:opacity-50 disabled:hover:scale-100",
                viewMode === "student"
                  ? "border-fuchsia-500/50 bg-slate-950/90 text-fuchsia-100 shadow-[0_0_28px_rgba(192,132,252,0.2)] hover:border-fuchsia-300 hover:bg-slate-900 hover:shadow-[0_0_40px_rgba(192,132,252,0.35)]"
                  : "border-amber-400/60 bg-slate-950/90 text-amber-200 shadow-[0_0_24px_rgba(234,179,8,0.15)] hover:border-amber-300 hover:bg-slate-900 hover:text-amber-100 hover:shadow-[0_0_40px_rgba(234,179,8,0.4)]",
                viewMode === "student" && !loading && !ctaFormBlocked && !assessLimitBlocked && "animate-pulse",
              )}
              loading={loading}
              assessLimitBlocked={assessLimitBlocked}
              ctaFormBlocked={ctaFormBlocked}
              ctaBlockReason={ctaBlockReason}
            />
            {loading && viewMode === "student" ? (
              <div
                className="mx-auto mt-6 flex max-w-md flex-col items-center gap-3 rounded-2xl border border-emerald-500/20 bg-slate-950/70 p-5 shadow-[0_0_32px_rgba(16,185,129,0.1)] backdrop-blur-xl"
                role="status"
                aria-live="polite"
                aria-busy
              >
                <div className="relative flex h-20 w-20 items-center justify-center">
                  <span className="absolute inset-0 animate-ping rounded-full border border-emerald-400/35" style={{ animationDuration: "1.5s" }} aria-hidden />
                  <Radar className="relative h-9 w-9 text-emerald-400" aria-hidden />
                </div>
                <p className="text-center text-sm text-emerald-100/90">
                  {language === "en" ? (
                    <>Matching your draft to BTEC bar — hang tight…</>
                  ) : (
                    "جاري مسح الواجب ومطابقته مع معايير Pearson BTEC الصارمة…"
                  )}
                </p>
              </div>
            ) : loading ? (
              <div
                className="mx-auto mt-6 max-w-md space-y-3 rounded-2xl border border-amber-500/20 bg-slate-950/70 p-4 text-start shadow-[0_0_32px_rgba(234,179,8,0.08)] backdrop-blur-xl"
                role="status"
                aria-live="polite"
                aria-busy
              >
                <Skeleton className="h-3 w-[75%] bg-amber-950/50" />
                <Skeleton className="h-3 w-full bg-amber-950/50" />
                <Skeleton className="h-3 w-[83%] bg-amber-950/50" />
                <p className="text-center text-sm text-slate-400">
                  {language === "en" ? "Grading in progress — almost there." : "جاري التقييم… يرجى الانتظار."}
                </p>
              </div>
            ) : null}
          </div>
        </section>

        {stickyCtaVisible && (
          <div
            className="pointer-events-auto fixed bottom-4 start-4 end-4 z-50 flex justify-center md:start-auto md:end-auto md:mx-auto md:max-w-lg"
            role="region"
            aria-label={language === "en" ? "Start assessment" : "ابدأ التقييم"}
          >
            <div className="w-full rounded-2xl border border-amber-500/40 bg-slate-950/95 p-3 shadow-[0_8px_32px_rgba(0,0,0,0.5)] backdrop-blur-md supports-[padding:max(0px)]:pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              <AssessmentCtaButton
                source="sticky"
                id="assessment-submit-sticky"
                data-onboarding="assessment-run-sticky"
                name="assessment_submit_sticky"
                language={language === "ar" ? "ar" : "en"}
                size="lg"
                variant="secondary"
                compact
                wrapClassName="w-full"
                branding={viewMode === "student" ? "scanner" : "default"}
                className={cn(
                  "h-12 w-full border px-4 text-sm font-semibold transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:hover:scale-100",
                  viewMode === "student"
                    ? "border-fuchsia-400/50 bg-fuchsia-500/10 text-fuchsia-100"
                    : "border-amber-400/60 bg-amber-500/10 text-amber-100",
                )}
                loading={loading}
                assessLimitBlocked={assessLimitBlocked}
                ctaFormBlocked={ctaFormBlocked}
                ctaBlockReason={ctaBlockReason}
              />
            </div>
          </div>
        )}
      </form>

      <section className="border-t border-white/5 bg-[#030712]/90 px-4 py-12 md:py-16">
        <div className="container mx-auto max-w-6xl">
          <div className="grid grid-cols-1 gap-8 sm:grid-cols-3">
            <Card className="rounded-2xl border border-white/10 bg-white/[0.02] shadow-[0_4px_30px_rgba(0,0,0,0.5)] backdrop-blur-2xl transition-all duration-500 ease-out hover:border-amber-500/35">
              <CardContent className="p-6 text-center">
                <div className="mb-2 bg-gradient-to-r from-amber-300 via-yellow-500 to-amber-200 bg-clip-text text-4xl font-bold text-transparent drop-shadow-[0_0_20px_rgba(234,179,8,0.35)] md:text-5xl">
                  50K+
                </div>
                <p className="text-slate-400">{language === "en" ? "Active Students" : "الطلاب النشطين"}</p>
              </CardContent>
            </Card>
            <Card className="rounded-2xl border border-white/10 bg-white/[0.02] shadow-[0_4px_30px_rgba(0,0,0,0.5)] backdrop-blur-2xl transition-all duration-500 ease-out hover:border-cyan-500/35">
              <CardContent className="p-6 text-center">
                <div className="mb-2 bg-gradient-to-r from-cyan-300 to-sky-200 bg-clip-text text-4xl font-bold text-transparent drop-shadow-[0_0_18px_rgba(6,182,212,0.4)] md:text-5xl">
                  500+
                </div>
                <p className="text-slate-400">{language === "en" ? "Expert Courses" : "الدورات الخبيرة"}</p>
              </CardContent>
            </Card>
            <Card className="rounded-2xl border border-white/10 bg-white/[0.02] shadow-[0_4px_30px_rgba(0,0,0,0.5)] backdrop-blur-2xl transition-all duration-500 ease-out hover:border-fuchsia-500/35">
              <CardContent className="p-6 text-center">
                <div className="mb-2 bg-gradient-to-r from-fuchsia-300 to-violet-300 bg-clip-text text-4xl font-bold text-transparent drop-shadow-[0_0_20px_rgba(192,132,252,0.45)] md:text-5xl">
                  98%
                </div>
                <p className="text-slate-400">{language === "en" ? "Success Rate" : "معدل النجاح"}</p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {result && (
        <section className="relative border-t border-white/10 bg-gradient-to-b from-[#030712] to-slate-950/90 px-4 py-10 md:py-14">
          <div
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_20%_0%,rgba(168,85,247,0.1),transparent_50%),radial-gradient(ellipse_at_80%_100%,rgba(234,179,8,0.07),transparent_45%)]"
            aria-hidden
          />
          <div className="relative container mx-auto max-w-6xl">
            <Card className="mt-2 animate-in fade-in slide-in-from-bottom-2 duration-500 rounded-3xl border border-white/10 bg-white/[0.02] shadow-[0_8px_40px_rgba(0,0,0,0.55)] backdrop-blur-2xl ring-1 ring-amber-500/15">
              <CardContent className="p-6 md:p-8">
                <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <h3 className="flex items-center gap-2 text-xl font-semibold leading-tight tracking-tight">
                    <span
                      className={cn(
                        "flex items-center gap-2 rounded-xl border px-4 py-2 text-base font-semibold shadow-[0_0_20px_rgba(234,179,8,0.15)]",
                        viewMode === "student"
                          ? "border-fuchsia-500/40 bg-gradient-to-r from-fuchsia-500/15 to-violet-500/5 text-fuchsia-100"
                          : "border-amber-400/40 bg-gradient-to-r from-amber-500/10 to-yellow-500/5 text-amber-100",
                      )}
                    >
                      {viewMode === "student" ? (
                        <Radar
                          className="h-5 w-5 shrink-0 text-fuchsia-300 drop-shadow-[0_0_6px_rgba(192,132,252,0.6)]"
                          aria-hidden
                        />
                      ) : (
                        <ClipboardCheck
                          className="h-5 w-5 shrink-0 text-amber-300 drop-shadow-[0_0_6px_rgba(234,179,8,0.6)]"
                          aria-hidden
                        />
                      )}
                      {viewMode === "student"
                        ? ar
                          ? "نتيجة الفحص المسبق"
                          : "Pre-submit scan result"
                        : "النتيجة النهائية"}
                    </span>
                  </h3>
                  <div
                    className="inline-flex flex-shrink-0 rounded-xl border border-cyan-500/25 bg-slate-950/70 p-1 text-xs shadow-[0_0_24px_rgba(6,182,212,0.08)]"
                    role="group"
                    aria-label="وضع العرض"
                  >
                    <button
                      type="button"
                      onClick={() => setViewMode("teacher")}
                      className={cn(
                        "rounded-lg px-4 py-2 font-medium transition-all duration-500",
                        viewMode === "teacher"
                          ? "bg-cyan-500/25 text-cyan-100 shadow-[0_0_16px_rgba(6,182,212,0.35)]"
                          : "text-slate-500 hover:text-cyan-200/90"
                      )}
                    >
                      وضع المعلم
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewMode("student")}
                      className={cn(
                        "rounded-lg px-4 py-2 font-medium transition-all duration-500",
                        viewMode === "student"
                          ? "bg-fuchsia-500/25 text-fuchsia-100 shadow-[0_0_16px_rgba(192,132,252,0.35)]"
                          : "text-slate-500 hover:text-fuchsia-200/90"
                      )}
                    >
                      وضع الطالب
                    </button>
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="relative rounded-2xl p-[2px] shadow-[0_0_48px_rgba(16,185,129,0.18)] [background:linear-gradient(135deg,rgba(52,211,153,0.5),rgba(234,179,8,0.4),rgba(6,182,212,0.45))]">
                    <div
                      className={cn(
                        "rounded-[14px] border p-8 text-center text-3xl font-bold tracking-tight md:text-4xl",
                        gradeVisual(result.grade_band)
                      )}
                    >
                      {gradeBandLabelAr(result.grade_band)}
                    </div>
                  </div>
                  <GradingResultHints
                    gradeBand={result.grade_band}
                    language={language === "ar" ? "ar" : "en"}
                    corpusDegraded={corpusStatusUi === "fallback" || corpusStatusUi === "unavailable"}
                  />
                  {result.consistency_validation?.uncertain_grading && (
                    <p className="text-center text-sm text-amber-400/90">
                      تنبيه: الدرجتان (الأولى والمُعاد فحصها) اختلفتا في نمط &quot;محقق/غير محقق&quot; — عُلّم الناتج
                      بأنه غير مؤكد.
                    </p>
                  )}

                  {(corpusStatusUi === "fallback" || corpusStatusUi === "unavailable") && (
                    <div
                      className="status-warning rounded-xl px-4 py-3 text-sm"
                      role="status"
                    >
                      {corpusStatusUi === "fallback" ? (
                        <>
                          <p className="font-semibold">
                            ⚠️ لم يتم استخدام المقارنة النصية في هذا التقييم (تم المتابعة في وضع بديل)
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            تم التقييم بدون مقارنة متقدمة. السبب: تعذر الوصول لخدمة التضمين (embedding) مؤقتًا — الدرج
                            الأساسي (P/M/D) ما زال ساريًا.
                          </p>
                        </>
                      ) : (
                        <>
                          <p className="font-semibold">تعذر استخدام المقارنة النصية</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            قد يكون السبب نصًا قصيرًا جدًا، أو تعذر الاتصال بالشبكة، أو عدم جاهزية قاعدة البيانات. تم
                            إكمال التقييم دون فحص تشابه المتجهات.
                          </p>
                        </>
                      )}
                    </div>
                  )}

                  {viewMode === "teacher" && (
                    <>
                    <div className="rounded-xl border border-violet-900/50 bg-violet-950/20 p-6">
                      <h4 className="mb-3 text-sm font-bold text-violet-300">لوحة سريعة (معلم)</h4>
                      {(teacherPanel?.submission_format_label || result.submission_format_label) && (
                        <p className="mb-3 text-xs text-cyan-200/95" role="status">
                          نوع الإجابة المكتشف:{" "}
                          <span className="font-medium text-cyan-100">
                            {teacherPanel?.submission_format_label ?? result.submission_format_label}
                          </span>
                        </p>
                      )}
                      {typeof teacherPanel?.spec_quality === "number" && (
                        <p className="mb-2 text-xs text-slate-400" role="status">
                          جودة مواصفة PASS0: {(teacherPanel.spec_quality * 100).toFixed(0)}٪
                          {teacherPanel.spec_penalties_disabled ? (
                            <span className="ms-2 text-amber-300/90">
                              — عقوبات الاعتماد على PASS0 مُعطّلة (مواصفة ضعيفة)
                            </span>
                          ) : null}
                        </p>
                      )}
                      {typeof teacherPanel?.grade_band_stability_applied === "boolean" &&
                        teacherPanel.grade_band_stability_applied && (
                          <p className="mb-2 text-xs text-emerald-300/90" role="status">
                            حارس الاستقرار: معظم صفوف المعايير «متحقق» — تم ضمان ألا ينزف النطاق لأقل من ناجح (Pass) حسب
                            نسبة التحقيق (موزونة P/M/D).
                          </p>
                        )}
                      {typeof teacherPanel?.grade_band_upper_guard_applied === "boolean" &&
                        teacherPanel.grade_band_upper_guard_applied && (
                          <p className="mb-2 text-xs text-violet-300/90" role="status">
                            حارس علوي: تم خفض النطاق إن لزم (مثلاً Distinction دون صف D متحقق، أو Merit دون صف M متحقق).
                          </p>
                        )}
                      {typeof teacherPanel?.overall_confidence === "number" && (
                        <p className="mb-2 text-xs text-cyan-200/90" role="status">
                          ثقة إجمالية (متوسّط الصفوف المتحققة، مضبوط 0.4–0.95):{" "}
                          {(teacherPanel.overall_confidence * 100).toFixed(0)}٪
                        </p>
                      )}
                      {teacherPanel?.audit && (
                        <details className="mb-2 rounded-lg border border-slate-700 bg-slate-950/50 p-2 text-[0.65rem] text-slate-400">
                          <summary className="cursor-pointer font-semibold text-slate-500">سجل تدقيق (Audit)</summary>
                          <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap font-mono">
                            {JSON.stringify(teacherPanel.audit, null, 2)}
                          </pre>
                        </details>
                      )}
                      {typeof teacherPanel?.student_level === "string" && teacherPanel.student_level && (
                        <p className="mb-1 text-[0.65rem] text-slate-500">
                          مستوى المتعلم: {teacherPanel.student_level}
                          {teacherPanel.relax_thresholds ? " · عتبات مرتخية (L2)" : ""}
                        </p>
                      )}
                      {teacherPanel?.assignment_spec_brief?.ok && (
                        <p className="mb-3 text-xs text-violet-200/90" role="status">
                          فهم الواجب (قبل التقييم): نوع المهمة{" "}
                          <span className="font-medium text-violet-100">
                            {teacherPanel.assignment_spec_brief.assignment_type ?? "—"}
                          </span>
                          {typeof teacherPanel.assignment_spec_brief.expected_format === "string" ? (
                            <>
                              {" "}
                              · التنسيق المتوقع: {teacherPanel.assignment_spec_brief.expected_format}
                            </>
                          ) : null}
                          {typeof teacherPanel.assignment_spec_brief.criteria_count === "number" ? (
                            <span className="text-slate-400">
                              {" "}
                              · معايير بمواصفة دنيا عادلة: {teacherPanel.assignment_spec_brief.criteria_count}
                            </span>
                          ) : null}
                        </p>
                      )}
                      {teacherPanel &&
                      Array.isArray(teacherPanel.criteria_summary) &&
                      teacherPanel.criteria_summary.length > 0 ? (
                        <div className="space-y-3 text-sm text-slate-200">
                          <ul className="space-y-2">
                            {teacherPanel.criteria_summary.map((row) => (
                              <TeacherCriterionStatusStrip
                                key={row.code}
                                row={{ code: row.code, achieved: row.achieved, minimum_acceptable: row.minimum_acceptable }}
                              >
                                {typeof row.criterion_confidence === "number" && (
                                  <p className="ms-7 text-xs text-slate-500">
                                    ثقة النموذج لهذا السطر: {(row.criterion_confidence * 100).toFixed(0)}٪
                                  </p>
                                )}
                                {row.confidence_summary_ar && row.confidence_summary_ar.length > 0 && (
                                  <div className="ms-7 mt-1 rounded-md border border-cyan-900/40 bg-cyan-950/20 px-2 py-1.5">
                                    <p className="text-[0.65rem] font-semibold text-cyan-400/90">ملخص سريع</p>
                                    <ul className="list-inside list-disc text-[0.7rem] leading-relaxed text-cyan-100/90">
                                      {row.confidence_summary_ar.map((line) => (
                                        <li key={line}>{line}</li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                                {row.confidence_reason && row.confidence_reason.length > 0 && (
                                  <div className="ms-7 mt-1 rounded-md border border-slate-600/60 bg-slate-950/40 px-2 py-1.5">
                                    <p className="text-[0.65rem] font-semibold text-slate-500">🧠 تفاصيل أسباب الثقة</p>
                                    <ul className="list-inside list-disc text-[0.7rem] leading-relaxed text-slate-400">
                                      {row.confidence_reason.map((tag) => (
                                        <li key={tag}>{CONFIDENCE_REASON_AR[tag] ?? tag}</li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                              </TeacherCriterionStatusStrip>
                            ))}
                          </ul>
                          {teacherPanel.flags && teacherPanel.flags.length > 0 && (
                            <div className="rounded-lg border border-amber-800/50 bg-amber-950/20 p-3">
                              <p className="mb-1 text-xs font-bold text-amber-400/90">⚠️ علامات النظام</p>
                              <ul className="list-inside list-disc text-xs text-amber-200/90">
                                {teacherPanel.flags.map((f) => (
                                  <li key={f}>{f}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {typeof teacherPanel.confidence === "number" && (
                            <p className="text-xs text-slate-500">
                              متوسّط ثقة صفوف المعايير: {(teacherPanel.confidence * 100).toFixed(0)}٪
                            </p>
                          )}
                          {teacherPanel.evidence_diversity_ok === false && (
                            <p className="text-xs text-amber-200/80">تنوع الأدلة عبر الملفات: منخفض</p>
                          )}
                          {teacherPanel.criteria_undetected && (
                            <p className="text-xs text-amber-200/80">تعذّر اكتشاف رموز معايير (P/M/D) من نص المهمة.</p>
                          )}
                        </div>
                      ) : (
                        <p className="text-sm text-slate-500">لا يوجد ملخص معايير (عدّل الإرسال أو أعد التقييم).</p>
                      )}
                    </div>

                    <div className="rounded-xl border border-fuchsia-900/40 bg-fuchsia-950/15 p-6">
                      <h4 className="mb-2 text-sm font-bold text-fuchsia-200">تعلم أسلوب المعلم (اختياري)</h4>
                      <p className="mb-4 text-xs leading-relaxed text-slate-400">
                        بعد أن ترى المثال الإرشادي في وضع الطالب، الصق هنا <strong>نسختك</strong> من نص الحل. يقارن النظام
                        أصل حل الطالب مع تعديلك ويخزّن <em>أنواع</em> التحسين (مثل إضافة سبب أو مثال) — لتلميحات
                        لاحقة فقط، دون تغيير معايير التقدير.
                      </p>
                      <label htmlFor="teacher-edit-draft" className="mb-1 block text-xs text-slate-500">
                        نصك بعد التعديل (كما ينبغي أن يكون)
                      </label>
                      <textarea
                        id="teacher-edit-draft"
                        name="teacher_edit_draft"
                        value={teacherEditDraft}
                        onChange={(e) => setTeacherEditDraft(e.target.value)}
                        placeholder="مثال: أعد صياغة فقرة الطالب بأسلوبك، مع إضافة السبب أو المثال الذي تفضّله…"
                        className="mb-3 min-h-[120px] w-full resize-y rounded-lg border border-slate-600 bg-slate-900/60 p-3 text-sm text-slate-100 outline-none focus:ring-1 focus:ring-fuchsia-500/60"
                      />
                      <div className="flex flex-wrap items-center gap-3">
                        <button
                          type="button"
                          onClick={() => void handleTeacherEditSave()}
                          disabled={teacherEditBusy || !teacherEditDraft.trim()}
                          className="rounded-lg bg-fuchsia-700/80 px-4 py-2 text-sm font-semibold text-white transition hover:bg-fuchsia-600 disabled:opacity-40"
                        >
                          {teacherEditBusy ? <Loader2 className="inline h-4 w-4 animate-spin" /> : null}
                          {teacherEditBusy ? " جارٍ الحفظ…" : "تسجيل تعديل المعلم"}
                        </button>
                      </div>
                    </div>
                    </>
                  )}

                  {viewMode === "student" && (
                    <>
                  {progressMomentum && (
                    <div
                      className="rounded-xl border border-sky-800/50 bg-sky-950/25 p-4 text-sm leading-relaxed text-sky-100/95"
                      role="status"
                    >
                      <p className="mb-1 text-[0.65rem] font-bold uppercase tracking-wide text-sky-300/90">تقدّم</p>
                      <p>📊 {progressMomentum}</p>
                    </div>
                  )}
                  <div className="rounded-2xl border border-cyan-500/20 bg-white/[0.02] p-6 shadow-[0_4px_30px_rgba(0,0,0,0.4)] backdrop-blur-xl">
                    <h4 className="mb-2 text-sm font-bold text-cyan-300 drop-shadow-[0_0_8px_rgba(34,211,238,0.35)]">
                      التبرير الأكاديمي (Rationale)
                    </h4>
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-300">{result.rationale}</p>
                  </div>

                  {studentFeedbackBlocks.length > 0 && (
                    <div className="rounded-xl border border-emerald-900/40 bg-emerald-950/20 p-6">
                      <h4 className="mb-3 text-sm font-bold text-emerald-300/95">تغذية راجعة موجّهة (للطالب)</h4>
                      <p className="mb-4 text-xs leading-relaxed text-slate-400">
                        ملاحظات تربوية بلغة واضحة — توجّه التفكير للتحسين دون تقديم حل جاهز.
                      </p>
                      <ul className="space-y-4 text-sm leading-relaxed text-slate-200">
                        {studentFeedbackBlocks.map((block, idx) => (
                          <li
                            key={idx}
                            className="rounded-lg border border-emerald-800/50 bg-slate-900/40 p-4 whitespace-pre-wrap"
                          >
                            {block}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {studentImprovementPayload && (
                    <div className="mt-2 rounded-xl border border-sky-900/50 bg-sky-950/25 p-6">
                      <h3 className="text-base font-bold text-sky-200">مثال توجيهي للتحسين (إرشاد ذكي)</h3>
                      <p className="mt-1 text-xs leading-relaxed text-slate-500">
                        يظهر نص المثال فقط بعد الموافقة — لتقليل النسخ السريع دون وعي.
                      </p>

                      {!guidedImprovementUnlocked ? (
                        <div className="relative mt-4 min-h-[12rem] overflow-hidden rounded-xl border border-white/10 bg-slate-950/40 p-6 text-center">
                          <div
                            className="pointer-events-none absolute inset-0 z-0 select-none opacity-30 blur-md"
                            aria-hidden
                          >
                            <p className="px-4 pt-2 text-right text-sm leading-loose text-slate-200">
                              ████████████████████████████
                              <br />
                              ██████████████████
                            </p>
                          </div>
                          <div className="absolute inset-0 z-[1] bg-slate-950/75 backdrop-blur-sm" />
                          <div className="relative z-10 flex min-h-[10rem] flex-col items-center justify-center gap-4 px-2">
                            <p className="max-w-md text-sm leading-relaxed text-slate-300">
                              جُهّزت تلميحات لتحسين صياغة إجابتك باتجاه مستوى أعلى. للاطلاع عليها، يجب
                              الالتزام بسياسة النزاهة (Pearson BTEC) أولاً.
                            </p>
                            <AIIntegrityWarning
                              buttonText="عرض التلميحات (بموافقة سياسة BTEC)"
                              onAccept={() => setGuidedImprovementUnlocked(true)}
                            />
                          </div>
                        </div>
                      ) : (
                        <div className="mt-4 animate-in fade-in duration-300">
                      <p className="mb-3 flex flex-wrap items-center gap-2 text-xs text-amber-200/95">
                        <span className="font-semibold">⚠️</span>
                        <span>
                          مثال <strong>إرشادي</strong> فقط — ليس إجابة جاهزة للتسليم. استخدمه كاتجاه تفكير.
                        </span>
                        <span
                          className="rounded border border-amber-700/60 bg-amber-950/40 px-2 py-0.5 text-[0.65rem] text-amber-300/90"
                          title="النمط لا يعوّض الدرجة ولا يلغي قواعد النزاهة"
                        >
                          {studentImprovementPayload.mode}
                        </span>
                        {studentImprovementPayload.teacher_memory_used ? (
                          <span
                            className="rounded border border-fuchsia-700/50 bg-fuchsia-950/50 px-2 py-0.5 text-[0.65rem] text-fuchsia-200/90"
                            title="تم تلميع التحسين الإرشادي بتوجيهات مجمّعة من أنماط تعديل عدة معلمين + سياق المادة (لا يغيّر الدرجة)"
                          >
                            توجيه من ممارسات المعلمين
                          </span>
                        ) : null}
                      </p>
                      {studentImprovementPayload.teacher_memory_used &&
                        Array.isArray(studentImprovementPayload.memory_explanation) &&
                        studentImprovementPayload.memory_explanation.length > 0 && (
                          <div className="mb-3 rounded-lg border border-fuchsia-900/30 bg-fuchsia-950/20 p-3 text-xs leading-relaxed text-fuchsia-100/90">
                            <p className="mb-1.5 font-semibold text-fuchsia-200/95">🧠 تمت الإشارة — في المسار الإرشادي فقط — إلى:</p>
                            <ul className="list-inside list-disc space-y-1 text-slate-300/95">
                              {studentImprovementPayload.memory_explanation.map((line, i) => (
                                <li key={i}>{line}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      <h4 className="mb-1 text-sm font-bold text-sky-300">
                        مثال على تطوير إجابتك نحو مستوى {studentImprovementPayload.target_level}
                      </h4>
                      {studentImprovementPayload.source_grade_band && (
                        <p className="mb-3 text-xs text-slate-500">
                          استناداً إلى تقديرك الحالي: {studentImprovementPayload.source_grade_band}
                        </p>
                      )}
                      {studentImprovementPayload.style_guard_triggered && (
                        <p className="mb-2 rounded border border-amber-800/50 bg-amber-950/30 p-2 text-xs text-amber-200/90">
                          تم تعليق التعديل التلقائي لأن المخرج بدا بعيداً جداً عن أسلوبك (Style Guard) أو تعذّر
                          الاستخراج. يظهر نصك الأصلي كما هو.
                        </p>
                      )}
                      <div className="mb-4 max-h-80 overflow-y-auto rounded-lg border border-slate-600/80 bg-slate-900/50 p-4 text-sm leading-relaxed text-slate-200">
                        <p className="whitespace-pre-wrap">
                          {studentImprovementPayload.improved || "—"}
                        </p>
                      </div>
                      {Array.isArray(studentImprovementPayload.notes) && studentImprovementPayload.notes.length > 0 && (
                        <div className="mb-3">
                          <h5 className="mb-2 text-xs font-bold text-slate-400">ما تمت الإشارة إليه / تم تحسينه</h5>
                          <ul className="list-inside list-disc space-y-1 text-sm text-slate-300">
                            {studentImprovementPayload.notes.map((n, i) => (
                              <li key={i}>{n}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {typeof studentImprovementPayload.similarity === "number" && (
                        <p className="mb-2 text-xs text-slate-500">
                          تشابه النص مع أصلك: {(studentImprovementPayload.similarity * 100).toFixed(0)}٪
                        </p>
                      )}
                      {studentImprovementPayload.diff_preview && studentImprovementPayload.diff_preview.trim() ? (
                        <details className="text-xs text-slate-400">
                          <summary className="cursor-pointer text-slate-500 hover:text-slate-300">
                            عرض مقتطف اختلاف (سطور) — اختياري
                          </summary>
                          <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded border border-slate-700 bg-slate-950/80 p-2 font-mono text-[0.65rem] leading-relaxed">
                            {studentImprovementPayload.diff_preview}
                          </pre>
                        </details>
                      ) : null}
                        </div>
                      )}
                    </div>
                  )}

                  {result.criteria_results && result.criteria_results.length > 0 && (
                    <div className="space-y-6" id="criteria-pmd-heading">
                      {studentCriteriaSecured.length > 0 && (
                        <div className="rounded-2xl border border-emerald-500/35 bg-gradient-to-br from-emerald-950/45 to-slate-950/50 p-4 shadow-[0_0_32px_rgba(16,185,129,0.14)] backdrop-blur-2xl sm:p-6">
                          <h4 className="mb-3 flex flex-wrap items-center gap-2 text-base font-bold text-emerald-100">
                            <span aria-hidden>✅</span>
                            {ar ? "النقاط المضمونة (Secured Grades)" : "Secured Grades"}
                          </h4>
                          <ul className="space-y-3 text-sm text-slate-200" role="list">
                            {studentCriteriaSecured.map((row) => (
                              <li
                                key={row.code}
                                className="rounded-xl border border-emerald-500/25 bg-slate-950/45 p-4 shadow-[0_4px_24px_rgba(0,0,0,0.3)]"
                              >
                                <CriterionStatusBlock
                                  row={row}
                                  assignmentContext={result.assignment_context}
                                  assignmentSpec={result.assignment_spec}
                                  extraNotAchievedNote={null}
                                />
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {studentCriteriaGap.length > 0 && (
                        <div className="rounded-2xl border border-amber-400/40 bg-gradient-to-br from-amber-950/30 via-slate-900/50 to-sky-950/40 p-4 shadow-[0_0_32px_rgba(251,191,36,0.12)] backdrop-blur-2xl sm:p-6">
                          <h4 className="mb-3 flex flex-wrap items-center gap-2 text-base font-bold text-amber-50">
                            <span aria-hidden>🎯</span>
                            {ar ? "فرص الترقية (Upgrade Opportunities)" : "Upgrade Opportunities"}
                          </h4>
                          <p className="mb-4 text-xs text-slate-400">
                            {ar
                              ? "تركّز على أقرب خطوة — بدون وسم «رَسُوب»; كل سطر أدناه تلميح عملي."
                              : "Actionable next steps — we never label this as “failure”."}
                          </p>
                          <ul className="space-y-6 text-sm text-slate-200" role="list">
                            {studentCriteriaGap.map((row) => (
                              <li
                                key={row.code}
                                className="rounded-2xl border border-sky-500/25 bg-slate-950/55 p-4 shadow-[0_4px_24px_rgba(0,0,0,0.35)] sm:p-5"
                              >
                                <p className="mb-3 leading-relaxed text-slate-100">
                                  {ar ? (
                                    <>
                                      ينقصك هذا لتصل إلى{" "}
                                      <span className="font-mono font-bold text-sky-300">{row.code}</span>:{" "}
                                      {studentUpgradeFeedback(row)}
                                    </>
                                  ) : (
                                    <>
                                      You’re not yet at{" "}
                                      <span className="font-mono font-bold text-sky-300">{row.code}</span>:{" "}
                                      {studentUpgradeFeedback(row)}
                                    </>
                                  )}
                                </p>
                                <div className="mb-3">
                                  <Button
                                    type="button"
                                    onClick={() => openUltraTutorForCriterion(row.code)}
                                    className="h-10 w-full border border-cyan-400/50 bg-cyan-500/15 text-sm font-bold text-cyan-50 shadow-[0_0_24px_rgba(34,211,238,0.35)] transition-all hover:bg-cyan-500/25 hover:shadow-[0_0_32px_rgba(34,211,238,0.45)] sm:w-auto"
                                  >
                                    <span className="me-1.5" aria-hidden>
                                      🤖
                                    </span>
                                    {ar
                                      ? "كيف أحقق هذا المعيار؟ (Ultra Tutor)"
                                      : "How do I reach this? (Ultra Tutor)"}
                                  </Button>
                                </div>
                                <GuidanceGapSection
                                  analysis={gapByCode ? gapByCode[row.code] : undefined}
                                  loading={gapLoading}
                                  ar={ar}
                                />
                                {row.why_higher_tier_excluded && (
                                  <p className="mt-3 border-s-4 border-amber-500/50 bg-amber-950/25 pe-2 ps-3 text-xs leading-relaxed text-amber-100/90">
                                    <span className="font-semibold text-amber-400/90">لِمَ لا الدرجة الأعلى: </span>
                                    {row.why_higher_tier_excluded}
                                  </p>
                                )}
                                <details className="mt-4 rounded-lg border border-slate-600/50 bg-slate-950/50">
                                  <summary className="cursor-pointer list-none px-3 py-2 text-xs font-semibold text-slate-400 outline-none ring-slate-500/40 transition hover:text-slate-200 focus-visible:ring-2 [&::-webkit-details-marker]:hidden">
                                    <span className="me-1 inline-block">▸</span>
                                    عرض التبرير التفصيلي والأدلة (للمراجعة)
                                  </summary>
                                  <div className="space-y-3 border-t border-slate-700/80 px-3 py-3 text-xs">
                                    <p className="whitespace-pre-wrap leading-relaxed text-slate-400">{row.justification}</p>
                                    {(row.evidence_items && row.evidence_items.length > 0) ||
                                    (Array.isArray(row.evidence) && row.evidence.length > 0) ? (
                                      <div>
                                        <p className="mb-1 font-semibold text-slate-500">الأدلة (من نص الطالب)</p>
                                        {row.evidence_items && row.evidence_items.length > 0
                                          ? row.evidence_items.map((it, i) => (
                                              <blockquote
                                                key={i}
                                                className="mb-2 border-s-2 border-slate-600 ps-3 text-slate-300"
                                              >
                                                {it.source_file && (
                                                  <span className="mb-1 block text-[0.7rem] text-slate-500">
                                                    {it.source_file}
                                                  </span>
                                                )}
                                                {it.quote}
                                              </blockquote>
                                            ))
                                          : (row.evidence ?? []).map((q, i) => (
                                              <blockquote
                                                key={i}
                                                className="mb-2 border-s-2 border-slate-600 ps-3 text-slate-300"
                                              >
                                                {q}
                                              </blockquote>
                                            ))}
                                      </div>
                                    ) : null}
                                  </div>
                                </details>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                    </>
                  )}

                  {resultConfidence && (
                    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-slate-400 shadow-[0_0_24px_rgba(0,0,0,0.25)]">
                      <span>مستوى الثقة للنموذج:</span>
                      <span
                        className={cn(
                          "rounded-lg px-3 py-1 text-xs font-bold shadow-sm",
                          resultConfidence.label === "High"
                            ? "border border-emerald-500/30 bg-emerald-950/50 text-emerald-300"
                            : resultConfidence.label === "Medium"
                              ? "border border-amber-500/30 bg-amber-950/40 text-amber-300"
                              : "border border-rose-500/30 bg-rose-950/50 text-rose-300"
                        )}
                      >
                        {resultConfidence.label}
                      </span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
          </section>
      )}
    </div>
  );
}
