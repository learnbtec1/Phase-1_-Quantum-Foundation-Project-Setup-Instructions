# Sonnet Task — Pending Owner Approval
Status: PENDING

## Task ID
SNT-MOTION-LAB-001

## 🚨 IMPORTANT: EXECUTOR MODE ONLY
You are EXECUTOR, not designer.
Follow instructions exactly.
Do not add scope.
Do not touch production avatar behavior outside this task.

## Mandatory Pre-Read
Before any edit/command, read:
1) `my memory/shared/PLATFORM-VISION.md`
2) `my memory/shared/handoff.md`

## Objective (Fast MVP)
Build a tiny isolated **Avatar Motion Lab** to study VRM bones and camera control quickly, without destabilizing `/avatar-agent`.

This lab is for:
- manual bone rotation testing
- safe camera zoom/pan/rotate
- validating ranges and preventing deformation

This lab is NOT for:
- VRMA integration
- behavior/personality system
- refactor of existing production avatar pipeline

## Timebox
Hard limit: 90 minutes.
If not complete, stop and report exactly what blocks progress.

## Strict File Scope
Allowed to create/edit ONLY:
1) `frontend/src/app/avatar-motion-lab/page.tsx` (new)
2) `frontend/src/components/avatar-lab/BoneLabCanvas.tsx` (new)
3) `frontend/src/components/avatar-lab/BoneControlPanel.tsx` (new)
4) `frontend/src/components/avatar-lab/types.ts` (new, optional)

Optional (only if required):
5) `frontend/src/config/avatar.ts` (read-only preferred; edit only to read existing URL helpers safely)

Do NOT edit:
- `frontend/src/app/avatar-agent/*`
- `frontend/src/ai/*`
- backend files
- package versions

## Exact Build Requirements
Implement a minimal page at route:
- `/avatar-motion-lab`

Features required:
0) Direction sanity pass (must be first):
   - Add colored 3D arrow helpers from shoulder-level origin (avatar chest/shoulder height) for:
     - Front, Back, Up, Down, Right, Left
   - Use fixed distinct colors (example):
     - Front=green, Back=red, Up=cyan, Down=orange, Right=blue, Left=magenta
   - Keep avatar oriented to face the camera at initial load.
   - Show a small on-screen legend mapping color -> direction.
   - STOP after implementing this and report: "Owner direction confirmation required"
   - Do not continue to later steps until owner confirms directions are correct.

1) Load VRM model using existing URL logic (same avatar source path policy).
2) Show avatar in R3F Canvas with OrbitControls:
   - `enableRotate=true`
   - `enableZoom=true`
   - `enablePan=true`
3) Bone selector dropdown with at least:
   - `head`, `neck`, `rightUpperArm`, `rightLowerArm`, `rightHand`, `leftUpperArm`, `leftLowerArm`, `leftHand`
4) Three sliders per selected bone:
   - rotation X/Y/Z in radians
   - live apply to selected bone
5) Reset button:
   - reset selected bone to bind pose rotation `(0,0,0)` relative local rotation
6) Safety clamp (required):
   - clamp each axis in range `[-1.2, 1.2]` rad before applying
7) Simple debug text panel:
   - selected bone name
   - current clamped x/y/z values
   - whether bone was found or missing

## Stability Rules (Non-Negotiable)
1) Keep event source safe:
   - parent div ref + pass as `eventSource` to Canvas to avoid null addEventListener regression.
2) Use `frameloop="always"` in this lab Canvas.
3) Do not mount extra nested canvases.
4) Do not import `VRMAPlayer` in lab.

## Validation Checklist (Must Pass)
1) `npx tsc --noEmit --skipLibCheck` passes in `frontend`.
2) Route `/avatar-motion-lab` opens without black screen.
3) Avatar is facing camera on initial load.
4) Direction arrows + legend visible and color-mapped correctly.
5) Owner confirms direction correctness before continuing.
6) Mouse can rotate/zoom/pan.
7) Changing slider visibly moves selected bone.
8) Reset works.
9) No runtime error: `Cannot read properties of null (reading 'addEventListener')`.

## Rollback Rule
If any regression appears in `/avatar-agent`:
1) revert only files touched in this task
2) stop immediately
3) report exact error

## Sonnet Output Format (5 lines only)
1) Files changed
2) TypeScript result
3) Lab route status (working/not working)
4) Evidence (camera + slider + no-null-addEventListener)
5) Next step for GPT (recommended Phase-2 lab enhancement, one line only)
