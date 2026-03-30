# BRAIN-TO-BODY PIPELINE DIAGNOSTIC
**Role:** Lead Systems Architect & Robotics Control Specialist  
**Date:** 2026-03-29  
**Subject:** Exact sovereignty boundary between GPT-4o-mini intent and Agent procedural control

---

## THE FOUR-LAYER CONTROL STACK

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  LAYER 4 — THE BRAIN      (GPT-4o-mini / backend)                              │
│  Generates dialogue text + gesture tokens. Has NO knowledge of bones.          │
│                                    │                                           │
│  "أهلاً يا بطل! [wave]"            │  → token → performance[]                 │
└────────────────────────────────────┼────────────────────────────────────────────┘
                                     │
┌────────────────────────────────────▼────────────────────────────────────────────┐
│  LAYER 3 — THE NERVOUS SYSTEM  (useAgentAgent.ts + cogni_output_format.py)     │
│  Strips tokens, builds performance cues, dispatches browser events.            │
│                                    │                                           │
│  CustomEvent('avatar:gesture', {type:'wave', duration:2.5})                   │
└────────────────────────────────────┼────────────────────────────────────────────┘
                                     │
┌────────────────────────────────────▼────────────────────────────────────────────┐
│  LAYER 2 — THE MUSCLES  (AvatarCanvas.tsx onGesture / VRMA system)             │
│  Translates event → VRMA clip selection → THREE.AnimationMixer.                │
│  Agent rules determine WHICH clip plays and when procedural overrides apply.   │
└────────────────────────────────────┼────────────────────────────────────────────┘
                                     │
┌────────────────────────────────────▼────────────────────────────────────────────┐
│  LAYER 1 — THE BONES  (§8 procedural override in useFrame)                     │
│  FINAL WRITE to raw quaternions. Agent overrides EVERYTHING here.              │
│  LLM has zero access. FeetFixer, GroundLock, bind-pose clamps all live here.  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## SECTION 1 — THE BRAIN (Intent Generation)

### How GPT-4o-mini Controls Movement (Indirectly, Via Tokens)

The LLM has **zero direct access to bones, quaternions, or Three.js**. Its entire "motor output" is a **text string** containing gesture tokens like `[wave]`, `[think]`, `[point]`.

**How the LLM is guided to produce these tokens** (`tutor.py`, system prompt):

```python
# tutor.py — _SCAFFOLDING_TUTOR_BLOCK_AR (appended to every system prompt)
# + personality.ts — COGNI_PERSONA.systemPrompt (sent from frontend)

# Key instruction injected:
"[wave] الترحيب | [think] تفكير | [point] إشارة | [beckon] دعوة ..."
"قاعدة مطلقة: ... طبّق الإيماءة المناسبة باستخدام الرمز."
```

The LLM is **not executing** gestures. It is producing **labeled text** that our Agent later interprets. The LLM thinks it is writing dialogue; our Agent is reading its output as a command stream.

**Two paths for gesture tokens reaching the backend:**

```
Path A (Primary):
  LLM text: "[wave] أهلاً!"
  → cogni_output_format.py:extract_inline_gestures()
  → strips "[wave]" from dialogue text
  → produces: performance[{"tag":"[GESTURE_WAVE]","animation":"wave","start_word":0}]
  → sends clean audio-safe dialogue to TTS

Path B (Fallback — if backend missed it):
  Frontend _parseClientInlineGestures(dialogue)
  → same regex scan on frontend
  → produces PerformanceCue[] merged into perfMerged
```

**Pedagogical supplement** (`agent_ws.py:177–220`):
When the LLM produces **no gesture token**, our Agent auto-injects one:
- Praise words → `[GESTURE_CLAP]`
- Question mark → `[GESTURE_POINT]`
- Merit stage → `[GESTURE_POINT]`
- Distinction stage → `[GESTURE_WAVE]`

**The LLM does not decide these.** The Agent reads the dialogue's *semantic content* and overrides.

---

## SECTION 2 — THE NERVOUS SYSTEM (Token Parsing Pipeline)

### The Exact Parsing Chain

