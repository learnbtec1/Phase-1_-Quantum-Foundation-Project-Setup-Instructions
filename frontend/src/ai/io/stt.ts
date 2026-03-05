// File: src/ai/io/stt.ts
const INTERIM_DEBOUNCE_MS = 300;
const MAX_TRANSCRIPT_LENGTH = 2000;

export interface STTOptions {
  lang?: string;
  continuous?: boolean;
  interimResults?: boolean;
}

export interface STTResult {
  transcript: string;
  isFinal: boolean;
  confidence?: number;
}

function normalizeArabic(text: string): string {
  return text
    .replace(/[\u064B-\u065F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function createSTT(): {
  start: (onResult: (r: STTResult) => void, opts?: STTOptions) => void;
  stop: () => void;
  isSupported: () => boolean;
} {
  let recognition: any = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const isSupported = () =>
    typeof window !== 'undefined' &&
    ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);

  const start = (onResult: (r: STTResult) => void, opts: STTOptions = {}) => {
    if (!isSupported()) return;
    const SpeechRecognitionAPI =
      (window as unknown as { SpeechRecognition?: new () => unknown }).SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: new () => unknown }).webkitSpeechRecognition;
    if (!SpeechRecognitionAPI) return;

    recognition = new SpeechRecognitionAPI();
    recognition.continuous = opts.continuous ?? true;
    recognition.interimResults = opts.interimResults ?? true;
    recognition.lang = opts.lang ?? 'ar';

    recognition.onresult = (e: { results: ArrayLike<{ isFinal: boolean; 0: { transcript: string; confidence?: number } }> }) => {
      const last = e.results.length - 1;
      const result = e.results[last];
      const transcript = result?.[0]?.transcript ?? '';
      const normalized = normalizeArabic(transcript).slice(0, MAX_TRANSCRIPT_LENGTH);
      if (result?.isFinal) {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = null;
        onResult({ transcript: normalized, isFinal: true, confidence: result[0]?.confidence });
      } else {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          onResult({ transcript: normalized, isFinal: false });
          debounceTimer = null;
        }, INTERIM_DEBOUNCE_MS);
      }
    };

    recognition.onerror = (e: any) => {
      console.warn('[STT] error', e?.error || e);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('stt:error', { detail: { error: e?.error } }));
      }
    };

    recognition.onspeechstart = () => {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('stt:speechstart'));
      }
    };

    recognition.start();
  };

  const stop = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = null;
    try {
      recognition?.stop();
    } catch {
      /* ignore */
    }
    recognition = null;
  };

  return { start, stop, isSupported };
}
