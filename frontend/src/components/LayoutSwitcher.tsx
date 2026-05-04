'use client';

import { usePathname } from 'next/navigation';
import { CognieAppShell } from '@/components/cognie-ui/AppShell';

/**
 * تجاوز كامل الشريط Cognie لصفحة أفاتار 3D (ملء الشاشة) — المنطق في AvatarAgentClient دون تغيير.
 */
export default function LayoutSwitcher({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '';
  if (pathname.startsWith('/avatar-agent')) {
    return <>{children}</>;
  }
  return <CognieAppShell>{children}</CognieAppShell>;
}
