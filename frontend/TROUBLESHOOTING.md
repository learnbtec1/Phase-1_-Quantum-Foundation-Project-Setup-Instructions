# TROUBLESHOOTING — NEXUS Avatar Agent

> Covers `/avatar-agent` and the `/ws/agent` WebSocket backend.  
> `/evaluate` and `/assessment` are intentionally **not** touched by this system.

---

## Quick Diagnostic Checklist

| Symptom | First thing to check |
|---------|----------------------|
| Avatar invisible | VRM file exists at `public/models/teach.vrm` |
| WebSocket errors in console | FastAPI running on `:8000`? `backend/app/main.py` registered? |
| `classifyReplyType is not a function` | Was `CognitiveEngine.ts` rebuilt after the fix? |
| No voice / TTS silent | Kokoro service on `:8880`; fallback is Web Speech API |
| Emotion/gesture has no effect | Check browser console for `[HUMANIZE][GESTURE]` logs |
| Walk / nod / laugh not animating | Test with `__avatarDebug.testWalk()` in DevTools |

---

## 1. Avatar Is Not Visible

### Symptoms
- Black or transparent canvas where the avatar should be
- Console shows no VRM-related logs

### Causes & Fixes

**A. VRM file missing**
```
public/models/teach.vrm   ← must exist relative to Next.js root
```
Verify: open `http://localhost:3000/models/teach.vrm` in the browser — should download.

**B. `VRMUtils.rotateVRM0` was called on a pre-rotated model**  
`teach.vrm` is VRM 0.0 already facing the camera. Calling `rotateVRM0` flips it 180° → invisible.  
Fix: the call is intentionally absent in `AvatarCanvas.tsx`. Do not restore it.

**C. Dynamic import SSR hydration failure**  
`AvatarAgentClient.tsx` uses `next/dynamic({ ssr: false })`. Ensure the page imports from `AvatarAgentClient`, not `AvatarCanvas` directly.

**D. Missing `'use client'` directive**  
Any file using hooks, `useEffect`, or `useFrame` needs `'use client'` at the top.

---

## 2. WebSocket Errors: `ws://localhost:8000/ws/agent` failed

### Symptoms
```
WebSocket connection to 'ws://localhost:8000/ws/agent' failed
```

### Causes & Fixes

**A. FastAPI server not running**
```bash
cd backend
python app/main.py
# or with auto-reload:
uvicorn app.main:app --reload
```
Health check: `curl http://127.0.0.1:8000/` → `{"status":"Online",...}`

**B. `/ws/agent` endpoint not registered**  
Ensure `backend/app/main.py` has:
```python
from app.api.v1.endpoints.agent_ws import router as agent_ws_router
app.include_router(agent_ws_router)
```

**C. CORS blocking the WebSocket upgrade**  
FastAPI CORS middleware must allow `http://localhost:3000` and `http://127.0.0.1:3000`.  
See `backend/app/main.py` → `CORSMiddleware`.

---

## 3. `classifyReplyType is not a function` (TypeError at director.ts:79)

### Symptom
```
TypeError: classifyReplyType is not a function
    at directFromAgentFrame (director.ts:79)
```

### Root Cause
`director.ts` imports `classifyReplyType`, `emotionToProsody`, `humanizeTelemetry` from  
`@/ai/cognitive/CognitiveEngine` — these were never exported there.

### Fix Applied ✅
Three functions added to the bottom of `src/ai/cognitive/CognitiveEngine.ts`:
- `classifyReplyType(text)` → maps Arabic/English text to emotion overrides
- `emotionToProsody(emotion)` → maps emotion name to `{ rate, pitch }`
- `humanizeTelemetry(tag, data)` → dev-only console logger

If the error recurs, verify the file ends with all three `export function` declarations.

---

## 4. Emotions / Gestures Have No Visual Effect

### Symptoms
- Avatar speaks but shows no expression
- Gesture events dispatched but arms don't move

### Diagnostic: Use `__avatarDebug` (DevTools Console)
Open `http://localhost:3000/avatar-agent` → DevTools Console:
```js
// Test emotions
__avatarDebug.testEmotion('happy')
__avatarDebug.testEmotion('sad')
__avatarDebug.testEmotion('celebration')
__avatarDebug.testEmotion('surprised')

// Test gestures
__avatarDebug.testGesture('wave')
__avatarDebug.testGesture('point', 'right')
__avatarDebug.testGesture('beat', 'both')
__avatarDebug.testGesture('openHand', 'left')

// Test locomotion
__avatarDebug.testWalk(4)        // walk for 4 seconds
__avatarDebug.testNod()          // head nod
__avatarDebug.testLaugh()        // shoulder shake + happy expression

// Test speech
__avatarDebug.testSpeak('مرحبا') // send text via WebSocket
__avatarDebug.testBlink()        // force immediate blink
```

### Causes & Fixes

**A. Wrong emotion key sent**  
Supported emotions: `neutral`, `friendly`, `happy`, `sad`, `angry`, `strict`, `thinking`,  
`relax`, `celebration`, `excited`, `encouraging`, `surprised`.

**B. VRM lacks a blendshape**  
Not all VRM models expose every blendshape. Errors are silently caught. Check DevTools for  
`[AvatarCanvas] setValue failed` — this is non-fatal.

