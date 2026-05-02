'use client';

import { useEffect } from 'react';

function debugEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (window.localStorage.getItem('cogni_debug_avatar') === '1') return true;
  } catch {
    /* ignore */
  }
  return new URLSearchParams(window.location.search).get('cogni_debug_avatar') === '1';
}

/**
 * When `?cogni_debug_avatar=1` or localStorage cogni_debug_avatar=1:
 * - Walk ancestors from avatar portal / canvas for transform|filter|perspective|will-change|contain
 * - Poll canvas bounding box until visible or timeout
 */
export function useCogniAvatarDebug(active: boolean) {
  useEffect(() => {
    if (!active || !debugEnabled()) return;

    const findCanvas = (): HTMLCanvasElement | null => {
      const fromPortal = document.querySelector('[data-avatar-portal] canvas');
      if (fromPortal instanceof HTMLCanvasElement) return fromPortal;
      const mainCanvas = document.querySelector('main canvas');
      return mainCanvas instanceof HTMLCanvasElement ? mainCanvas : null;
    };

    const walkFrom = (start: HTMLElement | null) => {
      let el: HTMLElement | null = start;
      while (el) {
        const cs = window.getComputedStyle(el);
        const pairs: [string, string][] = [
          ['transform', cs.transform],
          ['filter', cs.filter],
          ['perspective', cs.perspective],
          ['will-change', cs.willChange],
          ['contain', cs.contain],
        ];
        for (const [name, val] of pairs) {
          if (val && val !== 'none' && val !== 'auto' && val !== 'normal') {
            console.warn('[cogni:debug] possible stacking-context on ancestor', {
              tag: el.tagName,
              className: el.className,
              [name]: val,
            });
          }
        }
        el = el.parentElement;
      }
    };

    const portal = document.querySelector('[data-avatar-portal]');
    walkFrom(portal instanceof HTMLElement ? portal : findCanvas());

    let ticks = 0;
    const maxTicks = 40;
    const id = window.setInterval(() => {
      ticks += 1;
      const canvas = findCanvas();
      if (!canvas) {
        if (ticks >= maxTicks) {
          console.error('[cogni:debug] no canvas found');
          window.clearInterval(id);
        }
        return;
      }
      const rect = canvas.getBoundingClientRect();
      const st = window.getComputedStyle(canvas);
      const visible =
        rect.width > 0 &&
        rect.height > 0 &&
        st.visibility !== 'hidden' &&
        st.opacity !== '0' &&
        st.display !== 'none';
      if (!visible) {
        console.error('[cogni:debug] canvas not visible', {
          boundingRect: { w: rect.width, h: rect.height },
          visibility: st.visibility,
          opacity: st.opacity,
          display: st.display,
          glSize: { w: canvas.width, h: canvas.height },
        });
      } else {
        console.log('[cogni:debug] canvas visible', {
          dom: { w: rect.width, h: rect.height },
          gl: { w: canvas.width, h: canvas.height },
        });
        window.clearInterval(id);
      }
      if (ticks >= maxTicks) window.clearInterval(id);
    }, 500);

    return () => window.clearInterval(id);
  }, [active]);
}