```
backend/cogni_output_format.py
  extract_inline_gestures(text)
    └── regex: /\[(wave|think|point|...)\]/gi
    └── builds PerformanceCue[] with start_word offset
    └── returns (cleaned_dialogue, cues[])
  
  _pedagogical_performance_supplement(dialogue, existing_perf, stage)
    └── if existing cues: pass-through (LLM intent wins)
    └── elif praise tokens in dialogue → [GESTURE_CLAP]
    └── elif '?' in dialogue → [GESTURE_POINT]
    └── else → [GESTURE_EXPLAIN] (default)

WS frame sent to client:
  {
    type: "speech",
    dialogue: "أهلاً بكم",       ← token-stripped, TTS-safe
    performance: [               ← structured cues
      { tag: "[GESTURE_WAVE]", start_word: 0, animation: "wave", intensity: 0.6 }
    ],
    audio_base64: "...",
    word_cues: [{ t: 0, w: "أهلاً" }, { t: 320, w: "بكم" }]
  }

frontend/useAgentAgent.ts
  schedulePerformanceCues(dialogue, perfMerged, wordCues, totalDurationMs, onFire)
    └── for each cue: setTimeout(onFire, startWordToDelayMs(cue.start_word, ...))
    └── onFire → window.dispatchEvent(CustomEvent('avatar:performance', cue))

frontend/avatarPerformanceBridge.ts → resolvePerformanceCue(cue)
  └── [GESTURE_WAVE] → { kind: 'gesture', token: 'wave' }
  └── dispatches CustomEvent('avatar:gesture', { type: 'wave', duration: 2.5 })

frontend/AvatarCanvas.tsx → onGesture(e)
  └── reads gesture type, side, duration
  └── routes to VRMA selection logic
```

### How Text-to-Animate is Distinguished from Text-to-Speak

| Signal | Mechanism |
|--------|-----------|
| `[wave]` in LLM text | Extracted by `extract_inline_gestures()` regex → performance cue → **never reaches TTS** |
| `*يلوّح بيده*` (action line) | Stripped by `parse_legacy_cogni_reply()` regex `\*[^*]+\*` → **never spoken** |
| `[EMOTION: friendly]` | Extracted by regex → sets `emotionLabel` → dispatches `avatar:emotion` event |
| Remaining text | Pure dialogue → TTS pipeline |

---

## SECTION 3 — THE MUSCLES & BONES (Execution Layer)

### animationMap.ts — The Agent's Motion Vocabulary

```typescript
// animationMap.ts — 100% HARDCODED by Agent developers
// LLM NEVER sees this file or these paths.
export const ANIMATION_MAP = {
  wave:      ['/models/animations/waving.vrma'],
  think:     ['/models/animations/thinking.vrma'],
  point:     ['/models/animations/pointing.vrma'],
  agree:     ['/models/animations/agreeing.vrma', '/models/animations/acknowledging.vrma'],
  // ... 30+ entries
}

// Random selection from multi-option entries creates gesture variety
// without LLM involvement: "agree" randomly plays agreeing OR acknowledging
```

The LLM produces `wave`. It has no knowledge of `waving.vrma`. The mapping is **entirely owned by the Agent**.

### AvatarCanvas.tsx §8 — The Final Override Layer

This is the most important layer. After every `v.update(safeDelta)` call (which bakes VRMA keyframes into bones), §8 runs as the **last bone write before render**:

```
useFrame render order:
  1. [VRMA] mixerRef.current.update(safeDelta)  ← VRMA writes all bones
  2. [ANATOMY MASK] resetLowerBodyToIdle()       ← Agent ERASES lower body writes
  3. [STABILIZER] FeetFixer.apply()             ← Agent clamps foot quaternions
  4. [§1-A] breathSpineAmount()                 ← Agent adds breathing to spine
  5. [§6] neck gaze override                    ← Agent writes neck/head
  6. [§8] final bone writes                     ← Agent writes all limbs (absolute)
```

**Key §8 standing rules:**
- Legs/feet: ALWAYS overridden by `resetLowerBodyToIdle()` → bind-pose quaternions
- Hips: position = `hipsBindPosRef`, rotation = `(0, 0, tilt+roll)`
- Arms (no gesture): sway + shoulder drop (procedural)
- Arms (VRMA gesture active): **released to VRMA** — Agent steps back
- Arms (seated): lap pose regardless of VRMA content

### FeetFixer & GroundLock — The Physical Integrity Guardians

