'use client';

import { useLayoutEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

type BodyPortalProps = {
  children: ReactNode;
};

/**
 * يُركِّب الأبناء مباشرة على document.body لتجاوز:
 * - overflow:hidden على أسلاف التخطيط (لوحة التعلّم، أعمدة flex، إلخ) التي تقصّ الـ overlay
 * - سياقات تراص منخفضة بسبب isolate / transform على الحاويات
 *
 * المودالات والستائر هنا. للأفاتار fullscreen استخدم `AvatarBodyPortal` (حاوية body مخصّصة + `Z_LAYERS`).
 */
export function BodyPortal({ children }: BodyPortalProps) {
  const [target, setTarget] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    setTarget(document.body);
  }, []);

  if (!target) return null;

  return createPortal(children, target);
}
