'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiBase, authHeaders } from '@/lib/auth';

type Subject = { id: number; name: string; grade_level: string | null };
type Topic = { id: number; subject_id: number; name: string; order_index: number };
type Lesson = {
  id: number;
  topic_id: number;
  title: string;
  content: string | null;
  learning_objectives: string | null;
  estimated_duration_min: number | null;
};
type Question = {
  id: number;
  lesson_id: number;
  text: string;
  type: string;
  correct_answer: string | null;
  options: unknown;
  rubric: string | null;
  difficulty: number | null;
};

export default function CurriculumViewer({
  canEdit,
}: {
  /** Teacher/admin — show create forms */
  canEdit: boolean;
}) {
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [selS, setSelS] = useState<number | null>(null);
  const [selT, setSelT] = useState<number | null>(null);
  const [selL, setSelL] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const loadSubjects = useCallback(async () => {
    setErr(null);
    try {
      const r = await fetch(`${apiBase()}/api/v1/curriculum/subjects`, { headers: { ...authHeaders() } });
      if (!r.ok) throw new Error('فشل تحميل المواد');
      setSubjects((await r.json()) as Subject[]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'خطأ');
    }
  }, []);

  useEffect(() => {
    void loadSubjects();
  }, [loadSubjects]);

  useEffect(() => {
    if (selS == null) {
      setTopics([]);
      return;
    }
    void (async () => {
      const r = await fetch(`${apiBase()}/api/v1/curriculum/subjects/${selS}/topics`, {
        headers: { ...authHeaders() },
      });
      if (r.ok) setTopics((await r.json()) as Topic[]);
    })();
  }, [selS]);

  useEffect(() => {
    if (selT == null) {
      setLessons([]);
      return;
    }
    void (async () => {
      const r = await fetch(`${apiBase()}/api/v1/curriculum/topics/${selT}/lessons`, {
        headers: { ...authHeaders() },
      });
      if (r.ok) setLessons((await r.json()) as Lesson[]);
    })();
  }, [selT]);

  useEffect(() => {
    if (selL == null) {
      setQuestions([]);
      return;
    }
    void (async () => {
      const r = await fetch(`${apiBase()}/api/v1/curriculum/lessons/${selL}/questions`, {
        headers: { ...authHeaders() },
      });
      if (r.ok) setQuestions((await r.json()) as Question[]);
    })();
  }, [selL]);

  const activeLesson = lessons.find((l) => l.id === selL);

  return (
    <div className="space-y-4 text-right" dir="rtl">
      {err && <p className="text-rose-400 text-sm">{err}</p>}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div className="rounded-xl border border-white/10 bg-black/30 p-3">
          <h3 className="text-xs font-bold text-gray-500 uppercase mb-2">مواد</h3>
          <ul className="space-y-1 max-h-64 overflow-y-auto">
            {subjects.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => {
                    setSelS(s.id);
                    setSelT(null);
                    setSelL(null);
                  }}
                  className={`w-full text-right px-2 py-1 rounded-lg text-sm ${
                    selS === s.id ? 'bg-violet-600 text-white' : 'hover:bg-white/10'
                  }`}
                >
                  {s.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl border border-white/10 bg-black/30 p-3">
          <h3 className="text-xs font-bold text-gray-500 uppercase mb-2">مواضيع</h3>
          <ul className="space-y-1 max-h-64 overflow-y-auto">
            {topics.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => {
                    setSelT(t.id);
                    setSelL(null);
                  }}
                  className={`w-full text-right px-2 py-1 rounded-lg text-sm ${
                    selT === t.id ? 'bg-cyan-700 text-white' : 'hover:bg-white/10'
                  }`}
                >
                  {t.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl border border-white/10 bg-black/30 p-3">
          <h3 className="text-xs font-bold text-gray-500 uppercase mb-2">دروس</h3>
          <ul className="space-y-1 max-h-64 overflow-y-auto">
            {lessons.map((l) => (
              <li key={l.id}>
                <button
                  type="button"
                  onClick={() => setSelL(l.id)}
                  className={`w-full text-right px-2 py-1 rounded-lg text-sm ${
                    selL === l.id ? 'bg-emerald-700 text-white' : 'hover:bg-white/10'
                  }`}
                >
                  {l.title}
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl border border-white/10 bg-black/30 p-3 md:col-span-1">
          <h3 className="text-xs font-bold text-gray-500 uppercase mb-2">أسئلة</h3>
          <ul className="space-y-2 max-h-64 overflow-y-auto text-xs text-gray-300">
            {questions.map((q) => (
              <li key={q.id} className="border-b border-white/5 pb-2">
                <span className="text-amber-400/80">{q.type}</span> — {q.text.slice(0, 120)}
                {q.text.length > 120 ? '…' : ''}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {activeLesson && (
        <div className="rounded-xl border border-violet-500/20 bg-[#0a0a12] p-4 text-sm text-gray-200">
          <h4 className="font-bold text-white mb-2">{activeLesson.title}</h4>
          <div className="whitespace-pre-wrap text-gray-400 max-h-48 overflow-y-auto">
            {activeLesson.content || '—'}
          </div>
        </div>
      )}

      {canEdit && (
        <p className="text-xs text-gray-500">
          لإضافة محتوى استخدم واجهة الـ API: POST /api/v1/curriculum/subjects … (سيتم ربط نماذج الإنشاء لاحقاً).
        </p>
      )}
    </div>
  );
}
