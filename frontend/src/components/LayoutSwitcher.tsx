'use client';

import React from 'react';

/**
 * LayoutSwitcher – thin wrapper that allows per-route layout overrides.
 * Currently a transparent pass-through; extend here if you need route-aware
 * shell switching (e.g. fullscreen 3D vs. admin sidebar).
 */
export default function LayoutSwitcher({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
