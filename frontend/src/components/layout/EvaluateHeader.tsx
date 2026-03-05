'use client';

import React from 'react';
import Link from 'next/link';

export default function EvaluateHeader() {
  return (
    <header className="evaluate-header shrink-0 h-16 flex items-center justify-between px-4 sm:px-6 border-b border-white/10 bg-[var(--evaluate-bg-primary)]/95 backdrop-blur-md">
      <Link
        href="/dashboard"
        className="flex items-center gap-2 text-[var(--evaluate-text-secondary)] hover:text-white transition-colors"
        aria-label="العودة للصفحة الرئيسية"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        <span className="text-sm font-semibold hidden sm:inline">الرئيسية</span>
      </Link>

      <div className="flex items-center gap-3">
        <span className="text-lg sm:text-xl font-bold tracking-tight text-white">
          <span className="text-[var(--evaluate-accent-blue)]">Quantum</span>
          <span className="text-[var(--evaluate-accent-gold)]"> Foundation</span>
        </span>
        <span className="hidden sm:inline text-slate-400 text-xs font-medium px-2">|</span>
        <span className="hidden sm:inline text-slate-400 text-sm">د. حمزة — BTEC</span>
      </div>

      <div className="flex items-center gap-2">
        <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-400 text-xs font-medium border border-emerald-500/30">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          متصل
        </span>
        <button
          type="button"
          className="p-2 rounded-lg text-[var(--evaluate-text-secondary)] hover:text-white hover:bg-white/5 transition"
          aria-label="الإعدادات"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
      </div>
    </header>
  );
}
