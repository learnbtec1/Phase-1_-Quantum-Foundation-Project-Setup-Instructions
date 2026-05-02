'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import AvatarAgentClient, {
  type AvatarSessionContext,
} from '@/app/avatar-agent/AvatarAgentClient';

/**
 * Read teacher deep-link query params inside Suspense (required by useSearchParams).
 * Example: /cognie?unit=6&target=distinction&subject=Business%20Purpose
 * Cognie home defaults to `btec_evaluator` (WS session_context + evaluator HUD). Use `?context=default` for neutral mode.
 */
function CognieSearchParamsBridge() {
  const sp = useSearchParams();
  const initialUnit = sp.get('unit')?.trim() ?? '';
  const initialTarget = sp.get('target')?.trim() ?? '';
  const initialSubject = sp.get('subject')?.trim() ?? '';
  const rawContext = sp.get('context')?.trim().toLowerCase() ?? '';
  const sessionContext: AvatarSessionContext =
    rawContext === 'default' ? 'default' : 'btec_evaluator';
  return (
    <AvatarAgentClient
      cognieCleanUi
      initialUnit={initialUnit}
      initialTarget={initialTarget}
      initialSubject={initialSubject}
      sessionContext={sessionContext}
    />
  );
}

export default function CogniePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[#0a0a12] text-sm text-white">
          جاري التحميل...
        </div>
      }
    >
      <CognieSearchParamsBridge />
    </Suspense>
  );
}
