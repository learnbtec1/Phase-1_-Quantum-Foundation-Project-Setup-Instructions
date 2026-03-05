// components/Dashboard.tsx

"use client";

import React from "react";
import { motion, useMotionValue, useTransform } from "framer-motion";
import DrHamzaOrb from "./DrHamzaOrb";
import clsx from "clsx";

// Tile Config
const tiles = [
  { title: "Module Viewer" },
  { title: "Study Timeline" },
  { title: "AI Feedback" },
  { title: "Cognitive Load" },
  { title: "Simulation Access" },
];

// Helper component: TiltCard
const TiltCard = ({ title }: { title: string }) => {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotateX = useTransform(y, [0, 1], [10, -10]);
  const rotateY = useTransform(x, [0, 1], [-10, 10]);

  const handleMouseMove = (e: React.MouseEvent) => {
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    const offsetX = e.clientX - rect.left;
    const offsetY = e.clientY - rect.top;
    const newX = offsetX / rect.width;
    const newY = offsetY / rect.height;

    x.set(newX);
    y.set(newY);
  };

  const handleMouseLeave = () => {
    x.set(0.5);
    y.set(0.5);
  };

  return (
    <motion.div
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{
        rotateX,
        rotateY,
        transformStyle: "preserve-3d",
      }}
      className={clsx(
        "group relative w-full h-48 rounded-2xl p-6 transition-all duration-300",
        "bg-white/10 backdrop-blur-lg border border-white/20",
        "shadow-[0_0_30px_rgba(6,182,212,0.15)]",
        "hover:shadow-[0_0_50px_rgba(16,185,129,0.4)]"
      )}
    >
      <div
        className={clsx(
          "text-white text-xl font-semibold",
          "group-hover:text-emerald-400"
        )}
      >
        {title}
      </div>
      <motion.div
        className="absolute inset-0 rounded-2xl pointer-events-none border-2 opacity-0 group-hover:opacity-100"
        animate={{
          borderColor: ["#06b6d4", "#10b981"],
        }}
        transition={{
          duration: 1.2,
          repeat: Infinity,
          repeatType: "mirror",
        }}
      />
    </motion.div>
  );
};

// Main Dashboard Component
const Dashboard = () => {
  return (
    <div className="relative min-h-screen w-full bg-transparent px-8 py-16 flex flex-col items-center justify-center overflow-hidden">
      {/* Bento Grid */}
      <div
        className={clsx(
          "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8 max-w-6xl w-full",
          "z-10"
        )}
      >
        {tiles.map((tile) => (
          <TiltCard key={tile.title} title={tile.title} />
        ))}
      </div>

      {/* Dr. Hamza AI Orb */}
      <DrHamzaOrb />
    </div>
  );
};

export default Dashboard;
