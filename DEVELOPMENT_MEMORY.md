# DEVELOPMENT MEMORY — Cogni (Eduverse)
> Long-term engineering log. Update after every significant change.
> Last updated: 2026-03-23 (Checkpoint #47 teacher QR + Quick Review)

---

## Table of Contents
1. [Project Topology](#1-project-topology)
2. [Protected Modules](#2-protected-modules)
3. [Checkpoints](#3-checkpoints)
4. [Errors & Fixes](#4-errors--fixes)
5. [Active Decisions](#5-active-decisions)
6. [Data Flow Map](#6-data-flow-map)
7. [How to Restore a Checkpoint](#7-how-to-restore-a-checkpoint)
8. [Cognitive architecture summary (Arabic)](#8-cognitive-architecture-summary-arabic)

---

## 1. Project Topology

```
Phase 1_ Quantum Foundation Project Setup Instructions/
├── backend/               FastAPI + Whisper STT + Azure TTS + PostgreSQL
│   ├── app/
│   │   ├── api/v1/endpoints/   tutor.py, tts_timing.py, …
│   │   ├── core/config.py
│   │   └── services/           tts_service.py, whisper_stt.py
│   ├── Dockerfile
│   └── requirements.txt
└── frontend/              Next.js 16 / React 19 / TypeScript
    └── src/
        ├── app/
        │   ├── page.tsx               → redirect to /avatar-agent (server-side)
        │   ├── layout.tsx             root layout
        │   ├── avatar-agent/          ★ PRIMARY ROUTE
        │   │   ├── page.tsx
        │   │   ├── AvatarAgentClient.tsx   ← PROTECTED
        │   │   ├── AvatarCanvas.tsx        ← PROTECTED
        │   │   ├── AvatarCanvas.module.css
        │   │   ├── AvatarAgentClient.module.css
        │   │   ├── utils.ts
        │   │   ├── scene/             R3F scene components
        │   │   ├── debug/             Dev-only HUD
        │   │   ├── office/            OfficeDeskPro (orphan – not in main chain)
        │   │   └── physics/           WorldColliders
        │   ├── assessment/            ★ SECONDARY ROUTE
        │   │   └── page.tsx               ← PROTECTED
        │   └── api/                   All backend proxy routes (keep untouched)
        ├── ai/                        AgentDirector, brain store, engines
        │   └── avatar/AgentDirector.ts    ← PROTECTED
        ├── components/                Shared UI
        │   ├── PermissionBanner.tsx       ← PROTECTED
        │   ├── ConversationManager.tsx
        │   ├── HologramWindow.tsx
        │   ├── ComfortLightingRig.tsx
        │   ├── ScenicBackdrop.tsx
        │   ├── RoyalDecoProps.tsx
        │   ├── RoyalMaterialsOverride.tsx
        │   ├── ErrorBoundary.tsx
        │   └── LayoutSwitcher.tsx
        ├── config/avatar.ts
        ├── hooks/
        │   ├── useVAD.ts                  ← PROTECTED
        │   ├── useAgentAgent.ts
        │   └── useAgentAgent.ts (canonical)
        └── utils/
            ├── MotionLogger.ts
            ├── micManager.ts
            └── TimingUtils.ts
```

---

## 2. Protected Modules
> These files MUST NOT be modified without explicit justification. Any AI-assisted change must be reviewed manually.

| File | Reason |
|------|--------|
| `frontend/src/app/avatar-agent/AvatarAgentClient.tsx` | Core orchestration layer — connects VAD + TTS + Avatar |
| `frontend/src/app/avatar-agent/AvatarCanvas.tsx` | Fully-rewritten VRM animation engine (2055 lines) |
| `frontend/src/app/avatar-agent/page.tsx` | Avatar route entry — do not add server-side data fetching |
| `frontend/src/app/assessment/page.tsx` | Assessment engine — grading logic is fragile |
| `frontend/src/ai/avatar/AgentDirector.ts` | Brain↔Avatar event bridge |
| `frontend/src/hooks/useVAD.ts` | Custom VAD hook with complex WebM/EBML header handling |
| `frontend/src/components/PermissionBanner.tsx` | Self-managing — owns its own permission state, do not pass external props |
| `backend/app/services/tts_service.py` | Azure Speech SDK wrapper with Error 27 fix |
| `backend/Dockerfile` | Hardened with SSL/audio libs for Azure TTS |

---

## 3. Checkpoints

### Checkpoint #44 – 2026-03-26 – Complete BTEC Pedagogical Engine (production-ready) ✅
- **State persistence:** `tutorial_progress` table (Alembic `0007_tutorial_progress`) + `TutorialProgress` model; `tutorial_progress_store.py` (CRUD, criterion ordering, `expects_mini_answer`); `ENABLE_TUTORIAL_PERSISTENCE` (default on).
- **EMM API:** `EmotionalMemoryManager.get_tutorial_state` / `update_tutorial_state` / `clear_tutorial_state` delegate to the store.
- **Mini-checks:** `mini_check_evaluator.evaluate_mini_check` (LLM JSON rubric + RAG context); `tutorial_session_bridge.apply_tutorial_turn` wired into `tutor.py` before the global scaffolding block when RAG is grounded and user UUID present; advances `current_criterion` on pass.
- **Gestures:** `agent_ws._pedagogical_performance_supplement(..., pedagogical_stage)` — Pass→`open_hand`, Merit→`point`, Distinction→`wave`, `mini_check`→`explain_01`; keyword overrides (praise/clap, question/point). WS frames include `pedagogical_stage` + `tutorial_unit_id`. `mark_expects_mini_after_assistant_reply` sets/clears DB flag from assistant dialogue `?`.
- **Shim:** `services/tutorial_mode.py` re-exports tutorial modules for prompts/tooling.
- **Env (see `backend/.env.example`):** `COGNI_STAGE_GESTURES`, plus prior `COGNI_AUTO_BTEC_SCAFFOLDING` / `COGNI_PEDAGOGICAL_PERFORMANCE`.

### Checkpoint #46 – 2026-03-26 – Proactive Assessment Feedback Loop & Unified Dashboard ✅
- **Student `/dashboard`:** When `auth/me` role is `student`, `StudentLearningDashboard` renders a two-panel layout: subject chips + `StudentAssessmentPanel` (BTEC evaluate + local grade history) and `AvatarAgentClient` with `embedVariant="dashboard"`.
- **WebSocket:** `set_focus_subject` updates tutor/RAG focus; `new_grade` stores a one-shot `pending_grade_nudge` and triggers an immediate assistant turn (SYSTEM_EVENT); `grade_nudge` only queues nudge for the next LLM turn. On connect, logged-in users get a DB primed nudge from latest `evaluations`⋈`assignments` when grade ≠ Distinction (`assessment_grade_context.py`).
- **`agent_ws.py`:** `pending_grade_nudge` / `focus_subject` session state; clear on successful reply parse; `clear` resets both. `set_focus_subject` refetches latest row for the topic string; if a nudge applies, triggers the same proactive pattern as a new grade.
- **`tutor.py`:** `build_proactive_nudge()` + mandatory «تغذية راجعة استباقية» system block when `pending_assessment_nudge` is present; optional «تركيز المادة» block; Chroma query text prefixed with `focus_subject` for tighter retrieval.
- **Frontend shared modules:** `lib/academicSubjects.ts`, `lib/assessmentNormalize.ts`; `/assessment/page.tsx` imports refactored to avoid duplicating the curriculum tree and normalizer.

### Checkpoint #47 – 2026-03-23 – Teacher QR Generator & Quick Review Mode ✅
- **Summary:** Teacher-facing QR Generator & Quick Review Mode implemented. Unified deep-linking spec for all learning paths.
- **Teacher UI:** `frontend/src/components/teacher/DeepLinkGenerator.tsx` — unit dropdown from `academicSubjects.flattenSubjectLabels()`, targets Pass / Merit / Distinction / Quick Review, subject line (auto-filled from unit), live `qrcode.react` preview, copy link + download PNG. Shown on `/dashboard` only when `auth/me` role is **`teacher`** (not admin).
- **Deep link spec:** `/dashboard?unit=&target=&subject=` — student view embeds `AvatarAgentClient` with `initialUnit` / `initialTarget` / `initialSubject`; topic chips keep using **`focusSubject`** for locking.
- **WebSocket:** `deep_link_clear` clears `deep_link_state` and `session_state.is_quick_review`; mission badge dismiss sends this frame so tutoring returns to default P–M–D scaffolding without a full session clear.
- **`agent_ws.py`:** `_normalize_deep_link_target` accepts `quick_review` and aliases `quick`, `review`, `revision` (and Arabic variants); `session_state["is_quick_review"]`; `context["is_quick_review"]` for `tutor.py` + RAG.
- **`tutor.py`:** Revision Mode block (English + Arabic) for Quick Review; `DEEP_LINK_TRIGGER` branch for rapid summary + two quick questions; skips auto `_AUTO_BTEC_SCAFFOLDING_WHEN_RAG_AR` / Distinction gate relax when `is_quick_review`.
- **RAG:** `btec_chroma_rag.retrieve_btec_chroma_block*` and `local_rag.retrieve_local_context` take `quick_review` to prefer chunks whose text matches Summary / Key Concept style headings (regex fallback to normal top‑k if none match).

### Checkpoint #43 – 2026-03-23 – Universal BTEC Pedagogical Engine (auto scaffolding + gestures) ✅
- **tutor.py:** When Chroma and/or local BTEC RAG injects chunks, `_AUTO_BTEC_SCAFFOLDING_WHEN_RAG_AR` activates **without** a manual training toggle — treats turn as assignment/unit support, infers criteria (incl. A.P1-style codes) and scenario; aligns with training/examiner context. Extended `_SCAFFOLDING_TUTOR_BLOCK_AR` with **2 bis** (mini-check gating using **conversation history**) and richer context identification.
- **Env:** `COGNI_AUTO_BTEC_SCAFFOLDING` (default on) disables the auto-activation block only; core scaffolding block remains global.
- **agent_ws.py:** `_pedagogical_performance_supplement` fills empty `performance[]` from dialogue heuristics (question → point, praise → clap, else explain). `COGNI_PEDAGOGICAL_PERFORMANCE` (default on) to disable.
- **btec_chroma_rag.py:** unchanged — RAG path already wired through tutor.

### Checkpoint #42 – 2026-03-23 – Student Training Mode (BTEC Practice) ✅
- **Service:** `backend/app/services/training_mode.py` — RAG from Chroma `btec_knowledge_base` for question generation and answer evaluation; structured **P/M/D** feedback with `source_ref`; progress JSON under `backend/data/training_progress/`; optional `TrainingData` rows for logged-in users; optional `BTEC_TRAINING_FORENSIC=true` to fold in `forensic_grade`.
- **WebSocket:** `training_request` frame (`topic`, `difficulty`); text shortcuts `تدريب منهج` / `تدريب btec` (optional `:` + topic) so Phase B DB «تدريب» is unchanged; `training_evaluation` frame on grade; state cleared on `clear`.
- **Tutor:** `btec_training_deliver_question`, `cogni_training_mode`, `btec_training_examiner` context blocks — Jordanian examiner persona additive to existing rules.
- **Frontend:** `AvatarAgentClient.tsx` — «تدريب BTEC» modal → `training_request`.

### Checkpoint #41 – 2026-03-23 – Cognitive Awakening — Streaming Emotion, Reactive Subconscious, Additive Quaternion Blending, Motion Entropy, General Hand Avoidance (Embodiment-First; audio deferred) ✅
- **Streaming emotion:** `lib/frameNormalizer.ts` normalizes WS `speech` / `tts_unavailable` payloads safely. `useAgentAgent` dispatches `avatar:emotion` and `applyStreamingEmbodiment` **before** audio/TTS; `processFrame` unchanged semantically afterward.
- **AgentDirector:** Immediate `avatar:emotion` with raw `lastFrame.emotion` when present; gesture **entropy** (amplitude, wrist twist, duration jitter); **non-repetition** alternation for point/openHand/beat when the log would repeat; `checkGestureCooldown` accepts `explicitActionToken` from `lastFrame.gesture`.
- **Motor memory (`store.ts`):** Teaching gestures `openHand` / `point` cooldown **1.2s**; consecutive-repeat window uses 1.2s for those types vs 3s for others; explicit backend action bypasses consecutive block when it matches the gesture token.
- **AvatarCanvas:** §1-A **spine/chest breathing** moved to **after** `v.update(safeDelta)` so VRMA is the base layer, then additive quaternion multiply; **listening** micro-pitch when `avatar:listening` + listening phase; **general wrist separation** during any VRMA gesture window (lighter repulsion when not clap/cheer); **no per-frame** `Vector3.clone` for eye desire (reused buffer).
- **Audio:** No changes to TTS / `AudioContext` / streaming decode — embodiment decoupled as required.

### Checkpoint #40 – 2026-03-25 – Walk Speed, Bone Harmony & Hand Separation (V32 follow‑up) ✅
- **Walking:** Centralised `WALK_SPEED_MPS`, `WALK_CYCLE_RAD_PER_S`, `WALK_DEFAULT_DISTANCE_METERS`, `WALK_WRIST_MIN_SEP_M` in `avatar.ts`. `avatar:walk` uses `distance` (default 2m); duration = path length / speed; group motion uses constant-speed steps matching that duration. Patrol extends `walkUntil` by `dist / WALK_SPEED_MPS` instead of a fixed 500ms.
- **Procedural vs VRMA:** During active VRMA `walk`, §8 no longer overwrites legs/feet (clip is sole authority); arms keep additive swing. Fallback full gait when VRMA walk is absent.
- **Clap/cheer:** After additive arm roll, world-space hand positions enforce a minimum separation via extra upper-arm Z rotation (no Rapier spheres).
- **Files:** `AvatarCanvas.tsx`, `avatar.ts`.

### Checkpoint #39 – 2026-03-25 – Speech Repetition Fixed & Full AI–Mind Integration ✅
- **Fixed:** Duplicate client TTS fallback when `tts_unavailable` repeats the same dialogue within 10s (`useAgentAgent.ts`); `AgentDirector.scheduleTTS` dedupes identical text within 10s.
- **Fixed:** Azure 503 retry loop in `tts.ts` reduced to at most one retry (was four).
- **Fixed:** Gesture “consecutive repeat” now blocks only if the same type replayed within **3s** (not forever); per-type cooldown unchanged.
- **Activated:** Thinker default idle threshold **15s** (`THINKER_IDLE_THRESHOLD_SEC` default in `agent_ws.py`); class default `idle_threshold_seconds=15` in `thinker.py`; clearer skip logs for `is_llm_busy` / `is_tts_playing`.
- **Enhanced:** After V28 context enrich, `agent_ws` re-injects `current_goal`, `active_lesson_plan`, and `last_internal_thought` so tutor always sees latest Thinker/memory state.
- **Enhanced:** `tutor.py` accepts optional `emotional_memory_snapshot` dict; LLM **no-repeat** guard compares new reply to the last **three** assistant turns (threshold `COGNI_REPEAT_SIMILARITY_THRESHOLD`, default 0.82) for non-proactive turns too.
- **Result:** Fewer quota-driven speech loops, fewer blocked gestures, stronger Thinker→tutor prompt alignment.

### Checkpoint #38 – 2026-03-25 – Human-Like Motion Restored ✅
- **Fixed:** Procedural life (breathing, weight shift, group bounce, idle sway) stays active during VRMA gestures with `PROC_LIFE_DURING_VRMA_GESTURE` damping; seated hip sway + subtle spine lateral drift added.
- **Fixed:** `AnimationMixer` `finished` no longer shrinks `vrmaGestureUntilRef` (was cutting the standing gesture tail); clip end still sets `vrmaClipDoneRef` for procedural arm takeover.
- **Fixed:** Gesture handling — `pulseHandSeparationWindow` on wave/clap/cheer/point/celebration; clap/cheer arm spread respects `isHandSeparationPulseActive()`; residual upper-arm multiply sway while VRMA gesture plays.
- **Improved:** Idle VRMA rotation uses `IDLE_VRMA_MIN_MS` / `IDLE_VRMA_MAX_MS` (10–15s) for standing and seated sit/sitTalk alternation.
- **Relaxed:** §2 hip sway runs seated (reduced amplitude); idle finger micro-sway continues in idle/listening with damp during heavy VRMA clips; `avatar:micro:gesture` event + auto scheduler (`IDLE_MICRO_GESTURE_*`) for shoulder shrug, head tilt, finger tap.
- **Result:** Avatar keeps organic motion layers during gestures and idle; verify checklist (breathing, weight shift, clap separation, idle VRMA cadence, micro-gestures).

### Checkpoint #37 – 2026-03-24 – Final Human Polish ✅
- **Voice:** Micro-pauses and random pitch variation in `tts_service.py` (`_build_ssml`) for natural prosody.
- **Hands:** Finger articulation for VRMA `point` (smooth blend on index + thumb); subtle idle finger sway on proximal phalanges.
- **Dialect:** Hard post-LLM guard against Egyptian tokens + retry / apology path in `tutor.py`; free tier aligned with `gpt-4o-mini` (`TUTOR_MODEL_FREE`).
- **Human layers:** Real-time teaching-style hints, subtopic mastery line, stronger empathy when affect is negative (`digital_human_context.py`, `tutor.py`); thumb feedback adjusts style where wired.
- **Proactive:** Soft nudge timing (10s + 5s gates, 120s cooldown) and varied `SYSTEM_EVENT` pool in `thinker.py` / `agent_ws.py`.
- **Facial:** Idle micro-expression cadence 6–12s; extra types (`browFurrow`, `lipPress`, `noseWrinkle`, `eyeSquint`) and random peak intensity in `AvatarCanvas.tsx` / `avatar.ts`.
- **Physics:** Clap/cheer upper-arm spread; optional palm-collider hook stub in `WorldColliders.ts`.
- **Performance:** Skip idle VRMA cycling while speaking/transcribing; `CameraPerception` dynamically imported in `AvatarAgentClient.tsx`.
- **Result:** Cogni tuned for human-like teaching presence; verify with V29 checklist (voice, hands, dialect, nudges, micro-expressions, FPS).

#### VERIFICATION CHECKLIST (V29)
- **Voice:** Speak to Cogni — natural pauses and slight pitch motion, not monotone.
- **Hands:** Trigger point — index extends; clap — hands should not intersect badly.
- **Dialect:** Ask “إزاي أحسب مساحة الدائرة؟” — reply Jordanian (no Egyptian “إزاي”).
- **Personality:** Thumbs-up a response — later replies reflect preferred style where enabled.
- **Proactive:** Stay silent ~45s — one nudge with varied wording, not spam.
- **Facial:** Idle ~2 min — micro-expressions about every 6–12s.
- **Performance:** DevTools Performance — minimal frame drops during gestures.

### Checkpoint #36 – 2026-03-24 – Voice Fixed, Hand Bias, Dialect Crushed, Human Layers ✅
- **Voice:** `COGNI_ARABIC_TTS_VOICE_LOCKED` + `_locked_jordanian_male_voice()` in `tts_service.py` and `tts_timing.py` — all Azure/edge Arabic paths force **ar-JO-TaimNeural**; `ar_voice=female` on `/tts-with-timing` is ignored with a warning.
- **Physics:** `AvatarCanvas.tsx` applies **additive upper-arm roll** during clap/cheer VRMA to reduce hand intersection; procedural **index finger** bias on `point` gestures when bones exist.
- **Dialect:** Expanded `_jordanize` in `tutor.py`; **personality.ts** rule 10 bans Egyptian fillers; **free-tier** (`TUTOR_MODEL_FREE`) uses lower **temperature** (0.5 / 0.55 proactive) to reduce dialect drift.
- **Human layers:** `EmotionalMemoryManager` stores `student_understanding_score` + `preferred_teaching_style` (DB snapshot); `tutor.py` injects theory-of-mind + V28 mental blocks; `thinker.py` **`on_soft_nudge`** → `agent_ws` thin `SYSTEM_EVENT` after **15s** silence post–inner thought.
- **Micro-expressions:** `avatar.ts` idle micro cadence **3–8s**; extra blend types in `AvatarCanvas.tsx`.

### Checkpoint #35 – 2026-03-24 – Full Digital Human Layers (V28) ✅
- **DB:** Alembic `0006_digital_human` — `users.dnd_mode`, `user_context`, `student_persona_preferences`, `student_timeline`, `training_data`; SQLAlchemy models in `db_models.py`.
- **Config:** `ENABLE_*` env flags in `config.py` for camera, device context, theory-of-mind, contagion, empathy, persona learning, RL, Redis session sync, ethical filter, layered TTS.
- **Backend:** `digital_human_context.py` (mental state, persona traits, timeline, RL Q-table in `user_memory` type `rl_policy`), `ethical_filter.py`, `session_state_redis.py`, `reflection_service.py`; `tutor.py` injects V28 blocks + post-LLM ethical filter; `agent_ws.py` — `camera_frame`, `device_context`, `tool_interaction`, `session_feedback`, DND skips welcome/proactive, Redis `session_snapshot`/`save`, `contagion` on speech frames; `users.py` — `PATCH /me/preferences`, `GET/DELETE /me/memory`, `GET /me/export`; `digital_human_api.py` — admin CSV `GET /digital-human/training-export`; `dashboard.py` — `GET .../students/{id}/timeline`.
- **Frontend:** `deviceContext.ts`, `CameraPerception.tsx` (5s heuristic sampling), `DigitalHumanSettingsModal`, `ResponseFeedback`, `ToolSandbox`, `/settings/privacy`, `useAgentAgent` sends `device_context` on connect + `sendWsPayload`; `AgentDirector` listens `cogni:student_contagion`; avatar `thumbUp`/`pointIndex` → `point`; teacher dashboard loads timeline.
- **Scripts:** `backend/scripts/export_training_data.py` JSONL export.
- **Note:** Advanced lighting/volumetrics/52 ARKit blendshapes/TTS breath clips are flagged (`ENABLE_LAYERED_TTS`) or deferred; monthly yearly LLM snapshot is extensible via `user_memory.memory_type=yearly_snapshot`.

### Checkpoint #34 – 2026-03-24 – Final Polish (Model Tier, English Tokens, Dead Code) ✅
- **Model tier:** `TUTOR_MODEL_FREE` default is **`gpt-4o-mini`** in `config.py`; `tutor._tutor_model_for_context` reads `_settings.TUTOR_MODEL` / `_settings.TUTOR_MODEL_FREE`.
- **English tokens:** System blocks in `tutor.py` + `personality.ts` rule 9 minimize English; `_dialogue_has_unwanted_latin` triggers one **Arabic-only rephrase** pass after the main LLM call.
- **Dead code:** Removed **`speakWebSpeech`** and `webSpeechVoice` imports from `useAgentAgent.ts`; audio paths are **`playServerTTSAudio`** and **`AgentDirector.scheduleTTS`** → `speakWithTTS`.
- **Result:** Cleaner frontend and more consistent Jordanian TTS (fewer `<lang en-GB>` spans).

### Checkpoint #33 – 2026-03-24 – Phase C: Production Readiness ✅
- **Scalability:** Stateless backend patterns using Redis for Cogni state (`user:{id}:cogni_state` via `cogni_redis_state.py`); SQLAlchemy connection pool via `DB_POOL_SIZE` / `DB_MAX_OVERFLOW`; `docker-compose` adds Redis + healthchecks; `deploy/nginx.conf` + `deploy/SCALING.md` for LB / K8s notes.
- **Cost governance:** `ApiRateLimitMiddleware` (TTS hourly per IP); OpenAI token-per-minute budget in `llm_client.cogni_chat_completion` for authenticated `user_id`; `usage_log` + `usage_service`; admin `GET /api/v1/admin/usage/monthly`; model tier routing in `tutor.py` (`TUTOR_MODEL` / `TUTOR_MODEL_FREE`).
- **Security & compliance:** `DELETE /api/v1/users/me/data` (GDPR-style anonymization); `POST /api/v1/auth/consent`; `audit_log` + `audit_service`; SAML stub `GET /api/v1/auth/saml/login`; Alembic `0005_phase_c` for new tables/columns.
- **Monetization:** Stripe webhook stub `POST /api/v1/webhooks/stripe`; `subscription_plan` / `model_tier` on users; invite_codes table for future school licensing.
- **Polish:** `CurriculumEditor.tsx` (TipTap + MCQ builder) on teacher dashboard; PWA `manifest.json`, `public/sw.js`, `ServiceWorkerRegister`; `.env.example` Phase C variables.
- **Result:** Platform is significantly closer to production pilot; verify with checklist (scale backend=2, 429 limits, usage_log, GDPR delete, Stripe test mode, PWA).

### Checkpoint #32 – 2026-03-24 – Curriculum CMS & Assessment Integration (Phase B) ✅
- **Models:** `Subject`, `Topic`, `Lesson`, `Question` (integer PKs), `Answer`, `UserTopicMastery`, `LessonAssignment` (`lesson_assignments` — distinct from legacy BTEC `assignments`).
- **API:** `GET/POST /api/v1/curriculum/*` (read: authenticated; write: teacher/admin); `GET /api/v1/curriculum/topics/{id}/select-question` adaptive pick; dashboard `GET .../students/{id}/progress`, `GET .../lesson-assignments`, `POST .../assign`, `GET .../analytics`.
- **Grading:** `app/services/answer_grading.py` — MCQ match, short/essay via LLM; WebSocket grades pending practice answers, updates mastery, `answer_graded` frame; `tutor.py` injects `assessment_history`, `practice_question_block`, `graded_feedback`.
- **Frontend:** `CurriculumViewer.tsx`, dashboard tabs (students / curriculum / assignments / analytics), **تدريب** button on avatar (logged-in) → `sendText('', { practice: true })`.
- **Migration:** Alembic `0004_phase_b_curriculum_assessment`.
- **Result:** Structured content, assessment hooks, adaptive practice, and teacher visibility — Cogni behaves as a minimal LMS backbone.

### Checkpoint #31 – 2026-03-24 – Identity & Persistent Memory (Phase A) ✅
- Added user accounts: JWT auth (`POST /api/v1/auth/register`, `/login`, `GET /api/v1/auth/me`) with `python-jose` + `passlib[bcrypt]`; secrets via `JWT_SECRET` in `config.py` and `docker-compose.yml`.
- Extended `db_models.User` (`hashed_password`, `is_active`, `UserRole.admin`) and new `UserMemory` table for snapshots; Alembic `0003_phase_a_user_memory`; dev `AUTO_CREATE_TABLES` calls `Base.metadata.create_all`.
- WebSocket `ws://…/ws/agent?token=…` resolves `user_id` or stays guest; `EmotionalMemoryManager` loads/saves last entries + lesson plan + Thinker goal on disconnect; `RequestIdMiddleware` adds `X-Request-ID`.
- Teacher dashboard: `GET /api/v1/dashboard/students` (role teacher/admin), frontend `/dashboard` + `AuthModal` + `cogni_access_token` in `localStorage`; guest banner on avatar page.
- **Result:** Cogni can remember each logged-in user across sessions; schools get a minimal teacher view and observability baseline.

### Checkpoint #30 – 2026-03-24 – Procedural Life (Breathing, Eye Saccades, Weight Shift, Micro-expressions) ✅
- **Config (`src/config/avatar.ts`):** V20 tuning — `BREATHE_HZ` / `BREATHE_AMP_STANDING` / `BREATHE_AMP_SITTING` / `BREATHE_HARMONIC_STRENGTH` / `BREATHE_HARMONIC_FREQ` / `BREATHE_GROUP_BOUNCE_M`, weight-shift amplitudes, `LONG_HEAD_TILT_RAD`, `SHOULDER_DROP_RAD`, `FOOT_IDLE_YAW_RAD`, micro-expression idle window (`MICRO_EXPR_*`), gaze idle fixation (`GAZE_FIXATE_IDLE_*`).
- **`proceduralLife.ts`:** Pure helpers `breathSpineAmount` + `breathGroupBounce` (single source for chest + root bounce).
- **`AvatarCanvas.tsx`:** Breathing drives spine / upperChest / optional `spine1` & `spine2`; root gets `breathGroupBounce` on Y; lateral weight shift on X + `lifeHipTiltZRef` on hips (standing §8). Long head roll bias (`lifeLongHeadTiltRef`), shoulder asymmetry (`lifeShoulderDropSideRef`), idle foot yaw wiggle, eye **micro-bursts** added to lookAt target, longer idle gaze fixation (500–1500 ms) when not speaking, blinks use `BLINK_MIN_SEC`–`BLINK_MAX_SEC`, micro-expressions 0.2–0.5 s at ≤0.2 intensity with 10–20 s idle spacing.
- **`AvatarAgentClient.tsx`:** Unchanged (orchestration only).
- **Result:** Layered procedural motion on top of VRMA + Rapier; gestures unchanged.

### Checkpoint #29 – 2026-03-24 – Full body physics activated ✅
- **Activated:** Rapier (`@dimforge/rapier3d-compat`) world initialized in `AvatarCanvas` (`physicsWorldRef` + `initRapierWorld` on mount).
- **Colliders:** Kinematic capsule (full-body approximation from `PHYSICS_CONFIG` in `src/config/avatar.ts`) + fixed cuboids for floor, desk (`getDeskBox()`), and chair seat (`getChairAnchorVector3()`). Character movement uses Rapier `KinematicCharacterController` (`resolveIfEnabled(world, vrm, …)` in `WorldColliders.ts` → `rapierColliders.ts`).
- **Fallback:** If Rapier fails to init, Box3 `resolveIfEnabled(position, radius)` still runs while standing.
- **Result:** Avatar position is corrected against the environment each frame — reduced clipping through desk/chair/floor compared to Box3-only.

### Checkpoint #28 – 2026-03-24 – Voice stability & gesture visibility ✅
- **Azure-only path (HTTP):** `tts_timing.tts_with_timing` no longer falls through to edge-tts/gTTS when Azure returns **429 / rate limit**; returns **503** with a clear message. `TTS_DISABLE_NON_AZURE_FALLBACK` (default **true** in `docker-compose.yml`) blocks all fallbacks after Azure failure so Jordanian `ar-JO-*` identity is not replaced by gTTS.
- **AzureTTSService:** `TTS_AZURE_RETRY_COUNT` / `TTS_AZURE_RETRY_DELAY_SEC` — transient 429 retry before surfacing error to `agent_ws` (which already sends `tts_unavailable` without switching engine).
- **agent_ws:** `synthesize(..., voice_name=settings.TTS_ARABIC_VOICE)` — explicit voice every turn.
- **Gestures:** `AgentDirector._reactToFrame` uses `Math.max(1.55, …)` for planned gesture duration so clips stay visible; `personality.ts` adds short gesture hints (openHand/point/wave).
- **Result:** Avatar WebSocket uses Azure only; HTTP TTS proxy no longer swaps to gTTS voice on quota errors.

### Checkpoint #25 – 2026-03-24 – LLM failure handling & fallback deduplication ✅
- **Tutor:** Consecutive failure streak per `session_id`; after `LLM_FAILURE_COOLDOWN_COUNT` (default 3), returns `_FALLBACK_EXHAUSTED` with longer guidance + extended cooldown. Every failure arms `LLM_FAILURE_COOLDOWN_SEC` (default 60s) minimum; 429 uses `max(60, retry-after)`. `insufficient_quota` / `quota` logs a **billing renewal** hint for developers.
- **Variants:** `FALLBACK_VARIANT_WINDOW_SEC` (default 30) controls rotation among `_DEGRADED_REPLY` / `_DEGRADED_REPLY_ALT` / `_FALLBACK_BUSY_SHORT`. Successful LLM turns call `_reset_llm_streak`.
- **Thinker:** Tracks `_llm_fail_streak`; after threshold, sets `_thinker_cooldown_until` for `THINKER_LLM_STRIKE_COOLDOWN_SEC` (default 300s) and logs **Thinker disabled for Xs**. Resets streak on successful `cogni_chat_completion`.
- **Proactive:** `_trigger_proactive_speech` skips when `is_llm_paused()` (global OpenAI backoff).
- **Config:** `LLM_FAILURE_COOLDOWN_SEC`, `LLM_FAILURE_COOLDOWN_COUNT`, `FALLBACK_VARIANT_WINDOW_SEC`, `THINKER_LLM_STRIKE_COOLDOWN_SEC`.
- **Result:** With OpenAI quota exhausted, Cogni stops hammering the API and does not repeat the same degraded line indefinitely.

### Checkpoint #24 — 2026-03-24 — Fallback repetition, TTS guard, Thinker observability ✅
- **Tutor:** LLM exceptions no longer always return the same `_DEGRADED_REPLY`; session-scoped debounce (30s) alternates with `_DEGRADED_REPLY_ALT`. OpenAI **429** / rate-limit strings trigger `_set_cooldown` + warning log. Cooldown path returns rotating `_COOLDOWN_MESSAGES` instead of a single string. `session_id` / `client_id` threaded for HTTP chat.
- **Azure TTS:** `AzureTTSService` sets `_available=False` and logs clearly when `AZURE_SPEECH_KEY` or `AZURE_SPEECH_REGION` is empty; `synthesize` raises early with a clear message.
- **agent_ws:** `context["session_id"]` passed to tutor; `last_outbound_dialogue` dedupes **tts_unavailable** (prefix `لحظة — ` when dialogue matches last send). Thinker start log includes `session_id`; default `THINKER_INTERVAL_SEC` **45**.
- **Thinker:** `info` logs for busy / TTS / idle gate / unparseable JSON (was silent on idle).
- **Config:** default `PROACTIVE_THOUGHT_COUNT` **3** (env override).

### Checkpoint #23 — 2026-03-24 — Proactive loop fixed & Jordanian accent enforced ✅
- **Fixed:** `last_interaction_time` is updated after proactive speech (`_touch_interaction()`), breaking the infinite idle re-trigger loop.
- **Improved:** Proactive user message is built from `EmotionalMemoryManager.get_last_of_type("internal_thought")` when present; otherwise a curriculum ice-breaker `SYSTEM_EVENT` without generic greetings.
- **Thinker:** `last_proactive_time` is set **before** `await on_proactive()`; `_proactive_anchor_ts` after completion; cooldown default **90s**; `TTS_PLAYBACK_GRACE_SEC` default **0.8s** (`config.py`).
- **Enforced:** Tutor always appends Jordanian / anti-greeting blocks for `thinker_proactive_speech` and `[SYSTEM_EVENT:`; `proactive_engagement` matches `صامت` as well as `صمت`.
- **LLM:** Proactive turns use higher `frequency_penalty` / `presence_penalty` (env `COGNI_PROACTIVE_*`) and stricter repetition rephrase threshold (`COGNI_PROACTIVE_REPEAT_SIMILARITY_THRESHOLD`).
- **Result:** Cogni should stop repeating generic Egyptian/MSA greetings; proactive output should be one curriculum question in Jordanian-style Arabic per cooldown window.

### Checkpoint #22 — 2026-03-24 — Multi-step lesson planning + Phase 2.5 refinements ✅
- **Phase 2.5:** Inner-thought similarity uses `difflib.SequenceMatcher` + `THOUGHT_SIMILARITY_THRESHOLD`. `playing_tts` clears after `TTS_PLAYBACK_GRACE_SEC` async sleep (avoids early proactive overlap). HTTP `/api/v1/chat` injects `last_internal_thought` + `active_lesson_plan` via optional `client_id` + in-memory `EmotionalMemoryManager` per client key.
- **Phase 3:** `EmotionalMemoryManager` stores `active_lesson_plan` / `plan_updated_at`, `count_dialogue_turns`, `last_user_text`. Thinker emits JSON `thought` / `goal` / optional `lesson_plan` when `PLANNING_ENABLED` and (no plan | new-topic heuristics | every `PLANNING_INTERVAL_TURNS`). Confusion cues in thought trigger `_update_lesson_plan`. Tutor injects «خطة الدرس الحالية» from `context.active_lesson_plan` (from WS or HTTP).
- **Config:** `TTS_PLAYBACK_GRACE_SEC`, `PLANNING_ENABLED`, `PLANNING_INTERVAL_TURNS`.

### Checkpoint #21 — 2026-03-24 — Proactive awareness & thought injection ✅
- **Thought injection:** `agent_ws` passes `last_internal_thought` into tutor `context`; `tutor.py` appends «وعيك الداخلي» to the system prompt. `thinker_proactive_speech` adds a short block for Thinker-initiated turns.
- **Proactive speech:** After `PROACTIVE_THOUGHT_COUNT` (default 2) inner thoughts since `max(last_user_ts, proactive_anchor)`, cooldown `PROACTIVE_COOLDOWN_SEC`, and only if not `pipeline_busy` / not `playing_tts` / not LLM task busy — `process_text(..., thinker_proactive=True)` runs; **Checkpoint #23:** after completion, `_touch_interaction()` resets idle so the loop does not stack.
- **Repetition:** Consecutive near-duplicate thoughts skipped (Jaccard on tokens, `THOUGHT_SIMILARITY_THRESHOLD`); debug log.
- **Safety:** `pipeline_busy` wraps full `process_text`; `playing_tts` around synthesize+send; Thinker receives `is_llm_busy` + `is_tts_playing`.
- **Config:** `PROACTIVE_THOUGHT_COUNT`, `PROACTIVE_COOLDOWN_SEC`, `THOUGHT_SIMILARITY_THRESHOLD` in `app/core/config.py` (env).
- **Memory:** `EmotionalMemoryManager.count_thoughts_since(ts)`; `get_last_of_type` returns `full_thought` / `topic` / `summary`.

### Checkpoint #20 — 2026-03-24 — Autonomous inner thinker (frontal lobe) idle + curriculum guard ✅
- **`backend/app/services/thinker.py`:** `AutonomousThinker` (alias `Thinker`) — Arabic-only inner monologue system prompt with **curriculum guard** (no off-curriculum daydreaming); JSON `{thought, goal}`; logs `🧠 [COGNI'S INNER THOUGHT]: …`; uses `cogni_chat_completion`.
- **`agent_ws.py`:** `last_interaction_time` + `_touch_interaction()` on **text**, **audio**, and **clear** (not on ping/pong); Thinker receives `get_last_interaction`, `is_llm_busy` (active LLM+TTS task), `THINKER_INTERVAL_SEC` (default 35), `THINKER_IDLE_THRESHOLD_SEC` (default 30).
- **`main.py`:** Lifespan comment — Thinker stays **per WebSocket** (no app-global singleton).
- **No frontend changes.** Tutor/personality unchanged by this checkpoint.
- **Verify:** After ~30s silence with no in-flight reply, backend logs an inner thought line.

### Checkpoint #19 — 2026-03-24 — Persona fortification & repetition guard ✅
- **`frontend/src/config/personality.ts`:** COGNI_PERSONA rewritten — strict Jordanian curriculum teacher, concise replies, anti-repetition rules, diacritics + *gesture* + `[EMOTION:]` contract; `fallbackResponse` added; voice/timing tuned (rate 0.9, gesture variance 0.7).
- **`backend/app/api/v1/endpoints/tutor.py`:** Removed English `SYSTEM_PROMPT`; Arabic-only `_DEFAULT_PERSONA_SYSTEM_AR` when client omits persona; `_user_obvious_off_topic` short-circuit; `_model_reply_off_topic_leisure` post-check; one-shot LLM retry when `should_rephrase_for_repetition`; `max_tokens=300`, `temperature` 0.68/0.62 on retry; emotional snapshot header Arabic; degraded reply aligned with curriculum wording.
- **`backend/app/services/llm_client.py`:** Higher default `frequency_penalty` / `presence_penalty` (OpenAI has no `repetition_penalty`); `jaccard_token_similarity` + `should_rephrase_for_repetition` (threshold env `COGNI_REPEAT_SIMILARITY_THRESHOLD`).
- **`emotional_memory_manager.py`:** Doc note linking persona source of truth.
- **Verify:** off-topic leisure questions → polite redirect; repeated user question → less duplicate phrasing (tune via env if needed).

### Checkpoint #18 — 2026-03-23 — Autonomous Thinker + system integration ✅
- Added `backend/app/services/thinker.py`: background inner monologue + `current_goal` via `cogni_chat_completion` (interval `THINKER_INTERVAL_SEC`, default 45s).
- Added `backend/app/services/emotional_memory_manager.py`: per-session ledger (`observe_dialogue_turn`, `record_moment`, `get_recent`, `get_last_of_type`).
- `agent_ws.py`: starts/stops Thinker per connection; injects `context["current_goal"]`; optional WS frame `goal_update` on goal change; feeds `think_mm` after each LLM turn.
- `tutor.py`: appends Arabic teaching-goal block from `current_goal` (or default conversational goal).
- Frontend polish (this checkpoint doc only — code may predate): unified audio (`stopAllAudio` / `stopTTSGlobally`), gesture window `dur + 500`, `normalizeAvatarEvents` unknown → `idle`, TTS `_split_segments` short ASCII stays on ar-JO voice.

### Checkpoint #1 — 2026-03-17 — Base after initial development
- Project running on Docker, backend on port 8000, frontend on port 3000.
- VRM avatar loading but fully static (no animation).
- Routes: `/`, `/evaluate` (legacy), `/assessment`.

### Checkpoint #2 — 2026-03-20 22:00 — Avatar animation rewrite
- **Rewrote** `src/app/evaluate/AvatarCanvas.tsx` with full animation engine.
- Added: automatic breathing, lip-sync via `'aa'` blendshape, head tracking with strict clamping, smooth arm gestures via `THREE.MathUtils.lerp`, simplex-noise idle sway.
- Root cause of frozen avatar identified: event-spike architecture + mixed timing sources (`Date.now()` vs `elapsedTime`).
- Created `SONNET_PROJECT_MEMORY.md` (initial analysis doc).

### Checkpoint #3 — 2026-03-20 23:30 — Legacy route cleanup (brutal purge)
- **Deleted** ~75 files/folders. Surviving count: ~80 files.
- Routes removed: `/evaluate`, `/vr-experience`, `/plagiarism`, `/ai-teacher`, `/unit-1-agriculture`, `/competition`, and 12 more legacy route folders.
- `src/app/page.tsx` rewritten as server-side redirect → `/avatar-agent`.
- `src/app/assessment/page.tsx` verified clean (zero deps on deleted code).
- Created `CLEANUP_REPORT.md`.

### Checkpoint #17 — 2026-03-21 — Speech-Standing: Avatar Stands for Entire AI Response ✅

**Root Cause:** The avatar only stood correctly when pressing the wave button manually because:
1. The wave button bypasses `checkGestureCooldown` (direct `window.dispatchEvent`)
2. AI-triggered gestures have 5-12s cooldowns — most are blocked mid-conversation
3. Even when a gesture fires, the standing window was only 2-4s while speech is 5-15s
4. `onSpeakStart` played `sitTalk.vrma` keeping the avatar seated throughout speech

**Fix — `speakStandUntilRef` (new ref)**
- Added `speakStandUntilRef = useRef(0)` — independent from `vrmaGestureUntilRef`
- `onSpeakStart`: if sitting → `speakStandUntilRef = now + 60_000` + play idle VRMA (standing)
- `onSpeakEnd`: `speakStandUntilRef = 0` → avatar sits back via lerp
- `useFrame`: `speakStandNow = isSittingNow && (now < speakStandUntilRef)` feeds into:
  `isSittingEffective = isSittingNow && !vrmaGestureNowPos && !speakStandNow`
- `restoreAfterGesture`: when `speakStandNow`, restore to idle (not sitTalk) so avatar stays up

**Result:**
- Every AI speech response → avatar stands from chair, stays standing until speech ends
- Gestures still override arms with their VRMA clips while avatar stands
- After speech ends → avatar sits smoothly back to chair
- Wave button still works as before (bypasses cooldown, immediate stand)

**Files Modified:** `AvatarCanvas.tsx`

**Test:** Open `/avatar-agent` incognito, speak to trigger a response → avatar should rise at speech start, stand throughout response, sit back when done.

---

### Checkpoint #16 — 2026-03-21 — Final Liberation: Stand Behind Desk & Arm Freedom ✅

**Status:** Completed

**Root Causes Fixed (3 surgical fixes):**

**Fix 1 — `standingFromChair` (Desk Clipping)**
- **Problem**: When `isSittingNow=true` but `isSittingEffective=false` (gesture window), `group.position.z` jumped to `currentAvatarZRef` (patrol position, possibly in front of desk), causing avatar to pass through desk geometry.
- **Solution**: Added `standingFromChair = isSittingNow && !isSittingEffective`. When true, X/Z locked to `CHAIR_X/CHAIR_Z` — avatar rises in place behind desk, never clips through.

**Fix 2 — `vrmaClipDoneRef` (Arm Paralysis)**
- **Problem**: Short VRMA clips (e.g. `ack` ≈1.5s) finish early within a 4.7s gesture window. Arms freeze at last clip frame for ~3.2s because `vrmaGestureNow` kept §8 arm overrides suppressed.
- **Solution**: `vrmaClipDoneRef` ref (reset to `false` on gesture start, set to `true` by `mixer.addEventListener('finished')`). `vrmaGestureNow = (now < gestureUntil) && !vrmaClipDoneRef`. Arms freed immediately when clip ends, standing posture maintained for full window.

**Fix 3 — `hipsBindPosRef` (Correct Standing Height)**
- **Problem**: Previous `hipsBindPosRef.current.y = 0` was wrong — T-pose hips Y ≈ 0.9m for `teach.vrm`. Setting to 0 sank skeleton below floor.
- **Solution**: Bind position captured once at VRM load (before any VRMA plays): `hipsBindPosRef.current = hB.position.clone()`. Restored to `bindPos.y` in §8 when `!isSittingEffective`.

**Files Modified**: `AvatarCanvas.tsx` only.

**Test**: Open `/avatar-agent` incognito + Ctrl+Shift+R. Gesture → avatar rises behind desk, arms move freely during clip, arms restore after clip ends, avatar sits back smoothly after full window.

---

### Checkpoint #14 — 2026-03-21 — Total Bone Liberation: Arms Fully Unbound ✅

**Root Cause Diagnosed**: §8 in `useFrame` is labelled "ALWAYS runs as final bone override". When VRMA plays `ack/beckon/point/wave/clap`, `v.update(delta)` bakes keyframes onto raw bones — then §8's final `else` block **immediately overwrites all arm bones** back to lap/idle positions. Result: every single VRMA gesture animation was cancelled within 1 frame of starting.

**Fix 1 — `vrmaGestureUntilRef` sentinel** (the core unlock):
- Added `const vrmaGestureUntilRef = useRef(0)` to VRMScene
- In `onGesture` handler: whenever `playVRMA(...)` is called for any gesture clip, set `vrmaGestureUntilRef.current = Date.now() + dur + 700`
- In §8 final `else` block: `const vrmaGestureNow = now < vrmaGestureUntilRef.current` — arm writes are **completely skipped** when `vrmaGestureNow` is true
- This applies to both sitting (lap arms) and standing (idle sway arms)

**Fix 2 — `clap` / `cheer` gesture added**:
- New `else if (gType === 'clap' || gType === 'cheer')` branch in `onGesture`
- Maps to `playVRMA('clap')` / `playVRMA('cheer')` with full sentinel + restore logic
- Procedural fallback: symmetric `beat` on both arms when VRMA not ready
- `AgentDirector.ts`: `EMOTION_GESTURE_MAP` updated — `excited` → `'clap'`, `proud` → `'cheer'`

**Fix 3 — Sitting laugh unfreeze**:
- Removed static arm freeze during `isLaughingNow && isSittingNow`
- Replaced with `laughBounce = Math.sin(t * 14) * 0.04` applied to lap-resting arms
- Laugh arms also respect `vrmaGestureNow` (gesture takes priority over laugh)

**Fix 4 — `restoreAfterGesture` helper**:
- Extracted shared restore logic: `isSittingRef.current ? sitTalk/sit : idle{N}`
- Used in all 3 gesture branches (wave, clap/cheer, point/openHand/beat)

**Files Modified**:
- `frontend/src/app/avatar-agent/AvatarCanvas.tsx` — `vrmaGestureUntilRef`, sentinel check in §8, clap support, laugh unfreeze
- `frontend/src/ai/avatar/AgentDirector.ts` — `excited: 'clap'`, `proud: 'cheer'`

**Status**: **STABLE ✅** — Docker restarted. Hit `Ctrl+Shift+R` to verify.

---

### Checkpoint #13 — 2026-03-21 — Quantum Entanglement: Full System Integration ✅

**Goal**: Unify all systems (WebSocket → AgentDirector → AvatarCanvas) into a single living entity. Eliminate the "arm freeze" and "gesture restore" bugs during sitting.

**Dependency Analysis (Phase 0)**:
- **No `useSocket.ts`** — WebSocket is embedded in `useAgentAgent.ts` (already well-built)
- **Full pipeline is connected**: Voice → useVAD → WebSocket → Backend → AgentFrame → BrainStore → AgentDirector → CustomEvents → AvatarCanvas
- **AgentDirector**: Already has priority queue (PAD-debounce 300ms, emotion-debounce 250ms), gesture cooldowns via `checkGestureCooldown`, emotion-to-gesture mapping, neutral idle timers — **no changes needed**
- **AvatarCanvas**: Three surgical bugs found (see fixes below)

**Bug #1 — VRMA gesture restore never ran while sitting** (Lines 529–542):
- **Root Cause**: After VRMA gesture plays, restore timer had `if (!isSittingRef.current) playVRMA(idle)`. While sitting → condition was FALSE → restore was skipped → avatar frozen in T-pose after gesture.
- **Fix**: Changed to branching logic — when sitting, restore to `isTalkingRef.current ? 'sitTalk' : 'sit'`. Both `wave` and `point/openHand/beat` gesture restore handlers updated.

**Bug #2 — Procedural arm gestures hard-blocked when sitting** (Line 1559):
- **Root Cause**: `} else if (hasGesture && gestureRef.current && !isSittingNow)` — `!isSittingNow` completely prevented arm animation during sit mode.
- **Fix**: Removed `&& !isSittingNow`. Added seated gesture logic: `sitScale = 0.6` scales amplitude, `lapUAx/lapUAz/lapLAx` offsets move gesture origin from lap rest pose (not from T-pose). Leg sitting pose enforced within the gesture branch to prevent fall-through reset.

**Bug #3 — Static lap arms (no organic motion while sitting)**:
- **Root Cause**: Lap arms were hardcoded to fixed rotations — no breathing, no sway.
- **Fix**: Added `lapSway` (dual-harmonic noise) + `breathZ` (linked to `spineBreathRef`) to arm rotations. Arms now gently rise/fall with breathing and have subtle organic lateral sway.

**Files Modified**:
- `frontend/src/app/avatar-agent/AvatarCanvas.tsx` — 3 targeted patches (lines 526–550, 1559–1604, 1664–1675)

**Systems Preserved Intact**:
- `useVAD.ts` — untouched
- `physics/WorldColliders.ts` — untouched
- `AgentDirector.ts` — untouched (already correct)
- `useAgentAgent.ts` — untouched
- Camera (CameraGuard) — untouched
- Physics (resolveIfEnabled) — untouched

**Status**: **STABLE ✅** — Docker restarted. Hit `Ctrl+Shift+R` to verify.

---

### Checkpoint #12 — 2026-03-21 — Strategic Rollback to teach.vrm ✅
- **Decision**: Reverted to `teach.vrm` (VRM 0.x, 25MB) due to severe structural and texture issues with `teacher-final.vrm` (Seed-san VRM 1.0). Restored full motion and visual stability for the Asas Platform demo.
- **Files confirmed on disk**: `teach.vrm` (25MB) + `teacher-final.vrm` (11MB, kept as future reference)
- **All VRM 1.0 changes reverted**:
  - `avatar.ts`: Primary URL → `/models/teach.vrm`
  - `avatarFacingRef` init → `Math.PI` (VRM 0.x base)
  - Facing system: `Math.PI + atan2(...)` base restored
  - JSX group rotation → `[0, Math.PI, 0]`
  - Sitting legs: `+1.5/-1.5` (Math.PI calibrated) restored
  - Material overrides: full `DoubleSide + needsUpdate` on all materials restored
- **`AvatarAgentClient.tsx` preserved**: Still uses `pickVrmUrl()` — single source of truth pattern kept.
- Status: **STABLE & WORKING** ✅

### Checkpoint #11 — 2026-03-21 — Structural Fix: Inverted Legs & Unclad Body ✅
- **Root Cause 1 — White/Grey (definitive fix)**:
  - Previous fix checked `isVRM1` (VRM version) to skip material overrides — but `isVRM1` could silently fail to detect, running VRM 0.x path on MToon materials.
  - **Final fix**: Per-material check `(m as any).isMToonMaterial` — this is a first-class property on `MToonMaterial` in @pixiv/three-vrm 3.x (confirmed from source). MToon materials are detected at material level and skipped entirely, regardless of VRM version.
- **Root Cause 2 — Legs twisted (definitive fix)**:
  - §8 bone overrides run AFTER `v.update(delta)` which applies VRMA keyframes (sitting.vrma) to raw bones. §8 was then OVERWRITING the VRMA pose with hardcoded values calibrated for a different model/rotation convention.
  - **Final fix**: When `vrmaLive=true` (sitting.vrma is active), §8 skips ALL leg bone overrides — VRMA drives the legs. Only arm bones are set manually (VRMA doesn't reliably cover arms). When VRMA not loaded, legs set to `identity()` quaternion (T-pose = safe fallback, no twisting).
- Files modified: `src/app/avatar-agent/AvatarCanvas.tsx`
- Status: **COMPLETED** ✅

### Checkpoint #10 — 2026-03-21 — Seed-san Bone & Material Mapping Fixed ✅
- **Goal**: Fix leg deformation + white/grey textures on VRM 1.0 (teacher-final.vrm).
- **Root Cause 1 — White/Grey Materials**:
  - `m.needsUpdate = true` on `MToon1Material` (VRM 1.0 custom shader) resets internal shader uniforms including texture maps → model renders as white/grey.
  - **Fix**: Skip ALL material property overrides for VRM 1.0. Only set `frustumCulled=false` and `mesh.visible=true`. MToon1Material is self-managing.
- **Root Cause 2 — Leg Twisting**:
  - §8 sitting pose was calibrated for `group.rotation.y = Math.PI` (VRM 0.x). With Math.PI flip, `rul.rotation.x = +1.5` pushed thigh FORWARD in world space.
  - After changing to `group.rotation.y = 0` for VRM 1.0, the same `+1.5` pushes thigh BACKWARD → severe leg deformation.
  - **Fix**: Negated X rotation signs: upper legs `+1.5 → -1.5`, lower legs `-1.5 → +1.5`.
- **Files modified**: `src/app/avatar-agent/AvatarCanvas.tsx`
  - Loader: `isVRM1` branch skips material overrides entirely
  - §8 sitting: flipped leg rotation signs for no-group-flip convention
- Status: **COMPLETED** ✅

### Checkpoint #9 — 2026-03-21 — Forced Cache Break & Motion Unlocked ✅
- **Goal**: Kill browser cache permanently by renaming asset to a unique name.
- **Actions**:
  1. Renamed `asas-pro-teacher.vrm` → **`asas-teacher-v1.vrm`** (final canonical name)
  2. Config URL: `/models/asas-teacher-v1.vrm?update=final_force` — unique URL the browser has never seen
  3. All legacy fallbacks removed from `VRM_FALLBACKS` (only one source of truth)
  4. Breathing formula locked: `(Math.sin(t * BREATHE_BASE_HZ * Math.PI * 2) * BREATHE_BASE_AMP) * (isSittingNow ? 0.55 : 1.0)` — never freezes to 0
- **Sole VRM source on disk**: `asas-teacher-v1.vrm` (10.9MB, VRM 1.0)
- Files modified: `src/config/avatar.ts`, `src/app/avatar-agent/AvatarCanvas.tsx`
- Status: **COMPLETED** ✅

### Checkpoint #9 — 2026-03-21 — Total Cache Break & Motion Restoration ✅
- **Goal**: Force browser to load new avatar by renaming file + busting cache. Confirm breathing active.
- **Actions**:
  1. **Renamed**: `frontend/public/models/seed-san.vrm` → `asas-pro-teacher.vrm`
  2. **Config updated** (`src/config/avatar.ts`):
     - Primary URL: `/models/asas-pro-teacher.vrm?v=999`
     - All legacy fallbacks (`teach.vrm`, `verona.vrm`) removed — they don't exist on disk
     - `teach.vrm` confirmed absent from host filesystem (never existed there; old refs were stale)
  3. **Breathing verified** (`AvatarCanvas.tsx` line ~1254):
     - Formula: `breathAmp = isSittingNow ? BREATHE_BASE_AMP * 0.55 : BREATHE_BASE_AMP`
     - `spineBreathTarget = Math.sin(t * breathRad) * breathAmp + Math.sin(t * breathRad * BREATHE_HARMONIC) * breathAmp * 0.27`
     - Confirmed NOT frozen when sitting ✅
- **Sole VRM source**: `asas-pro-teacher.vrm` (10.9MB, VRM 1.0, official Seed-san model)
- Files modified: `src/config/avatar.ts`
- Status: **COMPLETED** ✅

### Checkpoint #8 — 2026-03-21 — Neural-to-Motor Link Restored ✅
- **Goal**: Re-enable procedural animations (breathing, organic noise) for Seed-san + wire `BREATHE_BASE_HZ` from config.
- **Root Cause of "locked" avatar**: In a previous session (Checkpoint #5.5), spine breathing was deliberately frozen (`isSittingNow ? 0 : ...`) to achieve "only neck+eyes move". User reversed this decision.
- **Fixes applied** (`AvatarCanvas.tsx`):
  1. **Breathing restored**: `spineBreathTarget` now uses `BREATHE_BASE_HZ * 2π` + `BREATHE_BASE_AMP` from `@/config/avatar` (SINGLE SOURCE OF TRUTH). Amplitude = 55 % while sitting, 100 % standing.
  2. **Organic noise restored**: `sittingScale = 0.25` when sitting (subtle alive feel), `1.0` when standing. Lateral sway still disabled to avoid desk-clipping.
  3. **Spine gaze absorption**: 10 % when sitting (slight alive), 20 % when standing.
  4. **Config wiring**: Added `BREATHE_BASE_HZ`, `BREATHE_BASE_AMP`, `BREATHE_HARMONIC` to imports.
- **AgentDirector audit**: Confirmed fully wired. Fires: `avatar:emotion`, `avatar:gesture`, `avatar:nod`, `avatar:headpose`, `avatar:speak:start`, `avatar:speak:end`. All events reach `AvatarCanvas` via `dispatchAvatar`.
- **Expression manager audit (VRM 1.0)**:
  - `setEM()` already probes VRM 1.0 keys first (`aa`, `ih`, `ou`, `ee`, `oh`, `happy`, `sad`, `angry`, `relaxed`, `surprised`), then falls back to VRM 0.x (`A`, `I`, `U`, `E`, `O`, `Joy`, `Sorrow`...). Zero changes needed.
  - Seed-san (VRM 1.0) will use VRM 1.0 keys directly on first probe — cached for subsequent frames.
- **LookAt**: Was never static. Already tracks `pointer.x` / `pointer.y` from R3F `useFrame` state + gaze-break saccade system. Confirmed intact.
- Files modified: `src/app/avatar-agent/AvatarCanvas.tsx` (breathing + organic noise)
- Status: **COMPLETED** ✅

### Checkpoint #7 — 2026-03-21 — Asas Premium Identity (Seed-san VRM 1.0) ✅
- **Goal**: Upgrade to high-fidelity VRoid-style model + professional anime lighting.
- **Model**: Downloaded `Seed-san.vrm` (10.9MB, VRM 1.0) from `vrm-c/vrm-specification` GitHub (official VRM Consortium sample). Placed at `frontend/public/models/seed-san.vrm`.
- **Config**: `src/config/avatar.ts` → `VRM_FALLBACKS[0]` updated to `/models/seed-san.vrm`; `teach.vrm` remains as fallback.
- **VRM 1.0 Loader fix** (`AvatarCanvas.tsx`):
  - Auto-detects VRM version via `model.meta?.metaVersion === '1'`.
  - Skips `m.side = THREE.DoubleSide` on VRM 1.0 models — MToon 1.0 handles backface culling internally; forcing DoubleSide breaks rim-lighting.
  - `group.rotation.y = Math.PI` correctly orients both VRM 0.x and VRM 1.0 (both face -Z natively in @pixiv/three-vrm 3.x).
- **Lighting** (`ComfortLightingRig.tsx` + `scene/LightingRig.tsx`):
  - Three-point anime setup: Key (warm, 2.4 intensity, upper-left) + Fill (cool lavender, right) + Rim (white-blue, behind).
  - Shadow map: 2048×2048, normalBias=0.04 (prevents MToon self-shadowing artefacts).
  - Face-level point light at `[0, 0.3, -1.2]` for MToon inner glow.
  - Environment: `city` preset at 0.50 intensity for specular gloss.
- **Body freeze** (previous session): Arms/spine static when sitting — ONLY neck + eyes move.
- Files modified: `src/config/avatar.ts`, `src/components/ComfortLightingRig.tsx`, `src/app/avatar-agent/scene/LightingRig.tsx`, `src/app/avatar-agent/AvatarCanvas.tsx` (loader section)
- Status: **COMPLETED** ✅

### Checkpoint #6 — 2026-03-21 — Camera finalized (face portrait framing) ✅
- **Problem**: Camera at `[0,1.5,0.8]` targeted `Z=-2.5` but avatar sits at `Z=-2.8` → camera framed the desk, not the face.
- **Final Camera Values** (AvatarCanvas.tsx):

  | Parameter | Value | Rationale |
  |-----------|-------|-----------|
  | `camera.position` | `[0, 0.9, 0.7]` | Eye level, 3.52m from avatar |
  | `camera.fov` | `48°` | Portrait lens — no barrel distortion |
  | `OrbitControls target` | `[0, 0.5, -2.8]` | 0.25m below head → head sits in upper-third of frame |
  | `minDistance` | `2.0m` | Prevents camera entering desk geometry |
  | `maxDistance` | `6.0m` | Wide view without losing the avatar |
  | `maxPolarAngle` | `130°` (0.72π) | No camera below desk level |
  | `minPolarAngle` | `14°` (0.08π) | No extreme overhead angle |
  | `azimuth` | `±99°` (±0.55π) | Prevents camera seeing avatar's back |

- **Math verification**:
  - Head world Y = SIT_Y(-1.21) + 1.45×scale(1.35) = **+0.75m**
  - Head 8% above frame center → professional portrait framing ✅
  - Visible height @ 3.52m, FOV 48° = **3.14m** → face + shoulders + desk visible ✅
- **lookAt**: Already fully implemented (lines 1330-1408) — saccade FSM, VRM built-in eye tracking, cursor tracking, gaze-break randomization. No changes needed.
- Status: **COMPLETED** ✅

### Checkpoint #5 — 2026-03-21 — Physics enabled (desk/wall collision)
- **Root Cause Found**: `WorldColliders.ts` had `let _enabled = false` — the entire Box3 collision system was already wired up but toggled off.
- **Fix**: Changed to `let _enabled = true`. One line. No new packages, no rewrites.
- **Collision features now active**:
  - Floor snap: avatar Y clamped to `ROOM_BOUNDS.floorY`
  - Wall clamps: avatar X/Z kept inside room bounds with capsule margin
  - Desk separation: 3-iteration Box3 overlap resolver (push-out on minimum-overlap axis)
- **Chair seat anchor**: `OfficeSetLoader.tsx` already calls `setDeskScene()` + `computeChairAnchor()` on load — no changes needed.
- Files modified: `src/app/avatar-agent/physics/WorldColliders.ts` (1-line change)
- Status: **STABLE** ✅

### Checkpoint #4 — 2026-03-21 — useVAD import fix + import audit
- **Fixed** `ReferenceError: useVAD is not defined` in `AvatarAgentClient.tsx`.
  - Added: `import { useVAD } from '@/hooks/useVAD';`
  - Removed stale destructured props (`permissionDenied`, `micNotFound`, `resetPermissionDenied`) that were passed to `PermissionBanner` (which self-manages).
- **Audited** all imports in `AvatarCanvas.tsx` — all clean.
- **Verified** `backend/Dockerfile` already has `ca-certificates`, `openssl`, `libasound2` + `SSL_CERT_FILE` env var → Azure TTS Error 27 already resolved.
- Status: **STABLE** ✅

---

## 4. Errors & Fixes

### ERR-001 — Frozen/Static Avatar
- **Symptom**: Avatar renders but never moves (no breathing, blinking, lip-sync, gestures).
- **Root Cause** (multi-factor):
  1. Animation was fully event-driven (spikes only) — no continuous baseline motion.
  2. Timing mixed `Date.now()` in event handlers with `state.clock.elapsedTime` in `useFrame`, creating drift.
  3. Bone rotations were set directly (no `lerp`) → snapping instead of smooth movement.
  4. No idle sway/breathing loop → avatar completely still between events.
- **Fix**: Rewrote `AvatarCanvas.tsx` (2055 lines). Architecture is now a state machine inside `useFrame`:
  - Continuous breathing: `Math.sin(t * 1.9) * 0.06` on spine/chest.
  - Lip-sync: `isTalkingRef.current` drives `'aa'` blendshape.
  - Head tracking: idle sway + explicit headpose commands, clamped to `±0.20` yaw, `±0.22` pitch.
  - Arms: `THREE.MathUtils.lerp` with explicit gesture commands + idle sway.
  - All timing via `state.clock.elapsedTime` (monotonic, frame-accurate).
- **Files affected**: `src/app/evaluate/AvatarCanvas.tsx` (original), `src/app/avatar-agent/AvatarCanvas.tsx` (current canonical).

### ERR-002 — ReferenceError: useVAD is not defined
- **Symptom**: `AvatarAgentClient.tsx` crashes at runtime with `ReferenceError`.
- **Root Cause**: `useVAD` was called on line 74 but the import statement was never added to the file.
- **Fix**: Added `import { useVAD } from '@/hooks/useVAD';` to the imports block.
- **Related**: Removed the three destructured variables (`permissionDenied`, `micNotFound`, `resetPermissionDenied`) from the `useVAD()` call since they were only forwarded to `PermissionBanner` as props that the component doesn't accept. `PermissionBanner` is self-managing via the native Permissions API.
- **Files affected**: `src/app/avatar-agent/AvatarAgentClient.tsx`

### ERR-003 — Azure TTS Error 27 (SSL certificate failure)
- **Symptom**: Backend Azure Speech SDK throws Error 27 (`SPXERR_RUNTIME_INVALID_STATE`) on container start.
- **Root Cause**: The Azure Cognitive Services Speech SDK's internal HTTP singleton cannot locate CA certificates inside the slim Python Docker image.
- **Fix** (already applied in `backend/Dockerfile`):
  ```dockerfile
  RUN apt-get install -y ca-certificates openssl libasound2 libgomp1
  RUN update-ca-certificates --fresh
  ENV SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt
  ENV SSL_CERT_DIR=/etc/ssl/certs
  ```
- **Files affected**: `backend/Dockerfile`

### ERR-004 — head command not found (PowerShell)
- **Symptom**: `head -n 10 *.txt` fails in PowerShell — `head` is not a recognized cmdlet.
- **Fix**: Use `Get-Content -TotalCount 10 file.txt` or Cursor's `Read` tool with `limit` parameter.
- **Environment note**: This is a Windows PowerShell workspace. GNU coreutils are not available. Use `rg` for search (pre-installed) and native PS cmdlets for file ops.

### ERR-006 — Physics never ran despite being fully wired
- **Symptom**: Avatar clips through desk and walls even though `resolveIfEnabled` is called every frame.
- **Root Cause**: `let _enabled = false` in `WorldColliders.ts`. The toggle was off by default. Everything else was already correctly wired: `OfficeSetLoader` calls `setDeskScene()` + `computeChairAnchor()` on load, and `AvatarCanvas.tsx` calls `resolveIfEnabled(group.position)` every `useFrame`.
- **Fix**: Changed to `let _enabled = true`. One-line change.
- **Files affected**: `src/app/avatar-agent/physics/WorldColliders.ts`
- **Why no Rapier needed**: The existing system uses pure Three.js `Box3` AABB collision — zero external dependencies, zero GC pressure per frame (all temporaries pre-allocated), 3-iteration overlap resolver. Production-quality for this use case.

### ERR-005 — PermissionBanner prop mismatch
- **Symptom**: TypeScript errors passing `permissionDenied`, `micNotFound`, `onRetry` to `PermissionBanner`.
- **Root Cause**: `PermissionBanner` was designed as a zero-prop self-managing component that queries the native Permissions API directly. The props were added by mistake in a prior refactor.
- **Fix**: Render as `<PermissionBanner />` with no props. The component internally handles all permission states.
- **Files affected**: `src/app/avatar-agent/AvatarAgentClient.tsx`

---

## 5. Active Decisions

| Decision | Rationale | Date |
|----------|-----------|------|
| Server-side redirect `/` → `/avatar-agent` | Eliminates the legacy landing page flash; Next.js handles it before React hydrates | 2026-03-20 |
| `PermissionBanner` self-manages its own state | Decouples mic permission UI from parent orchestration; easier to test in isolation | 2026-03-20 |
| `useVAD` called in `AvatarAgentClient` (separate from `useAgentAgent`) | Allows independent VAD lifecycle control; `useAgentAgent` has its own audio pipeline that should not conflict | 2026-03-21 |
| `OfficeDeskPro.tsx` + `RoomWithShelves.tsx` kept as orphan files | They are inside `avatar-agent/office/` and `avatar-agent/scene/`. Not imported by the main chain. Deleting them is safe but low priority. | 2026-03-21 |
| Dockerfile uses `openssl` (runtime) not `libssl-dev` (headers) | Runtime image should never carry compiler headers | 2026-03-20 |
| VRM bones via `getNormalizedBoneNode` (not `getRawBoneNode`) | `getRawBoneNode` bypasses the VRM normalization layer; rotations are locked in T-pose space and produce unnatural results | 2026-03-20 |

---

## 6. Data Flow Map

### Speech → Avatar (Full Pipeline)
```
User speaks
  └─► useVAD (hooks/useVAD.ts)
        └─► onSpeechEnd(blob) → POST /api/v1/stt
              └─► Whisper transcription
                    └─► useAgentAgent (hooks/useAgentAgent.ts)
                          └─► POST /api/v1/tutor  (LLM response)
                                └─► AgentDirector (ai/avatar/AgentDirector.ts)
                                      ├─► window.dispatchEvent('avatar:speak:start')
                                      ├─► window.dispatchEvent('avatar:emotion', { emotion })
                                      ├─► window.dispatchEvent('avatar:gesture', { type, side })
                                      └─► window.dispatchEvent('avatar:speak:end')
                                            └─► AvatarCanvas.tsx (useFrame loop)
                                                  ├─► isTalkingRef → 'aa' blendshape lip-sync
                                                  ├─► emotionRef → head pitch / expression
                                                  ├─► gestureRef → arm rotation via lerp
                                                  └─► Continuous: breathing + blink + idle sway
```

### TTS Audio Flow
```
AgentDirector → POST /api/v1/tts
  └─► AzureTTS SDK → WAV bytes
        └─► Frontend AudioContext.decodeAudioData → play
              └─► window.dispatchEvent('avatar:speak:start') ← triggers lip-sync
```

---

## 7. How to Restore a Checkpoint

If a future session breaks something critical, use git to restore to the last stable state:

```powershell
# See all recent commits
git log --oneline -20

# Restore a specific file to a known-good commit
git checkout <commit-hash> -- frontend/src/app/avatar-agent/AvatarCanvas.tsx

# Full hard reset to Checkpoint #4 (current stable)
# Find the commit SHA first: git log --oneline
git reset --hard <sha-of-checkpoint-4>
```

**Checkpoint #4 stable files (do not overwrite without logging an ERR entry):**
- `frontend/src/app/avatar-agent/AvatarAgentClient.tsx`
- `frontend/src/app/avatar-agent/AvatarCanvas.tsx`
- `frontend/src/app/assessment/page.tsx`
- `backend/Dockerfile`

---

## 8. Cognitive architecture summary (Arabic)

> **عنوان عربي:** شرح التكامل المعرفي للأفاتار — ملخّص للمعلّمين والتوثيق الداخلي. يصف طبقات **tutor + LLM**، **Thinker**، **AgentDirector + AvatarCanvas**، و**Azure TTS** كما في الشيفرة الحالية (مع فروقات الإعداد).

### الطبقات باختصار

- **الرد التفاعلي:** `tutor.py` يستدعي نموذج الدردشة (مثل `gpt-4o-mini` للطبقة المجانية حسب الإعداد). المخرجات تشمل نص الحوار، ووسم الإيماءة، والعاطفة — تُمرَّر عبر WebSocket ثم `useAgentAgent` و`useBrainStore` و**AgentDirector** إلى الأفاتار.
- **التأمل الدوري (Thinker):** `thinker.py` يعمل في الخلفية بفاصل `interval_seconds` (مثلاً من `THINKER_INTERVAL_SEC`، غالباً ~45s) ويشترط صمتاً لا يقل عن **`idle_threshold`** (الافتراضي بعد V31: **15s** عبر `THINKER_IDLE_THRESHOLD_SEC`). يولّد أفكاراً داخلية وخطة درس وهدفاً؛ تُحقَن في سياق المحادثة (`current_goal`, `active_lesson_plan`, `last_internal_thought`) — راجع **Checkpoint #39** لإعادة الحقن بعد `enrich_ws_tutor_context`.
- **الحركة والوجه:** النموذج لا يرسل زوايا عظام؛ يرسل رموزاً عالية المستوى (`wave`, `openHand`, …). **AgentDirector** يطلق أحداثاً؛ **AvatarCanvas** يطبّق VRMA وطبقات إجرائية.
- **الصوت:** Azure TTS عبر المسار الموحّد. في Docker غالباً يكون **`TTS_DISABLE_NON_AZURE_FALLBACK`** مفعّلاً، فلا يُعتمد على edge-tts كاحتياط في الإنتاج؛ عند نفاد الحصة يظهر **`tts_unavailable`** ومسار عميل يقلّل تكرار الجملة نفسها (Checkpoint #39).

### ملاحظات دقيقة للتوافق مع الإعداد الفعلي

1. **TTS:** عند نفاد الحصة الساعية لا يُفترض تكرار نفس جملة الـ fallback بلا حدود؛ راجع منطق **`tts_unavailable`** و`scheduleTTS` في الواجهة.
2. **Thinker:** الوصف «كل 15–30 ثانية» معقول كفكرة عامة: الفاصل الفعلي هو **interval**، وشرط الصمت هو **idle** (افتراضي 15s، قابل للضبط).
3. **العظام:** التحكم رمزي فقط → VRMA / إجراءات، وليس أوامر دوران مباشرة من الـ LLM.

### الخلاصة

النموذج اللغوي يقود **المحتوى والسلوك الرمزي** (نص، إيماءة، عاطفة)، والمحرك الأمامي يحوّل ذلك إلى **صوت وحركة وتعبير** — مع احترام قيود TTS والجلسة كما في البيئة المفعّلة.
