'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Z_LAYERS } from '@/lib/z-layers';

type AvatarBodyPortalProps = {
  children: ReactNode;
};

/**
 * Dedicated mount node on document.body (data-avatar-portal) so avatar stack is not a direct
 * child mix-up with other portals, and z-index is applied on a single fixed wrapper.
 * Client-only: container is created in useEffect (no SSR DOM access).
 */
export function AvatarBodyPortal({ children }: AvatarBodyPortalProps) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    const div = document.createElement('div');
    div.setAttribute('data-avatar-portal', 'true');
    div.setAttribute('data-cogni-mount', 'avatar-r3f');
    div.style.cssText = [
      'position:fixed',
      'top:0',
      'left:0',
      'right:0',
      'bottom:0',
      'width:100vw',
      'height:100vh',
      `z-index:${Z_LAYERS.AVATAR_PORTAL}`,
      'pointer-events:none',
    ].join(';');
    document.body.appendChild(div);
    setContainer(div);
    return () => {
      div.remove();
    };
  }, []);

  if (!container) return null;

  return createPortal(children, container);
}
