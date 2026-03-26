'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import CurriculumEditor from '@/components/CurriculumEditor';
import StudentLearningDashboard from '@/components/student/StudentLearningDashboard';
import DeepLinkGenerator from '@/components/teacher/DeepLinkGenerator';
import { apiBase, authHeaders, clearAccessToken, getAccessToken, notifyAuthChanged } from '@/lib/auth';

type Me = { id: string; email: string; name: string; role: string };
type StudentRow = {
  id: string;
  email: string;
  name: string;
  last_emotional_summary: string | null;
  topics_hint: string[] | null;
};

type Tab = 'students' | 'curriculum' | 'assignments' | 'analytics';

type TopicMastery = {
  topic_id: number;
  topic_name: string;
  subject_name: string;
  score: number;
  mastered: boolean;
  attempted: number;
  correct: number;
};

type AnswerRow = {
  answer_id: string;
  question_text: string;
  score: number | null;
  feedback: string | null;
  created_at: string | null;
};

type ProgressOut = {
  student_id: string;
  topics: TopicMastery[];
  recent_answers: AnswerRow[];
};

type LessonAssignment = {
  id: string;
  teacher_id: string;
  student_id: string;
  lesson_id: number;
  assigned_at: string | null;
  completed_at: string | null;
  lesson_title: string | null;
};

type Analytics = {
  total_answers: number;
  average_score: number | null;
  lesson_assignments_open: number;
  students_with_mastery_rows: number;
};

type TimelineRow = { day: string; summary: string | null; topics_covered: unknown };

