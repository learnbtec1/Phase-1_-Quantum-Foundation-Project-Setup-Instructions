# Cogni (Eduverse) — Codebase Cleanup Report
**Date:** 2026-03-21  
**Engineer:** Principal Next.js Architect (AI)  
**Scope:** `frontend/src/` — all files not reachable from `/avatar-agent` or `/assessment`

---

## Methodology

Full import graph traced from:
1. `src/app/layout.tsx` → `LayoutSwitcher`, `ProgressContext`, `dev-log-filter`
2. `src/app/page.tsx` → `next/navigation` redirect only (zero local deps)
3. `src/app/avatar-agent/page.tsx` → `AvatarAgentClient` → full canvas/AI/hook chain
4. `src/app/assessment/page.tsx` → zero local imports (self-contained, uses npm only)
5. `src/app/api/**/*` → all API routes preserved per instructions

Each suspect file was cross-checked with `Select-String` across the entire `src/` tree to confirm zero live consumers before marking for deletion.

---

## LIVE TREE (kept — zero touches)

### App Shell
- `src/app/page.tsx` — server redirect to `/avatar-agent`
- `src/app/layout.tsx` — root layout
- `src/app/dev-log-filter.tsx` — used by layout
- `src/app/globals.css` — used by layout
- `src/app/favicon.ico` — static asset
- `src/app/error.tsx` — Next.js error boundary
- `src/app/not-found.tsx` — Next.js 404
- `src/app/avatar-agent/**/*` — entire route (minus dead sub-files below)
- `src/app/assessment/page.tsx` — core assessment route
- `src/app/api/**/*` — ALL API routes preserved

### Components (referenced by live pages)
- `LayoutSwitcher.tsx`, `PermissionBanner.tsx`, `ConversationManager.tsx`
- `HologramWindow.tsx`, `ComfortLightingRig.tsx`, `ScenicBackdrop.tsx`
- `RoyalDecoProps.tsx`, `RoyalMaterialsOverride.tsx`, `ErrorBoundary.tsx`

### AI / Cognitive
- `ai/avatar/AgentDirector.ts`, `EmotionalMemoryManager.ts`, `actions.ts`
- `ai/cognitive/BehaviorRulesEngine.ts`, `GestureEngine.ts`
- `ai/memory/store.ts`
- `ai/io/tts.ts`, `ai/lipsync/timing.ts`, `ai/lipsync/azureViseme.ts`, `ai/lipsync/viseme.ts`

### Hooks / Store / Context
- `hooks/useAgentAgent.ts`, `hooks/useVAD.ts`
- `store/useBrainStore.ts`, `store/avatarConfigStore.ts` (used by api/avatar-config)
- `context/ProgressContext.tsx` (used by layout)

### Utilities / Types / Config / Lib
- `utils/events/normalizeAvatarEvents.ts`, `utils/MotionLogger.ts`, `utils/micManager.ts`
- `utils/TimingUtils.ts`
- `debug/avatarDebug.ts` (imported by avatar-agent/AvatarCanvas.tsx)
- `types/ai.ts`, `types/number-to-arabic-words.d.ts`
- `config/avatar.ts`
- `lib/ai/vectorDB.ts` (used by api/ai/ingest and api/ai/query)
- `__tests__/evaluate-validation.test.ts`, `utils/events/__tests__/normalizeAvatarEvents.test.ts`

---

## DEAD — DELETED

### Dead App Route Folders (18 routes)
| Path | Reason |
|------|--------|
| `src/app/ai-teacher/` | Legacy route — not in core two |
| `src/app/ai-tutor/` | Legacy route — never linked |
| `src/app/assessments/` | Plural duplicate — real one is `assessment/` |
| `src/app/auth/` | Auth pages not in core routes |
| `src/app/competition/` | Eduverse Academy legacy |
| `src/app/competition-dashboard/` | Eduverse Academy legacy |
| `src/app/competition-login/` | Eduverse Academy legacy |
| `src/app/dashboard/` | Eduverse Academy legacy |
| `src/app/dashboard-2d/` | Eduverse Academy legacy |
| `src/app/evaluate/` | Deprecated — replaced by `/avatar-agent` |
| `src/app/farm/` | Eduverse Academy legacy |
| `src/app/login/` | Not in core two routes |
| `src/app/plagiarism/` | Eduverse Academy legacy |
| `src/app/simulation/` | Eduverse Academy legacy |
| `src/app/strict-evaluation/` | Legacy — no live importers |
| `src/app/student/` | Eduverse Academy legacy |
| `src/app/unit-1-agriculture/` | Eduverse Academy legacy |
| `src/app/vr-experience/` | Eduverse Academy legacy |

### Dead Files Inside `avatar-agent/` (dead sub-tree)
| File | Reason |
|------|--------|
| `avatar-agent/SceneClassroom.tsx` | Not imported by AvatarCanvas or any live file |
| `avatar-agent/brand/LogoAIEDUCAT.tsx` | Only used by dead SceneClassroom |
| `avatar-agent/debug/ClassroomHUD.tsx` | Not imported by AvatarCanvas (only OfficeDebugHUD is) |
| `avatar-agent/hooks/useRoomTheme.ts` | Zero importers anywhere in codebase |
| `avatar-agent/npm run dev.txt` | Accidental file |

