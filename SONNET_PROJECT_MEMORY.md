# SONNET Project Memory - Cogni (Eduverse)

## Scope analyzed
- `frontend/src/app/evaluate/page.tsx`
- `frontend/src/ai/avatar/AgentDirector.ts`
- `frontend/src/app/evaluate/AvatarCanvas.tsx`

## Exact runtime data flow (backend -> page -> director -> avatar)
1. User or boot flow in `page.tsx` calls `/api/chat`.
2. API response returns text/emotion.
3. `page.tsx` updates brain state:
   - `useBrainStore.setEmotionLabel(emotion)`
   - `useBrainStore.setLastFrame(...)` for planned gesture/voice behavior
4. `page.tsx` then calls `agentDirector.scheduleTTS(cleanText, emotion, 0)`.
5. `AgentDirector` reacts through store subscriptions and internal scheduling:
   - emits `avatar:emotion`
   - emits `avatar:gesture`
   - emits `avatar:headpose` / `avatar:nod` in some emotion/listening paths
   - emits `avatar:speak:start` and `avatar:speak:end` around TTS playback
6. `AvatarCanvas.tsx` listens to these browser events and uses refs as animation targets.
7. `useFrame` applies targets continuously each render tick and updates VRM (`vrm.update(delta)`).

## Event mechanism findings
- Dispatcher in `AgentDirector.ts` routes known avatar events via `dispatchAvatar(...)`.
- `dispatchAvatar` normalizes only `avatar:gesture`, `avatar:emotion`, `avatar:listening`; other events pass through unchanged.
- `AvatarCanvas.tsx` correctly listens for:
  - `avatar:speak:start`, `avatar:speak:end`
  - `avatar:emotion`, `avatar:blink`
  - `avatar:headpose`, `avatar:nod`, `avatar:gesture`

## VRM bone manipulation findings
- Current evaluate `AvatarCanvas.tsx` already uses `getNormalizedBoneNode(...)` for:
  - `head`, `neck`, `spine`, `leftUpperArm`, `rightUpperArm`
- It does not rely on `getRawBoneNode(...)` in this file.

## Root-cause diagnosis for "Frozen/Static Avatar"
The freeze perception is multi-factor, not a single event bug:

1. **Animation architecture is too event-spike oriented**  
   Most expressive motion starts from discrete events; when event density is low, movement degrades to very subtle motion and appears static to users.

2. **No strong continuous locomotion baseline**  
   Idle movement exists but is weak and not composed as a persistent animation state machine (breath + micro sway + head micro tracking + arm settling), so the avatar can look "parked".

3. **Pose targets and timing are mixed with wall-clock windows**  
   Logic blends `Date.now()` windows with per-frame motion. This can create inconsistent transitions under variable frame timing and makes state less deterministic than pure clock-driven animation.

4. **Insufficiently constrained/managed rig channels**  
   Head/neck and arm channels are moved, but without a stricter target model + clamps + smooth convergence envelope, resulting motion can flatten or feel stuck.

5. **React updates are not the main blocker, but should be isolated from rig loop**  
   Main rendering should remain purely ref-driven in `useFrame`; any avoidable React state coupling in animation code should be removed.

## Action decided
- Keep `page.tsx` and `AgentDirector.ts` as-is unless pipeline break is found.
- Fully rewrite evaluate `AvatarCanvas.tsx` to:
  - maintain always-on breathing and idle motion
  - use normalized bones only
  - keep strict head/neck clamps
  - smooth all gesture transitions via `THREE.MathUtils.lerp`
  - keep lip-sync active during speech via `aa` preset in frame loop
  - apply all behavior inside deterministic `state.clock.elapsedTime`-driven logic