```
LLM knowledge of FeetFixer:    ZERO
LLM knowledge of GroundLock:   ZERO

FeetFixer.apply() runs AFTER mixer.update():
  - Captures T-pose quaternion at VRM load (baseline)
  - Each frame: computes delta = baseline⁻¹ × current
  - Clamps euler to ±35° pitch, ±12° yaw/roll
  - Blends back at delta-time-normalised rate
  - OVERRIDE IS SILENT — LLM never knows the correction happened

GroundLock.tryApplyFloorY():
  - Guards against runaway floor Y resets (carpet AABB updates)
  - Ignores jumps > 3m from first recorded floor
  - LLM has no floor Y concept; this is pure Agent physics
```

---

## SECTION 4 — PROCEDURAL LIFE (The Autonomic System)

These systems run **100% independently of LLM input**, every single frame:

### Breathing (`breathSpineAmount` in `proceduralLife.ts`)
```typescript
// AvatarCanvas.tsx §1-A — runs every frame regardless of LLM state
const spineBreathTarget = breathSpineAmount(t, isSitting, phaseScale) * skelMul;
// = sin(t × TAU × 0.22 Hz) × amp + sin(t × 2.1 × freq) × amp × 0.3
// Amplitude modulated by phase:
//   speaking  → ×1.15 (slightly elevated, animated)
//   listening → ×0.75 (shallow, attentive)
//   thinking  → ×0.90
//   idle      → ×1.00
```
**LLM participation:** Zero. The phase (`speaking`/`listening`/`thinking`/`idle`) is derived from local refs (`isTalkingRef`, `isTranscribingRef`), not from LLM output.

### Blinking (Simplex noise-driven)
```typescript
// AvatarCanvas.tsx §2 — autonomous, 60× per second
const noiseVal = (_noise3D(t * 0.0009, 77, 0) + 1) * 0.5;  // [0, 1]
nextBlinkRef.current = BLINK_MIN_SEC + noiseVal × (BLINK_MAX_SEC - BLINK_MIN_SEC);
// Result: blinks every 3–7 seconds with organic, non-repeating intervals
// Left/right eye phase lag: random 0–150 ms (blinkAsymRef)
// Double-blinks: 20% probability
```
**LLM participation:** Zero. The LLM CAN trigger a single blink via `[GESTURE: blink]` (dispatched via `onGesture`), but the autonomous blink loop runs perpetually underneath.

### Gaze (Pointer-tracking + noise drift + random look-aways)
```typescript
// AvatarCanvas.tsx §5-A
// Neck tracks pointer.x / pointer.y (user's mouse)
// + _noise3D organic drift  
// + random look-away events (gazeBreakOffsetRef, lookAwayBlend)
// + eyeMicroOffsetRef for subtle saccades (2-5s cadence)
```
**LLM participation:** Zero. Gaze is a pure physics/UI response system.

### Idle Micro-Gestures (shoulder shrug, head tilt, finger tap)
```typescript
// AvatarCanvas.tsx — autonomous 8–14s cadence
if (now >= idleMicroGestureNextRef.current && !vrmaBusy && !procBusy) {
  const roll = Math.random();
  if (roll < 0.28) shoulderShrugUntilRef.current = now + 620;
  else if (roll < 0.55) headRollEmotionRef.current = 0.09 × (±1);  // head tilt
  else if (roll < 0.78) headPitchRef.current = 0.11;               // head down
  else fingerTapUntilRef.current = now + 480;
}
// Cooldown: 8,000 – 14,000 ms random between each
```
**LLM participation:** Zero. The LLM can schedule explicit gestures (which pause the idle loop), but the micro-gesture engine runs independently when no gesture is active.

### Walking Locomotion
**LLM participation:** Zero. Walk triggers come from right-click mouse events (`handleClick` in `useEffect`) → `walkUntilRef`, `targetAvatarXRef/ZRef`. The LLM cannot direct Cogni to walk to a specific position.

---

## CONTROL MATRIX

