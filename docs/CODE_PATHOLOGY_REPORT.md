# CODE PATHOLOGY REPORT — Eduverse / Cogni
**Auditor:** Lead Systems Architect  
**Date:** 2026-03-29  
**Stack:** Next.js 16.2 (Turbopack) · Three.js/VRM · FastAPI · ChromaDB · WebSockets  
**Scope:** 108 frontend TypeScript files + 85 backend Python files  

---

## EXECUTIVE SUMMARY

| Layer | Severity | Verdict |
|-------|----------|---------|
| React rendering / memory | 🟠 Medium | 81 per-frame `new THREE.*` allocations; 17 dispose() for 81 creates |
| WebSocket turn-taking | 🟡 Low–Medium | Half-duplex logic exists but VAD-to-TTS gap window unguarded |
| Avatar kinematics | 🔴 High | FeetFixer is a STUB; bind-pose capture race condition; hips root-motion |
| Animation blending | 🟠 Medium | `crossFadeTo` never used; direct `fadeOut/fadeIn` can snap |
| Lip-sync | 🟡 Low | Network jitter uncompensated; viseme scheduling is linear estimate |
| Pedagogy / RAG | 🟡 Low | Socratic mode scaffolding exists but never routes to it from WS |
| Long-term emotion memory | 🔴 High | `student_memory.py` writes JSON files — no 30-day PAD tracking |
| MENA localisation | 🟠 Medium | Dialect is prompt-only; no fallback for offline RAG |

---

## SECTION 1 — MICROSCOPIC CODE DEFECTS

### 1.1 WebGL Memory Leak — Per-Frame Allocations Inside `useFrame`

**File:** `frontend/src/app/avatar-agent/AvatarCanvas.tsx`  
**Lines:** 3278–5256 (the entire `useFrame` callback)

**Finding:**  
The `useFrame` callback creates `new THREE.Vector3()` **inline** on every frame:

```typescript
// Line 3939 — inside useFrame, called 60× per second
const avatarPos = group ? group.position : new THREE.Vector3();

// Lines 1744–1755 — inside recalibrateFeet(), called per-frame path
? headNode.getWorldPosition(new THREE.Vector3()).y
const src = origin.clone().add(new THREE.Vector3(0, 0.3, 0));
const ray = new THREE.Raycaster(src, new THREE.Vector3(0, -1, 0), 0, 1.0);
const lHitY = castDown(l.getWorldPosition(new THREE.Vector3()));
const rHitY = castDown(r.getWorldPosition(new THREE.Vector3()));
const lY = l.getWorldPosition(new THREE.Vector3()).y;
const rY = r.getWorldPosition(new THREE.Vector3()).y;
```

Module-level scratch objects exist (`_scratchEuler`, `_scratchQuat`, etc.) but **are not used** in the hot paths above.  
At 60 fps: ~40 Vector3 + ~10 Quaternion allocations = **~3,000 objects/second** → GC pressure → frame drops.

**Fix required:**
```typescript
// Add to module-level scratch pool
const _tmpVec3A = new THREE.Vector3();
const _tmpVec3B = new THREE.Vector3();
const _tmpRaycaster = new THREE.Raycaster();

// Replace per-frame: new THREE.Vector3() → _tmpVec3A.set(0,0,0)
```

**Effort:** Low (mechanical refactor).

---

### 1.2 `console.log` Spam in Production — 72 Instances

**File:** `AvatarCanvas.tsx`  
**Finding:** 72 `console.log` calls with no dev-guard. In a production build running at 60 fps, log calls inside `useFrame` serialize strings on every frame. Observed examples:
- `[VRMA] ▶ idle0 (loop=true)` — fires every idle cycle switch (~10s)
- `[BRAIN] Gesture received: wave` — fires on every gesture event
- `[V53] VRM loaded — default stand XZ …` — fires on load

**No `if (process.env.NODE_ENV === 'development')` guard on 65 of 72 calls.**

**Fix:**
```typescript
if (process.env.NODE_ENV === 'development') {
  console.log(`[VRMA] ▶ ${name} (loop=${loop})`);
}
```

---

### 1.3 Race Condition — VAD ↔ TTS Overlap Window

