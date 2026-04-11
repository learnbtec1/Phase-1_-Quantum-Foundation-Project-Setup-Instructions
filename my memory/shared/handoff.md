# Shared Handoff

## ✅ VERIFIED ARM AXIS MAP — cogni.vrm VRM 1.0 (confirmed 2026-04-11)

### slerpArmEuler uses SK_E.set(ex, ey, ez, 'YXZ') in VRMSkeletonManager

| Bone | Axis | + direction | − direction |
|------|------|-------------|-------------|
| rightUpperArm | Y (ruaY) | **FORWARD** ✅ | BACKWARD |
| rightUpperArm | Z (ruaZ) | **DOWN** (hang) ✅ | UP (raise) |
| rightUpperArm | X (ruaX) | ROLL/TWIST | ROLL/TWIST |
| leftUpperArm  | Y (luaY) | BACKWARD | **FORWARD** ✅ (mirrored!) |
| leftUpperArm  | Z (luaZ) | **DOWN** (hang) ✅ | **UP** (raise) ✅ |
| leftUpperArm  | X (luaX) | ROLL/TWIST | ROLL/TWIST |

### Confirmed Working Values (ARM_IDLE static pose)
```
ruaY: +1.2  → right arm FORWARD ✅
ruaZ: +0.3  → right arm slightly below horizontal ✅
luaZ: +1.3  → left arm raised UP ✅
rlaX: +0.25 → right elbow slight bend ✅
```

### Gesture System Status (2026-04-11)
- `BLOCK_ALL_GESTURES = true` in VRMSkeletonManager — no gesture fires
- `FREEZE_IDLE_ANIMATIONS = false` — breathing/head movement active
- `coSpeechPlanner` — disabled (return [])
- `unifiedGestureEngine.play('Thinking')` — disabled
- `getStrategyAvatarBehavior gesture` — disabled
- `intentToGestureHint` — disabled
- All disabled until ARM_OFFSETS are calibrated per gesture

### Next Step: Calibrate ARM_OFFSETS
Use verified axes above + motion-lab to set offsets for: explain, point, think, clap, wave, agree.
Then set BLOCK_ALL_GESTURES=false and re-enable gesture dispatch points.

---

## Last Stable State (Updated 2026-04-11)
- Avatar: /models/195_Uta01/cogni.vrm — VRM 1.0 (converted from 195_Uta01 via UniVRM/Unity 2022.3.22f1)
- Canvas renders WITHOUT gate ✅ | frameloop="always" ✅ | key="avatar-canvas-singleton" ✅
- .env.local: NEXT_PUBLIC_AVATAR_VRM_URL=/models/195_Uta01/cogni.vrm ✅
- VRM_FALLBACKS: ['/models/195_Uta01/cogni.vrm'] — no old models
- rotateVRM0 REMOVED — VRM 1.0 already faces +Z correctly
- combineSkeletons REMOVED — causes skinning artifacts on VRM 1.0
- removeUnnecessaryVertices REMOVED — model already optimized
- AnimationController: no dual-alias fallbacks — VRM 1.0 uses direct names (happy/sad/angry/relaxed/blink)
- ⚠️ NEVER re-add rotateVRM0 or combineSkeletons for VRM 1.0 models

## VRM 1.0 Model Spec (195_Uta01/cogni.vrm)
- Size: 13.75 MB | Polygons: 42,236 | Bones: 54 | Expressions: 16
- Expression names: happy, sad, angry, relaxed, blink, blinkLeft, blinkRight,
    aa, ih, oh, ou, ee, lookUp, lookDown, lookLeft, lookRight, neutral
- NOTE: 'surprised' not present — mapped to 'happy' in EXPR_DUAL_NAMES
- New bones vs VRM 0.x: leftEye, rightEye, leftThumbMetacarpal, rightThumbMetacarpal

## Avatar Model: 195_Uta01.vrm — Full Bone & Expression Map (2026-04-10)
Source: BOOTH by 龍ポリゴン (Ryu Polygon) — VRM 0.x — ~34MB — ~10k polygons

### Expression Names (VRM 0.x CamelCase — use these in setValue/getValue)
| Category | Name in VRM | preset |
|----------|-------------|--------|
| Mouth | **A**, **I**, **U**, **E**, **O** | a,i,u,e,o |
| Emotion | **Joy** (happy), **Sorrow** (sad), **Angry**, **Fun** (relaxed), **Surprised** | joy,sorrow,angry,fun,unknown |
| Eyes | **Blink**, **Blink_L**, **Blink_R** | blink,blink_l,blink_r |
| Gaze | **LookUp**, **LookDown**, **LookLeft**, **LookRight** | lookup,lookdown,lookleft,lookright |
| Neutral | **Neutral** | neutral |

### AnimationController dual-alias coverage ✅
Phase 1 dual-alias handles all of these automatically:
- happy→Joy ✅, sad→Sorrow ✅, angry→Angry ✅, relaxed→Fun ✅
- aa→A ✅, ih→I ✅, oh→O ✅, ou→U ✅, ee→E ✅, blink→Blink ✅

