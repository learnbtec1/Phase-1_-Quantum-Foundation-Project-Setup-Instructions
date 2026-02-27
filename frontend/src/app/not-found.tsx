import React from 'react';
import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-6">
      <div className="text-6xl opacity-40 mb-4">404</div>
      <h2 className="text-xl font-bold text-white mb-2">الصفحة غير موجودة</h2>
      <p className="text-sm text-slate-400 mb-6">
        عذراً، الصفحة التي تبحث عنها غير موجودة.
      </p>
      <Link
        href="/evaluate"
        className="px-5 py-2.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-medium transition"
      >
        العودة إلى الرئيسية
      </Link>
    </div>
  );
}
