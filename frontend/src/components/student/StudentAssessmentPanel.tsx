'use client';

import { useEffect, useMemo, useState } from 'react';
import { BookOpen, GraduationCap, Layers } from 'lucide-react';
import { ACADEMIC_DATA } from '@/lib/academicSubjects';
import { normalizeIntegratedResult, type EvaluationResult } from '@/lib/assessmentNormalize';

export type GradeNudgePayload = {
  grade: string;
  subject: string;
  unit?: string;
  ts: string;
};

type HistoryEntry = { subject: string; grade: string; ts: string };

function buildNgrams(text: string, n = 3): Set<string> {
  const words = text.toLowerCase().replace(/[^\w\u0600-\u06ff\s]/g, ' ').split(/\s+/).filter(Boolean);
  const grams = new Set<string>();
  for (let i = 0; i <= words.length - n; i++) grams.add(words.slice(i, i + n).join(' '));
  return grams;
}

function jaccardSim(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  a.forEach((x) => {
    if (b.has(x)) inter++;
  });
  return Math.round((inter / (a.size + b.size - inter)) * 100);
}

type Props = {
  focusTopicLabel?: string | null;
  onGradeUpdated?: (payload: GradeNudgePayload) => void;
};

export default function StudentAssessmentPanel({ focusTopicLabel, onGradeUpdated }: Props) {
  const [selectedClass, setSelectedClass] = useState('');
  const [selectedSection, setSelectedSection] = useState('');
  const [selectedSubject, setSelectedSubject] = useState('');
  const [assignmentContext, setAssignmentContext] = useState('');
  const [studentAnswer, setStudentAnswer] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<EvaluationResult | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('nexus-assessment-history');
      if (raw) {
        const parsed = JSON.parse(raw) as HistoryEntry[];
        if (Array.isArray(parsed)) setHistory(parsed.slice(0, 10));
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!focusTopicLabel?.trim()) return;
    for (const cls of Object.keys(ACADEMIC_DATA)) {
      for (const sec of Object.keys(ACADEMIC_DATA[cls] || {})) {
        const subs = ACADEMIC_DATA[cls][sec] || [];
        if (subs.includes(focusTopicLabel)) {
          setSelectedClass(cls);
          setSelectedSection(sec);
          setSelectedSubject(focusTopicLabel);
          return;
        }
      }
    }
    setSelectedSubject(focusTopicLabel);
  }, [focusTopicLabel]);

  const availableSections = useMemo(
    () => (selectedClass ? Object.keys(ACADEMIC_DATA[selectedClass] || {}) : []),
    [selectedClass],
  );
  const availableSubjects = useMemo(
    () => (selectedClass && selectedSection ? ACADEMIC_DATA[selectedClass][selectedSection] || [] : []),
    [selectedClass, selectedSection],
  );

  const saveLastGrade = (evalResult: EvaluationResult, subjectLabel: string) => {
    try {
      const criteria = evalResult.data.criteria ?? [];
      const criteriaSummary = criteria
        .map((c) => `${c.code}: ${c.verdict === 'Achieved' ? '✓ Achieved' : '✗ Not Achieved'}`)
        .join(' | ');
      const snapshot = {
        final_grade: evalResult.data.final_grade || 'PENDING',
        subject: subjectLabel || '—',
        criteria_summary: criteriaSummary,
        achieved: evalResult.data.summary.achievedCount,
        total: evalResult.data.summary.totalCriteria,
        ts: new Date().toISOString(),
      };
      localStorage.setItem('nexus-last-grade', JSON.stringify(snapshot));
    } catch {
      /* ignore */
    }
  };

  const handleEvaluate = async () => {
    if (!selectedSubject || !assignmentContext || !studentAnswer.trim()) {
      alert('يرجى اختيار المادة وملء سياق الواجب والإجابة.');
      return;
    }
    const criteriaMatches = assignmentContext.match(/\b[PMD]\d+\b/gi) || [];
    const uniqueCodes = new Set(criteriaMatches.map((c: string) => c.toUpperCase()));
    if (uniqueCodes.size < 2) {
      alert('يجب أن يحتوي سياق الواجب على معيارين BTEC على الأقل (مثل P1، M1، D1).');
      return;
    }

    setLoading(true);
    setResult(null);
    try {
      const assignmentBrief = `${selectedSubject}\n${assignmentContext}`;
      const res = await fetch('/api/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          student_text: studentAnswer,
          assignment_text: assignmentBrief,
          unit_id: '14',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error((data?.detail || data?.error || 'Evaluation failed') as string);
      const normalized = data?.data?.criteria !== undefined ? data.data : data;
      const evalResult = normalizeIntegratedResult(normalized);
      if (typeof data?.report === 'string' && data.report) evalResult.report = data.report;
      setResult(evalResult);

      const sim = jaccardSim(buildNgrams(studentAnswer), buildNgrams(`${selectedSubject}\n${assignmentContext}`));
      const g = evalResult.data.final_grade || 'PENDING';
      const entry: HistoryEntry = { subject: selectedSubject, grade: g, ts: new Date().toLocaleString('ar-SA') };
      const next = [entry, ...history].slice(0, 20);
      setHistory(next);
      try {
        localStorage.setItem('nexus-assessment-history', JSON.stringify(next));
      } catch {
        /* ignore */
      }

      saveLastGrade(evalResult, selectedSubject);
      onGradeUpdated?.({
        grade: g,
        subject: selectedSubject,
        unit: assignmentContext.slice(0, 120),
        ts: new Date().toISOString(),
      });
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'خطأ في التقييم');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3 text-right text-sm text-gray-200">
      <div className="space-y-2">
        <label className="block text-xs text-gray-500">الصف</label>
        <select
          value={selectedClass}
          onChange={(e) => {
            setSelectedClass(e.target.value);
            setSelectedSection('');
            setSelectedSubject('');
          }}
          className="w-full rounded-lg bg-white/5 border border-white/10 px-2 py-1.5 text-xs"
        >
          <option value="">—</option>
          {Object.keys(ACADEMIC_DATA).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-2">
        <label className="block text-xs text-gray-500 flex items-center gap-1">
          <BookOpen className="w-3 h-3" /> الفصل
        </label>
        <select
          value={selectedSection}
          onChange={(e) => {
            setSelectedSection(e.target.value);
            setSelectedSubject('');
          }}
          disabled={!selectedClass}
          className="w-full rounded-lg bg-white/5 border border-white/10 px-2 py-1.5 text-xs disabled:opacity-40"
        >
          <option value="">—</option>
          {availableSections.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-2">
        <label className="block text-xs text-gray-500 flex items-center gap-1">
          <Layers className="w-3 h-3" /> المادة / الوحدة
        </label>
        <select
          value={selectedSubject}
          onChange={(e) => setSelectedSubject(e.target.value)}
          disabled={!selectedSection}
          className="w-full rounded-lg bg-white/5 border border-white/10 px-2 py-1.5 text-xs disabled:opacity-40"
        >
          <option value="">—</option>
          {availableSubjects.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <label className="block text-xs text-gray-500 flex items-center gap-1">
          <GraduationCap className="w-3 h-3" /> سياق الواجب (يشمل P1/M1/D1…)
        </label>
        <textarea
          value={assignmentContext}
          onChange={(e) => setAssignmentContext(e.target.value)}
          rows={4}
          className="w-full rounded-lg bg-white/5 border border-white/10 px-2 py-1.5 text-xs font-mono"
          placeholder="الصق نص الواجب والمعايير…"
        />
      </div>
      <div className="space-y-2">
        <label className="block text-xs text-gray-500">إجابة الطالب</label>
        <textarea
          value={studentAnswer}
          onChange={(e) => setStudentAnswer(e.target.value)}
          rows={5}
          className="w-full rounded-lg bg-white/5 border border-white/10 px-2 py-1.5 text-xs"
        />
      </div>

      <button
        type="button"
        disabled={loading}
        onClick={() => void handleEvaluate()}
        className="w-full py-2 rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 text-white text-xs font-semibold disabled:opacity-40"
      >
        {loading ? 'جاري التقييم…' : 'تقييم'}
      </button>

      {result && (
        <div className="rounded-lg border border-white/10 bg-black/30 p-2 text-xs space-y-1">
          <div className="font-bold text-violet-300">الدرجة: {result.data.final_grade}</div>
          {result.report && <p className="text-gray-400 line-clamp-4">{result.report}</p>}
        </div>
      )}

      {history.length > 0 && (
        <div className="border-t border-white/10 pt-2 mt-2">
          <div className="text-xs text-gray-500 mb-1">آخر النتائج</div>
          <ul className="space-y-1 max-h-32 overflow-y-auto text-[11px] text-gray-400">
            {history.map((h, i) => (
              <li key={`${h.ts}-${i}`}>
                <span className="text-white/80">{h.subject}</span> — {h.grade}{' '}
                <span className="text-gray-600">{h.ts}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
