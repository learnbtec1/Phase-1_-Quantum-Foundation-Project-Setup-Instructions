"use client";
import React, { useEffect, useState } from 'react';

export default function PESTLESimulator({ dataPath = '/data/advisor_agriculture_task.json' }: { dataPath?: string }) {
  const [task, setTask] = useState<any | null>(null);
  const [selected, setSelected] = useState<string>('P');

  useEffect(() => {
    fetch(dataPath).then(r => r.json()).then(setTask).catch(() => {});
  }, [dataPath]);

  if (!task) return <div className="p-4">جارٍ تحميل سيناريو غرفة التحكم...</div>;

  const map: any = task.pestle_analysis || {};
  const keys = ['P','E','S','T','L','En'];

  return (
    <div className="p-4 bg-white rounded shadow">
      <h3 className="font-bold mb-2">محاكي غرفة التحكم (PESTLE)</h3>
      <div className="flex gap-2 mb-3">
        {keys.map(k => (
          <button key={k} onClick={() => setSelected(k)} className={`px-3 py-1 rounded ${selected===k? 'bg-cyan-500 text-black' : 'bg-gray-100'}`}>
            {map[k]?.title ?? k}
          </button>
        ))}
      </div>

      <div className="p-3 border rounded bg-gray-50">
        <div className="font-medium mb-1">{map[selected]?.title}</div>
        <div className="text-sm text-gray-700 mb-2">{map[selected]?.description}</div>
        <div className="text-xs text-gray-600 mb-2">التأثير: {map[selected]?.impact}</div>
        <div>
          <div className="font-semibold">توصيات مقترحة:</div>
          <ul className="list-disc ml-5">
            {(map[selected]?.recommended_actions || []).map((a: string, i: number) => (
              <li key={i} className="text-sm">{a}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
