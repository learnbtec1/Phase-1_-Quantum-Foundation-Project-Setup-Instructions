'use client';

import { useEffect, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { Stars } from '@react-three/drei';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'react-hot-toast';
import Player from '@/components/Player';
import NPC from '@/components/NPC';
import WalkingColleague from '@/components/WalkingColleague';
import OfficeEnvironment from '@/components/OfficeEnvironment';
import DialogueSystem from '@/components/DialogueSystem';
import PESTLEChallenge from '@/components/Challenges/PESTLEChallenge';
import FourPsChallenge from '@/components/Challenges/FourPsChallenge';
import BudgetChallenge from '@/components/Challenges/BudgetChallenge';
import CompetitorChallenge from '@/components/Challenges/CompetitorChallenge';
import CampaignChallenge from '@/components/Challenges/CampaignChallenge';
import { npcDefinitions } from '@/data/learningData';
import { challengesData } from '@/data/challengesData';
import { saveProgress, loadProgress } from '@/utils/gameLogic';
import type { NPCDefinition, Vector3 } from '@/types/gameTypes';

const bounds = { minX: -9, maxX: 9, minZ: -9, maxZ: 9 };

export default function MarketingSimulationWorld() {
  const [playerPosition, setPlayerPosition] = useState<Vector3>({ x: 0, y: 0.5, z: 0 });
  const [activeNPC, setActiveNPC] = useState<NPCDefinition | null>(null);
  const [activeChallenge, setActiveChallenge] = useState<string | null>(null);
  const [completedChallenges, setCompletedChallenges] = useState<string[]>([]);
  const [xp, setXp] = useState(0);
  const [level, setLevel] = useState(1);
  const [touchVector, setTouchVector] = useState<Vector3>({ x: 0, y: 0, z: 0 });

  useEffect(() => {
    const saved = typeof window !== 'undefined' ? loadProgress() : null;
    if (saved) {
      setPlayerPosition(saved.position);
      setCompletedChallenges(saved.completedChallenges);
      setXp(saved.xp);
      setLevel(saved.level);
    }
  }, []);

  const handleInteract = (npc: NPCDefinition) => {
    setActiveNPC(npc);
    if (npc.challengeId) {
      setActiveChallenge(npc.challengeId);
    }
  };

  const handleCompleteChallenge = (id: string) => {
    if (completedChallenges.includes(id)) return;
    const reward = challengesData.find((c) => c.id === id)?.rewardXp ?? 100;
    const nextXp = xp + reward;
    const nextLevel = Math.floor(nextXp / 500) + 1;
    setCompletedChallenges((prev) => [...prev, id]);
    setXp(nextXp);
    setLevel(nextLevel);
    toast.success(`تم إكمال التحدي! +${reward} XP`);
    setActiveChallenge(null);
    setActiveNPC(null);

    saveProgress({
      position: playerPosition,
      completedChallenges: [...completedChallenges, id],
      rewards: [`xp-${reward}`],
      xp: nextXp,
      level: nextLevel,
      lastStage: nextLevel
    });
  };

  const challengePanel = () => {
    switch (activeChallenge) {
      case 'pestle':
        return <PESTLEChallenge onComplete={() => handleCompleteChallenge('pestle')} />;
      case 'fourps':
        return <FourPsChallenge onComplete={() => handleCompleteChallenge('fourps')} />;
      case 'budget':
        return <BudgetChallenge onComplete={() => handleCompleteChallenge('budget')} />;
      case 'competitors':
        return <CompetitorChallenge onComplete={() => handleCompleteChallenge('competitors')} />;
      case 'campaign':
        return <CampaignChallenge onComplete={() => handleCompleteChallenge('campaign')} />;
      default:
        return null;
    }
  };

  return (
    <div className="relative w-full h-[calc(100vh-120px)]">
      <Canvas camera={{ position: [0, 6, 8], fov: 50 }}>
        <ambientLight intensity={0.6} />
        <directionalLight position={[6, 10, 4]} intensity={1} castShadow />
        {/* @ts-ignore - Drei component type compatibility */}
        <Stars radius={80} depth={20} count={2000} factor={4} />

        <OfficeEnvironment />
        <Player bounds={bounds} onMove={setPlayerPosition} touchVector={touchVector} />

        {npcDefinitions.map((npc) => (
          <NPC key={npc.id} npc={npc} playerPosition={playerPosition} onInteract={handleInteract} />
        ))}

        <WalkingColleague position={[2, 0.5, 6]} bounds={bounds} avatarUrl="/avatars/colleague.svg" label="زميل" />
        <WalkingColleague position={[-3, 0.5, -6]} bounds={bounds} avatarUrl="/avatars/colleague.svg" label="زميل" />
      </Canvas>

      <DialogueSystem open={!!activeNPC} lines={activeNPC?.dialogue ?? []} onClose={() => setActiveNPC(null)} />

      <AnimatePresence>
        {activeChallenge && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="absolute top-6 left-6 z-50 w-full max-w-md"
          >
            {challengePanel()}
          </motion.div>
        )}
      </AnimatePresence>

      {/* HUD */}
      <div className="absolute top-6 right-6 z-40 glass-dark p-4 rounded-2xl border border-white/10">
        <div className="text-sm text-gray-400">المستوى</div>
        <div className="text-2xl font-black text-cyan-400">{level}</div>
        <div className="text-sm text-gray-400 mt-2">نقاط الخبرة</div>
        <div className="text-lg font-bold">{xp}</div>
        <div className="mt-3 text-xs text-gray-400">تحديات مكتملة: {completedChallenges.length}</div>
      </div>

      {/* أزرار تحكم للجوال */}
      <div className="absolute bottom-6 left-6 z-40 flex gap-3">
        <div className="glass-dark p-3 rounded-2xl border border-white/10">
          <div className="text-xs text-gray-300 mb-2">تحكم لمسي</div>
          <div className="grid grid-cols-3 gap-2">
            <button
              onPointerDown={() => setTouchVector({ x: 0, y: 0, z: -1 })}
              onPointerUp={() => setTouchVector({ x: 0, y: 0, z: 0 })}
              onPointerLeave={() => setTouchVector({ x: 0, y: 0, z: 0 })}
              className="px-3 py-2 bg-white/10 rounded-lg"
            >
              ⬆️
            </button>
            <button
              onPointerDown={() => setTouchVector({ x: -1, y: 0, z: 0 })}
              onPointerUp={() => setTouchVector({ x: 0, y: 0, z: 0 })}
              onPointerLeave={() => setTouchVector({ x: 0, y: 0, z: 0 })}
              className="px-3 py-2 bg-white/10 rounded-lg"
            >
              ⬅️
            </button>
            <button
              onPointerDown={() => setTouchVector({ x: 1, y: 0, z: 0 })}
              onPointerUp={() => setTouchVector({ x: 0, y: 0, z: 0 })}
              onPointerLeave={() => setTouchVector({ x: 0, y: 0, z: 0 })}
              className="px-3 py-2 bg-white/10 rounded-lg"
            >
              ➡️
            </button>
            <button
              onPointerDown={() => setTouchVector({ x: 0, y: 0, z: 1 })}
              onPointerUp={() => setTouchVector({ x: 0, y: 0, z: 0 })}
              onPointerLeave={() => setTouchVector({ x: 0, y: 0, z: 0 })}
              className="px-3 py-2 bg-white/10 rounded-lg"
            >
              ⬇️
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