### Dead Components (flat + sub-folders)
| File/Folder | Reason |
|-------------|--------|
| `components/EduverseHero3D.tsx` | Was only in old root page (now replaced) |
| `components/DrAhmedOrb.tsx` | Was only in old root page |
| `components/DrHamzaOrbWrapper.tsx` | Zero importers |
| `components/AvatarViewer.tsx` | Only used by dead AvatarHumanProUltra chain |
| `components/AvatarHumanProUltra.tsx` | Only used by dead VRMChat |
| `components/MarketingSimulationWorld.tsx` | Only in dead vr-experience route |
| `components/AssessmentLiveCard.tsx` | Only in dead Dashboard.tsx |
| `components/CriteriaAnalysisBox.tsx` | Only in dead components/index.tsx |
| `components/VRMChat.tsx` | Only in dead AvatarHumanProUltra chain |
| `components/ProgressTower.tsx` | Only in dead AssessmentLiveCard |
| `components/Dashboard.tsx` | Only for dead dashboard route |
| `components/Human-Pro-Max-IndependentAgent-V20.tsx` | Zero importers |
| `components/Human-Pro-Max-Plus-Arabic.tsx` | Zero importers |
| `components/Human-Pro-Max-Plus-Arabic.module.css` | Dead CSS |
| `components/index.tsx` | Zero importers (barrel file for dead components) |
| `components/{` | Malformed stray file |
| `components/audio/` (folder) | Soundscape.tsx — zero live importers |
| `components/avatar/` (folder) | All dead: AvatarHumanProUltra, DrHamzaOrb, HumanizationRig |
| `components/boardroom/` (folder) | Entire Eduverse boardroom feature |
| `components/competition/` (folder) | Entire Eduverse competition feature |
| `components/evaluate/EvaluateInterface.tsx` | Dead evaluate route component |
| `components/layout/EvaluateHeader.tsx` | Dead evaluate route header |
| `components/mr/` (folder) | MR/AR — zero live importers |
| `components/dashboard/ReportDownloadButton.tsx` | Dead dashboard component |
| `components/particles/` (folder) | Empty (.gitkeep only) |
| `components/ui/Chat.tsx` + `Chat.module.css` | Zero importers in live chain |

### Dead AI Modules
| File/Folder | Reason |
|-------------|--------|
| `ai/AgentDirector.ts` (root-level) | Shadowed by ai/avatar/AgentDirector.ts; zero importers |
| `ai/audio/stt.ts` | Zero importers in live chain |
| `ai/avatar/brain.ts` | Only used by dead EvaluateInterface + dead Chat |
| `ai/avatar/director.ts` | Zero importers anywhere |
| `ai/avatar/HumanizationRig.ts` | Zero importers in live chain |
| `ai/avatar/resolveExpressions.ts` | Only used by dead constants/avatar chain |
| `ai/avatar/state.ts` | Zero importers anywhere |
| `ai/avatar/managers/` (folder) | Zero importers in live chain |
| `ai/cognitive/CognitiveEngine.ts` | Only in dead ai/avatar/director.ts |
| `ai/emotion/` (folder) | Zero importers in live chain |
| `ai/io/sttWhisper.ts` | Zero importers in live chain |
| `ai/rag/loader.ts` | Zero importers in live chain |

### Dead Constants
| File/Folder | Reason |
|-------------|--------|
| `constants/avatar/` (entire folder) | Only used by dead resolveExpressions + dead types/avatar |

### Dead Debug
| File | Reason |
|------|--------|
| `debug/AvatarInspector.tsx` | Only in dead DriftMeter |
| `debug/DriftMeter.ts` | Zero live importers |
| `debug/VeronaHUD.tsx` | Only uses dead EmotionEngine |

### Dead Hooks
| File | Reason |
|------|--------|
| `hooks/useAuth.ts` | Only used by dead login/auth/vr-experience routes |

### Dead Lib
| File | Reason |
|------|--------|
| `lib/audio-pool.ts` | Zero importers |
| `lib/avatarSettingsRegistry.ts` | Zero importers |
| `lib/fileProcessor.ts` | Zero importers |
| `lib/numbersToArabicWords.ts` | Zero importers |
| `lib/parseReply.ts` | Zero importers |
| `lib/selfCheckGate.ts` | Zero importers |
| `lib/strict-evaluation.ts` | Only used by dead strict-evaluation route |

### Dead Config
| File | Reason |
|------|--------|
| `config/rubric.json` | Only used by dead lib/strict-evaluation.ts |
| `config/voice.ts` | Zero importers in live chain |

### Dead Realtime
| Folder | Reason |
|--------|--------|
| `realtime/` (entire folder) | Zero importers anywhere in codebase |

### Dead Services
| Folder | Reason |
|--------|--------|
| `services/eduverseApiService.ts` | Zero importers |

### Dead Types
| File | Reason |
|------|--------|
| `types/avatar.ts` | Zero importers in live chain |

### Dead Utils
| File | Reason |
|------|--------|
| `utils/LipSyncAudioAnalyzer.ts` | Zero importers in live chain |
| `utils/selectFemaleArabicVoice.ts` | Zero importers in live chain |

### Dead Proxy
| File | Reason |
|------|--------|
| `src/proxy.ts` | Zero importers anywhere |

---

## Safety Guarantee

- `src/app/assessment/page.tsx` — **ZERO imports changed or deleted**
- `src/app/avatar-agent/` main canvas chain — **fully preserved**  
- `src/app/api/**/*` — **all API routes preserved, zero touched**
- `src/app/layout.tsx` and its direct deps — **fully preserved**
