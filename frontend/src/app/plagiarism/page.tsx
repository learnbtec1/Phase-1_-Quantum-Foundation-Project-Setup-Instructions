"use client";

import React, { Suspense, useState, useRef, useEffect } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Float, MeshDistortMaterial, Sphere, OrbitControls, Stars } from "@react-three/drei";
import { motion as motion2d, AnimatePresence } from "framer-motion";

// --- مكون النواة الذكية (تتفاعل مع الصوت) ---
function PythagorasCore({ isSpeaking }: { isSpeaking: boolean }) {
  const meshRef = useRef<any>(null);

  useFrame(() => {
    if (meshRef.current && isSpeaking) {
      meshRef.current.rotation.y += 0.05; // دوران أسرع عند الكلام
    }
  });

  return (
    <Float speed={isSpeaking ? 6 : 2} rotationIntensity={isSpeaking ? 3 : 1.5} floatIntensity={isSpeaking ? 4 : 2}>
      <mesh ref={meshRef}>
        <Sphere args={[1, 64, 64]}>
          <MeshDistortMaterial
            color={isSpeaking ? "#10b981" : "#06b6d4"} // يتحول للأخضر الزمردي عند الكلام
            speed={isSpeaking ? 5 : 2}
            distort={isSpeaking ? 0.6 : 0.4}
            radius={1}
            emissive={isSpeaking ? "#059669" : "#000000"}
            emissiveIntensity={isSpeaking ? 1.5 : 0}
          />
        </Sphere>
      </mesh>
    </Float>
  );
}

export default function Pythagoras_AI_Nexus() {
  const [inputText, setInputText] = useState("");
  const [isScanning, setIsScanning] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [report, setReport] = useState("");

  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const speak = (text: string) => {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.onstart = () => setIsSpeaking(true);
      utterance.onend = () => setIsSpeaking(false);
      window.speechSynthesis.speak(utterance);
    }
  };

  const handleStartScan = () => {
    if (!inputText.trim()) return;
    setIsScanning(true);
    
    // محاكاة التحليل الجنائي
    setTimeout(() => {
      setIsScanning(false);
      const result = "التحليل الجنائي اكتمل. تم اكتشاف نمط كتابة اصطناعي بنسبة ثمانين بالمئة في الفقرة الثانية. دكتور حمزة، أنصحك بمراجعة الربط المنطقي في المنهجية.";
      setReport(result);
      speak(result);
    }, 3000);
  };

  return (
    <div className="h-screen w-full bg-[#030712] relative overflow-hidden font-cairo">
      {/* 1. طبقة الـ 3D العميقة */}
      <div className="absolute inset-0 z-0">
        <Canvas camera={{ position: [0, 0, 5], fov: 75 }}>
          <ambientLight intensity={0.4} />
          <pointLight position={[10, 10, 10]} color="#06b6d4" intensity={1.5} />
          <Stars radius={100} depth={50} count={5000} factor={4} saturation={0} fade speed={1} />
          <Suspense fallback={null}>
            <PythagorasCore isSpeaking={isSpeaking} />
          </Suspense>
          <OrbitControls enableZoom={false} />
        </Canvas>
      </div>

      {/* 2. طبقة الواجهة (Spatial UI) */}
      <motion2d.main
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="relative z-10 flex flex-col items-center justify-center h-full p-6"
      >
        <div className="glass-nexus p-10 max-w-3xl w-full rounded-[40px] border border-white/10 shadow-2xl backdrop-blur-3xl bg-black/20">
          <div className="flex items-center justify-center gap-3 mb-6">
             <div className={`w-3 h-3 rounded-full ${isSpeaking ? 'bg-emerald-500 animate-ping' : 'bg-cyan-500'}`}></div>
             <h1 className="text-4xl font-black text-gradient uppercase tracking-tighter">
                Pythagoras AI Nexus
             </h1>
          </div>
          
          <p className="text-gray-400 text-center mb-8 text-sm">
            نظام التحليل الجنائي المستقبلي للأبحاث الأكاديمية - رؤية 2046
          </p>

          <textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            className="w-full h-40 bg-black/40 border border-white/5 rounded-3xl p-6 text-white outline-none focus:border-emerald-500/50 transition-all placeholder:opacity-20 font-mono text-sm"
            placeholder="أدخل النص الأكاديمي للتحليل العميق..."
          />

          <button 
            onClick={handleStartScan}
            disabled={isScanning || !inputText}
            className="btn-nexus w-full mt-6 py-5 rounded-2xl text-xl font-black shadow-[0_0_30px_rgba(6,182,212,0.2)] disabled:opacity-50 group overflow-hidden relative"
          >
            <span className="relative z-10">{isScanning ? "جاري المسح الهولوجرامي..." : "بدء تحليل فيثاغورس"}</span>
            {isScanning && <div className="absolute inset-0 bg-white/10 animate-pulse"></div>}
          </button>
        </div>

        {/* التقرير العائم (ظهر عند الانتهاء) */}
        <AnimatePresence>
          {report && (
            <motion2d.div 
              initial={{ opacity: 0, y: 50 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-8 p-6 glass-nexus border-emerald-500/20 max-w-2xl text-center"
            >
              <p className="text-emerald-400 font-bold mb-2 text-xs uppercase tracking-widest">Live Forensic Report</p>
              <p className="text-white text-sm leading-relaxed">{report}</p>
            </motion2d.div>
          )}
        </AnimatePresence>

        {/* حالة النظام في الزاوية */}
        <div className="absolute bottom-10 right-10 flex items-center gap-4 bg-white/5 p-4 rounded-2xl border border-white/10 backdrop-blur-md">
          <div className={`w-3 h-3 rounded-full shadow-[0_0_10px] ${isSpeaking ? 'bg-emerald-500 shadow-emerald-500' : 'bg-cyan-500 shadow-cyan-500'} animate-pulse`}></div>
          <p className="text-[10px] text-gray-400 uppercase font-bold tracking-widest">
            {isSpeaking ? "AI Advisor: Speaking" : "System: Ready for Uplink"}
          </p>
        </div>
      </motion2d.main>
    </div>
  );
}