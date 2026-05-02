/**
 * يربط صفحة التقييم / لوحة الطالب بجلسة كوجني عبر WebSocket:
 * - تركيز المادة (focus_subject)
 * - ذاكرة تقييم مستمرة (assessment_coaching) نحو أعلى مستوى BTEC
 */
import type { EvaluationResult } from '@/lib/assessmentNormalize';

export const COGNI_FOCUS_SUBJECT_KEY = 'cogni-focus-subject';
export const COGNI_ASSESSMENT_COACHING_KEY = 'cogni-assessment-coaching';

export const COGNI_FOCUS_SUBJECT_EVENT = 'cogni:focus-subject-changed';

export function setCogniFocusSubject(label: string): void {
  const v = (label || '').trim();
  if (typeof window === 'undefined') return;
  try {
    if (v) localStorage.setItem(COGNI_FOCUS_SUBJECT_KEY, v.slice(0, 200));
    else localStorage.removeItem(COGNI_FOCUS_SUBJECT_KEY);
    window.dispatchEvent(new CustomEvent(COGNI_FOCUS_SUBJECT_EVENT, { detail: { subject: v } }));
  } catch {
    /* ignore */
  }
}

export function getCogniFocusSubject(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const s = localStorage.getItem(COGNI_FOCUS_SUBJECT_KEY);
    return s?.trim() ? s.trim().slice(0, 200) : null;
  } catch {
    return null;
  }
}

/** درجة أعلى للتوجيه التربوي (عربي مختصر). */
export function coachingTargetHintAr(finalGrade: string): string {
  const u = (finalGrade || '').toUpperCase();
  if (u.includes('DIST') || u.includes('D1') || u.includes('امتياز')) {
    return 'الطالب وصل لمستوى مرتفع؛ ثبّت الفهم وعمّق التقييم النقدي والأدلة حيث يناسب المعايير.';
  }
  if (u.includes('MERIT') || u.includes('M') || u.includes('تفوق')) {
    return 'الهدف التالي: تعزيز التحليل والربط المنطقي ثم الانتقال نحو صياغة تقييم وحكم مبرّر (Distinction) حيث ينطبق.';
  }
  if (u.includes('PASS') || u.includes('P') || u.includes('نجاح')) {
    return 'الهدف التالي: إغلاق فجوات Pass المتبقية ثم بناء مهارات Merit (تحليل/مقارنة) ثم التميز Distinction.';
  }
  return 'ساعد الطالب خطوة بخطوة نحو أعلى مستوى يستطيع تحقيقه وفق معايير الواجب، دون حل جاهز.';
}

export type AssessmentCoachingPayload = {
  final_grade: string;
  subject: string;
  achieved: number;
  total: number;
  criteria_summary: string;
  /** معايير غير محققة + أسباب وتوصيات */
  gaps_detail_ar: string;
  coaching_goal_ar: string;
  report_excerpt?: string;
  ts: string;
};

export function buildAssessmentCoachingPayload(
  evalResult: EvaluationResult,
  subjectLabel: string,
): AssessmentCoachingPayload {
  const criteria = evalResult.data.criteria ?? [];
  const criteriaSummary = criteria
    .map(
      (c) =>
        `${c.code}: ${c.verdict === 'Achieved' ? '✓' : '✗'}`,
    )
    .join(' | ');

  const notOk = criteria.filter((c) => c.verdict !== 'Achieved');
  const gapsLines = notOk.map((c) => {
    const rs = (c.reasons || []).filter(Boolean).join('؛ ') || 'لم يُحقَّق المعيار بعد';
    const rec = (c.recommendations || []).filter(Boolean).join('؛ ') || '—';
    return `• ${c.code}: السبب/الفجوة: ${rs}. توجيه للتحسين: ${rec}.`;
  });

  const report =
    typeof evalResult.report === 'string' && evalResult.report.trim()
      ? evalResult.report.trim().slice(0, 1200)
      : '';

  return {
    final_grade: evalResult.data.final_grade || 'PENDING',
    subject: (subjectLabel || '—').slice(0, 256),
    achieved: evalResult.data.summary.achievedCount,
    total: evalResult.data.summary.totalCriteria,
    criteria_summary: criteriaSummary.slice(0, 1200),
    gaps_detail_ar: (gapsLines.join('\n') || 'لا توجد معايير غير محققة في آخر تقييم.').slice(
      0,
      3500,
    ),
    coaching_goal_ar: coachingTargetHintAr(evalResult.data.final_grade || ''),
    ...(report ? { report_excerpt: report } : {}),
    ts: new Date().toISOString(),
  };
}

export function persistAssessmentCoaching(payload: AssessmentCoachingPayload): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(COGNI_ASSESSMENT_COACHING_KEY, JSON.stringify(payload));
  } catch {
    /* ignore */
  }
}

export function readAssessmentCoaching(): AssessmentCoachingPayload | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(COGNI_ASSESSMENT_COACHING_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as AssessmentCoachingPayload;
    if (!p || typeof p !== 'object') return null;
    return p;
  } catch {
    return null;
  }
}

export function clearAssessmentCoaching(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(COGNI_ASSESSMENT_COACHING_KEY);
  } catch {
    /* ignore */
  }
}
