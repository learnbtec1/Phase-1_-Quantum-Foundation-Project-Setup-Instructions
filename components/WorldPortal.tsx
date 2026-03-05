"use client";
import React, { Suspense } from 'react';
import dynamic from 'next/dynamic';
import { motion } from 'framer-motion';

const BTECEngine = dynamic(() => import('./vr-engine/BTECEngine'), { ssr: false });

export default function WorldPortal({ activeUnit, onAction }: { activeUnit: any, onAction: () => void }) {
  return (
    <div className="relative w-full h-[500px] rounded-[3rem] overflow-hidden border border-white/10 shadow-2xl">
      <Suspense fallback={<div className="flex items-center justify-center h-full bg-slate-900 animate-pulse text-cyan-500 font-mono">LOADING VIRTUAL SECTOR...</div>}>
        <BTECEngine config={activeUnit} onStartTask={onAction} />
      </Suspense>
      <div className="absolute top-8 left-8 p-6 bg-black/40 backdrop-blur-md rounded-2xl border border-white/10">
        <h3 className="text-2xl font-black text-white italic uppercase tracking-tighter">{activeUnit.title}</h3>
        <p className="text-cyan-400 text-xs font-mono uppercase tracking-[0.2em]">{activeUnit.sector}</p>
      </div>
    </div>
  );
}
