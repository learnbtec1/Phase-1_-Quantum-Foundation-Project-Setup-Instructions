'use client';

import {
  useCallback,
  useEffect,
  useRef,
  type MutableRefObject,
  type RefObject,
} from 'react';
import type { VisemeCue } from '@/app/avatar-agent/LipSyncManager';
import { registerAzureClientTTSStop } from '@/ai/io/tts';
import { ensureMicrosoftSpeechSdk } from '@/lib/microsoftSpeechSdkBrowser';
import {
  planCoSpeechGestures,
  durationMsFromVisemeCues,
  estimateDialogueDurationMs,
} from '@/ai/avatar/coSpeechPlanner';
import { authHeaders } from '@/lib/auth';

const ARABIC_RE = /[\u0600-\u06FF]/;
const TICKS_TO_SEC = 1 / 10_000_000;

export type AzureClientTTSOptions = {
  voice?: string;
  language?: string;
  pitch?: string;
  rate?: string;
};

type TokenCache = { token: string; region: string; until: number };

let tokenCache: TokenCache | null = null;
const TOKEN_REFRESH_SKEW_MS = 60_000;

async function fetchSpeechToken(): Promise<{ token: string; region: string }> {
  const now = Date.now();
  if (
    tokenCache &&
    now < tokenCache.until - TOKEN_REFRESH_SKEW_MS
  ) {
    return { token: tokenCache.token, region: tokenCache.region };
  }
  const r = await fetch('/api/speech-token', { headers: { ...authHeaders() } });
  const body = (await r.json().catch(() => ({}))) as {
    error?: string;
    token?: string;
    region?: string;
  };
  if (!r.ok) {
    throw new Error(
      typeof body.error === 'string'
        ? body.error
        : `speech-token failed (${r.status})`,
    );
  }
  if (!body.token || !body.region) {
    throw new Error('speech-token: invalid response');
  }
  tokenCache = {
    token: body.token,
    region: body.region,
    until: now + 9 * 60 * 1000,
  };
  return { token: body.token, region: body.region };
}

function defaultVoiceForText(text: string): string {
  return ARABIC_RE.test(text) ? 'ar-JO-TaimNeural' : 'en-US-JennyNeural';
}

