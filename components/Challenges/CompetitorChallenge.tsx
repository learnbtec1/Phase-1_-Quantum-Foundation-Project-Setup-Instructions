'use client';

interface ChallengeProps {
  onComplete: () => void;
}

export default function CompetitorChallenge({ onComplete }: ChallengeProps) {
  return (
    <div className="glass p-6 rounded-2xl border border-white/10">
      <h3 className="text-xl font-bold mb-2">تحدي المنافسين</h3>
      <p className="text-sm text-gray-400 mb-4">قارن بين المنافسين واختر الأفضل أداءً.</p>
      <button onClick={onComplete} className="px-4 py-2 bg-emerald-600 rounded-lg">إكمال التحدي</button>
    </div>
  );
}
