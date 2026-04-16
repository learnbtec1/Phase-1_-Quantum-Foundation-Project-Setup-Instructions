/**
 * Root Next.js app API routes are disabled. Canonical BFF lives under frontend/src/app/api/.
 * @see README.md — Production: npm run dev:frontend / npm run build:frontend
 */
import { NextResponse } from 'next/server';

export const LEGACY_ROOT_API_MESSAGE =
  'Legacy route — do not use. Use the canonical app in frontend/ (Bearer-authenticated BFF).';

export function legacyRootApiResponse(routeLabel: string): NextResponse {
  if (process.env.NODE_ENV === 'development') {
    console.warn(
      `[LEGACY ROOT API] Blocked ${routeLabel}. Run: npm run dev:frontend — POST /api${routeLabel} on port 3000 (frontend app).`,
    );
  }
  return NextResponse.json(
    {
      error: LEGACY_ROOT_API_MESSAGE,
      code: 'legacy_root_api_disabled',
      canonicalApp: 'frontend/',
    },
    { status: 410 },
  );
}
