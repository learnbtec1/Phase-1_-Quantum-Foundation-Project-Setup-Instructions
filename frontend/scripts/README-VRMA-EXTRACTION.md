# VRMA Batch Extraction Scripts

## Overview
This folder contains scripts to extract bone rotation data from VRMA animation files and generate TypeScript constants for use in VRMSkeletonManager.

## Scripts

### 1. `extract-vrma-bones.mjs` (Single file extraction)
Extract rotation constants from a single VRMA file.

**Usage:**
```bash
# Basic extraction (50% through animation, default gesture name 'think')
node scripts/extract-vrma-bones.mjs public/models/animations/Thinking.vrma

# Specify gesture name
node scripts/extract-vrma-bones.mjs public/models/animations/Waving.vrma --gesture waving

# Sample at different point (0-100%)
node scripts/extract-vrma-bones.mjs public/models/animations/Pointing.vrma --frame-percent 75

# Average over more frames (smoother values)
node scripts/extract-vrma-bones.mjs public/models/animations/Jump.vrma --avg-window 10

# Write to file
node scripts/extract-vrma-bones.mjs public/models/animations/Clapping.vrma --out clapping-constants.ts
```

### 2. `extract-all-vrmas.mjs` (Batch extraction) ⭐ **RECOMMENDED**
Extract rotation constants from ALL VRMA files in the animations folder at once.

**Usage:**
```bash
# Extract all gestures (generates src/generatedGestures.ts)
node scripts/extract-all-vrmas.mjs

# Customize sampling
node scripts/extract-all-vrmas.mjs --frame-percent 60 --avg-window 7

# Custom output location
node scripts/extract-all-vrmas.mjs --out src/myGestures.ts
```

**Output:** `src/generatedGestures.ts` containing:
- TypeScript interface `GestureData`
- Object `GESTURE_CONSTANTS` with all gestures
- Individual constants for each gesture (ready to copy-paste)

## Generated Gestures

After running `extract-all-vrmas.mjs`, you'll have **40+ gestures** extracted:

### Emotional Expressions
- `ANGRY`, `BLUSH`, `SAD`, `SURPRISED`, `SLEEPY`, `RELAX`

### Hand Gestures
- `WAVING`, `CLAPPING`, `BECKONING`, `POINTING`, `ACKNOWLEDGING`, `AGREEING`

### Full-Body Movements
- `WALKING`, `JUMP`, `JUMP_HIGH`, `STOP_WALKING`, `STANDING_CHEERING`

### Sitting Poses
- `SITTING`, `SITTING_AND_POINTING`, `SITTING_AND_TALKING`, `SITTING_DISAPPROVAL`, `SITTING_TALKING`

### Idle Variations
- `IDLE1`, `IDLE2`, `IDLE3`, `IDLE4`

### Misc
- `THINKING` (→ `THINK`), `TYPING`, `GOODBYE`, `LOOK_AROUND`, `LOOK_AROUND2`, `PACING_AND_TALKING_ON_A_PHONE`

### Generic Motion Pack
- `VRMA_01` through `VRMA_07`

## How to Use Generated Constants

### Option 1: Import GESTURE_CONSTANTS object
```typescript
import { GESTURE_CONSTANTS } from './generatedGestures';

// Access all data
const wavingData = GESTURE_CONSTANTS.WAVING;
console.log(wavingData.rightUpperArm.x); // -1.0577
```

