export type Vector3 = { x: number; y: number; z: number };

export type PlayerMode = 'walk' | 'run' | 'crouch';

export interface PlayerState {
  position: Vector3;
  velocity: Vector3;
  mode: PlayerMode;
  xp: number;
  level: number;
}

export type NPCType = 'trainer' | 'market-analyst' | 'product-manager' | 'finance-manager' | 'tournament-host' | 'colleague' | 'customer';

export interface DialogueLine {
  speaker: string;
  text: string;
  hint?: string;
}

export interface NPCDefinition {
  id: string;
  name: string;
  role: NPCType;
  position: Vector3;
  dialogue: DialogueLine[];
  challengeId?: string;
  avatarUrl?: string;
}

export interface ChallengeDefinition {
  id: string;
  title: string;
  description: string;
  rewardXp: number;
}

export interface SavedProgress {
  position: Vector3;
  completedChallenges: string[];
  rewards: string[];
  xp: number;
  level: number;
  lastStage: number;
}