### Humanoid Bone Chain (ALL PRESENT ✅)
- **Spine**: hips → spine → chest → upperChest → neck → head
- **Right Arm**: rightShoulder → rightUpperArm → rightLowerArm → rightHand
- **Left Arm**: leftShoulder → leftUpperArm → leftLowerArm → leftHand
- **Fingers R**: rightIndexProximal, rightMiddleProximal, rightRingProximal, rightLittleProximal, rightThumbProximal
- **Fingers L**: leftIndexProximal, leftMiddleProximal, leftRingProximal, leftLittleProximal, leftThumbProximal
- **Legs**: leftUpperLeg, leftLowerLeg, leftFoot, leftToes (same for right)

### VRM Spec Notes
- Version: VRM 0.x (GLB v2)
- autoUpdateHumanBones: true (default) → normalized→raw propagation active
- SpringBones: none detected (no hair/cloth physics)
- Commercial use: DISALLOWED — educational/personal use only
- Redistribution: PROHIBITED

## Avatar Rotation — Critical Discovery (2026-04-10)
VRMUtils.rotateVRM0() applies vrm.scene.rotation.y = Math.PI ONLY when meta.metaVersion === "0".
195_Uta01.vrm has NO metaVersion field → the auto-rotation does NOT fire.
Fix: call VRMUtils.rotateVRM0(vrm) manually after loading in BOTH AvatarCanvas AND avatar-motion-lab.

Rules:
- FORWARD_ROTATION_Y = 0 (rotation handled by explicit rotateVRM0 call)
- AvatarCanvas group: position + scale only, NO rotation={} prop
- AvatarCanvas handleLoad: calls VRMUtils.rotateVRM0(loadedVrm) explicitly after combineSkeletons
- avatar-motion-lab: calls VRMUtils.rotateVRM0(loaded) explicitly after loading
- Motion lab VrmPreview group: rotation={[0, 0, 0]} (FORWARD_ROTATION_Y = 0, no-op, safe)

Avatar arm mapping for 195_Uta01.vrm:
- USE_MIRRORED_ARM_SIDE_MAPPING = false (arms are direct, no swap needed)
- "Avatar Right" in lab = VRM rightUpperArm (direct)
- ⚠️ Gestures calibrated on avaturn_avatar.vrm NEED RECALIBRATION on 195_Uta01

## FINAL CORRECT Canvas Pattern (VERIFIED in code 2026-04-10)

The root div renders UNCONDITIONALLY with `useRef`. Canvas is NEVER behind a gate.
```tsx
const r3fEventSourceRef = useRef<HTMLDivElement>(null);

return (
  <div ref={r3fEventSourceRef} className="relative w-full h-full bg-[#0a0a12]">
    {/* Loading/Error overlays are pointer-events-none absolute, INSIDE the div */}
    <Canvas
      key="avatar-canvas-singleton"
      eventSource={r3fEventSourceRef as React.RefObject<HTMLElement>}
      frameloop="always"
      shadows
      gl={{ powerPreference: 'high-performance', alpha: false, antialias: true }}
      style={{ width: '100%', height: '100%', display: 'block' }}
      onCreated={({ gl }) => { /* color space + tonemap + webglcontextlost handler */ }}
    >
      {/* scene content */}
    </Canvas>
  </div>
);
```

⛔ NEVER add {condition && <Canvas>} — causes StrictMode WebGL Context Lost
⛔ NEVER use callback ref + containerEl state — same StrictMode issue
⛔ NEVER use useLayoutEffect + canvasReady gate — fails in Next.js SSR
⛔ NEVER remove eventSource — R3F needs it in React 19
⛔ NEVER remove frameloop="always"
⛔ NEVER remove key="avatar-canvas-singleton"

## Opus Master Plan Execution (2026-04-10)
- Phase 1: Expression Dual-Alias (AnimationController.tsx) ✅
  - exprGet/exprSet now try VRM 0.0 names (Joy/Sorrow/Angry/Surprised/Fun) AND VRM 1.0 names
  - runExprAudit() logs available expression names on first frame (dev only)
- Phase 2: Viseme Timeline Sync (useAgentAgent.ts + LipSyncManager.tsx) ✅
  - WS server cues dispatched BEFORE avatar:speak:start → first syllable has lip sync
  - Async fallback preserved for non-WS cue scenarios
  - Dev warning added when perf.now() anchor is used with queue present
- Phase 3: Wave Elbow Fix + Gesture Queue Buffer ✅
  - armGestureReference.ts wave: llaX 2.12→1.85, llaZ -2.20→-1.80 (prevent hyperextension)
  - VRMSkeletonManager pending buffer upgraded: single-slot → queue[5] (no gesture loss at startup)