function langFromVoice(voice: string, fallback: string): string {
  const parts = voice.split('-');
  if (parts.length >= 2) return `${parts[0]}-${parts[1]}`;
  return fallback;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Browser Azure Speech synthesis with viseme timeline → `visemeCueQueueRef` (`{ t, id }` seconds, Azure viseme id).
 * Assigns `audioElementRef` for `LipSyncManager` + dispatches `avatar:speak:start` / `avatar:speak:end`.
 */
export function useTTSWithVisemes(
  visemeCueQueueRef: MutableRefObject<VisemeCue[]>,
  audioElementRef: RefObject<HTMLAudioElement | null>,
) {
  const blobUrlRef = useRef<string | null>(null);
  const genRef = useRef(0);
  const pendingEndedRef = useRef<(() => void) | null>(null);
  // Co-speech gesture timers — cleared whenever speech stops
  const gestureTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const revokeBlob = useCallback(() => {
    if (blobUrlRef.current) {
      try {
        URL.revokeObjectURL(blobUrlRef.current);
      } catch {
        /* */
      }
      blobUrlRef.current = null;
    }
  }, []);

  const clearGestureTimers = useCallback(() => {
    for (const t of gestureTimersRef.current) clearTimeout(t);
    gestureTimersRef.current = [];
  }, []);

  const stop = useCallback(() => {
    genRef.current += 1;
    clearGestureTimers();
    const audio = audioElementRef.current;
    const endedFn = pendingEndedRef.current;
    if (audio && endedFn) {
      audio.removeEventListener('ended', endedFn);
      pendingEndedRef.current = null;
    }
    if (audio) {
      try {
        audio.pause();
        audio.currentTime = 0;
        audio.removeAttribute('src');
        audio.load();
      } catch {
        /* */
      }
    }
    revokeBlob();
    visemeCueQueueRef.current = [];
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('avatar:speak:end'));
    }
  }, [audioElementRef, clearGestureTimers, revokeBlob, visemeCueQueueRef]);

  const dispose = useCallback(() => {
    stop();
  }, [stop]);

  const speak = useCallback(
    async (text: string, options?: AzureClientTTSOptions): Promise<void> => {
      const trimmed = text?.trim();
      if (!trimmed) return;

      stop();
      const genAtStart = genRef.current;

      const { token, region } = await fetchSpeechToken();
      const sdk = await ensureMicrosoftSpeechSdk();
      const voice =
        options?.voice?.trim() || defaultVoiceForText(trimmed);
      const lang =
        options?.language?.trim() ||
        langFromVoice(voice, ARABIC_RE.test(trimmed) ? 'ar-JO' : 'en-US');

      const speechConfig = sdk.SpeechConfig.fromAuthorizationToken(token, region);
      speechConfig.speechSynthesisVoiceName = voice;
      speechConfig.speechSynthesisOutputFormat =
        sdk.SpeechSynthesisOutputFormat.Audio24Khz160KBitRateMonoMp3;

      const pending: { visemeId: number; audioOffset: number }[] = [];
      const synthesizer = new sdk.SpeechSynthesizer(speechConfig, null);

      synthesizer.visemeReceived = (_s, e) => {
        pending.push({
          visemeId: e.visemeId,
          audioOffset: e.audioOffset,
        });
      };

      const pitch = options?.pitch ?? '+0%';
      const rate = options?.rate ?? '+0%';
      const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="http://www.w3.org/2001/mstts" xml:lang="${escapeXml(lang)}"><voice name="${escapeXml(voice)}"><mstts:viseme type="redlips_front"/><prosody pitch="${escapeXml(pitch)}" rate="${escapeXml(rate)}">${escapeXml(trimmed)}</prosody></voice></speak>`;

      await new Promise<void>((resolve, reject) => {
        synthesizer.speakSsmlAsync(
          ssml,
          (result) => {
            synthesizer.close();
            if (genAtStart !== genRef.current) {
              resolve();
              return;
            }
            if (result.errorDetails) {
              reject(new Error(result.errorDetails));
              return;
            }
            const cues: VisemeCue[] = pending.map((v) => ({
              t: v.audioOffset * TICKS_TO_SEC,
              id: v.visemeId,
            }));
            cues.sort((a, b) => a.t - b.t);
            visemeCueQueueRef.current = cues;

            const audioData = result.audioData;
            if (!audioData || audioData.byteLength === 0) {
              reject(new Error('Azure Speech returned no audio'));
              return;
            }

            revokeBlob();
            const blob = new Blob([audioData], { type: 'audio/mpeg' });
            const url = URL.createObjectURL(blob);
            blobUrlRef.current = url;

            let audio = audioElementRef.current;
            if (!audio) {
              audio = new Audio();
              audio.crossOrigin = 'anonymous';
              (audioElementRef as MutableRefObject<HTMLAudioElement | null>).current =
                audio;
            }

            audio.src = url;

            const onEnded = () => {
              audio?.removeEventListener('ended', onEnded);
              pendingEndedRef.current = null;
              if (genAtStart !== genRef.current) {
                resolve();
                return;
              }
              revokeBlob();
              visemeCueQueueRef.current = [];
              window.dispatchEvent(new CustomEvent('avatar:speak:end'));
              resolve();
            };
            pendingEndedRef.current = onEnded;
            audio.addEventListener('ended', onEnded);

            void audio
              .play()
              .then(() => {
                if (genAtStart !== genRef.current) return;
                // Wire analyser FIRST so AvatarCanvas creates AnalyserNode before
                // speak:start sets isTalkingRef → LipSyncManager always has audio ref
                if (audio) {
                  window.dispatchEvent(
                    new CustomEvent('avatar:audio:element', { detail: { audio } }),
                  );
                }
                window.dispatchEvent(
                  new CustomEvent('avatar:speak:start', { detail: {} }),
                );

                // ── Co-speech gestures: schedule based on NLP analysis of text ──
                clearGestureTimers();
                const durFromCues = durationMsFromVisemeCues(cues);
                const audioDurMs = durFromCues > 0 ? durFromCues : estimateDialogueDurationMs(trimmed);
                const plans = planCoSpeechGestures(trimmed, audioDurMs);
                for (const plan of plans) {
                  const tid = setTimeout(() => {
                    if (genAtStart !== genRef.current) return;
                    window.dispatchEvent(
                      new CustomEvent('avatar:gesture', {
                        detail: {
                          gesture: plan.gesture,
                          duration: Math.round(audioDurMs * 0.38),
                        },
                      }),
                    );
                    if (plan.emphasis) {
                      // Use avatar:speech:emphasis (what AnimationController + VRMSkeletonManager listen to)
                      window.dispatchEvent(
                        new CustomEvent('avatar:speech:emphasis', { detail: { kind: plan.emphasis, type: plan.emphasis } }),
                      );
                    }
                  }, plan.atMs);
                  gestureTimersRef.current.push(tid);
                }
                // Always fire an 'explain' gesture at speech start for continuous body language
                const baseGid = setTimeout(() => {
                  if (genAtStart !== genRef.current) return;
                  window.dispatchEvent(
                    new CustomEvent('avatar:gesture', {
                      detail: { gesture: 'explain', duration: Math.round(audioDurMs * 0.55) },
                    }),
                  );
                }, 180);
                gestureTimersRef.current.push(baseGid);
              })
              .catch((err) => {
                audio?.removeEventListener('ended', onEnded);
                pendingEndedRef.current = null;
                revokeBlob();
                visemeCueQueueRef.current = [];
                window.dispatchEvent(new CustomEvent('avatar:speak:end'));
                reject(err instanceof Error ? err : new Error(String(err)));
              });
          },
          (err) => {
            synthesizer.close();
            reject(new Error(err));
          },
        );
      });
    },
    [audioElementRef, revokeBlob, stop, visemeCueQueueRef],
  );

  useEffect(() => {
    registerAzureClientTTSStop(stop);
    return () => {
      registerAzureClientTTSStop(null);
      dispose();
    };
  }, [dispose, stop]);

  return { speak, stop, dispose };
}
