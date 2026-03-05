'use client';

import { usePathname } from 'next/navigation';
import DrHamzaOrb from '@/components/avatar/DrHamzaOrb';

/** مؤقتاً: إخفاء الصندوق (DrHamzaOrb) على صفحة evaluate */
const HIDE_ORB_ON_ROUTES = ['/evaluate'];

export default function DrHamzaOrbWrapper() {
  const pathname = usePathname();
  const hidden = HIDE_ORB_ON_ROUTES.some((r) => pathname?.startsWith(r));
  if (hidden) return null;
  return <DrHamzaOrb />;
}
