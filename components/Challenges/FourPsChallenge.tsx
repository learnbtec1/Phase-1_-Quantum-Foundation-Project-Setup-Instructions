'use client';

interface ChallengeProps {
  onComplete: () => void;
}

export default function FourPsChallenge({ onComplete }: ChallengeProps) {
  return (
    <div className="glass p-6 rounded-2xl border border-white/10">
      <h3 className="text-xl font-bold mb-2">تحدي 4Ps</h3>
      <p className="text-sm text-gray-400 mb-4">رتب عناصر المنتج والسعر والمكان والترويج.</p>
      <button onClick={onComplete} className="px-4 py-2 bg-purple-600 rounded-lg">إكمال التحدي</button>
    </div>
  );
}
