import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function proxy(req: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!.*\\.(?:css|js|map|png|jpg|jpeg|svg|gif|ico|txt)$).*)'],
};
