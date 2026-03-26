'use client';

/** Thumbs feedback for last model reply (V28 training + persona learning). */
import { useCallback, useState } from 'react';

type Props = {
  enabled: boolean;
  onFeedback: (payload: { thumbs_up: boolean; prompt: string; response: string }) => void;
  lastUserText: string;
  lastAssistantText: string;
};

export default function ResponseFeedback({ enabled, onFeedback, lastUserText, lastAssistantText }: Props) {
  const [done, setDone] = useState(false);
  const send = useCallback(
    (up: boolean) => {
      if (!enabled || !lastAssistantText.trim()) return;
      onFeedback({ thumbs_up: up, prompt: lastUserText.slice(0, 4000), response: lastAssistantText.slice(0, 4000) });
      setDone(true);
      window.setTimeout(() => setDone(false), 4000);
    },
    [enabled, lastUserText, lastAssistantText, onFeedback],
  );

  if (!enabled) return null;

  return (
    <div className="flex items-center gap-2 text-xs text-gray-400">
      <span>التقييم:</span>
      <button
        type="button"
        className="rounded px-2 py-0.5 hover:bg-white/10 disabled:opacity-40"
        disabled={done || !lastAssistantText.trim()}
        onClick={() => send(true)}
        title="مفيد"
      >
        👍
      </button>
      <button
        type="button"
        className="rounded px-2 py-0.5 hover:bg-white/10 disabled:opacity-40"
        disabled={done || !lastAssistantText.trim()}
        onClick={() => send(false)}
        title="غير مفيد"
      >
        👎
      </button>
      {done ? <span className="text-emerald-400/80">شكراً</span> : null}
    </div>
  );
}
