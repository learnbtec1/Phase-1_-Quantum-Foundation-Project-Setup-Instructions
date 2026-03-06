// File: frontend/src/hooks/useBrainStore.ts
// @ts-nocheck — legacy store superseded by store/useBrainStore.ts
import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import type { BrainState, BrainAction, BrainStore, AgentFrame } from '@/types/ai';
import { mapEmotionToPAD } from '@/ai/cognitive/PADModel';
import { tickPADDecay } from '@/ai/cognitive/EmotionDecay';
import { decideBehaviorFromPAD } from '@/ai/cognitive/BehaviorRulesEngine';

const initialState: BrainState = {
  emotion: { pad: { pleasure: 0, arousal: 0, dominance: 0 }, primary: 'neutral' },
  memory: { shortTerm: [], emotionalTrend: { averagePleasure: 0, averageArousal: 0, trend: 'stable', lastEmotion: 'neutral' }, longTerm: { topics: [], importantMoments: [] } },
  physical: { isSpeaking: false, isThinking: false, isListening: false },
  currentAction: { gesture: null, expression: null, speechText: null },
};

const brainReducer = (state: BrainState, action: BrainAction): BrainState => {
  switch (action.type) {
    case 'UPDATE_EMOTION': return { ...state, emotion: { ...state.emotion, ...action.payload } };
    case 'ADD_MEMORY_TURN': return { ...state, memory: { ...state.memory, shortTerm: [...state.memory.shortTerm, action.payload].slice(-10) } };
    case 'CLEAR_SHORT_TERM_MEMORY': return { ...state, memory: { ...state.memory, shortTerm: [] } };
    case 'UPDATE_PHYSICAL_STATE': return { ...state, physical: { ...state.physical, ...action.payload } };
    case 'SET_CURRENT_ACTION': return { ...state, currentAction: { ...state.currentAction, ...action.payload } };
    case 'RESET_CURRENT_ACTION': return { ...state, currentAction: initialState.currentAction };
    default: return state;
  }
};

export const useBrainStore = create<BrainStore>()(
  devtools(
    persist(
      (set, get) => ({
        ...initialState,

        dispatch: (action) => set((state) => brainReducer(state, action)),

        getEmotionalVector: () => {
          const { pad, primary } = get().emotion;
          return [pad.pleasure, pad.arousal, pad.dominance];
        },

        getLastUserMessage: () => {
          const turns = get().memory.shortTerm;
          for (let i = turns.length - 1; i >= 0; i--) {
            if (turns[i].role === 'user') return turns[i].text;
          }
          return null;
        },

        processFrame: (frame: AgentFrame) => {
          const state = get();
          const padDelta = mapEmotionToPAD(frame.emotion_tag);

          const newPAD = {
            pleasure: Math.min(1, Math.max(-1, state.emotion.pad.pleasure + padDelta.pleasure)),
            arousal: Math.min(1, Math.max(-1, state.emotion.pad.arousal + padDelta.arousal)),
            dominance: Math.min(1, Math.max(-1, state.emotion.pad.dominance + padDelta.dominance)),
          };

          const decayedPAD = tickPADDecay(newPAD, 0.02);

          get().dispatch({ type: 'UPDATE_EMOTION', payload: { pad: decayedPAD, primary: frame.primary_emotion || frame.emotion_tag } });

          if (frame.dialogue) {
            get().dispatch({ type: 'ADD_MEMORY_TURN', payload: { role: 'assistant', text: frame.dialogue, timestamp: Date.now(), emotion: frame.emotion_tag } });
          }

          const behavior = decideBehaviorFromPAD(decayedPAD);

          setTimeout(() => {
            get().dispatch({
              type: 'SET_CURRENT_ACTION',
              payload: { gesture: behavior.gesture, expression: behavior.expression, voiceParameters: behavior.voiceParameters },
            });
          }, behavior.thinkingDelayMs);

          console.log('[BrainStore] Frame processed →', { frame, decayedPAD, behavior });
        },
      }),
      { name: 'brain-storage' }
    )
  )
);