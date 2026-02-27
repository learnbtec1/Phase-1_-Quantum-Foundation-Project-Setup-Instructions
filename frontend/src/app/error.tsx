'use client';

import React from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-6">
      <div className="text-6xl opacity-40 mb-4">⚠️</div>
      <h2 className="text-xl font-bold text-white mb-2">حدث خطأ غير متوقع</h2>
      <p className="text-sm text-slate-400 mb-6 max-w-md">
        {error.message || 'عذراً، حدث خطأ أثناء تحميل الصفحة.'}
      </p>
      <button
        type="button"
        onClick={reset}
        className="px-5 py-2.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-medium transition"
      >
        إعادة المحاولة
      </button>
    </div>
  );
}