### Option 2: Copy individual constants to VRMSkeletonManager.tsx
```typescript
// 1. Open generatedGestures.ts
// 2. Find the gesture block (e.g., "// ─── WAVING gesture")
// 3. Copy all const declarations:
const WAVING_RUA_X = -1.0577;  // rightUpperArm pitch
const WAVING_RUA_Y =  0.5666;  // rightUpperArm yaw
const WAVING_RUA_Z =  0.7135;  // rightUpperArm roll
// ... etc

// 4. Paste into VRMSkeletonManager.tsx constants section
// 5. Add a case in the gesture switch:
} else if (g === 'waving') {
  const cal = (_calibrationRef.current?.gesture === 'waving') ? _calibrationRef.current.pose : null;
  slerpArmEuler(ruaRef.current, cal ? cal.ruaX : WAVING_RUA_X, cal ? cal.ruaY : WAVING_RUA_Y, cal ? cal.ruaZ : WAVING_RUA_Z, 1);
  slerpArmEuler(rlaRef.current, WAVING_RLA_X, 0, WAVING_RLA_Z, 1);
  slerpArmEuler(rhRef.current, WAVING_RH_X, WAVING_RH_Y, WAVING_RH_Z, 0.95);
  // ... implement left arm, shoulders, etc.
}
```

### Option 3: Fine-tune with GestureCalibrator
1. Load the gesture in your app
2. Open the GestureCalibrator UI (dev mode)
3. Adjust rotations in real-time
4. Export calibrated values
5. Replace constants in VRMSkeletonManager.tsx

## Bone Data Extracted

For each gesture, the script extracts rotation (Euler angles in radians, YXZ order) for:

### Arms
- `rightUpperArm` (x, y, z) / `leftUpperArm` (x, y, z)
- `rightLowerArm` (x, z) / `leftLowerArm` (x, z)
- `rightHand` (x, y, z) / `leftHand` (x, y, z)

### Body
- `hips` (x, y, z)
- `spine` (x, y, z)
- `chest` (x, y, z)

### Upper Body
- `rightShoulder` (x, y, z) / `leftShoulder` (x, y, z)
- `neck` (x, y, z)
- `head` (x, y, z)

## Adding New Gestures to VRMSkeletonManager

1. **Define the gesture type:**
```typescript
type GestureId = 'idle' | 'explain' | 'point' | 'think' | 'waving' | 'clapping'; // add new
```

2. **Add constants** (from generatedGestures.ts)

3. **Add switch case** in `useFrame`:
```typescript
} else if (g === 'waving') {
  // Implement arm movements using WAVING_* constants
}
```

4. **Dispatch gesture events:**
```typescript
window.dispatchEvent(new CustomEvent('avatar:gesture', { 
  detail: { gesture: 'waving', duration: 4000 } 
}));
```

## Sampling Strategy

- **frame-percent**: Where in the animation to sample (0-100%)
  - `0%` = Start pose (often T-pose or initial)
  - `50%` = Middle (default, usually peak of gesture) ✅ RECOMMENDED
  - `100%` = End pose (often return to rest)

- **avg-window**: Number of frames to average
  - `1` = Single frame (may be noisy)
  - `5` = Default (smooth, works well) ✅ RECOMMENDED
  - `10+` = Very smooth (may lose gesture peaks)

## Troubleshooting

### "No animations found"
- File may not contain VRMC_vrm_animation extension
- Try with a known-good VRMA file first

### "No rotation tracks found"
- File may only have position/scale data
- Check that bones are actually animated

### Values look wrong
- Try different `--frame-percent` (30%, 50%, 70%)
- Increase `--avg-window` for smoother values
- Use GestureCalibrator to fine-tune after extraction

## Performance Tips

- Run `extract-all-vrmas.mjs` once, not multiple times
- Generated file is ~3000 lines but tree-shakeable
- Only import what you need: `import { GESTURE_CONSTANTS } from './generatedGestures'`
- For production, copy only the constants you use to VRMSkeletonManager

## Next Steps

After extraction:
1. ✅ Review `src/generatedGestures.ts`
2. ✅ Pick gestures you want to implement
3. ✅ Copy constants to VRMSkeletonManager.tsx
4. ✅ Add switch cases for new gestures
5. ✅ Test in browser with gesture events
6. ✅ Fine-tune with GestureCalibrator if needed

---

**Generated:** 2026-04-07  
**Gestures extracted:** 40+  
**Time saved:** Hours of manual calibration ⚡
