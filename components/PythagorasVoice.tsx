"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import Particles from "@tsparticles/react";
import { Canvas } from '@react-three/fiber';
import { Float, Sphere, MeshDistortMaterial, Stars } from '@react-three/drei';

// --- 1. مكون الكرة المتفاعلة مع الصوت ---
function VoiceCore({ speaking }: { speaking: boolean }) {
  return (
    <Float speed={speaking ? 10 : 2} rotationIntensity={speaking ? 4 : 1} floatIntensity={speaking ? 4 : 2}>
      <mesh>
        <Sphere args={[1, 64, 64]}>
          <MeshDistortMaterial
            color={speaking ? "#10b981" : "#06b6d4"} // يتغير اللون عند الكلام
            speed={speaking ? 8 : 2} // تزيد السرعة عند الكلام
            distort={speaking ? 0.6 : 0.3}
            radius={1}
            emissive={speaking ? "#059669" : "#000000"}
            emissiveIntensity={speaking ? 2 : 0}
          />
        </Sphere>
      </mesh>
    </Float>
  );
}

// --- 2. الواجهة الرئيسية للمنصة ---
export default function PythagorasVoiceInterface() {
  const [text, setText] = useState('');
  const [analysis, setAnalysis] = useState('');
  const [loading, setLoading] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  
  // إعداد الصوت
  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;

    const updateVoices = () => {
      setVoices(window.speechSynthesis.getVoices());
    };

    updateVoices();
    window.speechSynthesis.onvoiceschanged = updateVoices;

    return () => {
      window.speechSynthesis.onvoiceschanged = null;
      window.speechSynthesis.cancel();
    };
  }, []);

  const speak = useCallback(
    ({ text, voice, rate }: { text: string; voice?: SpeechSynthesisVoice; rate?: number }) => {
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;

      const utterance = new SpeechSynthesisUtterance(text);
      if (voice) utterance.voice = voice;
      utterance.rate = rate ?? 1;
      utterance.onstart = () => setSpeaking(true);
      utterance.onend = () => setSpeaking(false);
      utterance.onerror = () => setSpeaking(false);

      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    },
    []
  );

  // اختيار صوت "Google UK English Male" أو ما شابه ليكون رسمياً
  const voice = voices.find((v) => v.lang.includes('en-GB')) || voices[0];

  const handleScan = () => {
    setLoading(true);
    // محاكاة عملية تحليل (استبدلها بالـ API الحقيقي لاحقاً)
    setTimeout(() => {
      setLoading(false);
      const report = "Dr. Hamzeh, the analysis is complete. Detecting 85% AI probability in the intro section. Critical anomaly found in paragraph 3. Suggesting immediate revision.";
      setAnalysis(report);
      
      // فيثاغورس يبدأ الكلام تلقائياً
      speak({ text: report, voice: voice, rate: 0.9 });
    }, 3000);
  };

  return (
    <div className="relative w-full h-screen bg-[#020617] overflow-hidden font-cairo text-white">
      
      {/* A. خلفية شبكة البيانات العصبية */}
      <Particles
        id="tsparticles"
        options={{
          background: { opacity: 0 },
          particles: {
            color: { value: "#06b6d4" },
            links: { enable: true, color: "#06b6d4", opacity: 0.2 },
            move: { enable: true, speed: 0.5 },
            number: { value: 60 },
            opacity: { value: 0.3 },
            size: { value: { min: 1, max: 3 } },
          },
        }}
        className="absolute inset-0 z-0"
      />

      {/* B. مشهد الـ 3D (الرأس المدبر) */}
      <div className="absolute top-0 left-0 w-full h-[60%] z-10 pointer-events-none">
        <Canvas camera={{ position: [0, 0, 4] }}>
            <ambientLight intensity={0.5} />
            <pointLight position={[10, 10, 10]} intensity={1.5} color="#06b6d4" />
            <VoiceCore speaking={speaking} />
            <Stars radius={100} depth={50} count={5000} factor={4} saturation={0} fade speed={1} />
        </Canvas>
      </div>

      {/* C. واجهة التحكم الزجاجية (Glass Dashboard) */}
      <div className="absolute bottom-0 w-full h-[50%] z-20 flex justify-center items-end pb-10 px-6">
        <motion.div 
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 1, type: "spring" }}
          className="glass-eduverse w-full max-w-4xl p-8 rounded-[3rem] border border-white/10 shadow-[0_-10px_40px_rgba(6,182,212,0.1)] backdrop-blur-xl bg-black/60 relative overflow-hidden"
        >
          {/* شريط التحميل الهولوغرافي */}
          {loading && (
             <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-emerald-500 to-transparent animate-shimmer"></div>
          )}

          <div className="flex flex-col md:flex-row gap-8">
            {/* منطقة الإدخال */}
            <div className="flex-1 space-y-4">
              <h2 className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-emerald-400">
                PYTHAGORAS SYSTEM v4.0
              </h2>
              <textarea 
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Paste academic text for forensic analysis..."
                className="w-full h-32 bg-white/5 border border-white/10 rounded-2xl p-4 text-sm focus:border-cyan-500/50 outline-none transition-all resize-none font-mono"
              />
              <button 
                onClick={handleScan}
                disabled={loading || !text}
                className="w-full py-4 bg-gradient-to-r from-cyan-600 to-emerald-600 rounded-xl font-bold hover:shadow-[0_0_20px_rgba(6,182,212,0.4)] transition-all flex justify-center items-center gap-2 group"
              >
                {loading ? (
                    <span className="animate-pulse">ANALYZING NEURAL PATTERNS...</span>
                ) : (
                    <>
                        <span>INITIATE SCAN</span>
                        <span className="group-hover:translate-x-1 transition-transform">🚀</span>
                    </>
                )}
              </button>
            </div>

            {/* منطقة التقرير الصوتي */}
            <div className="flex-1 bg-black/40 rounded-2xl p-6 border border-white/5 relative">
              <div className="absolute top-4 right-4 flex gap-2">
                {speaking && (
                    <div className="flex gap-1 items-end h-4">
                        <motion.div animate={{ height: [4, 16, 4] }} transition={{ repeat: Infinity, duration: 0.5 }} className="w-1 bg-emerald-500 rounded-full" />
                        <motion.div animate={{ height: [4, 12, 4] }} transition={{ repeat: Infinity, duration: 0.4 }} className="w-1 bg-emerald-500 rounded-full" />
                        <motion.div animate={{ height: [4, 16, 4] }} transition={{ repeat: Infinity, duration: 0.6 }} className="w-1 bg-emerald-500 rounded-full" />
                    </div>
                )}
              </div>
              
              <h3 className="text-gray-400 text-xs font-bold uppercase tracking-widest mb-4">LIVE INTELLIGENCE FEED</h3>
              
              <div className="h-40 overflow-y-auto text-sm leading-relaxed font-mono text-cyan-100/80">
                {analysis ? (
                   <span className="typing-effect">{analysis}</span>
                ) : (
                   <span className="opacity-30">Waiting for data input... System ready.</span>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}