| Body Part / Action | Controlled By | Logic Location | LLM Input? |
|-------------------|---------------|----------------|-----------|
| Spine breathing | Agent (sin wave + noise) | `proceduralLife.ts:breathSpineAmount` | ❌ None |
| Blink timing | Agent (simplex noise) | `AvatarCanvas.tsx §2` | ❌ None (can trigger 1 blink) |
| Eye saccades | Agent (noise + pointer) | `AvatarCanvas.tsx §5-A` | ❌ None |
| Neck/head direction | Agent (pointer + noise + gaze-break) | `AvatarCanvas.tsx §5-B/§7` | ❌ None |
| Idle micro-gestures | Agent (random timer) | `AvatarCanvas.tsx idle loop` | ❌ None |
| Gesture animations (wave/think/point) | **Agent routes LLM token** | `onGesture() → playVRMA()` | ✅ Via token |
| Arm pose (idle standing) | Agent (procedural sway) | `AvatarCanvas.tsx §8 standing` | ❌ None |
| Arm pose (gesture window) | VRMA clip (from Agent's animationMap) | `§8: vrmaGestureNow=true → VRMA wins` | ✅ Indirectly (token selects clip) |
| Seated arm pose (lap) | Agent (forced regardless) | `AvatarCanvas.tsx §8 seated` | ❌ None |
| Leg/foot quaternions (standing) | **Agent (bind-pose clamp — ABSOLUTE)** | `resetLowerBodyToIdle()` run every frame | ❌ None |
| Leg/foot quaternions (sitting) | Agent (hardcoded sit angles) | `§8: sitUpperLegX, sitLowerLegX` | ❌ None |
| Hips position | Agent (bind-pos override in §8) | `hipsBone.position.copy(bp)` | ❌ None |
| Hips rotation | Agent (tilt + pelvicRoll procedural) | `hipsBone.rotation.set(0,0,tilt)` | ❌ None |
| Foot floor contact | Agent (GroundLock + FeetFixer) | `GroundLock.ts + FeetFixer.ts` | ❌ None |
| Emotion blendshape | Agent routes LLM label | `onEmotion() → expressionManager.setValue()` | ✅ Via [EMOTION: tag] |
| Lip-sync visemes | Agent (Azure timing → blendshapes) | `AvatarCanvas.tsx §3 lip-sync` | ❌ None (driven by audio) |
| Avatar world position (XZ) | Agent (right-click handler) | `handleClick()` | ❌ None |
| Avatar floor Y | Agent (GroundLock) | `tryApplyFloorY()` | ❌ None |
| VRMA idle cycling | Agent (timer 10–15s) | `idleNextRef` in useFrame | ❌ None |
| Sit/stand posture | Agent (event from UI button) | `onSit() / onStand()` | ❌ None |

---

## CONTROL CONFLICTS

### Conflict 1: LLM Wants to Wave — Agent Is Enforcing Sit Pose

**Scenario:** Avatar is seated (`isSittingRef = true`). LLM emits `[wave]`.

**What happens:**
```typescript
// AvatarCanvas.tsx onGesture:
if (gType === 'wave') {
  if (vrmaReadyRef.current) {
    playVRMA('wave', false, 0.3);   // ← plays waving.vrma (upper body)
    vrmaGestureUntilRef.current = Date.now() + dur + 500;
  }
}

// §8 seated branch (runs EVERY frame even during wave):
if (isSittingEffective) {
  if (rul) rul.rotation.set(sitUpperLegX, ...);  // ← LEGS CLAMPED regardless
  if (lul) lul.rotation.set(sitUpperLegX, ...);
  if (!vrmaGestureNow) {
    // arms on lap  ← only overridden when VRMA is active
  }
}
```

**Resolution:** The wave VRMA clip plays (upper body waves), but the legs remain clamped to the seated position by §8. This is **correct and intentional** — a partial win for both. The LLM sees Cogni wave; the Agent sees Cogni stay seated. **No visual conflict.**

---

### Conflict 2: VRMA Clip Has Leg Keyframes — Agent Ignores Them

**Scenario:** A VRMA clip (e.g., `standing-cheering.vrma`) contains leg bone tracks with a jumping or wide-stance pose.

**What happens:**
```typescript
// mixerRef.current.update(safeDelta)  ← VRMA writes leg bones
// THEN:
if (!isSittingNow) {
  resetLowerBodyToIdle();   // ← Agent IMMEDIATELY ERASES all leg writes
}
// And §8:
resetLowerBodyToIdle();     // ← erased again for safety
```

**Resolution:** Leg tracks in VRMA clips are **silently discarded every frame**. The LLM-triggered animation can only control the upper body. This is the anatomical masking system.

---

### Conflict 3: LLM Triggers Gesture — But Agent Has Variety-Swap Logic

**Scenario:** LLM fires `[point]` twice within 4 seconds.

```typescript
// onGesture():
if (gType === lastGestureTypeRef.current && now - lastGestureTimeRef.current < 4000) {
  const alts = { point: 'openHand', openHand: 'beat', beat: 'point' };
  gType = alts[gType] ?? gType;  // ← Agent swaps to 'openHand' silently
}
```

**Resolution:** The Agent **overrides the LLM's specific gesture choice** to prevent repetition. The LLM intended `point` twice; the Agent delivers `point` then `openHand`. This makes Cogni appear more natural but **diverges from LLM intent**.

Exception: when `fromPerformance: true` or `fromAI: true` is set on the event, the swap logic is **bypassed** — structured performance cues from the LLM own the turn completely.

---

### Conflict 4: Auto-Patrol Walk vs LLM Gesture

**Scenario:** Agent's auto-patrol timer triggers `walkUntilRef`, starting a walk animation. LLM then fires `[wave]`.

**What happens:**
```typescript
// In playVRMA:
if (activeVrmaRef.current === '__cogni__' && cogniDynamicActionRef.current) {
  cogniDynamicActionRef.current.fadeOut(fadeTime);  // ← current anim fades out
}
// wave.vrma fades in

// In useFrame:
if (vrmaReadyRef.current && isWalkingNow && activeVrmaRef.current !== 'walk') {
  playVRMA('walk', true, 0.3);  // ← walk overrides if still walking!
}
```

**Resolution:** Walk has priority if `walkUntilRef` hasn't expired. The `[wave]` gesture fires, but if the Agent decides walking should still be active, `walk.vrma` re-takes control within one frame. **Walk wins over LLM gestures while locomotion is active.**

---

### Conflict 5: isSittingRef — LLM Cannot Know or Change It

**Scenario:** LLM emits `[sit]` or describes Cogni sitting in action text `*يجلس*`.

**What happens:** 
- The action text `*يجلس*` is stripped before TTS — never spoken, never executed.
- There is **no `[sit]` gesture token** that AvatarCanvas recognises as a posture command.
- `isSittingRef` is only changed by `avatar:sit` and `avatar:stand` custom events, dispatched from the **UI layer** (a button in `AvatarAgentClient.tsx`), not from LLM output.

**Resolution:** The LLM cannot make Cogni sit or stand. Posture is a **UI/human operator decision** only.

---

## FINAL VERDICT: WHO IS THE ULTIMATE SOVEREIGN?

```
┌────────────────────────────────────────────────────────────────────────────────┐
│                                                                                │
│   THE AGENT IS THE SOVEREIGN OF COGNI'S PHYSICAL INTEGRITY.                   │
│                                                                                │
│   GPT-4o-mini is a "Speech Writer" — it generates words and gesture tokens.   │
│   The Agent is the "Director" — it decides what those tokens actually mean     │
│   in 3D space, and it reserves the right to VETO or MODIFY any intent.        │
│                                                                                │
└────────────────────────────────────────────────────────────────────────────────┘
```

### The LLM Controls (Limited, Indirect):
- **What Cogni says** (dialogue text → TTS)
- **Which gesture category plays** (`[wave]` → `wave` token → Agent selects `waving.vrma`)
- **Emotional face expression** (`[EMOTION: happy]` → `expressionManager.setValue`)
- **When in the sentence the gesture fires** (via `start_word` offset in performance cues)

### The Agent Controls (Absolute, Non-Negotiable):
- **All bone quaternions** — §8 is the last writer, always
- **Leg/foot pose** — clamped every frame, immune to VRMA and LLM
- **Breathing** — autonomous sin wave, immune to LLM
- **Blinking** — autonomous noise-driven, immune to LLM
- **Gaze direction** — mouse/pointer tracking + noise, immune to LLM
- **Sit/stand posture** — UI-only, LLM cannot change
- **Walk locomotion** — click-driven, LLM cannot trigger
- **Floor Y / physics** — GroundLock, immune to LLM
- **Gesture variety** — Agent swaps repeated gestures automatically
- **Physical stability** — FeetFixer clamps any extreme angles

### The Exact Handoff Point:
```
LLM Output Text
    │
    │ ← "parse_reply_with_inline_gestures()" [backend]
    │
    ▼
performance[] cue {tag, animation, start_word, intensity}
    │
    │ ← "schedulePerformanceCues() → CustomEvent" [frontend]
    │
    ▼
onGesture/onEmotion handlers in AvatarCanvas
    │
    │ ← THIS IS THE HANDOFF BOUNDARY
    │    From here, the LLM is irrelevant.
    │    The Agent takes full control.
    │
    ▼
VRMA selection → AnimationMixer → §8 bone writes → GPU render
```

The LLM is a **guest writer**. The Agent is the **permanent landlord** of every bone in Cogni's body.
