'use client';

import { useLayoutEffect } from 'react';
import { bootstrapAuthLifecycle } from '@/lib/auth';

/**
 * Runs once on app load: optional dev token injection + [AUTH INIT] trace.
 * useLayoutEffect: seed emergency session before first paint/fetches below.
 */
export default function AuthBootstrap() {
  useLayoutEffect(() => {
    bootstrapAuthLifecycle();
  }, []);
  return null;
}
