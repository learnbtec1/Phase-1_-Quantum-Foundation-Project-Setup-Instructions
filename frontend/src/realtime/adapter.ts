/**
 * Realtime provider adapter types and factory.
 * Providers: rita | google | gemini | docker | azure3d
 */

export type RtProvider = 'rita' | 'google' | 'gemini' | 'docker' | 'azure3d';

export interface RtSession {
  connect(): Promise<void>;
  disconnect(): void;
  onEvent(cb: (ev: RtEvent) => void): () => void;
  sendUserAudio?(pcm: ArrayBuffer | Blob): Promise<void>;
  sendUserText?(text: string): Promise<void>;
  supportsTimings: boolean;
}

export interface RtEvent {
  type: 'audio' | 'text' | 'timings' | 'error' | 'end';
  audio?: HTMLAudioElement | string;
  timings?: Array<{ word: string; start_time: number; end_time: number }>;
  sampleRate?: number;
  text?: string;
  error?: string;
}

export type RtFactory = () => RtSession | null;
