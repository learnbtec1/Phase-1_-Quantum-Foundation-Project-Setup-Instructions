import type { ReactNode } from 'react';

/**
 * Minimal layout: no extra providers — isolates R3F / Canvas from global shell issues.
 */
export default function TestAvatarLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
