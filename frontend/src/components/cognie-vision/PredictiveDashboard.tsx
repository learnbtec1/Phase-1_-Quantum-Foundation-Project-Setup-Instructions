import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { GlassPanel } from "./GlassPanel";

interface LearningPath {
  course: string;
  progress: number;
  nextMilestone: string;
  color: "cyan" | "emerald" | "amber";
}

const initialPaths: LearningPath[] = [
  { course: "Neural Scaffolding", progress: 68, nextMilestone: "Spatial Memory", color: "cyan" },
  { course: "Affective Reasoning", progress: 41, nextMilestone: "Empathy Loop", color: "emerald" },
  { course: "Symbolic Logic", progress: 83, nextMilestone: "Meta-Cognition", color: "amber" },
];

export function PredictiveDashboard() {
  const [paths, setPaths] = useState(initialPaths);

  useEffect(() => {
    // ⚠ Simulated AI prediction. Replace with FastAPI/Laravel endpoint later.
    const id = setInterval(() => {
      setPaths((prev) =>
        prev.map((p) => ({
          ...p,
          progress: Math.max(5, Math.min(99, p.progress + (Math.random() * 14 - 7))),
        })),
      );
    }, 5000);
    return () => clearInterval(id);
  }, []);

  const colorVar = (c: LearningPath["color"]) =>
    c === "cyan" ? "var(--neon-cyan)" : c === "emerald" ? "var(--neon-emerald)" : "var(--neon-amber)";

  return (
    <GlassPanel variant="neon" glowColor="cyan" className="w-80 p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-widest uppercase" style={{ color: "var(--neon-cyan)" }}>
          Predictive Cortex
        </h2>
        <span className="text-[10px] text-muted-foreground">live · 5s</span>
      </div>
      <div className="space-y-4">
        {paths.map((p) => (
          <div key={p.course}>
            <div className="mb-1 flex items-baseline justify-between text-xs">
              <span className="font-medium">{p.course}</span>
              <span style={{ color: colorVar(p.color) }}>{Math.round(p.progress)}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/5">
              <motion.div
                className="h-full rounded-full"
                style={{
                  background: `linear-gradient(90deg, ${colorVar(p.color)}, color-mix(in oklab, ${colorVar(p.color)} 50%, transparent))`,
                  boxShadow: `0 0 12px ${colorVar(p.color)}`,
                }}
                animate={{ width: `${p.progress}%` }}
                transition={{ duration: 1.2, ease: "easeOut" }}
              />
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground">→ {p.nextMilestone}</p>
          </div>
        ))}
      </div>
    </GlassPanel>
  );
}