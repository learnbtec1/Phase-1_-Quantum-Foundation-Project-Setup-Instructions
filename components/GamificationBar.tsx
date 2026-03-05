"use client";
import { useProgress } from '@/context/ProgressContext';

export default function GamificationBar() {
  const ctx = useProgress();
  const progress = ctx?.progress ?? { totalPoints: 0 };
  return (
    <div className="fixed top-6 right-6 z-50 bg-black/50 backdrop-blur-xl p-4 rounded-2xl border border-white/10 flex items-center gap-4">
      <div className="text-right font-mono">
        <div className="text-[10px] text-cyan-400 uppercase">Total Score</div>
        <div className="text-xl font-black text-white">{progress.totalPoints || 0} XP</div>
      </div>
      <div className="bg-cyan-500 p-2 rounded-xl flex items-center justify-center">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
          <path d="M7 3C7 2.44772 7.44772 2 8 2H16C16.5523 2 17 2.44772 17 3V6C17 8.76142 14.7614 11 12 11C9.23858 11 7 8.76142 7 6V3Z" fill="#061216"/>
          <path d="M4 6H6C6 9.866 9.13401 13 13 13C16.866 13 20 9.866 20 6H22V4H20C20 4 17 6 13 6C9 6 6 4 6 4H4V6Z" fill="#06B6D4"/>
        </svg>
      </div>
    </div>
  );
}
