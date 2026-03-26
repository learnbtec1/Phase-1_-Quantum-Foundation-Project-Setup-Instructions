'use client';

import { useCallback, useEffect, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
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

function LessonBodyEditor({
  resetKey,
  onChangeHtml,
}: {
  resetKey: number;
  onChangeHtml: (html: string) => void;
}) {
  const editor = useEditor({
    extensions: [StarterKit],
    content: '<p></p>',
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          'prose prose-invert max-w-none min-h-[140px] rounded-lg border border-white/10 bg-black/40 p-3 text-right text-sm focus:outline-none focus:ring-1 focus:ring-violet-500',
      },
    },
    onUpdate: ({ editor: ed }) => {
      onChangeHtml(ed.getHTML());
    },
  });

  useEffect(() => {
    if (!editor) return;
    editor.commands.setContent('<p></p>');
  }, [editor, resetKey]);

  return <EditorContent editor={editor} />;
}

export default function CurriculumEditor({ canEdit }: { canEdit: boolean }) {
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [selS, setSelS] = useState<number | null>(null);
  const [selT, setSelT] = useState<number | null>(null);
  const [selL, setSelL] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const [newSubjectName, setNewSubjectName] = useState('');
  const [newTopicName, setNewTopicName] = useState('');
  const [lessonTitle, setLessonTitle] = useState('');
  const [lessonHtml, setLessonHtml] = useState('<p></p>');
  const [lessonResetKey, setLessonResetKey] = useState(0);
  const [mcqPrompt, setMcqPrompt] = useState('');
  const [mcqOpts, setMcqOpts] = useState(['', '', '', '']);
  const [mcqCorrect, setMcqCorrect] = useState(0);

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

  const postJson = async (url: string, body: unknown) => {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const t = await r.text();
      throw new Error(t || r.statusText);
    }
    return r.json();
  };

  const submitSubject = async () => {
    if (!canEdit || !newSubjectName.trim()) return;
    setMsg(null);
    try {
      await postJson(`${apiBase()}/api/v1/curriculum/subjects`, { name: newSubjectName.trim() });
      setNewSubjectName('');
      await loadSubjects();
      setMsg('تم إنشاء المادة');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'خطأ');
    }
  };

  const submitTopic = async () => {
    if (!canEdit || selS == null || !newTopicName.trim()) return;
    setMsg(null);
    try {
      await postJson(`${apiBase()}/api/v1/curriculum/subjects/${selS}/topics`, {
        name: newTopicName.trim(),
        order_index: topics.length,
      });
      setNewTopicName('');
      const r = await fetch(`${apiBase()}/api/v1/curriculum/subjects/${selS}/topics`, {
        headers: { ...authHeaders() },
      });
      if (r.ok) setTopics((await r.json()) as Topic[]);
      setMsg('تم إنشاء الموضوع');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'خطأ');
    }
  };

  const submitLesson = async () => {
    if (!canEdit || selT == null || !lessonTitle.trim()) return;
    setMsg(null);
    try {
      await postJson(`${apiBase()}/api/v1/curriculum/topics/${selT}/lessons`, {
        title: lessonTitle.trim(),
        content: lessonHtml,
      });
      setLessonTitle('');
      setLessonHtml('<p></p>');
      setLessonResetKey((k) => k + 1);
      const r = await fetch(`${apiBase()}/api/v1/curriculum/topics/${selT}/lessons`, {
        headers: { ...authHeaders() },
      });
      if (r.ok) setLessons((await r.json()) as Lesson[]);
      setMsg('تم إنشاء الدرس');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'خطأ');
    }
  };

  const submitMcq = async () => {
    if (!canEdit || selL == null || !mcqPrompt.trim()) return;
    const opts = mcqOpts.map((o) => o.trim()).filter(Boolean);
    if (opts.length < 2) {
      setErr('أدخل خيارين على الأقل');
      return;
    }
    const correct = opts[mcqCorrect] ?? opts[0];
    setMsg(null);
    try {
      await postJson(`${apiBase()}/api/v1/curriculum/lessons/${selL}/questions`, {
        text: mcqPrompt.trim(),
        type: 'mcq',
        correct_answer: correct,
        options: opts,
        difficulty: 0.5,
      });
      setMcqPrompt('');
      setMcqOpts(['', '', '', '']);
      setMcqCorrect(0);
      const r = await fetch(`${apiBase()}/api/v1/curriculum/lessons/${selL}/questions`, {
        headers: { ...authHeaders() },
      });
      if (r.ok) setQuestions((await r.json()) as Question[]);
      setMsg('تمت إضافة سؤال اختيار من متعدد');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'خطأ');
    }
  };

  const activeLesson = lessons.find((l) => l.id === selL);

  return (
    <div className="space-y-6 text-right" dir="rtl">
      {err && <p className="text-rose-400 text-sm">{err}</p>}
      {msg && <p className="text-emerald-400 text-sm">{msg}</p>}

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
          <div
            className="prose prose-invert prose-sm max-w-none text-gray-300 max-h-64 overflow-y-auto"
            dangerouslySetInnerHTML={{ __html: activeLesson.content || '—' }}
          />
        </div>
      )}

      {canEdit && (
        <div className="space-y-6 rounded-xl border border-white/10 bg-black/20 p-4">
          <h3 className="text-white font-bold text-sm">إنشاء محتوى (معلّم)</h3>

          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">مادة جديدة</label>
              <div className="flex gap-2">
                <input
                  value={newSubjectName}
                  onChange={(e) => setNewSubjectName(e.target.value)}
                  className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm"
                  placeholder="اسم المادة"
                />
                <button
                  type="button"
                  onClick={() => void submitSubject()}
                  className="bg-violet-600 hover:bg-violet-500 px-3 py-2 rounded-lg text-sm"
                >
                  إضافة
                </button>
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">موضوع جديد (ضمن المادة المختارة)</label>
              <div className="flex gap-2">
                <input
                  value={newTopicName}
                  onChange={(e) => setNewTopicName(e.target.value)}
                  className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm"
                  placeholder="اسم الموضوع"
                  disabled={selS == null}
                />
                <button
                  type="button"
                  onClick={() => void submitTopic()}
                  disabled={selS == null}
                  className="bg-cyan-700 hover:bg-cyan-600 px-3 py-2 rounded-lg text-sm disabled:opacity-40"
                >
                  إضافة
                </button>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">درس جديد (محرّر غني — TipTap)</label>
            <input
              value={lessonTitle}
              onChange={(e) => setLessonTitle(e.target.value)}
              className="w-full mb-2 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm"
              placeholder="عنوان الدرس"
              disabled={selT == null}
            />
            <LessonBodyEditor resetKey={lessonResetKey} onChangeHtml={setLessonHtml} />
            <button
              type="button"
              onClick={() => void submitLesson()}
              disabled={selT == null}
              className="mt-2 bg-emerald-700 hover:bg-emerald-600 px-4 py-2 rounded-lg text-sm disabled:opacity-40"
            >
              حفظ الدرس
            </button>
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-2">سؤال اختيار من متعدد (للدرس المختار)</label>
            <textarea
              value={mcqPrompt}
              onChange={(e) => setMcqPrompt(e.target.value)}
              className="w-full mb-2 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm min-h-[72px]"
              placeholder="نص السؤال"
              disabled={selL == null}
            />
            <div className="grid grid-cols-2 gap-2 mb-2">
              {mcqOpts.map((o, i) => (
                <input
                  key={i}
                  value={o}
                  onChange={(e) => {
                    const next = [...mcqOpts];
                    next[i] = e.target.value;
                    setMcqOpts(next);
                  }}
                  className="bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-sm"
                  placeholder={`خيار ${i + 1}`}
                  disabled={selL == null}
                />
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <span className="text-xs text-gray-500">الإجابة الصحيحة:</span>
              <select
                value={mcqCorrect}
                onChange={(e) => setMcqCorrect(Number(e.target.value))}
                className="bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-sm"
                disabled={selL == null}
              >
                {mcqOpts.map((_, i) => (
                  <option key={i} value={i}>
                    خيار {i + 1}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={() => void submitMcq()}
              disabled={selL == null}
              className="bg-amber-600 hover:bg-amber-500 px-4 py-2 rounded-lg text-sm disabled:opacity-40"
            >
              إضافة السؤال
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
