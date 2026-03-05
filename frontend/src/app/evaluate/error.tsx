'use client';

import React from 'react';

export default function ErrorBoundary({ error, reset }: { error: Error; reset: () => void }) {
  console.error('Evaluate route error:', error);

  return (
    <div style={{ padding: 16, background: '#fff3cd', color: '#7a5d00' }}>
      <strong>⚠️ حدث خطأ في صفحة التقييم.</strong>
      <pre style={{ whiteSpace: 'pre-wrap' }}>{String(error?.message || error)}</pre>
      <button
        onClick={reset}
        style={{ marginTop: 12, padding: '8px 12px', background: '#ffc107', borderRadius: 6 }}
      >
        إعادة المحاولة
      </button>
    </div>
  );
}