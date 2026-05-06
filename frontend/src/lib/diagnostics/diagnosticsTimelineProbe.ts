/**
 * Lightweight timeline probes — updated outside hot paths or via cheap hooks.
 * Consumed by {@link runtimeTimelineRecorder} every 2s (never inside useFrame).
 */

const BONE_RING_MAX = 12;
const _conflictBones: string[] = [];

export function diagTimelinePushConflictBone(boneKey: string | undefined): void {
  if (!boneKey) return;
  _conflictBones.unshift(boneKey);
  while (_conflictBones.length > BONE_RING_MAX) _conflictBones.pop();
}

export function diagTimelineConflictBonesSnapshot(): string[] {
  return [..._conflictBones];
}

/** Last classified intent (rules / merged LLM). */
let _activeIntent = '';
let _intentReason = '';
/** Raw LLM canonical label from last call site (may be empty). */
let _llmIntentProbe = '';

export function diagTimelineTouchIntent(
  intent: string,
  llmIntent: string | null | undefined,
  reason: string,
): void {
  _activeIntent = intent;
  _intentReason = reason;
  _llmIntentProbe = (llmIntent ?? '').trim();
}

/** Last semantic gesture decision from bridge (per frame when resolved). */
let _semanticGesture = '';
let _semanticSourceIntent = '';

export function diagTimelineTouchSemantic(gesture: string, sourceIntent: string): void {
  _semanticGesture = gesture;
  _semanticSourceIntent = sourceIntent;
}

export function diagTimelineIntentProbe(): {
  activeIntent: string;
  llmIntent: string;
  intentReason: string;
  semanticGesture: string;
  semanticSourceIntent: string;
} {
  return {
    activeIntent: _activeIntent,
    llmIntent: _llmIntentProbe,
    intentReason: _intentReason,
    semanticGesture: _semanticGesture,
    semanticSourceIntent: _semanticSourceIntent,
  };
}
