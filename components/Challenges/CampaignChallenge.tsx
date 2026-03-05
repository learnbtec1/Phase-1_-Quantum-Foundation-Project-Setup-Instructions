'use client';

interface ChallengeProps {
  onComplete: () => void;
}

export default function CampaignChallenge({ onComplete }: ChallengeProps) {
  return (
    <div className="glass p-6 rounded-2xl border border-white/10">
      <h3 className="text-xl font-bold mb-2">تحدي الحملة الإعلانية</h3>
      <p className="text-sm text-gray-400 mb-4">اختر القنوات الإعلانية الأنسب للفئة المستهدفة.</p>
      <button onClick={onComplete} className="px-4 py-2 bg-rose-600 rounded-lg">إكمال التحدي</button>
    </div>
  );
}
