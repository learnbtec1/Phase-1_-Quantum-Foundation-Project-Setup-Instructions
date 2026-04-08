'use client';

import { flattenSubjectLabels } from '@/lib/academicSubjects';

type Props = {
  selectedSubject: string;
  onPick: (label: string) => void;
  className?: string;
};

/**
 * أزرار سريعة لمواد إدارة الأعمال (نفس شجرة ACADEMIC_DATA في التقييم).
 * يستدعي onPick؛ الواجهة الأم مسؤولة عن setCogniFocusSubject وحالة القوائم.
 */
export default function BusinessSubjectChips({
  selectedSubject,
  onPick,
  className = '',
}: Props) {
  const labels = flattenSubjectLabels();

  return (
    <div className={`space-y-2 ${className}`}>
      <p className="text-[11px] text-gray-500">
        اختر مادة للتركيز — كوجني يربط الشرح بهذه المادة فقط حتى تغيّرها.
      </p>
      <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto pr-0.5">
        {labels.map((label) => {
          const active = selectedSubject === label;
          return (
            <button
              key={label}
              type="button"
              onClick={() => {
                onPick(label);
              }}
              className={
                'rounded-full border px-2 py-0.5 text-[10px] leading-tight transition ' +
                (active
                  ? 'border-cyan-400/70 bg-cyan-500/20 text-cyan-100'
                  : 'border-white/15 bg-white/5 text-gray-300 hover:border-white/25 hover:bg-white/10')
              }
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
