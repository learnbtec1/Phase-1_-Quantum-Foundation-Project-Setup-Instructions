// frontend/src/lib/behavior/types.ts — عقد حمولة السلوك (متزامن مع خطة المحرك في الخادم)

export interface GestureCommand {
  type: string;
  side: 'left' | 'right' | 'both' | 'none';
  start_offset_ms: number;
  duration_ms: number;
  priority: number;
  channel: 'micro' | 'upper' | 'full';
  intensity?: number;
  /** ═══ NEW ═══ From backend `scale_factor` */
  scale_factor?: number;
  /** When true, scheduler skips extra playback-start delay (urgent / cut-off cues). */
  critical_timing?: boolean;
}

export interface MicroExpressionCommand {
  type: string;
  start_offset_ms: number;
  duration_ms: number;
  intensity: number;
}

export interface GazeCommand {
  target: 'user' | 'away' | 'think';
  start_offset_ms: number;
  duration_ms: number;
}

export interface PostureCommand {
  type: 'neutral' | 'listeningLean' | 'thinkingUpward' | 'excited';
  intensity: number;
}

export interface BehaviorPayload {
  gestures: GestureCommand[];
  micro_expressions: MicroExpressionCommand[];
  gaze: GazeCommand[];
  posture: PostureCommand | null;
}
