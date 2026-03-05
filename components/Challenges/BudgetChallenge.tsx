'use client';

interface ChallengeProps {
  onComplete: () => void;
}

export default function BudgetChallenge({ onComplete }: ChallengeProps) {
  return (
    <div className="glass p-6 rounded-2xl border border-white/10">
      <h3 className="text-xl font-bold mb-2">تحدي الميزانية</h3>
      <p className="text-sm text-gray-400 mb-4">وزّع الميزانية على البنود الرئيسية.</p>
      <button onClick={onComplete} className="px-4 py-2 bg-amber-600 rounded-lg">إكمال التحدي</button>
    </div>
  );
}
