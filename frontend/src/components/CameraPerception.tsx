'use client';

/**
 * V28 — optional camera sampling (every 5s). Heuristic emotion/attention without heavy ML
 * (avoids large TF bundles; can be replaced with TensorFlow.js face-mesh later).
 */
import { useCallback, useEffect, useRef, useState } from 'react';

type Props = {
  enabled: boolean;
  onSample: (payload: {
    emotion: string;
    attention: number;
    engagement: number;
    ts: number;
  }) => void;
};

export default function CameraPerception({ enabled, onSample }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    const w = typeof window !== 'undefined' ? (window as Window & { __cogniPerceptionCameraLive?: boolean }) : null;
    if (!enabled || typeof window === 'undefined') {
      stop();
      if (w) w.__cogniPerceptionCameraLive = false;
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 320 }, height: { ideal: 240 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (w) w.__cogniPerceptionCameraLive = true;
        const v = videoRef.current;
        if (v) {
          v.srcObject = stream;
          await v.play().catch(() => undefined);
        }
      } catch (e) {
        if (w) w.__cogniPerceptionCameraLive = false;
        setErr('تعذّر تفعيل الكاميرا');
        console.warn('[CameraPerception]', e);
      }
    })();
    return () => {
      cancelled = true;
      stop();
      if (w) w.__cogniPerceptionCameraLive = false;
    };
  }, [enabled, stop]);

  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => {
      const v = videoRef.current;
      const c = canvasRef.current;
      if (!v || !c || v.readyState < 2) return;
      const w = Math.min(160, v.videoWidth || 160);
      const h = Math.min(120, v.videoHeight || 120);
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(v, 0, 0, w, h);
      const data = ctx.getImageData(0, 0, w, h).data;
      let sum = 0;
      for (let i = 0; i < data.length; i += 4) {
        sum += data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      }
      const px = data.length / 4;
      const avg = px > 0 ? sum / px / 255 : 0.5;
      // Heuristic: very dark frame → possibly looking away / low attention
      const attention = Math.max(0, Math.min(1, avg * 1.4));
      const engagement = Math.max(0, Math.min(1, 0.45 + attention * 0.4));
      let emotion = 'neutral';
      if (avg > 0.58) emotion = 'happy';
      else if (avg < 0.22) emotion = 'bored';
      onSample({
        emotion,
        attention,
        engagement,
        ts: Date.now(),
      });
    }, 5000);
    return () => window.clearInterval(id);
  }, [enabled, onSample]);

  if (!enabled) return null;

  return (
    <div className="flex flex-col gap-1 text-[10px] text-gray-500">
      <video ref={videoRef} className="hidden" playsInline muted />
      <canvas ref={canvasRef} className="hidden" />
      {err ? <span>{err}</span> : <span className="opacity-70">الكاميرا: عيّنة كل 5 ثوانٍ</span>}
    </div>
  );
}