- Phase 3b: Wave FINAL values (owner-confirmed — DO NOT CHANGE)
  - avatar-motion-lab GESTURE_POSES.wave:
      rightUpperArm: x=-1.13, y=0.22, z=0.51 | rightLowerArm: x=2.2 y=1.42 z=-2.2 | rightHand: 0,0,0
      leftUpperArm: x=0.95, y=-0.12, z=-0.28 | leftLowerArm: x=0.55, y=-0.06, z=-0.16 | leftHand: x=0.2, y=-0.03, z=-0.08
  - armGestureReference.ts wave offsets:
      rua (resting lowered): 0.95, -0.12, -1.68 | rla: 0.47, -0.16 | rh: 0.20, -0.03, -0.08
      lua (waving): -1.13, 0.22, 1.91 | lla: 1.85, -1.80 | lh: 0,0,0
  - RULE: Owner calibrated BOTH arms together. Do NOT zero the resting arm.

## Current Priority Roadmap
1) Stable VRMA enablement (no black screen regressions)
2) intensity/mood full pipeline propagation
3) word-boundary -> gesture timing bridge

---

## 🚨 KNOWN ROOT CAUSE — BLACK SCREEN / MISSING AVATAR (RESOLVED PERMANENTLY)

### The Problem (occurred 4+ times)
The avatar disappears and screen goes black. This is always caused by one of TWO root causes:

### ROOT CAUSE A — Wrong VRM URL (404)
- `cogni.vrm` does NOT exist locally → HTTP 404 → VRM fails to load → black screen
- This happened because `pickVrmUrl()` had a hardcoded fallback to `/models/cogni.vrm`
- It also happened when `AvatarCanvas` defaulted to `vrmUrl = '/models/cogni.vrm'`

**PERMANENT FIX A (updated 2026-04-10):**
- `pickVrmUrl()` returns `/models/195_Uta01.vrm` as fallback
- `AvatarCanvas.tsx` default param: `vrmUrl = pickVrmUrl()` ← FIXED (was hardcoded cogni.vrm!)
- Fallback chain: 195_Uta01.vrm → avaturn_avatar.vrm → cogni.vrm
- `.env.local`: `NEXT_PUBLIC_AVATAR_VRM_URL=/models/195_Uta01.vrm`

**⛔ NEVER change `pickVrmUrl()` fallback back to `/models/cogni.vrm`**
**⛔ NEVER hardcode `/models/cogni.vrm` as the primary or default in any component**

### ROOT CAUSE B — null.addEventListener (React 19 + R3F Canvas)
- R3F `Canvas.configure()` is async in React 19
- If `eventSource` ref.current is null when Canvas mounts → TypeError
- **THIS ERROR CAN COME FROM ANY COMPONENT THAT USES `<Canvas>` — NOT ONLY AvatarCanvas**

**PERMANENT FIX B (current in code 2026-04-10):**
- The root div with `useRef` renders UNCONDITIONALLY (no early return before it)
- Canvas renders INSIDE the div with NO conditional gate
- Loading/Error overlays are `pointer-events-none absolute` INSIDE the div
- This ensures ref.current is populated before Canvas mounts

**ALL Canvas components use the same pattern (verified 2026-04-10):**
- `frontend/src/app/avatar-agent/AvatarCanvas.tsx` — `r3fEventSourceRef` ✅
- `frontend/src/app/avatar-agent/MouseGestureCalibrator.tsx` — `calibratorEventSourceRef` ✅
- `frontend/src/app/avatar-motion-lab/page.tsx` — `eventSourceRef` ✅

- ⛔ NEVER add {condition && <Canvas>} gate
- ⛔ NEVER use callback ref + containerEl state (StrictMode context loss)
- ⛔ NEVER put early returns before the root div

### ROOT CAUSE C — VRMAPlayer static import (Turbopack build error)
- `import { VRMAPlayer } from './VRMAPlayer'` causes Turbopack to fail resolving `@pixiv/three-vrm-animation`
- Build error → entire page fails → black screen

**PERMANENT FIX C (applied earlier, preserved):**
- VRMAPlayer is loaded via `next/dynamic` with `.catch(() => null)` fallback
- If module fails: avatar stays visible, procedural gestures continue
- ⛔ NEVER change VRMAPlayer back to a static import

---

### ROOT CAUSE D — WebGL Context Lost → Frozen Frame (avatar looks like screenshot)
- Any state-based gate ({condition && <Canvas>}) + StrictMode = Canvas unmounts/remounts
- Each mount/unmount destroys WebGL context → last frame frozen as a screenshot
- **PERMANENT FIX D (same as Fix B — unconditional Canvas render):**
  - Canvas renders unconditionally inside the root div (NO gate)
  - `key="avatar-canvas-singleton"` prevents hot-reload remounts
  - `frameloop="always"` forces continuous rendering
  - `webglcontextlost` handler in `onCreated` reloads page on context loss

---

## Operational Rules for Sonnet
- Read this file AND `my memory/shared/PLATFORM-VISION.md` before coding — every session
- Write execution report to `my memory/sonnet/SONNET-0001.md`
- Run `npx tsc --noEmit --skipLibCheck` and include output in report
- Before any change: verify `http://localhost:3000/models/avaturn_avatar.vrm` returns 200
- After any change: hard-refresh browser and confirm avatar visible before reporting done
- If avatar disappears: STOP and report. Do NOT attempt any additional changes.