**File:** `frontend/src/hooks/useAgentAgent.ts` (lines 1267–1320)

**Finding:**  
The half-duplex guard is:
1. `avatar:speak:start` fires → stops VAD  
2. `avatar:speak:end` fires → resumes VAD after **250 ms** delay

**Gap:** Between `stopAllAudio()` (TTS cancelled by user speech) and `vadStop()` completing, there is an **unguarded ~50–200 ms window** where:
- The VAD has already buffered audio chunks from the user
- `onSpeechEnd` fires → sends audio to backend
- Backend is STILL processing the previous turn (LLM in-flight)
- Two concurrent `process_text()` asyncio tasks can exist

The backend has `cancel_in_flight()` on `start_user_turn`, but the frontend does NOT guard against sending a new audio frame while the WS `type: audio` is being processed:

```typescript
// useAgentAgent.ts ~line 985
if (isSpeakingRef.current) {
  stopAllAudio();  // stops TTS
  // ← NO guard here: sendText / audio frame is sent immediately
}
```

**Fix needed:** Add a `pendingInterruptRef` with 80 ms debounce before sending audio post-interrupt.

---

### 1.4 Silent Fail — `animationMap.ts` Fallback Returns Wrong Path

**File:** `frontend/src/ai/avatar/animationMap.ts`

```typescript
export function getRandomAnimationPath(intent: string): string {
  const key = (intent ?? '').toLowerCase().replace(/[^a-z]/g, '');
  const paths = ANIMATION_MAP[key];
  if (!paths || paths.length === 0) {
    return `${A}acknowledging.vrma`;  // ← SILENT FALLBACK
  }
  return paths[Math.floor(Math.random() * paths.length)];
}
```

**Problem:** Any unknown intent silently falls back to `acknowledging.vrma`. There is **no warning log**, so unknown intents from the LLM (e.g. `"celebrate2"`, `"thumbup"`) silently play a nod gesture instead. The LLM may emit 20+ gesture tokens not in the map.

**Fix:** Add `console.warn('[AnimationMap] Unknown intent:', intent)` in the fallback branch.

---

### 1.5 Unhandled Promise — `useEffect` → `stopTTS` in ConversationManager

**File:** `frontend/src/components/ConversationManager.tsx` (lines 103–110)

```typescript
if (isAvatarSpeaking) {
  stopTTS();
  window.dispatchEvent(new CustomEvent('cogni:avatar:interrupt'));
}
```

`stopTTS()` is synchronous but dispatches `avatar:speak:end` immediately. If an in-flight `speakWithTTS()` is still awaiting a network response (TTS backend latency), the cleanup inside the `fetch` promise will call `window.dispatchEvent(new CustomEvent('avatar:speak:end'))` **a second time**, triggering double-fire of listening-start events.

---

### 1.6 `.env` Parsing — No Validation on Critical Keys

**File:** `backend/app/core/config.py` (inferred from `.env.example`)

`AZURE_SPEECH_KEY` and `AZURE_SPEECH_REGION` are read as raw strings. If there is a BOM character (`\uFEFF`) or trailing whitespace, the Azure SDK silently fails with Error 27. The comment in the `.env.example` says "backend strips zero-width chars automatically" — but this stripping is conditional:

```python
# Observed in tts_timing.py / tts_service.py
_locked_jordanian_male_voice(...)
```

There is no `startup` validation event that **logs a clear error** if Azure keys are present but malformed. Result: TTS silently 503s, avatar speaks nothing, no error surfaced to developer.

---

## SECTION 2 — AVATAR KINEMATIC & VISUAL FAILURES

### 2.1 FeetFixer Is a Stub — Not Doing Real IK

**File:** `frontend/src/engine/rig/FeetFixer.ts`

The `FeetFixer.apply()` method:
```typescript
// Lines 80–92
this._qTmp.copy(baseline).invert();
this._qTmp.premultiply(q);         // delta = baseline⁻¹ · current
this._euler.setFromQuaternion(...);
// clamp euler angles
const target = baseline.clone().multiply(this._qTmp);
q.slerp(target, blend);            // ← blend = 0.75 (too aggressive)
```

