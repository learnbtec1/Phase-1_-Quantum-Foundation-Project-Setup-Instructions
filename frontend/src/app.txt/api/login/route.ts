import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(req: NextRequest) {
  const { pathname, searchParams } = req.nextUrl;

  const isAPI = pathname.startsWith('/api');
  const isStatic =
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.startsWith('/assets') ||
    pathname.startsWith('/public');
  const isLogin = pathname === '/login';

  // عدّل قائمة المسارات المحمية حسب حاجتك
  const isProtected =
    pathname.startsWith('/assessment') ||
    pathname.startsWith('/dashboard');

  // تحقق الجلسة
  const sess = req.cookies.get('sess')?.value;
  const isAuthed = Boolean(sess);

  if (isProtected && !isAuthed && !isAPI && !isStatic && !isLogin) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    // الحفاظ على الوجهة المطلوبة بعد نجاح الدخول
    url.searchParams.set('redirect', pathname + (searchParams.toString() ? `?${searchParams.toString()}` : ''));
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!.*\\.(?:css|js|map|png|jpg|jpeg|svg|gif|ico|txt)$).*)'],
};