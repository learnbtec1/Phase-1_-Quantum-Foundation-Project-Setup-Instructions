'use client';

import type { RootCauseGraphPayload } from './types';
import type { ActiveFailure } from './types';

/**
 * Builds a causal graph from failure clusters — incremental O(n) per cycle only.
 */
export function buildEmbodiedCausalGraph(params: {
  failures: ActiveFailure[];
  timelineTransitions: string[];
}): RootCauseGraphPayload {
  const ts = new Date().toISOString();
  const nodes: RootCauseGraphPayload['nodes'] = [];
  const edges: RootCauseGraphPayload['edges'] = [];

  const pushNode = (id: string, subsystem: RootCauseGraphPayload['nodes'][0]['subsystem'], w: number) => {
    const idx = nodes.findIndex((n) => n.id === id);
    if (idx >= 0) nodes[idx].weight += w;
    else nodes.push({ id, subsystem, weight: w });
  };

  for (const f of params.failures) {
    pushNode(f.subsystem, f.subsystem, Math.min(3, f.confidence * 3));
  }

  const layers = [
    'speech',
    'phoneme_viseme',
    'facial',
    'semantic_bridge',
    'scheduler',
    'motion_authority',
    'vrm_skeleton',
    'spatial',
    'visual_realism',
  ] as const;

  for (let i = 0; i < layers.length - 1; i++) {
    edges.push({
      from: layers[i],
      to: layers[i + 1],
      weight: 0.25,
      label: 'embodied_stack_coupling',
    });
  }

  if (params.timelineTransitions.length > 0) {
    const last = params.timelineTransitions[params.timelineTransitions.length - 1];
    pushNode('timeline_transition', 'motion_authority', 0.8);
    edges.push({ from: 'semantic_bridge', to: 'timeline_transition', weight: 0.6, label: last });
  }

  nodes.sort((a, b) => b.weight - a.weight);

  const dominantPath =
    nodes.length >= 2
      ? [nodes[0].id, nodes[1].id]
      : nodes.length === 1
        ? [nodes[0].id]
        : ['idle_embodied_stack'];

  return { timestamp: ts, nodes, edges, dominantPath };
}