**C. Events dispatched outside browser window scope**  
All events must be dispatched on `window`. Server-side or non-browser dispatch has no effect.

---

## 5. Walking / Nodding / Laughing Animation Not Playing

### Diagnostic
```js
// In DevTools console:
__avatarDebug.testWalk(5)    // should see body bob + arm swing for 5s
__avatarDebug.testNod()      // should see gentle head nod
__avatarDebug.testLaugh()    // should see shoulder bounce + happy face
```

### Causes & Fixes

**A. Events not being dispatched from the agent**  
`director.ts` dispatches these. Check if `directFromAgentFrame` is being called from  
`useAvatarAgent.ts` (line 326).

**B. Timer already expired**  
Walk/nod/laugh use `Date.now()` timestamps. If the event was dispatched in the past, the  
animation fires for a single frame. Re-dispatch the event.

**C. Conflicting gesture priority**  
Wave and explicit gestures (`point`, `beat`, `openHand`) take priority over walk arm swing.  
Walk body bounce still plays regardless.

---

## 6. No TTS / Voice Output

### Symptoms
- `useAvatarAgent` receives `tts_unavailable` frames
- Avatar moves mouth (Web Speech API fallback active) but no natural voice

### Causes & Fixes

**A. Kokoro TTS server not running**  
Backend `agent_ws.py` uses Kokoro on `http://localhost:8880`. Start it separately, or accept  
the Web Speech API fallback (browser's built-in synthesis).

**B. Browser blocks autoplay**  
AudioContext requires a user gesture before audio can play. Click the mic button once to  
unlock audio before speaking.

**C. Arabic voice not installed**  
For Web Speech API fallback: check `speechSynthesis.getVoices()` in the console. Install  
the Arabic voice pack from your OS if missing.

---

## 7. Performance / FPS Issues

### Diagnostic
Add `<Stats />` from `@react-three/drei` inside `<Canvas>` temporarily:
```tsx
import { Stats } from '@react-three/drei';
// Inside <Canvas>:
<Stats />
```

### Common Causes
- High-poly VRM model → reduce polygon count externally
- `useFrame` running expensive operations every frame → move to refs / compute outside loop
- Multiple `<Canvas>` instances on same page → consolidate

### Optimization Tips
- `shadows={false}` is already set (saves GPU)
- `dpr={[1, 2]}` caps pixel ratio at 2 (already set)
- Frustum culling disabled per mesh (`frustumCulled = false`) is intentional for VRM

---

## 8. Common Import / TypeScript Errors

### `Cannot find module '@/ai/cognitive/CognitiveEngine'`
`@/` resolves to `src/`. Correct import: `import { ... } from '@/ai/cognitive/CognitiveEngine'`

### `Module '"@/types"' has no exported member 'XYZ'`
All project types live in `types/index.ts` at **repository root** (not `src/`).  
Import using a relative path: `import type { Assessment } from '../../types'`  
or adjust `tsconfig.json` paths accordingly.

### `useAvatarAgent is not a function`
Ensure the import is: `import { useAvatarAgent } from '@/hooks/useAvatarAgent'`  
Do NOT import from `hooks/useAvatarAgent` without the `@/` prefix (it won't resolve in `src/`).

---

## Event Reference

Events dispatched on `window` by the avatar pipeline:

| Event | Detail payload | Effect |
|-------|---------------|--------|
| `avatar:speak:start` | — | Start procedural lip-sync |
| `avatar:speak:end` | — | Stop lip-sync, reset emotion to neutral |
| `avatar:stopSpeaking` | — | Same as `speak:end` |
| `avatar:emotion` | `{ emotion: string }` | Set expression blendshapes |
| `avatar:gesture` | `{ type, side, duration }` | Arm gesture animation |
| `avatar:walk` | `{ duration?: number }` | Walk-in-place locomotion |
| `avatar:nod` | `{ duration?: number }` | Head nod via spine bone |
| `avatar:laugh` | `{ duration?: number }` | Shoulder shake + happy expression |
| `avatar:voice` | `{ rate?: number, pitch?: number }` | Record TTS prosody metadata |
| `avatar:blink` | — | Force immediate blink |

---

## File Map

```
frontend/src/
├── app/avatar-agent/
│   ├── AvatarCanvas.tsx        ← main component (inline VRMScene, all animation)
│   ├── AvatarAgentClient.tsx   ← thin next/dynamic wrapper (ssr:false)
│   ├── AvatarCanvas.module.css ← loading/error overlay styles
│   └── page.tsx
├── hooks/
│   └── useAvatarAgent.ts       ← WebSocket client, calls directFromAgentFrame()
├── ai/
│   ├── avatar/
│   │   ├── director.ts         ← orchestrates emotion/gesture/prosody dispatch
│   │   ├── brain.ts            ← EMOTION_ANIMATION_MAP, inferResponsePlan()
│   │   └── actions.ts          ← avatar action helpers
│   └── cognitive/
│       ├── CognitiveEngine.ts  ← + classifyReplyType / emotionToProsody / humanizeTelemetry
│       └── GestureEngine.ts    ← gestureEngine singleton
backend/app/api/v1/endpoints/
└── agent_ws.py                 ← WebSocket at /ws/agent (STT→LLM→TTS pipeline)
```
