'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import AvatarAgentClient from './AvatarAgentClient';

// [COPILOT_FORCE_DYNAMIC] Removed: force-dynamic caused Cache-Control: no-store which blocks bfcache.
export const dynamic = 'auto';

/**
 * ADDED: Read teacher deep-link query params inside Suspense (required by useSearchParams).
 * Example: /avatar-agent?unit=6&target=distinction&subject=Business%20Purpose
 */
function AvatarAgentSearchParamsBridge() {
  const sp = useSearchParams();
  const initialUnit = sp.get('unit')?.trim() ?? '';
  const initialTarget = sp.get('target')?.trim() ?? '';
  const initialSubject = sp.get('subject')?.trim() ?? '';
  return (
    <AvatarAgentClient
      initialUnit={initialUnit}
      initialTarget={initialTarget}
      initialSubject={initialSubject}
    />
  );
}

export default function AvatarAgentPage() {
  return (
    <Suspense fallback={null}>
      <AvatarAgentSearchParamsBridge />
    </Suspense>
  );
}