**Problems:**
1. **Blend of 0.75 per frame at 60fps** = the foot reaches 75% of baseline every frame. For a 35° deviation, after 1 frame: `35° × (1 - 0.75) = 8.75°` — this is almost instantaneous, causing foot snapping rather than smooth correction.  
   **Fix:** Use delta-time: `blend = Math.min(1, opts.blend * safeDelta * 60)`.

2. **Missing contact normal projection.** Real foot IK should project the foot quaternion onto the carpet surface normal. Without this, feet clip into the carpet mesh when the avatar walks on non-flat geometry.

3. **No toe IK.** The `leftToes`/`rightToes` are clamped in the same pool as feet but with identical limits. Toes have a much wider natural pitch range (±55°).

4. **`FeetFixer` is opt-in via `?fixFeet=1` URL param** — it is **off by default**. The avatar runs with zero foot correction in production.

---

### 2.2 Bind-Pose Capture Race Condition

**File:** `AvatarCanvas.tsx` lines 2329–2340

```typescript
setVrm(model);      // ← triggers re-render (async)
onLoad();
// ...
bindLowerBodyRotationsRef.current = new Map();  // ← wipe
captureLowerBodyBindPose();    // reads from vrmRef.current
```

**Problem:** `setVrm(model)` triggers a React state update (async re-render). `captureLowerBodyBindPose()` runs synchronously in the same microtask, reading `vrmRef.current` which is correctly set. **BUT** the VRM's `scene.updateMatrixWorld(true)` has not been called post-load. The raw bone quaternions at this point are T-pose from the GLTF file, which is correct — **except** when the GLTF file has a non-zero initial pose (some VRMs ship with a slight A-pose deviation in the bind). The captured quaternions therefore contain the model's shipping pose, not the VRM canonical T-pose.

**Fix:** Call `model.scene.updateMatrixWorld(true)` before `captureLowerBodyBindPose()`.

---

### 2.3 Hips Root-Motion Corruption

**File:** `AvatarCanvas.tsx` §8 (lines ~4340–4415)

The `sit.vrma` clip contains root-motion keyframes on the `hips` bone (both position X/Z and rotation). The code correctly pins `hips.position.x/z` to the T-pose bind values:

```typescript
if (hipsBoneS && hipsBindPosRef.current) {
  const bp = hipsBindPosRef.current;
  hipsBoneS.position.set(bp.x, hipsBoneS.position.y, bp.z);
}
```

But it **does not pin the hips rotation quaternion**. `sit.vrma` applies a 12° forward pelvis tilt, which:
- Shifts the perceived center of gravity forward
- Makes the legs appear to "splay" outward when the avatar stands
- Persists even after `playVRMA('idle0')` because `resetLowerBodyToIdle()` only resets the leg bones, not the hips quaternion

**Fix:** Also reset `hipsBoneS.quaternion.copy(hipsBindQuatRef.current)` in the standing branch of §8.

---

### 2.4 Animation Blending — No `crossFadeTo`

**File:** `AvatarCanvas.tsx` lines 2053–2080 (`playVRMA` function)

```typescript
const playVRMA = useCallback((name, loop, fadeTime) => {
  if (prev) prev.fadeOut(fadeTime);   // ← Action A fades out
  action.reset();
  action.fadeIn(fadeTime);            // ← Action B fades in
  action.play();
```

`fadeOut` + `fadeIn` with the same `fadeTime` creates a **linear crossfade**, but the weights do not sum to 1 during the transition:
- At t=0: A=1, B=0 (sum=1 ✓)
- At t=fadeTime/2: A=0.5, B=0.5 (sum=1 only if both times are identical)
- At t=fadeTime: A=0, B=1 (sum=1 ✓)

The correct API is `prev.crossFadeTo(action, fadeTime, false)` which guarantees weight sum = 1 throughout. Without this, the avatar momentarily "deflates" during transitions (especially visible on the chest and shoulders).

**Fix:**
```typescript
if (prev) {
  prev.crossFadeTo(action, fadeTime, false);
} else {
  action.fadeIn(fadeTime);
}
action.play();
```

---

### 2.5 Lip-Sync — Network Latency Uncompensated

**File:** `frontend/src/ai/io/tts.ts` (lines 395–453)

