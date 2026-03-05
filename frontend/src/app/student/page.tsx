"use client";

import React from 'react';
import { Award, BookOpen, CheckCircle, Clock } from 'lucide-react';

export default function StudentPortal() {
  return (
    <div className="space-y-8 animate-in fade-in duration-700">
      {/* رأس الصفحة */}
      <header className="flex justify-between items-end">
        <div>
          <h2 className="text-4xl font-black text-white/90">بوابة الطالب الأكاديمية 👨‍🎓</h2>
          <p className="text-gray-400 mt-2">مرحباً بك مجدداً، إليك ملخص تقدمك في معايير BTEC</p>
        </div>
        <div className="text-left">
          <p className="text-xs text-primary font-bold">المستوى الدراسي</p>
          <p className="text-xl font-black">BTEC Level 2 Business</p>
        </div>
      </header>

      {/* إحصائيات سريعة للطالب */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="card-nexus p-6 border-emerald-500/20">
          <CheckCircle className="text-emerald-500 mb-2" />
          <p className="text-xs text-gray-400">المعايير المكتملة</p>
          <p className="text-2xl font-black">12 / 15</p>
        </div>
        <div className="card-nexus p-6 border-blue-500/20">
          <Award className="text-blue-500 mb-2" />
          <p className="text-xs text-gray-400">الشهادات</p>
          <p className="text-2xl font-black">2</p>
        </div>
        <div className="card-nexus p-6 border-purple-500/20">
          <Clock className="text-purple-500 mb-2" />
          <p className="text-xs text-gray-400">ساعات التعلم</p>
          <p className="text-2xl font-black">45h</p>
        </div>
        <div className="card-nexus p-6 border-amber-500/20">
          <BookOpen className="text-amber-500 mb-2" />
          <p className="text-xs text-gray-400">المهام الحالية</p>
          <p className="text-2xl font-black">1</p>
        </div>
      </div>

      {/* قسم الشهادات والنتائج */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="card-nexus p-8 bg-black/40">
          <h3 className="text-xl font-bold mb-6 flex items-center gap-2">
            <span className="w-2 h-8 bg-primary rounded-full"></span>
            آخر نتائج التقييم (Assessment)
          </h3>
          <div className="space-y-4">
            <div className="flex justify-between items-center p-4 glass rounded-xl border-white/5">
              <span>Unit 1: The Green Field Project</span>
              <span className="badge-success badge">Achieved (Merit)</span>
            </div>
            <div className="flex justify-between items-center p-4 glass rounded-xl border-white/5 opacity-50">
              <span>Unit 4: Market Research</span>
              <span className="text-xs italic">قيد التصحيح...</span>
            </div>
          </div>
        </div>

        <div className="card-nexus p-8 bg-gradient-to-br from-primary/5 to-transparent">
          <h3 className="text-xl font-bold mb-6">الشهادات الرقمية 🎓</h3>
          <div className="flex flex-col items-center justify-center h-48 border-2 border-dashed border-white/10 rounded-2xl">
            <Award className="w-12 h-12 text-gray-600 mb-2" />
            <p className="text-gray-500 text-sm">أكمل الوحدة الرابعة لفتح الشهادة القادمة</p>
          </div>
        </div>
      </div>
    </div>
  );
}