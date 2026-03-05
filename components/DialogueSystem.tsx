'use client';

import { motion, AnimatePresence } from 'framer-motion';
import type { DialogueLine } from '@/types/gameTypes';

interface DialogueSystemProps {
  open: boolean;
  lines: DialogueLine[];
  onClose: () => void;
}

export default function DialogueSystem({ open, lines, onClose }: DialogueSystemProps) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          className="fixed bottom-6 right-6 z-[9999] glass-dark p-6 rounded-2xl w-[320px] border border-white/10"
        >
          <h3 className="text-lg font-bold mb-4">حوار التدريب</h3>
          <div className="space-y-3 text-sm text-gray-200">
            {lines.map((line, index) => (
              <div key={`${line.speaker}-${index}`}>
                <span className="text-cyan-400 font-bold">{line.speaker}: </span>
                {line.text}
                {line.hint && <div className="text-xs text-gray-400 mt-1">{line.hint}</div>}
              </div>
            ))}
          </div>
          <button
            onClick={onClose}
            className="mt-4 w-full py-2 rounded-lg bg-white/10 hover:bg-white/20"
          >
            إغلاق
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