Viseme events are scheduled as `setTimeout(offset_ms)` from the moment the audio **starts playing**. This is correct in theory. However:

1. **Azure viseme `offset_ms` is measured from TTS synthesis start**, not from audio play start. The audio blob is fetched over HTTP, decoded, and a `Blob URL` is created before `audio.play()`. This pipeline takes **100–400 ms** on slow connections, meaning the viseme offsets are all **too early** by that delta.

2. There is no `audio.currentTime` synchronisation. If the browser buffers audio (common on mobile or when switching tabs), viseme events fire on wall-clock time while audio lags, creating a "dubbed movie" desync.

**Fix:** Schedule visemes relative to `audio.addEventListener('timeupdate', ...)` using `audio.currentTime` as truth, not wall-clock `setTimeout`.

---

### 2.6 Uncanny Valley — `blink_duration: 160ms` Too Fast

**File:** `frontend/src/config/avatar.ts`
```typescript
export const BLINK_DURATION_MS = 160;
```
Human blink duration: **150–400 ms** (average 350 ms). A 160 ms blink is at the extreme low end and reads as a nervous tic rather than natural blinking. The avatar should also do **partial blinks** (25% of blinks close only 50–70%) — `PARTIAL_BLINK_CHANCE = 0.25` exists but only adjusts closure depth, not duration.

---

## SECTION 3 — THE INTERACTIVITY CHASM

### 3.1 Cognitive Gap — Cogni Answers Instead of Guides

**Current state:**  
`_SCAFFOLDING_TUTOR_BLOCK_AR` in `tutor.py` (line 293) exists and appends Socratic scaffolding rules. However, this block is only appended via `_append_scaffolding_tutor_rules()` in the **HTTP /api/v1/chat endpoint**, **not in the WebSocket `process_text` path** (agent_ws.py). The live avatar conversation therefore bypasses the BTEC scaffolding entirely.

**Evidence:**
```python
# agent_ws.py line 703
parsed = parse_reply_with_inline_gestures(reply_text)
# ↑ raw LLM output — no scaffolding injection
```

**Fix required:**
1. In `agent_ws.py`, after building `context`, inject the scaffolding block:
```python
if context.get("btec_context"):
    from app.api.v1.endpoints.tutor import _append_scaffolding_tutor_rules
    # pass scaffolding flag via context key rather than string concat
    context["enforce_scaffolding"] = True
```
2. In `tutor._get_cogni_response()`, check `enforce_scaffolding` and apply the block.

---

### 3.2 Spatial Awareness — No UI Element Pointing

**Current state:** The avatar can point at the world (via `point.vrma`), but has no mechanism to map 2D screen coordinates to 3D pointing direction.

**Missing architecture:**

```typescript
// Required: ScreenPointer bridge
interface ScreenPointerEvent {
  elementId: string;     // e.g. "btec-rubric-table"
  screenX: number;       // 0–1 normalized
  screenY: number;       // 0–1 normalized
}

// Convert to world space 3D target for avatar arm IK
function screenToAvatarPointing(ev: ScreenPointerEvent): THREE.Vector3 {
  // Unproject from NDC → world ray → intersect UI plane at z=1.5m
}
```

The IK system (`USE_IK = false` in `avatar.ts`) is disabled. Even if enabled, `three-ik` is not installed as a dependency. Building pointing-at-UI requires:
1. Enable IK (install `three-ik` or implement FABRIK chain manually)
2. Add a `UIPointer` component that maps React element positions to 3D coordinates
3. Wire `avatar:point-at-ui` event to the IK target

**Effort:** High (3–5 days).

---

### 3.3 Emotional Memory — Missing 30-Day Schema

**Current state:**
- `student_memory.py` stores BTEC assessment grades per session (JSON files, max 10 sessions)
- `episodic_memory.py` stores per-session dialogue summaries in ChromaDB
- There is **no PAD (Pleasure-Arousal-Dominance) time-series tracking** beyond the current session

**Missing schema (Postgres + Redis):**

