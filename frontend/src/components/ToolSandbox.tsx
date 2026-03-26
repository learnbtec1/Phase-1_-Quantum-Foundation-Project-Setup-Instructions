'use client';

/**
 * V28 — minimal shared whiteboard stub: sends `tool_interaction` over WS for Cogni awareness.
 */
import { useState } from 'react';

type Props = {
  sendTool: (payload: Record<string, unknown>) => void;
};

export default function ToolSandbox({ sendTool }: Props) {
  const [stroke, setStroke] = useState('');

  return (
    <div className="rounded-xl border border-white/10 bg-black/30 p-3 text-xs text-gray-300 max-w-md">
      <div className="text-[10px] text-violet-400 mb-2">لوحة سريعة (تجريبي)</div>
      <textarea
        value={stroke}
        onChange={(e) => setStroke(e.target.value)}
        onBlur={() => {
          if (stroke.trim()) {
            sendTool({ tool: 'whiteboard', action: 'stroke', text: stroke.slice(0, 2000) });
          }
        }}
        className="w-full bg-white/5 border border-white/10 rounded p-2 min-h-[72px] text-white"
        placeholder="ارسم أو اكتب ملاحظة…"
      />
    </div>
  );
}
