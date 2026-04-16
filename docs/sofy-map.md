# 🧠 SOFY MAP — AVATAR SYSTEM ARCHITECTURE

## 🎯 PURPOSE

This document defines the REAL architecture of the Avatar system.

It is the single source of truth to:

- Prevent system collapse
- Avoid motion conflicts
- Maintain clean modular design
- Guide all future development

## 🧱 CORE SYSTEM OVERVIEW

```
[ UI Layer ]
    ↓
AvatarCanvas (render shell ONLY)
    ↓
VRMAvatar (runtime core)
    ↓
----------------------------------
| Motion Layer (CRITICAL ZONE)   |
|--------------------------------|
| VRMA (Animation Clips)         |
| Procedural Motion              |
| Emotion System                 |
| Gesture System                 |
----------------------------------
    ↓
Agent / Director Layer
    ↓
Input (WebSocket / TTS / User)
```

## 🎬 RENDER PIPELINE

**AvatarCanvas → provides:**

- Canvas
- Camera
- Lights
- UI

**VRMAvatar:**

- Loads VRM
- Owns AnimationMixer
- Runs useFrame loop

**⚠️ RULE:**

AvatarCanvas must NEVER contain logic.

## 🎭 MOTION SYSTEM (CURRENT REALITY)

### ACTIVE SYSTEMS:

- VRMA via EmotionManager
- Procedural motion (arms, head, idle)
- Gesture system (events → bones)
- Lip sync (visemes)
- LookAt (camera tracking)

### 💣 CRITICAL PROBLEM

ALL systems write to the SAME skeleton at the SAME TIME.

There is:

- ❌ No motion gate
- ❌ No priority system
- ❌ No locking mechanism

**Result:**

- jitter
- T-pose
- teleport
- instability

## 🧠 ROOT CAUSE

There is NO central motion controller.

Everything writes directly into:

**VRMAvatar → useFrame → bones + mixer**

## 🧩 CURRENT CONTROL FLOW

```
WebSocket / Agent
    ↓
director.ts
    ↓
GestureEngine
    ↓
window events (avatar:*)
    ↓
VRMAvatar listeners
    ↓
EmotionManager / procedural updates
    ↓
AnimationMixer + bone manipulation
```

## ⚠️ ARCHITECTURE VIOLATIONS

- Multiple writers to same bones
- No synchronization layer
- EmotionManager partially detached (update not called)
- VRMASingleTrack exists but unused
- Two agent systems (useAvatarAgent vs AgentDirector)

## 🧱 MISSING LAYER (CRITICAL)

### 🚨 Motion Control Layer (NOT IMPLEMENTED)

Must sit BETWEEN:

**VRMAvatar and ALL motion systems**

## 🧠 REQUIRED DESIGN

```
MotionController
    ├── VRMA Controller
    ├── Procedural Controller
    ├── Gesture Controller
    └── Emotion Controller
```

## 🔒 REQUIRED RULES

**ONLY ONE system controls a bone at a time**

**Priority:**

`VRMA > Gesture > Procedural > Idle`

**Locking:**

If VRMA is active:

→ block procedural

**Gating:**

No system writes directly to skeleton

ALL go through controller

## 🎯 CURRENT SAFE STATE

- Rendering works
- Build passes
- Avatar loads

**BUT:**

System is structurally unstable

## 🚀 NEXT STEP (MANDATORY)

**DO NOT:**

- Modify AvatarCanvas
- Add new features

**ONLY:**

- Build MotionController layer

## 🧨 FINAL WARNING

If you continue without Motion Control:

**The system WILL collapse again.**

---

END OF DOCUMENT
