"use client";

import React from "react";
import { motion, useMotionValue, useTransform } from "framer-motion";
import Link from "next/link";
import { 
  Rocket, 
  Bot, 
  Fingerprint, 
  Activity, 
  Wheat, 
  ArrowRight, 
  Sparkles,
  ShieldCheck,
  Cpu
} from "lucide-react";

// استدعاء المكونات التفاعلية (تأكد من صحة مساراتها لديك)
import NexusHero3D from "../components/NexusHero3D";
import DrAhmedOrb from "../components/DrAhmedOrb";

// --- مكون البطاقة التفاعلية (InteractiveTile) بنظام الـ 3D Tilt ---
function InteractiveTile({ href, title, subtitle, icon: Icon, color, delay, isLarge = false }: any) {
  const x = useMotionValue(0.5);
  const y = useMotionValue(0.5);

  const rotateX = useTransform(y, [0, 1], [15, -15]);
  const rotateY = useTransform(x, [0, 1], [-15, 15]);

  return (
    <Link href={href} className={isLarge ? "md:col-span-2" : ""}>
      <motion.div
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          x.set((e.clientX - rect.left) / rect.width);
          y.set((e.clientY - rect.top) / rect.height);
        }}
        onMouseLeave={() => { x.set(0.5); y.set(0.5); }}
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6, delay }}
        style={{ rotateX, rotateY, transformStyle: "preserve-3d" }}
        className="group relative h-full rounded-[32px] border border-white/10 bg-gray-900/40 backdrop-blur-xl overflow-hidden cursor-pointer shadow-2xl"
      >
        <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
        
        <div className="relative h-full p-8 flex flex-col justify-between z-10">
          <div>
            <div 
              className="w-14 h-14 rounded-2xl mb-6 flex items-center justify-center border border-white/10 transition-all duration-500 group-hover:scale-110 shadow-lg"
              style={{ backgroundColor: `${color}20`, borderColor: `${color}40` }}
            >
              <Icon className="w-7 h-7" style={{ color }} />
            </div>

            <h3 className="text-2xl font-black text-white mb-2 group-hover:translate-x-1 transition-transform">
              {title}
            </h3>
            <p className="text-gray-400 text-sm leading-relaxed font-medium">
              {subtitle}
            </p>
          </div>

          <div className="flex items-center justify-between mt-8 pt-6 border-t border-white/5">
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: color }} />
              <span className="text-[10px] font-black tracking-[0.2em] text-gray-500 uppercase">System Ready</span>
            </div>
            <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center group-hover:bg-white group-hover:text-black transition-all duration-300">
              <ArrowRight className="w-5 h-5" />
            </div>
          </div>
        </div>

        {/* تأثير النيون عند الحواف */}
        <div 
          className="absolute inset-0 rounded-[32px] border-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
          style={{ borderColor: color, boxShadow: `inset 0 0 20px ${color}20` }}
        />
      </motion.div>
    </Link>
  );
}

export default function LandingPageClient() {
  return (
    <div className="min-h-screen bg-[#020617] text-white selection:bg-cyan-500/30 overflow-x-hidden relative font-cairo" dir="rtl">
      
      {/* 1. المحرك البصري والخلفية */}
      <div className="fixed inset-0 z-0">
        <NexusHero3D />
      </div>
      <div className="fixed inset-0 bg-gradient-to-b from-transparent via-[#020617]/50 to-[#020617] z-1 pointer-events-none" />

      {/* 2. واجهة المستخدم */}
      <main className="relative z-10 container mx-auto px-6 py-20 min-h-screen flex flex-col">
        
        {/* Header Section */}
        <div className="flex flex-col items-center text-center mb-24 pt-10">
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            className="mb-8 px-5 py-2 rounded-full bg-white/5 border border-white/10 backdrop-blur-2xl flex items-center gap-3"
          >
            <Sparkles className="w-4 h-4 text-cyan-400 animate-pulse" />
            <span className="text-[10px] font-black tracking-[0.3em] text-cyan-400 uppercase">Nexus Intelligence V3.0</span>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-7xl md:text-9xl font-black tracking-tighter mb-6 leading-none"
          >
            <span className="text-white">QUANTUM</span><br />
            <span className="text-transparent bg-clip-text bg-gradient-to-b from-white/40 to-white/5">LEARNING</span>
          </motion.h1>
          
          <motion.p 
             initial={{ opacity: 0 }}
             animate={{ opacity: 1 }}
             transition={{ delay: 0.4 }}
             className="text-gray-400 max-w-2xl text-lg font-medium"
          >
            مستقبل التعليم التفاعلي بين يديك. تجربة تعليمية مدعومة بالذكاء الاصطناعي والنمذجة ثلاثية الأبعاد.
          </motion.p>
        </div>

        {/* Interactive Bento Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-7xl mx-auto w-full mb-32">
          
          <InteractiveTile
            isLarge
            href="/avatar-agent"
            title="غرفة المحاكاة الهولوجرامية"
            subtitle="تحدث مباشرة مع الدكتور حمزة في بيئة ثلاثية الأبعاد تفاعلية بالكامل."
            icon={Bot}
            color="#06b6d4"
            delay={0.1}
          />

          <InteractiveTile
            href="/plagiarism"
            title="فيثاغورس AI"
            subtitle="التحليل الجنائي للأبحاث باستخدام محركات الذكاء الاصطناعي."
            icon={Fingerprint}
            color="#a855f7"
            delay={0.2}
          />

          <InteractiveTile
            href="/units"
            title="مسارات BTEC"
            subtitle="استكشف الوحدات التعليمية الزراعية والإدارية بنظام الكوانتوم."
            icon={Wheat}
            color="#10b981"
            delay={0.3}
          />

          <InteractiveTile
            href="/security"
            title="حماية البيانات"
            subtitle="تشفير عصبي متقدم لضمان خصوصية رحلتك التعليمية."
            icon={ShieldCheck}
            color="#ef4444"
            delay={0.4}
          />

          <InteractiveTile
            href="/core"
            title="المعالج المركزي"
            subtitle="إدارة موارد النظام وتحسين أداء التعلم الذاتي."
            icon={Cpu}
            color="#f59e0b"
            delay={0.5}
          />
        </div>

        {/* Footer */}
        <footer className="mt-auto pt-10 border-t border-white/5 flex flex-col md:flex-row justify-between items-center gap-4 text-[10px] font-bold text-gray-500 tracking-[0.2em] uppercase">
          <p>© 2026 Nexus Academy — Developed by Dr. Hamza</p>
          <div className="flex gap-8">
            <span className="hover:text-cyan-400 cursor-pointer transition-colors flex items-center gap-2">
               <Activity className="w-3 h-3" /> Core Status: Optimal
            </span>
          </div>
        </footer>
      </main>

      <DrAhmedOrb />
    </div>
  );
}