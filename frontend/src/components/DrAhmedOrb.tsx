"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, X, MessageCircle } from "lucide-react";

export default function DrAhmedOrb() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="fixed bottom-8 right-8 z-50">
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.8, y: 20 }}
            className="absolute bottom-20 right-0 w-80 rounded-3xl bg-gray-900/95 backdrop-blur-2xl border border-white/10 shadow-2xl overflow-hidden"
          >
            <div className="p-5 border-b border-white/10 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-cyan-500 to-purple-600 flex items-center justify-center">
                  <Sparkles className="w-4 h-4 text-white" />
                </div>
                <div>
                  <p className="text-sm font-bold text-white">Dr. Ahmed AI</p>
                  <p className="text-[10px] text-emerald-400 font-semibold">Online</p>
                </div>
              </div>
              <button aria-label="إغلاق" title="إغلاق" onClick={() => setIsOpen(false)} className="text-gray-500 hover:text-white transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 min-h-[200px] flex items-center justify-center">
              <p className="text-gray-400 text-sm text-center leading-relaxed">
                مرحباً! أنا مساعدك الذكي.<br />
                كيف يمكنني مساعدتك اليوم؟
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* الزر العائم */}
      <motion.button
        onClick={() => setIsOpen(!isOpen)}
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.95 }}
        className="relative w-16 h-16 rounded-full bg-gradient-to-br from-cyan-500 via-purple-600 to-pink-500 flex items-center justify-center shadow-2xl shadow-purple-500/30 cursor-pointer"
      >
        {/* حلقة النبض */}
        <motion.div
          className="absolute inset-0 rounded-full bg-gradient-to-br from-cyan-500 to-purple-600"
          animate={{ scale: [1, 1.3, 1], opacity: [0.5, 0, 0.5] }}
          transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
        />
        <MessageCircle className="w-7 h-7 text-white relative z-10" />
      </motion.button>
    </div>
  );
}