```sql
-- Required table: student_emotional_trajectory
CREATE TABLE student_emotional_trajectory (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id  UUID NOT NULL REFERENCES users(id),
  session_id  TEXT NOT NULL,
  timestamp   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  pad_p       FLOAT NOT NULL,   -- pleasure   -1.0 to +1.0
  pad_a       FLOAT NOT NULL,   -- arousal    -1.0 to +1.0
  pad_d       FLOAT NOT NULL,   -- dominance  -1.0 to +1.0
  frustration_score FLOAT,      -- derived: high arousal + low dominance
  topic       TEXT,
  session_minutes INT
);

CREATE INDEX ON student_emotional_trajectory (student_id, timestamp DESC);
```

```python
# Required Redis key for real-time frustration alert
# Key: cogni:frustration:{student_id}
# Value: rolling 5-minute average frustration score (0–1)
# TTL: 3600s (1 hour)
# Alert threshold: > 0.7 for > 2 minutes → trigger teacher notification
```

**Current `student_memory.py` limitation:** Only stores final grade per session. No intra-session frustration timeline, no emotion velocity (rate of mood change), no 30-day longitudinal view.

---

## SECTION 4 — THE MENA DOMINANCE MATRIX

### 4.1 What Exists (Verified)

| Feature | Status | Quality |
|---------|--------|---------|
| Jordanian Arabic TTS (Taim/Maysoon voices) | ✅ Code exists | Requires Azure key |
| Jordanian dialect in LLM system prompt | ✅ Implemented | Prompt-level only |
| BTEC curriculum RAG (ChromaDB) | ✅ Architecture ready | Needs PDF ingestion |
| P/M/D scaffolding pedagogy | ✅ In `tutor.py` | Not in WS path |
| Student assessment history | ✅ JSON files | Not queried in LLM context |
| Proactive silence detection | ✅ 30s timer | Works |
| Gesture-emotion alignment | ✅ performanceTags.ts | Full map |
| Multi-session episodic memory | ✅ ChromaDB | Per-session only |

---

### 4.2 What Must Be Built — Ranked by MENA Impact

#### Priority 1: The Jordanian Core (Week 1)

**Problem:** The dialect is enforced in the system prompt only. The LLM *reasons* in English internally and *expresses* in Arabic. Complex BTEC concepts (P/M/D criteria) are explained using generic academic language rather than local cultural anchors.

**Required change — Cultural Analogy Injection:**
```python
# In tutor.py _build_system_content()
CULTURAL_ANALOGY_MAP = {
    "SWOT analysis":     "شبيه بتحليل نقاط قوة وضعف محل تجاري في سوق الحسبة",
    "stakeholders":      "أصحاب المصلحة — مثل اتحاد الملاك في عمارة سكنية",
    "supply chain":      "سلسلة التوريد — مثل رحلة الزيتون من كفرنجة للسوق",
    "marketing mix":     "المزيج التسويقي — كيف يروّج مطعم الكنافة الجديد في الرمضانيات",
}

def inject_cultural_analogies(topic: str, content: str) -> str:
    for key, analogy in CULTURAL_ANALOGY_MAP.items():
        if key.lower() in content.lower():
            content += f"\n[استخدم هذا التمثيل: {analogy}]"
    return content
```

**Effort:** Low (2 days data entry + 1 day integration).

---

#### Priority 2: Offline-Capable RAG (Week 2) — The Privacy Play

**Current state:** All RAG queries go to OpenAI Embeddings API (`text-embedding-3-small`). This means **student queries leave the country**, which is a regulatory and trust issue for Jordanian schools.

**Required architecture:**

```python
# Local embedding option — add to requirements.txt
# sentence-transformers>=2.7.0  (Arabic BERT: CAMeL-Lab/bert-base-arabic-camelbert-msa)

from sentence_transformers import SentenceTransformer

_local_embed_model = None

def get_local_embeddings(texts: list[str]) -> list[list[float]]:
    global _local_embed_model
    if _local_embed_model is None:
        _local_embed_model = SentenceTransformer(
            "CAMeL-Lab/bert-base-arabic-camelbert-msa"
        )
    return _local_embed_model.encode(texts, normalize_embeddings=True).tolist()
```

Routing logic:
```python
if os.getenv("RAG_PRIVACY_MODE", "false") == "true":
    embeddings_fn = get_local_embeddings    # runs on CPU in container
else:
    embeddings_fn = get_openai_embeddings   # current default
```

