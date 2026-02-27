'use client';

import React, { useEffect, useRef } from 'react';
import { Howl, Howler } from 'howler';

const SOUNDS = {
  hover: '/audio/ui/hover.mp3',
  sent:  '/audio/ui/send.mp3',
  received: '/audio/ui/incoming.mp3',
};
const AMBIENCE_URL = '/audio/ambience/boardroom.mp3';

function playSafe(
  ref: React.MutableRefObject<Howl | null>,
  url: string,
  label: string,
  vol = 0.3
) {
  if (!url) return;
  try {
    if (!ref.current) {
      ref.current = new Howl({ src: [url], volume: vol, html5: true,
        onloaderror: () => { ref.current = null; } });
    }
    ref.current.volume(vol);
    ref.current.play();
  } catch {
    // silently skip if asset is absent
  }
}

export default function Soundscape() {
  const ambienceRef  = useRef<Howl | null>(null);
  const hoverRef     = useRef<Howl | null>(null);
  const sendRef      = useRef<Howl | null>(null);
  const receivedRef  = useRef<Howl | null>(null);

  const stopAmbience = () => { try { ambienceRef.current?.stop(); } catch { /* ignore */ } };

  useEffect(() => {
    // ── soundscape:start ────────────────────────────────────────────────────
    const onStart = () => {
      try {
        if (!ambienceRef.current) {
          ambienceRef.current = new Howl({
            src: [AMBIENCE_URL],
            volume: 0.18,
            loop: true,
            html5: true,
            onloaderror: () => { ambienceRef.current = null; },
          });
        }
        ambienceRef.current.volume(0.18);
        ambienceRef.current.play();
      } catch {
        // Ambience asset not found — silent mode
      }
    };

    // ── audio:resume — unlock Howler's AudioContext (iOS / autoplay policy) ──
    const onResume = () => {
      try {
        // Howler.ctx is the shared Web Audio API AudioContext
        Howler.ctx?.resume();
      } catch {
        // ignore
      }
    };

    const onStop     = () => stopAmbience();
    const onSent     = () => playSafe(sendRef,     SOUNDS.sent,      'sent',     0.35);
    const onReceived = () => playSafe(receivedRef,  SOUNDS.received,  'received', 0.35);
    const onHover    = () => playSafe(hoverRef,     SOUNDS.hover,     'hover',    0.2);

    window.addEventListener('soundscape:start', onStart);
    window.addEventListener('soundscape:stop',  onStop);
    window.addEventListener('audio:resume',     onResume);
    window.addEventListener('chat:sent',        onSent);
    window.addEventListener('chat:received',    onReceived);
    window.addEventListener('ui:hover',         onHover);

    return () => {
      window.removeEventListener('soundscape:start', onStart);
      window.removeEventListener('soundscape:stop',  onStop);
      window.removeEventListener('audio:resume',     onResume);
      window.removeEventListener('chat:sent',        onSent);
      window.removeEventListener('chat:received',    onReceived);
      window.removeEventListener('ui:hover',         onHover);
      stopAmbience();
    };
  }, []);

  return null;
}
