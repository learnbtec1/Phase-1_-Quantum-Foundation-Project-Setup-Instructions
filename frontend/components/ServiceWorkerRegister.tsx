'use client';

import { useEffect } from 'react';

export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
    const isLocal =
      window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    if (isLocal && process.env.NODE_ENV === 'development') return;
    void navigator.serviceWorker.register('/sw.js').catch(() => {});
  }, []);
  return null;
}
