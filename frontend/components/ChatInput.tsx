'use client';

import { useCallback, useEffect, useImperativeHandle, useRef, useState, forwardRef, type ReactNode } from 'react';
import { usePerceptionStore } from '@/store/usePerceptionStore';
import { recordTypingActivity } from '@/lib/behavior/anticipationLayer';
import {
  installUserGestureAudioUnlock,
  resumeSharedAudioFromClick,
} from '@/lib/audio/avatarAudioContext';
import { COGNI_STT_WEBSPEECH_LANG } from '@/lib/audio/sttLocale';

export type ChatInputProps = {
  onSend: (message: string) => void;
  disabled?: boolean;
  placeholder?: string;
  /** When false, hides Web Speech button (Chrome / Edge). */
  showWebSpeech?: boolean;
  /** When true, hides the Send button — user submits with Enter only (minimal Cognie UI). */
  hideSendButton?: boolean;
  className?: string;
  /** Extra controls after the send button (e.g. session VAD microphone). */
  trailingSlot?: ReactNode;
};

export type ChatInputHandle = {
  setValue: (text: string) => void;
};

type WebSpeechInst = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  onresult: ((ev: { results: Array<Array<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
};
type WebSpeechCtor = new () => WebSpeechInst;

function getSpeechRecognition(): WebSpeechCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as Window &
    typeof globalThis & {
      webkitSpeechRecognition?: WebSpeechCtor;
      SpeechRecognition?: WebSpeechCtor;
    };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * Chat bar: text + send + optional browser speech-to-text (not the VAD mic).
 * Dispatches `cogni:user:attention` on input focus so gaze / anticipation can react.
 */
const ChatInput = forwardRef<ChatInputHandle, ChatInputProps>(function ChatInput(
  {
    onSend,
    disabled = false,
    placeholder = 'تحدث أو اكتب سؤالك لكوجني هنا…',
    showWebSpeech = true,
    hideSendButton = false,
    className = '',
    trailingSlot,
  },
  ref,
) {
  const [message, setMessage] = useState('');
  const [listeningStt, setListeningStt] = useState(false);
  /** Must stay false until after mount — avoids SSR/client mismatch on Web Speech API. */
  const [webSpeechSupported, setWebSpeechSupported] = useState(false);
  const recRef = useRef<WebSpeechInst | null>(null);

  useImperativeHandle(ref, () => ({ setValue: (text: string) => setMessage(text) }), []);

  useEffect(() => {
    installUserGestureAudioUnlock();
    setWebSpeechSupported(getSpeechRecognition() !== null);
  }, []);

  const dispatchAttention = useCallback(() => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(
      new CustomEvent('cogni:user:attention', { detail: { source: 'chat_input' } }),
    );
  }, []);

  const handleSend = useCallback(() => {
    const t = message.trim();
    if (!t || disabled) return;
    resumeSharedAudioFromClick();
    onSend(t);
    setMessage('');
  }, [message, onSend, disabled]);

  const onChange = useCallback(
    (next: string) => {
      if (message.length === 0 && next.length > 0) {
        usePerceptionStore.getState().noteUserTypingStart(Date.now());
      }
      setMessage(next);
      recordTypingActivity();
    },
    [message.length],
  );

  const startVoice = useCallback(() => {
    resumeSharedAudioFromClick();
    const Ctor = getSpeechRecognition();
    if (!Ctor || disabled) return;
    try {
      recRef.current?.stop();
    } catch {
      /* */
    }
    const recognition = new Ctor();
    recognition.lang = COGNI_STT_WEBSPEECH_LANG;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event: { results: Array<Array<{ transcript: string }>> }) => {
      const text = event.results[0]?.[0]?.transcript?.trim();
      if (text) {
        if (process.env.NODE_ENV === 'development') {
          console.log('🎤 heard:', text);
        }
        setMessage(text);
        onSend(text);
        setMessage('');
      }
      setListeningStt(false);
    };
    recognition.onerror = () => setListeningStt(false);
    recognition.onend = () => setListeningStt(false);
    recRef.current = recognition;
    setListeningStt(true);
    recognition.start();
  }, [disabled, onSend]);

  return (
    <div
      className={`flex w-full max-w-4xl flex-1 flex-wrap items-center gap-3 ${className}`}
    >
      <div className="relative min-w-0 flex-1 group">
        <input
          type="text"
          dir="rtl"
          value={message}
          onChange={(e) => onChange(e.target.value)}
          onFocus={dispatchAttention}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder={placeholder}
          disabled={disabled}
          className="w-full rounded-2xl border border-white/10 bg-white/5 px-6 py-4 text-white shadow-inner transition placeholder:text-gray-600 focus:border-violet-500 focus:outline-none disabled:opacity-40"
        />
      </div>

      {!hideSendButton ? (
        <button
          type="button"
          onClick={handleSend}
          disabled={disabled || !message.trim()}
          className="shrink-0 rounded-2xl bg-violet-600 p-4 text-white shadow-lg shadow-violet-600/20 transition hover:bg-violet-500 disabled:opacity-20 active:scale-90"
          aria-label="إرسال"
        >
          🚀
        </button>
      ) : null}

      {trailingSlot}

      {showWebSpeech && !hideSendButton && webSpeechSupported && (
        <button
          type="button"
          onClick={startVoice}
          disabled={disabled || listeningStt}
          title="تحدث بالعربية (المتصفح)"
          aria-label="إدخال صوتي"
          className={`shrink-0 rounded-2xl px-4 py-3 text-white shadow-lg transition active:scale-90 disabled:opacity-30 ${
            listeningStt ? 'animate-pulse bg-emerald-700' : 'bg-emerald-600 hover:bg-emerald-500'
          }`}
        >
          🎤
        </button>
      )}
    </div>
  );
});

ChatInput.displayName = 'ChatInput';

export default ChatInput;
