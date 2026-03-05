// components/DrAhmedOrb.tsx

"use client";

import React from "react";
import { motion } from "framer-motion";
import clsx from "clsx";

const DrAhmedOrb = () => {
    return (
      <motion.div
          initial={{ opacity: 0, y: 50 }}
          animate={{
              opacity: 1,
              y: 0,
              boxShadow: [
                  "0 0 20px #06b6d4",
                  "0 0 30px #10b981",
                  "0 0 20px #06b6d4",
              ],
          }}
          transition={{
              duration: 3,
              repeat: Infinity,
              repeatType: "mirror",
              ease: "easeInOut",
          }}
          className={clsx(
              "fixed bottom-10 right-10 z-50",
              "w-32 h-32 rounded-full",
              "bg-white/10 backdrop-blur-xl border border-white/20",
              "flex items-center justify-center",
              "shadow-[0_0_30px_rgba(6,182,212,0.25)]"
          )}
      >
          <div className="text-center text-sm text-white font-light">
              <span className="block font-medium text-emerald-400">Dr. Ahmed</span>
              AI Mentor
          </div>
      </motion.div>
    );
};

export default DrAhmedOrb;
