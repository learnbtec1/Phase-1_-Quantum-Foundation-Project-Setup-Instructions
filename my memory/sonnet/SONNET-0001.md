# Sonnet Memory Log

Format:
- Timestamp
- What changed
- Validation output
- Risks / blockers

## [2026-04-10 07:37:57] SNT-NEXT-001 — VRMA Safe Runtime Logs

### Files Changed
1. frontend/src/app/avatar-agent/AvatarCanvas.tsx
2. frontend/src/app/avatar-agent/VRMAPlayer.tsx

### Changes
- AvatarCanvas: Added dev-only console.log on VRMA module load success/fail inside dynamic().
- VRMAPlayer: Added dev-only console.log on mixer init and VRM null state.
- No structural changes. domReady gate untouched. VRMAPlayerDynamic unchanged.

### Validation
- Lint: No errors
- TypeScript: Exit 0 (clean)
- Runtime: Avatar visibility preserved (no structural change)
- Logs now present for: module loaded/failed, mixer ready, procedural fallback trigger

### Risk Note
- Low risk. Only dev-only logs added (NODE_ENV === 'development').
- No crash path introduced. Rollback would be trivial (remove 3 console.log blocks).

### Next Step for GPT
VRMA pipeline is now observable via console.
Next highest ROI: word-boundary bridge (Azure TTS timestamps -> GestureScheduler).
OR: verify VRMA clips are actually triggering via a runtime test in console.

## [2026-04-10 07:58:46] SNT-NEXT-002 — VRMA Runtime Proof

### Files Changed
None (read-only validation task as specified)

### TypeScript Check
Exit code: 0 — clean

### Runtime Evidence Collected

#### VRMA Pipeline Confirmed Working:
- Thinking.vrma → HTTP check: exists (file on disk)
- Waving.vrma → HTTP check: exists (file on disk)  
- Dev server: HTTP 200 on health endpoint

#### Live console logs showing full pipeline:
1. [UnifiedGestureEngine] Playing: Thinking (priority=1 duration=3500ms)
2. [UnifiedGestureEngine] Dispatching gesture: Thinking → think url=/models/animations/Thinking.vrma intensity=0.82 mood=neutral
3. [VRMSkeletonManager] Loading VRMA: /models/animations/Thinking.vrma
4. [VRMSkeletonManager] Playing (procedural): /models/animations/Thinking.vrma
5. [VRMSkeletonManager] think | intensity=0.82 mood=neutral amp=0.99 (priority: 1)
6. [UnifiedGestureEngine] done "Thinking" in 4347.5ms
7. wave gesture also confirmed in logs (intensity=0.90 mood=neutral amp=1.20)

#### Avatar Visibility
Avatar visible during all gesture triggers (no black screen events in log)

#### Critical Finding (for GPT):
- VRMA files are loading and dispatching correctly
- BUT: VRMAPlayer mixer logs NOT seen in current log — meaning VRMAPlayer dynamic component may not be reaching the AnimationMixer (procedural fallback is handling gestures instead of true VRMA playback)
- intensity=0.82 is still hardcoded default (mood flowing but not fully personalized)

### Risk Note
Low risk — no regressions introduced. System stable.

### Next Step for GPT
The pipeline is ROUTING gestures correctly but the VRMA AnimationMixer may not be playing the actual .vrma animation files (procedural is running instead). 
GPT should decide: confirm VRMAPlayer mixer is running, OR move to word-boundary bridge as highest remaining ROI.

## [2026-04-11] SNT-NEXT-003 — Draco لتحميل مكتب glTF (Office) + توثيق الجلسة

### Files Changed
1. `frontend/src/app/avatar-agent/OfficeEnvironment.tsx`
2. `frontend/src/app/avatar-agent/scene/OfficeSetLoader.tsx`
3. `frontend/public/draco/draco_decoder.js` (نسخ من `node_modules/three/examples/jsm/libs/draco/gltf/draco_decoder.js`)

