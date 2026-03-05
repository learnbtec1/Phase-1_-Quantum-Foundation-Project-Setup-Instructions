"use client";
import React from 'react';
import { X } from 'lucide-react';

interface InfoCardProps {
  title: string;
  company?: string;
  ownership?: string;
  scope?: string;
  size?: string;
  details?: string[];
  role?: string;
  onClose: () => void;
}

export default function InfoCard({ 
  title, 
  company, 
  ownership, 
  scope, 
  size, 
  details, 
  role,
  onClose 
}: InfoCardProps) {
  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/70 backdrop-blur-sm animate-fadeIn">
      <div className="bg-gradient-to-br from-slate-900 via-emerald-900 to-slate-900 border-4 border-emerald-500 rounded-3xl p-8 max-w-2xl w-full mx-4 shadow-2xl shadow-emerald-500/50 transform scale-100 animate-scaleIn">
        {/* زر الإغلاق */}
        <button
          onClick={onClose}
          title="إغلاق"
          aria-label="إغلاق بطاقة المعلومات"
          className="absolute top-4 right-4 bg-red-500 hover:bg-red-600 text-white rounded-full p-2 transition-all hover:scale-110"
        >
          <X className="w-6 h-6" />
        </button>

        {/* العنوان */}
        <div className="text-center mb-6">
          <div className="text-6xl mb-4">🔍</div>
          <h2 className="text-4xl font-black text-white mb-2">{title}</h2>
          {role && (
            <p className="text-emerald-400 text-xl font-semibold">{role}</p>
          )}
        </div>

        {/* معلومات الشركة */}
        <div className="bg-black/30 rounded-2xl p-6 mb-6 space-y-4">
          {company && (
            <div className="flex items-start gap-3">
              <span className="text-2xl">🏢</span>
              <div>
                <p className="text-white/60 text-sm">الشركة</p>
                <p className="text-white font-bold text-lg">{company}</p>
              </div>
            </div>
          )}
          
          {ownership && (
            <div className="flex items-start gap-3">
              <span className="text-2xl">👥</span>
              <div>
                <p className="text-white/60 text-sm">الملكية</p>
                <p className="text-white font-bold">{ownership}</p>
              </div>
            </div>
          )}
          
          {scope && (
            <div className="flex items-start gap-3">
              <span className="text-2xl">🌍</span>
              <div>
                <p className="text-white/60 text-sm">النطاق</p>
                <p className="text-white font-bold">{scope}</p>
              </div>
            </div>
          )}
          
          {size && (
            <div className="flex items-start gap-3">
              <span className="text-2xl">📊</span>
              <div>
                <p className="text-white/60 text-sm">الحجم</p>
                <p className="text-white font-bold">{size}</p>
              </div>
            </div>
          )}
        </div>

        {/* التفاصيل الإضافية */}
        {details && details.length > 0 && (
          <div className="bg-emerald-500/10 border-2 border-emerald-500/30 rounded-xl p-5">
            <h3 className="text-emerald-400 font-bold text-lg mb-3 flex items-center gap-2">
              <span>✨</span>
              <span>معلومات مهمة</span>
            </h3>
            <ul className="space-y-2">
              {details.map((detail, index) => (
                <li key={index} className="text-white/90 text-sm leading-relaxed pl-4">
                  {detail}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* تلميح للطالب */}
        <div className="mt-6 bg-yellow-500/20 border-2 border-yellow-500/50 rounded-xl p-4">
          <p className="text-yellow-200 text-sm text-center flex items-center justify-center gap-2">
            <span>💡</span>
            <span className="font-semibold">استخدم هذه المعلومات في المقارنة وتحليل PESTLE</span>
          </p>
        </div>
      </div>
    </div>
  );
}
