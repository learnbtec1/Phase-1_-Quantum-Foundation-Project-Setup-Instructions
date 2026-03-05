"use client";
import React, { useState, useEffect } from 'react';

function IconBook() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M3 5a2 2 0 0 1 2-2h12" stroke="#000" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M21 7v11a2 2 0 0 1-2 2H7" stroke="#000" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconClose() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M18 6L6 18M6 6l12 12" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function VirtualTablet({ unitId, onClose }: { unitId: string, onClose: () => void }) {
  const [data, setData] = useState<any>(null);
  const [currentPage, setCurrentPage] = useState(0);

  // جلب البيانات من ملف الـ JSON الذي أنشأته
  useEffect(() => {
    fetch(`/data/advisor_agriculture_task.json`)
      .then(res => res.json())
      .then(json => setData(json))
      .catch(err => console.error("Failed to load narrative:", err));
  }, [unitId]);

  if (!data) return null;

  const pages = [
    { title: "ملفات الشركات", content: data.company_profiles, type: 'list' },
    { title: "تحليل PESTLE", content: data.pestle_factors, type: 'grid' },
    { title: "التوصيات", content: data.recommendations, type: 'text' }
  ];

  return (
    <div className="absolute bottom-10 left-1/2 -translate-x-1/2 w-[90%] max-w-4xl h-[600px] 
                 bg-slate-900/80 backdrop-blur-3xl border border-white/10 rounded-[3rem] 
                 shadow-2xl z-[150] overflow-hidden flex flex-col transition-transform duration-300" style={{transform: 'translateY(0)'}}>
      {/* Header التابلت */}
      <div className="p-6 border-b border-white/5 flex justify-between items-center bg-white/5">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-green-500 rounded-2xl shadow-lg shadow-green-500/20">
            <IconBook />
          </div>
          <div>
            <h2 className="text-white font-bold tracking-tight">{data.title}</h2>
            <p className="text-[10px] text-green-400 font-mono uppercase tracking-widest">Consultant Tablet v1.0</p>
          </div>
        </div>
        <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors" aria-label="Close tablet">
          <IconClose />
        </button>
      </div>

      {/* محتوى الصفحة الحالية */}
      <div className="flex-1 overflow-y-auto p-10">
          <div key={currentPage}>
            <h3 className="text-2xl font-black text-white mb-8 italic uppercase tracking-tighter">
              {pages[currentPage].title}
            </h3>
            
            <div className="space-y-4">
              {/* عرض ديناميكي بناءً على نوع الصفحة */}
              {pages[currentPage].content?.map((item: any, i: number) => (
                <div key={i} className="bg-white/5 border border-white/5 p-6 rounded-2xl hover:border-green-500/30 transition-all">
                  <h4 className="text-green-400 font-bold mb-2">{item.name || item.factor}</h4>
                  <p className="text-slate-400 text-sm leading-relaxed">{item.details || item.impact}</p>
                </div>
              ))}
            </div>
          </div>
      </div>

      {/* Navigation السفلي */}
      <div className="p-6 border-t border-white/5 flex justify-between items-center bg-black/20">
        <button 
          disabled={currentPage === 0}
          onClick={() => setCurrentPage(p => p - 1)}
          className="flex items-center gap-2 text-sm font-bold disabled:opacity-20"
        >
          ‹ السابق
        </button>
        
        <div className="flex gap-2">
          {pages.map((_, i) => (
            <div key={i} className={`w-2 h-2 rounded-full ${i === currentPage ? 'bg-green-500' : 'bg-white/10'}`} />
          ))}
        </div>

        <button 
          onClick={() => currentPage === pages.length - 1 ? onClose() : setCurrentPage(p => p + 1)}
          className="flex items-center gap-2 text-sm font-bold text-green-400"
        >
          {currentPage === pages.length - 1 ? 'إغلاق' : 'التالي'} ›
        </button>
      </div>
    </div>
  );
}