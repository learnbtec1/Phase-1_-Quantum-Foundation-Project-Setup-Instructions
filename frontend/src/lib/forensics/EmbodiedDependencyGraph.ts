'use client';

/**
 * Curated cross-file intelligence graph for the avatar embodiment stack.
 * Browser runtime cannot safely crawl the whole repo; this graph encodes known ownership + causality.
 */

export type EmbodiedGraphNode = {
  path: string;
  owns: string[];
  dependsOn: string[];
};

export const EMBODIED_PIPELINE_GRAPH: EmbodiedGraphNode[] = [
  {
    path: 'frontend/src/app/avatar-agent/VRMSkeletonManager.tsx',
    owns: ['motion authority', 'layer blend', 'VRM bone writes', 'idle vs gesture arbitration'],
    dependsOn: [
      'frontend/src/app/avatar-agent/motion/behaviorTimeline.ts',
      'frontend/src/app/avatar-agent/motion/motionScheduler.ts',
      'frontend/src/app/avatar-agent/motion/semanticGestureBridge.ts',
      'frontend/src/app/avatar-agent/motion/PoseComposer.ts',
      'frontend/src/app/avatar-agent/motion/biomechanicalCorrectionLayer.ts',
      'frontend/src/lib/diagnostics/diagnosticsApi.ts',
    ],
  },
  {
    path: 'frontend/src/app/avatar-agent/motion/behaviorTimeline.ts',
    owns: ['behavior queue', 'gesture envelope', 'anticipation/action/recovery'],
    dependsOn: ['frontend/src/app/avatar-agent/motion/semanticGestureBridge.ts'],
  },
  {
    path: 'frontend/src/app/avatar-agent/motion/motionScheduler.ts',
    owns: ['scheduler blocks', 'gesture dispatch cadence'],
    dependsOn: ['frontend/src/app/avatar-agent/motion/semanticGestureBridge.ts'],
  },
  {
    path: 'frontend/src/app/avatar-agent/motion/semanticGestureBridge.ts',
    owns: ['semantic gesture mapping', 'cooldown starvation signals'],
    dependsOn: ['frontend/src/app/avatar-agent/motion/intentClassifier.ts'],
  },
  {
    path: 'frontend/src/app/avatar-agent/motion/intentClassifier.ts',
    owns: ['text → motion intent'],
    dependsOn: [],
  },
  {
    path: 'frontend/src/app/avatar-agent/motion/PoseComposer.ts',
    owns: ['pose fusion layers'],
    dependsOn: ['frontend/src/app/avatar-agent/motion/biomechanicalCorrectionLayer.ts'],
  },
  {
    path: 'frontend/src/app/avatar-agent/motion/biomechanicalCorrectionLayer.ts',
    owns: ['Euler/order clamps', 'bind-relative arm correction'],
    dependsOn: [],
  },
  {
    path: 'frontend/src/lib/avatar/unifiedEnergyModel.ts',
    owns: ['speech-motion energy coupling'],
    dependsOn: [],
  },
  {
    path: 'frontend/src/app/avatar-agent/LipSyncManager.tsx',
    owns: ['viseme morphs', 'phoneme playhead vs cues', 'mouth RMS'],
    dependsOn: ['frontend/src/lib/avatar/audioTimeline.ts'],
  },
  {
    path: 'frontend/src/lib/avatar/resolveCogniPersonality.ts',
    owns: ['personality resolved traits'],
    dependsOn: [],
  },
  {
    path: 'frontend/src/app/avatar-agent/motion/__personalityMotion.ts',
    owns: ['personality → motion multipliers'],
    dependsOn: ['frontend/src/lib/avatar/resolveCogniPersonality.ts'],
  },
];

/** Files to prioritize when gesture collapse heuristics fire */
export const GESTURE_COLLAPSE_INSPECT_TARGETS: readonly string[] = [
  'frontend/src/app/avatar-agent/VRMSkeletonManager.tsx',
  'frontend/src/app/avatar-agent/motion/behaviorTimeline.ts',
  'frontend/src/app/avatar-agent/motion/motionScheduler.ts',
  'frontend/src/app/avatar-agent/motion/semanticGestureBridge.ts',
  'frontend/src/app/avatar-agent/motion/PoseComposer.ts',
  'frontend/src/app/avatar-agent/motion/biomechanicalCorrectionLayer.ts',
  'frontend/src/lib/avatar/unifiedEnergyModel.ts',
  // applySpeechFusion.ts — not present in repo; speech fusion lives across LipSync + VRMSkeleton energy hooks
  'frontend/src/app/avatar-agent/LipSyncManager.tsx',
] as const;

export function embodiedFindNeighbors(filePath: string): EmbodiedGraphNode | undefined {
  return EMBODIED_PIPELINE_GRAPH.find((n) => n.path === filePath);
}
