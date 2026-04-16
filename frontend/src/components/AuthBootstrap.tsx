'use client';

import { useEffect } from 'react';
import { bootstrapAuthLifecycle } from '@/lib/auth';

/**
 * Runs once on app load: optional dev token injection + [AUTH INIT] trace.
 */
export default function AuthBootstrap() {
  useEffect(() => {
    bootstrapAuthLifecycle();
  }, []);
  return null;
}
