import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Keep middleware manifest generated in dev; no route behavior changes.
export function middleware(_request: NextRequest) {
  return NextResponse.next();
}
