'use client';

/**
 * ReportDownloadButton
 * ──────────────────────────────────────────────────────────────────────────────
 * Fetches a PDF progress report from the backend and triggers a browser download.
 *
 * Usage:
 *   <ReportDownloadButton studentId="abc123" studentName="أحمد الزعبي" />
 *
 * The component reads NEXT_PUBLIC_BACKEND_URL for the API base (defaults to
 * http://localhost:8000).  Override in .env.local if needed.
 */

import React, { useCallback, useState } from 'react';

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL?.replace(/\/+$/, '') ??
  'http://localhost:8000';

interface ReportDownloadButtonProps {
  /** student_id as stored in the repository */
  studentId: string;
  /** Display name embedded in the PDF header. Optional — falls back to studentId. */
  studentName?: string;
  /** Custom button class names (Tailwind). */
  className?: string;
}

type DownloadState = 'idle' | 'loading' | 'error';

export function ReportDownloadButton({
  studentId,
  studentName = '',
  className = '',
}: ReportDownloadButtonProps) {
  const [state, setState] = useState<DownloadState>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const handleClick = useCallback(async () => {
    if (state === 'loading') return;
    setState('loading');
    setErrorMsg('');

    try {
      const params = new URLSearchParams();
      if (studentName) params.set('name', studentName);
      const url = `${BACKEND_URL}/api/v1/reports/student/${encodeURIComponent(studentId)}?${params}`;

      const resp = await fetch(url, { method: 'GET' });

      if (!resp.ok) {
        const body = await resp.json().catch(() => ({ detail: `HTTP ${resp.status}` }));
        throw new Error(String(body.detail ?? `HTTP ${resp.status}`));
      }

      // Stream the PDF blob and trigger download
      const blob = await resp.blob();
      const objUrl = URL.createObjectURL(blob);
      const anchor  = document.createElement('a');
      anchor.href     = objUrl;
      anchor.download = `nexus_report_${studentId.slice(0, 12)}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      setTimeout(() => URL.revokeObjectURL(objUrl), 5000);

      setState('idle');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
      setState('error');
      // Auto-clear error after 6 s
      setTimeout(() => setState('idle'), 6000);
    }
  }, [studentId, studentName, state]);

  const baseClass =
    'inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-all select-none';

  const stateClass =
    state === 'loading'
      ? 'bg-blue-700 text-white cursor-wait opacity-80'
      : state === 'error'
      ? 'bg-red-700 text-white cursor-pointer'
      : 'bg-blue-600 hover:bg-blue-500 text-white cursor-pointer';

  return (
    <div className="inline-block">
      <button
        type="button"
        onClick={handleClick}
        disabled={state === 'loading'}
        className={`${baseClass} ${stateClass} ${className}`}
        aria-label="Download academic progress report"
      >
        {state === 'loading' ? (
          <>
            {/* Spinner */}
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            <span>جاري توليد التقرير...</span>
          </>
        ) : state === 'error' ? (
          <>
            <span>⚠</span>
            <span>{errorMsg.slice(0, 60) || 'فشل التحميل — حاول مجدداً'}</span>
          </>
        ) : (
          <>
            <span>📄</span>
            <span>تحميل التقرير الأكاديمي</span>
          </>
        )}
      </button>
    </div>
  );
}
