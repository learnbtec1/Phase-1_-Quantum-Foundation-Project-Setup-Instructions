"use client";

import React from "react";
import { motion, useMotionValue, useTransform } from "framer-motion";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  Rocket,
  Wheat,
  Bot,
  ArrowRight,
  Fingerprint,
  Activity,
} from "lucide-react";

import DrAhmedOrb from "@/components/DrAhmedOrb";

const EduverseHero3D = dynamic(() => import("@/components/EduverseHero3D"), {
  ssr: false,
  loading: () => (
    <div
      className="fixed inset-0 -z-10 pointer-events-none bg-gradient-to-b from-[#020617] to-[#020617]/80"
      aria-hidden="true"
    />
  ),
});

// ==== بطاقة تفاعلية ثلاثية الأبعاد ====
const InteractiveTile = ({
  href,
  title,
  subtitle,
  icon: Icon,
  color,
  delay,
  isLarge = false,
}: {
  href: string;
  title: string;
  subtitle: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  delay?: number;
  isLarge?: boolean;
}) => {
  const x = useMotionValue(0.5);
  const y = useMotionValue(0.5);
  const rotateX = useTransform(y, [0, 1], [10, -10]);
  const rotateY = useTransform(x, [0, 1], [-10, 10]);

  const handleMouseMove = (e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    x.set((e.clientX - rect.left) / rect.width);
    y.set((e.clientY - rect.top) / rect.height);
  };

  const handleMouseLeave = () => {
    x.set(0.5);
    y.set(0.5);
  };

  return (
    <Link href={href} className={isLarge ? "md:col-span-2 row-span-2" : ""}>
      <motion.div
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay }}
        style={{ rotateX, rotateY, transformStyle: "preserve-3d" }}
        className="group relative h-full rounded-[32px] border border-white/10 bg-gray-900/40 backdrop-blur-xl overflow-hidden cursor-pointer shadow-xl"
      >
        <div className="absolute inset-0 pointer-events-none group-hover:bg-gradient-to-br from-white/5 to-transparent transition-opacity" />

        <div className="relative h-full p-8 flex flex-col justify-between z-10 relative-transform">
          <div>
            <div
              className="w-14 h-14 rounded-2xl mb-6 flex items-center justify-center group-hover:scale-110 transition-transform duration-500 shadow-lg"
              style={{
                backgroundColor: `${color}20`,
                border: `1px solid ${color}40`,
              }}
            >
              <Icon className="w-7 h-7 text-white" />
            </div>
            <h3 className="text-2xl font-black text-white mb-2 group-hover:translate-x-2 transition-transform duration-300">
              {title}
            </h3>
            <p className="text-gray-400 text-sm leading-relaxed font-medium max-w-[90%]">
              {subtitle}
            </p>
          </div>
          <div className="flex items-center justify-between mt-8 pt-6 border-t border-white/5">
            <span className="text-[10px] font-black tracking-[0.2em] text-gray-500 group-hover:text-white transition-colors uppercase">
              System Ready
            </span>
            <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center group-hover:bg-white group-hover:text-black transition-all duration-300 border border-white/10">
              <ArrowRight className="w-5 h-5" />
            </div>
          </div>
        </div>

        {/* Glow Border */}
        <motion.div
          className="absolute inset-0 rounded-[32px] pointer-events-none border-2 opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ borderColor: color }}
          animate={{
            boxShadow: [
              `0 0 0px ${color}00`,
              `0 0 20px ${color}40`,
              `0 0 0px ${color}00`,
            ],
          }}
          transition={{ duration: 2, repeat: Infinity }}
        />
      </motion.div>
    </Link>
  );
};

// ==== الصفحة الرئيسية للهبوط ====
export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#020617] text-white overflow-hidden relative font-cairo selection:bg-cyan-500/30">
      <EduverseHero3D />

      {/* الضباب السينمائي */}
      <div className="fixed inset-0 bg-gradient-to-b from-transparent via-transparent to-[#020617] z-0 pointer-events-none" />

      {/* واجهة المستخدم */}
      <main className="relative z-10 container mx-auto px-6 py-20 min-h-screen flex flex-col">
        {/* Header */}
        <div className="flex flex-col items-center text-center mb-24 pt-10">
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            className="mb-8 px-5 py-2 rounded-full bg-white/5 border border-white/10 backdrop-blur-2xl flex items-center gap-2 shadow-2xl"
          >
            <div className="w-2 h-2 bg-emerald-500 rounded-full animate-ping" />
            <span className="text-[10px] font-black tracking-[0.3em] text-cyan-400 uppercase">
              Eduverse Intelligence V3.0
            </span>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-7xl md:text-9xl font-black tracking-tighter mb-8 leading-none"
          >
            <span className="text-white">QUANTUM</span>
            <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-b from-white/40 to-white/10">
              LEARNING
            </span>
          </motion.h1>
        </div>

        {/* Bento Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-7xl mx-auto w-full mb-32">
          <InteractiveTile
            isLarge
            href="/vr_simulation"
            title="غرفة المحاكاة الهولوجرامية"
            subtitle="بيئة ثلاثية الأبعاد للتحكم واتخاذ قرارات في عالم افتراضي."
            icon={Rocket}
            color="#06b6d4"
            delay={0.1}
          />
          <InteractiveTile
            href="/plagiarism"
            title="فيثاغورس AI"
            subtitle="التحليل الجنائي للأبحاث باستخدام الذكاء الاصطناعي."
            icon={Fingerprint}
            color="#a855f7"
            delay={0.2}
          />
          <InteractiveTile
            href="/ai-teacher"
            title="المعلم الذكي"
            subtitle="مساعدك الشخصي لتطوير المهارات وفهم نقاط الضعف."
            icon={Bot}
            color="#f59e0b"
            delay={0.3}
          />
          <InteractiveTile
            href="/unit-1-agriculture"
            title="الوحدة الزراعية"
            subtitle="نماذج الأعمال المستقبلية في قطاع الزراعة."
            icon={Wheat}
            color="#10b981"
            delay={0.4}
          />
          <InteractiveTile
            href="/competition"
            title="ساحة المنافسة"
            subtitle="تحديات مباشرة ولوحة متصدرين تفاعلية."
            icon={Activity}
            color="#ef4444"
            delay={0.5}
          />
        </div>

        {/* Footer */}
        <footer className="mt-auto pt-10 border-t border-white/5 flex flex-col md:flex-row justify-between items-center gap-4 text-[10px] font-bold text-gray-500 tracking-[0.2em] uppercase">
          <p>© 2026 Eduverse Academy — Developed by Dr. Hamzeh</p>
          <div className="flex gap-8">
            <span className="hover:text-white transition">Core Status: Optimal</span>
            <span className="hover:text-white transition">Neural Uplink: Active</span>
          </div>
        </footer>
      </main>

      {/* AI Orb */}
      <DrAhmedOrb />
    </div>
  );
}
