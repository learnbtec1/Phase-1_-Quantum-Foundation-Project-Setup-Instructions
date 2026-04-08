'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import StudentAssessmentPanel, { type GradeNudgePayload } from '@/components/student/StudentAssessmentPanel';
import { flattenSubjectLabels } from '@/lib/academicSubjects';

const AvatarAgentClient = dynamic(() => import('@/app/avatar-agent/AvatarAgentClient'), {
  ssr: false,
  loading: () => (
    <div className="flex flex-1 items-center justify-center bg-[#06060c] text-gray-400 text-sm animate-pulse">
      جاري تحميل كوجني…
    </div>
  ),
});

type DashboardAvatarSlotProps = {
  focusSubject: string | null;
  gradeNudge: GradeNudgePayload | null;
};

/** ADDED: pass /dashboard?unit=&target=&subject= into embedded avatar (useSearchParams needs Suspense). */
function DashboardAvatarSlot({ focusSubject, gradeNudge }: DashboardAvatarSlotProps) {
  const sp = useSearchParams();
  const initialUnit = sp.get('unit')?.trim() ?? '';
  const initialTarget = sp.get('target')?.trim() ?? '';
  const initialSubject = sp.get('subject')?.trim() ?? '';
  return (
    <AvatarAgentClient
      initialUnit={initialUnit}
      initialTarget={initialTarget}
      initialSubject={initialSubject}
      focusSubject={focusSubject}
      gradeNudge={gradeNudge}
      embedVariant="dashboard"
    />
  );
}

export default function StudentLearningDashboard() {
  const [currentSubject, setCurrentSubject] = useState<string | null>(null);
  const [gradeNudge, setGradeNudge] = useState<GradeNudgePayload | null>(null);

  const subjects = flattenSubjectLabels();

  return (
    <div className="flex min-h-screen w-full bg-[#0a0a12] text-white" dir="rtl">
      <aside className="flex w-[300px] shrink-0 flex-col border-l border-white/10 bg-[#0f1020]">
        <div className="border-b border-white/10 p-4">
          <h1 className="text-lg font-bold text-white">لوحة التعلّم</h1>
          <p className="text-[11px] text-gray-500 mt-1">التقييم + المعلم الرقمي</p>
        </div>
        <div className="p-3 border-b border-white/10">
          <div className="text-xs text-gray-500 mb-2">تركيز المادة</div>
          <div className="max-h-40 overflow-y-auto flex flex-wrap gap-1.5">
            {subjects.map((label) => (
              <button
                key={label}
                type="button"
                onClick={() => setCurrentSubject(label)}
                className={`rounded-lg border px-2 py-1 text-[10px] leading-tight transition-colors ${
                  currentSubject === label
                    ? 'border-violet-400 bg-violet-600/40 text-white'
                    : 'border-white/15 bg-white/5 text-gray-300 hover:border-white/30'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          <StudentAssessmentPanel focusTopicLabel={currentSubject} onGradeUpdated={setGradeNudge} />
        </div>
      </aside>
      <main className="relative z-50 flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="relative z-50 isolate flex min-h-0 flex-1 flex-col">
          <Suspense
            fallback={
              <div className="flex min-h-[520px] flex-1 items-center justify-center bg-[#06060c] text-gray-500 text-sm">
                جاري تحميل الكوجني…
              </div>
            }
          >
            <DashboardAvatarSlot focusSubject={currentSubject} gradeNudge={gradeNudge} />
          </Suspense>
        </div>
      </main>
    </div>
  );
}