export default function TeacherDashboardPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('students');
  const [selectedStudent, setSelectedStudent] = useState<StudentRow | null>(null);
  const [progress, setProgress] = useState<ProgressOut | null>(null);
  const [progressLoading, setProgressLoading] = useState(false);
  const [assignments, setAssignments] = useState<LessonAssignment[]>([]);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [timeline, setTimeline] = useState<TimelineRow[]>([]);
  const [assignStudentId, setAssignStudentId] = useState('');
  const [assignLessonId, setAssignLessonId] = useState('');
  const [assignMsg, setAssignMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const token = getAccessToken();
    if (!token) {
      setMe(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const base = apiBase();
      const rMe = await fetch(`${base}/api/v1/auth/me`, { headers: { ...authHeaders() } });
      if (!rMe.ok) {
        setMe(null);
        setError('يجب تسجيل الدخول');
        return;
      }
      const u = (await rMe.json()) as Me;
      setMe(u);
      if (u.role === 'teacher' || u.role === 'admin') {
        const rSt = await fetch(`${base}/api/v1/dashboard/students`, { headers: { ...authHeaders() } });
        if (!rSt.ok) {
          setError('تعذر تحميل الطلاب');
          return;
        }
        setStudents((await rSt.json()) as StudentRow[]);
      } else {
        setStudents([]);
        setError(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطأ');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const loadProgress = async (s: StudentRow) => {
    setSelectedStudent(s);
    setProgress(null);
    setTimeline([]);
    setProgressLoading(true);
    try {
      const r = await fetch(`${apiBase()}/api/v1/dashboard/students/${s.id}/progress`, {
        headers: { ...authHeaders() },
      });
      if (r.ok) setProgress((await r.json()) as ProgressOut);
      const rT = await fetch(`${apiBase()}/api/v1/dashboard/students/${s.id}/timeline`, {
        headers: { ...authHeaders() },
      });
      if (rT.ok) setTimeline((await rT.json()) as TimelineRow[]);
    } finally {
      setProgressLoading(false);
    }
  };

  const loadAssignments = async () => {
    try {
      const r = await fetch(`${apiBase()}/api/v1/dashboard/lesson-assignments`, {
        headers: { ...authHeaders() },
      });
      if (r.ok) setAssignments((await r.json()) as LessonAssignment[]);
    } catch {
      /* ignore */
    }
  };

  const loadAnalytics = async () => {
    try {
      const r = await fetch(`${apiBase()}/api/v1/dashboard/analytics`, {
        headers: { ...authHeaders() },
      });
      if (r.ok) setAnalytics((await r.json()) as Analytics);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    if (!me || (me.role !== 'teacher' && me.role !== 'admin')) return;
    if (tab === 'assignments') void loadAssignments();
    if (tab === 'analytics') void loadAnalytics();
  }, [tab, me]);

  const submitAssign = async () => {
    setAssignMsg(null);
    try {
      const lid = parseInt(assignLessonId, 10);
      if (!assignStudentId.trim() || Number.isNaN(lid)) {
        setAssignMsg('أدخل معرف الطالب ورقم الدرس');
        return;
      }
      const r = await fetch(`${apiBase()}/api/v1/dashboard/assign`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_id: assignStudentId.trim(), lesson_id: lid }),
      });
      if (!r.ok) {
        const d = (await r.json().catch(() => ({}))) as { detail?: string };
        setAssignMsg(d.detail || 'فشل الإسناد');
        return;
      }
      setAssignMsg('تم إسناد الدرس.');
      setAssignLessonId('');
      void loadAssignments();
    } catch (e) {
      setAssignMsg(e instanceof Error ? e.message : 'خطأ');
    }
  };

  const logout = () => {
    clearAccessToken();
    notifyAuthChanged();
    setMe(null);
    setStudents([]);
  };

  if (loading && !me) {
    return (
      <div className="min-h-screen bg-[#06060c] text-gray-300 flex items-center justify-center" dir="rtl">
        جاري التحميل…
      </div>
    );
  }

  if (me?.role === 'student') {
    return <StudentLearningDashboard />;
  }

  const teacherOk = me && (me.role === 'teacher' || me.role === 'admin');

  return (
    <main className="min-h-screen bg-[#06060c] text-gray-100 p-8" dir="rtl">
      <div className="max-w-6xl mx-auto">
        <div className="flex justify-between items-center mb-6 flex-wrap gap-4">
          <h1 className="text-2xl font-bold">لوحة المعلّم</h1>
          <div className="flex gap-4 items-center">
            <Link href="/avatar-agent" className="text-cyan-400 hover:underline">
              ← كوجني
            </Link>
            {me && (
              <button type="button" onClick={logout} className="text-sm text-gray-400 hover:text-white">
                تسجيل خروج
              </button>
            )}
          </div>
        </div>

        {error && <p className="text-amber-400 mb-4">{error}</p>}

        {!getAccessToken() && (
          <p className="text-gray-500 mb-6">
            <Link href="/avatar-agent" className="text-violet-400 underline">
              سجّل الدخول من صفحة كوجني
            </Link>
          </p>
        )}

        {teacherOk && (
          <>
            {me?.role === 'teacher' && <DeepLinkGenerator />}
            <div className="flex gap-2 mb-6 flex-wrap border-b border-white/10 pb-2">
              {(
                [
                  ['students', 'الطلاب'],
                  ['curriculum', 'المناهج'],
                  ['assignments', 'الإسناد'],
                  ['analytics', 'إحصاءات'],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setTab(k)}
                  className={`px-4 py-2 rounded-t-lg text-sm font-semibold ${
                    tab === k ? 'bg-violet-600 text-white' : 'text-gray-400 hover:text-white'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {tab === 'students' && (
              <div className="space-y-6">
                <div className="overflow-x-auto rounded-xl border border-white/10">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-white/5 text-gray-400 text-right">
                        <th className="p-3">الاسم</th>
                        <th className="p-3">البريد</th>
                        <th className="p-3">آخر ملخص</th>
                        <th className="p-3">تفاصيل</th>
                      </tr>
                    </thead>
                    <tbody>
                      {students.map((s) => (
                        <tr key={s.id} className="border-t border-white/5 hover:bg-white/5">
                          <td className="p-3">{s.name}</td>
                          <td className="p-3 text-gray-400">{s.email}</td>
                          <td className="p-3 max-w-md text-gray-300 text-xs">
                            {s.last_emotional_summary || '—'}
                          </td>
                          <td className="p-3">
                            <button
                              type="button"
                              className="text-cyan-400 hover:underline text-xs"
                              onClick={() => void loadProgress(s)}
                            >
                              التقدّم
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {selectedStudent && (
                  <div className="rounded-xl border border-violet-500/30 bg-black/40 p-4">
                    <div className="flex justify-between items-center mb-3">
                      <h2 className="font-bold text-white">تقدّم: {selectedStudent.name}</h2>
                      <button
                        type="button"
                        className="text-gray-500 text-sm"
                        onClick={() => {
                          setSelectedStudent(null);
                          setProgress(null);
                          setTimeline([]);
                        }}
                      >
                        إغلاق
                      </button>
                    </div>
                    {timeline.length > 0 && (
                      <div className="mb-4 rounded-lg border border-white/10 bg-black/30 p-3">
                        <h3 className="text-sm font-bold text-violet-300 mb-2">خط زمني</h3>
                        <ul className="space-y-2 text-xs text-gray-300 max-h-40 overflow-y-auto">
                          {timeline.map((t) => (
                            <li key={t.day} className="border-b border-white/5 pb-2">
                              <span className="text-amber-400/90">{t.day}</span>
                              <p className="mt-0.5">{t.summary || '—'}</p>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {progressLoading && <p className="text-gray-500 text-sm">جاري التحميل…</p>}
                    {progress && (
                      <div className="grid md:grid-cols-2 gap-4 text-sm">
                        <div>
                          <h3 className="text-gray-500 text-xs uppercase mb-2">إتقان المواضيع</h3>
                          <ul className="space-y-2">
                            {progress.topics.map((t) => (
                              <li key={t.topic_id} className="border border-white/5 rounded-lg p-2">
                                <div className="font-medium text-white">{t.topic_name}</div>
                                <div className="text-gray-400 text-xs">
                                  {t.subject_name} — درجة: {(t.score * 100).toFixed(0)}% — محاولات:{' '}
                                  {t.attempted} (صحيح {t.correct}) {t.mastered ? '✓ متقن' : ''}
                                </div>
                              </li>
                            ))}
                            {progress.topics.length === 0 && (
                              <li className="text-gray-500">لا بيانات إتقان بعد.</li>
                            )}
                          </ul>
                        </div>
                        <div>
                          <h3 className="text-gray-500 text-xs uppercase mb-2">إجابات حديثة</h3>
                          <ul className="space-y-2 max-h-64 overflow-y-auto">
                            {progress.recent_answers.map((a) => (
                              <li key={a.answer_id} className="border border-white/5 rounded p-2 text-xs">
                                <div className="text-gray-300">{a.question_text.slice(0, 200)}…</div>
                                <div className="text-amber-200/80 mt-1">
                                  {a.score != null ? `${(a.score * 100).toFixed(0)}%` : '—'}{' '}
                                  {a.feedback ? `— ${a.feedback.slice(0, 120)}` : ''}
                                </div>
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {tab === 'curriculum' && (
              <CurriculumEditor canEdit={me.role === 'teacher' || me.role === 'admin'} />
            )}

            {tab === 'assignments' && (
              <div className="space-y-6">
                <div className="rounded-xl border border-white/10 p-4 bg-black/30">
                  <h3 className="font-bold mb-3 text-white">إسناد درس جديد</h3>
                  <div className="flex flex-wrap gap-3 items-end">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">معرف الطالب (UUID)</label>
                      <input
                        value={assignStudentId}
                        onChange={(e) => setAssignStudentId(e.target.value)}
                        className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm w-72"
                        placeholder="student uuid"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">رقم الدرس (lesson id)</label>
                      <input
                        value={assignLessonId}
                        onChange={(e) => setAssignLessonId(e.target.value)}
                        className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm w-32"
                        placeholder="e.g. 1"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => void submitAssign()}
                      className="bg-violet-600 hover:bg-violet-500 px-4 py-2 rounded-lg text-sm font-semibold"
                    >
                      إسناد
                    </button>
                  </div>
                  {assignMsg && <p className="text-sm mt-2 text-cyan-300">{assignMsg}</p>}
                </div>
                <div className="overflow-x-auto rounded-xl border border-white/10">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-white/5 text-gray-400">
                        <th className="p-3 text-right">الدرس</th>
                        <th className="p-3 text-right">الطالب</th>
                        <th className="p-3 text-right">تاريخ الإسناد</th>
                      </tr>
                    </thead>
                    <tbody>
                      {assignments.map((a) => (
                        <tr key={a.id} className="border-t border-white/5">
                          <td className="p-3">{a.lesson_title || a.lesson_id}</td>
                          <td className="p-3 text-gray-400 text-xs">{a.student_id}</td>
                          <td className="p-3 text-gray-500 text-xs">{a.assigned_at || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {tab === 'analytics' && analytics && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="rounded-xl border border-white/10 p-4 bg-black/30">
                  <div className="text-gray-500 text-xs">إجابات مسجّلة</div>
                  <div className="text-2xl font-bold text-white">{analytics.total_answers}</div>
                </div>
                <div className="rounded-xl border border-white/10 p-4 bg-black/30">
                  <div className="text-gray-500 text-xs">متوسط الدرجة</div>
                  <div className="text-2xl font-bold text-white">
                    {analytics.average_score != null
                      ? `${(analytics.average_score * 100).toFixed(0)}%`
                      : '—'}
                  </div>
                </div>
                <div className="rounded-xl border border-white/10 p-4 bg-black/30">
                  <div className="text-gray-500 text-xs">إسنادات مفتوحة</div>
                  <div className="text-2xl font-bold text-white">{analytics.lesson_assignments_open}</div>
                </div>
                <div className="rounded-xl border border-white/10 p-4 bg-black/30">
                  <div className="text-gray-500 text-xs">طلاب ببيانات إتقان</div>
                  <div className="text-2xl font-bold text-white">{analytics.students_with_mastery_rows}</div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