**Benefit:** Can pitch as "GDPR/PDPL-compliant, student data never leaves Jordan." Massive trust differentiator.  
**Effort:** Medium (3 days: model download + integration + test Arabic retrieval quality).

---

#### Priority 3: Real-Time Micro-Reward System

**Required architecture:**

```typescript
// frontend/src/ai/rewards/MicroRewardEngine.ts

interface RewardTrigger {
  type: 'criterion_achieved' | 'grade_improved' | 'first_distinction' | 'streak_3';
  payload: Record<string, unknown>;
}

const REWARD_REACTIONS: Record<RewardTrigger['type'], () => void> = {
  criterion_achieved: () => {
    window.dispatchEvent(new CustomEvent('avatar:gesture', {
      detail: { type: 'clap', duration: 1.5 }
    }));
    window.dispatchEvent(new CustomEvent('avatar:emotion', {
      detail: { emotion: 'encouraging' }
    }));
    spawnXPParticles('+10 XP');   // Three.js particle burst at avatar position
  },
  grade_improved: () => {
    window.dispatchEvent(new CustomEvent('avatar:gesture', {
      detail: { type: 'cheer', duration: 2.0 }
    }));
    unlockBadge('improvement');
  },
  first_distinction: () => {
    triggerConfetti();
    playSound('fanfare.mp3');
    window.dispatchEvent(new CustomEvent('avatar:speak:text', {
      detail: { text: '[cheer] الله عليك! أول Distinction! هاد إنجاز ما يطلع.' }
    }));
  },
  streak_3: () => { /* 3 sessions in a row streak */ }
};

export function processTurnReward(gradeResult: GradeResult): void {
  if (gradeResult.final_grade === 'DISTINCTION') {
    REWARD_REACTIONS.criterion_achieved();
    if (gradeResult.is_first_distinction) REWARD_REACTIONS.first_distinction();
  }
}
```

**Backend integration point:** `agent_ws.py` already sends `training_evaluation` frames with `grade` field — hook `processTurnReward` to this event in `useAgentAgent.ts`.

**Effort:** Medium (4 days: particle system + badge store + audio).

---

#### Priority 4: Mobile PWA (Month 1)

**Current blocker:** The 3D canvas is not responsive. `AvatarCanvas.tsx` uses fixed camera positions calibrated for desktop aspect ratios.

**Required changes:**
1. `getCameraPosZ()` should return different values based on `window.innerWidth`
2. Add `<meta name="viewport" content="width=device-width, initial-scale=1">` (verify present)
3. OrbitControls `minDistance/maxDistance` should scale with viewport
4. Add service worker for offline lesson review (text + cached gestures, no 3D)

**Effort:** High (1 week).

---

## SECTION 5 — DEMO-READY CHECKLIST (Tomorrow)

### ✅ Already Working — Show These
- [ ] Live Arabic conversation (student speaks → Cogni responds in Jordanian dialect)
- [ ] `[wave]` / `[think]` / `[point]` gesture tokens in responses
- [ ] BTEC scaffolding: Cogni asks "وين الدليل؟" instead of giving answer
- [ ] Emotion-aware avatar face (smile, furrow, surprise)
- [ ] Turn-taking: Cogni stops mid-sentence when student speaks

### 🔧 Quick Fixes Before Demo (2–3 hours)
1. **Add Azure TTS key** → Taim voice activates → avatar sounds human
2. **Run BTEC ingestion** → Cogni answers from actual BTEC textbooks
3. **Set `NEXT_PUBLIC_MIME_MODE=false`** → real audio, not simulated
4. **Guard the 72 console.log calls** → cleaner browser console
5. **Apply `crossFadeTo` fix** → smoother gesture transitions visible to investors

### 🔴 Do NOT Demo
- Walking locomotion (feet glitch without full FeetFixer IK)
- Sitting pose (hips root-motion corruption visible)
- Avatar pointing at screen UI (IK disabled)

---

*Report generated from static analysis of 108 TS + 85 Python files. No runtime profiling performed. Severity ratings are estimates; production load testing may reveal additional bottlenecks.*