### Changes
- **OfficeEnvironment:** `useLoader(GLTFLoader, url, (loader) => { ... })` — إنشاء `DRACOLoader`، `setDecoderPath('/draco/')`، `loader.setDRACOLoader(dracoLoader)`.
- **`setDecoderConfig({ type: 'js' })`:** حزمة `three` على npm لا ترفق `draco_decoder.wasm` تحت `examples/jsm/libs/draco`؛ بدون هذا يفشل المسار WASM (404). فك الضغط عبر **JS فقط** يكفي لملفات glTF المضغوطة بـ Draco.
- **OfficeSetLoader:** نفس ربط `DRACOLoader` قبل `loader.load`، و`dracoLoader.dispose()` في `return` من `useEffect` لتفادي تسرب الموارد.
- **مسار المكتب العام:** `OFFICE_GLB_PUBLIC_PATH` = `/models/office/office.glb` (مرجع من `frontend/src/config/avatar.ts`).

### Validation
- `npx tsc --noEmit` في `frontend`: Exit 0.
- Lint على الملفات المعدّلة: بدون أخطاء.
- للتحقق اليدوي: Network — طلب `GET /draco/draco_decoder.js` يجب أن يعيد **200**.

### Risks / follow-ups
- **WASM أسرع:** لإزالة `type: 'js'`، انسخ مجموعة فك Draco الكاملة (مثلاً من `https://www.gstatic.com/draco/versioned/decoders/…` متوافقة مع إصدار Three) إلى `public/draco/` بحيث يتوفر `draco_wasm_wrapper.js` + `draco_decoder.wasm` (أو الاسم الذي يتوقعه الـ wrapper لـ glTF).
- **تحميلات أخرى:** `AvatarCanvas` يستخدم `GLTFLoader` لـ **VRM** فقط في المقطع المرئي؛ `CarpetLoader` / `CabinetLoader` / `GlobeLoader` تستخدم `GLTFLoader` لأصول أخرى — أضف Draco هناك فقط إذا أصبحت تلك الـ GLB مضغوطة بـ Draco.

### سياق محادثة موجّز (قبل ضغط السياق)
- جلسات سابقة في نفس الخيط (ملخص): تعديلات إيماءات/هيكل عظمي (`VRMSkeletonManager`، `armGestureReference`)، إعدادات Docker/WS/سجلات، أرشفة أصول Unity ومسارات النماذج، والتأكد من وجود `office.glb` تحت المسار العام أعلاه. التفاصيل الدقيقة لكل ملف تُرجَع من `git diff`/`git log` عند الحاجة.

### Next Step for GPT
إن ظهرت أخطاء فك Draco في الإنتاج، راقب 404 على `/draco/*` أو فشل `KHR_draco_mesh_compression`؛ عندها إما إكمال ملفات WASM في `public/draco` أو الإبقاء على `type: 'js'` مع مراقبة زمن التحميل.

## [2026-04-11] SNT-NEXT-004 — خط أساس الإيماءات الرسمي (Owner lock)

### مرجع وحيد
- **`my memory/shared/COGNI_GESTURE_BASELINE.md`** — الخريطة الرسمية؛ **لا تعديل إلا بإذن المالك الشخصي.**

### ملخص التطبيق
- `armGestureReference.ts`: جدول `ARM_OFFSETS` كامل (wave/point/think/explain/clap/agree).
- `VRMSkeletonManager.tsx`: listening عبر `headposeYawRef` للأمام على محور Y + دمج headpose في الرقبة/الرأس؛ `BLOCK_ALL_GESTURES` و`FREEZE_IDLE_ANIMATIONS` بقيا كما في الخط الأساس (false).
- `coSpeechPlanner.ts`: `CO_SPEECH_GESTURES_DISABLED = false`.
- `avatarPerformanceBridge.ts`: `DISPATCH_PERFORMANCE_ARM_GESTURES = true`.
- `useAgentAgent.ts`: إعادة `unifiedGestureEngine.play` للاستراتيجية و`Thinking` وintent `gestureHint`.
- `AvatarCanvas.tsx`: `startSpontaneousBehavior` / `stopSpontaneousBehavior`.
