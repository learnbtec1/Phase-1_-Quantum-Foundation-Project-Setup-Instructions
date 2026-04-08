# Example: Adding WAVING Gesture to VRMSkeletonManager

This guide shows how to add the `WAVING` gesture extracted from `Waving.vrma` to your avatar system.

## Step 1: Copy Constants from generatedGestures.ts

Open `src/generatedGestures.ts` and find the WAVING constants block (around line 2745):

```typescript
// ─── WAVING gesture (from Waving.vrma) ──────────────────────
const WAVING_RUA_X                        = -1.0577;  // rightUpperArm pitch
const WAVING_RUA_Y                        =  0.5666;  // rightUpperArm yaw
const WAVING_RUA_Z                        =  0.7135;  // rightUpperArm roll

const WAVING_LUA_X                        =  0.9125;  // leftUpperArm pitch
const WAVING_LUA_Y                        =  0.8743;  // leftUpperArm yaw
const WAVING_LUA_Z                        = -0.3997;  // leftUpperArm roll

const WAVING_RLA_X                        = -0.3740;  // rightLowerArm pitch
const WAVING_RLA_Z                        =  0.0000;  // rightLowerArm roll

const WAVING_LLA_X                        =  0.2581;  // leftLowerArm pitch
const WAVING_LLA_Z                        = -0.0000;  // leftLowerArm roll

const WAVING_RH_X                         = -0.0158;  // rightHand pitch
const WAVING_RH_Y                         = -0.1541;  // rightHand yaw
const WAVING_RH_Z                         = -0.5157;  // rightHand roll

const WAVING_LH_X                         = -0.0898;  // leftHand pitch
const WAVING_LH_Y                         = -0.1956;  // leftHand yaw
const WAVING_LH_Z                         =  0.3553;  // leftHand roll

const WAVING_RSHOULDER_X                  = -0.1763;  // rightShoulder pitch
const WAVING_RSHOULDER_Y                  =  1.7880;  // rightShoulder yaw
const WAVING_RSHOULDER_Z                  =  1.8644;  // rightShoulder roll

const WAVING_LSHOULDER_X                  =  0.1932;  // leftShoulder pitch
const WAVING_LSHOULDER_Y                  =  1.8013;  // leftShoulder yaw
const WAVING_LSHOULDER_Z                  = -1.7348;  // leftShoulder roll

const WAVING_NECK_X                       =  0.0504;  // neck pitch
const WAVING_NECK_Y                       =  0.0378;  // neck yaw
const WAVING_NECK_Z                       =  0.0167;  // neck roll

const WAVING_HEAD_X                       =  0.0479;  // head pitch
const WAVING_HEAD_Y                       = -0.0162;  // head yaw
const WAVING_HEAD_Z                       = -0.0143;  // head roll

const WAVING_HIPS_X                       =  0.0034;  // hips pitch
const WAVING_HIPS_Y                       = -0.0361;  // hips yaw
const WAVING_HIPS_Z                       = -0.0047;  // hips roll

const WAVING_SPINE_X                      = -0.0101;  // spine pitch
const WAVING_SPINE_Y                      = -0.1476;  // spine yaw
const WAVING_SPINE_Z                      =  0.0014;  // spine roll

const WAVING_CHEST_X                      = -0.0150;  // chest pitch
const WAVING_CHEST_Y                      =  0.0257;  // chest yaw
const WAVING_CHEST_Z                      =  0.0003;  // chest roll
```

## Step 2: Add to VRMSkeletonManager.tsx Constants Section

Paste the constants after the existing gesture blocks (around line 170):

```typescript
// ═══════════════════════════════════════════════════════════════════════════════
//  WAVING gesture (from Waving.vrma)
// ═══════════════════════════════════════════════════════════════════════════════
const WAVING_RUA_X                        = -1.0577;
const WAVING_RUA_Y                        =  0.5666;
const WAVING_RUA_Z                        =  0.7135;

const WAVING_LUA_X                        =  0.9125;
const WAVING_LUA_Y                        =  0.8743;
const WAVING_LUA_Z                        = -0.3997;

const WAVING_RLA_X                        = -0.3740;
const WAVING_RLA_Z                        =  0.0000;

const WAVING_LLA_X                        =  0.2581;
const WAVING_LLA_Z                        = -0.0000;

const WAVING_RH_X                         = -0.0158;
const WAVING_RH_Y                         = -0.1541;
const WAVING_RH_Z                         = -0.5157;

const WAVING_LH_X                         = -0.0898;
const WAVING_LH_Y                         = -0.1956;
const WAVING_LH_Z                         =  0.3553;

const WAVING_RSHOULDER_X                  = -0.1763;
const WAVING_RSHOULDER_Y                  =  1.7880;
const WAVING_RSHOULDER_Z                  =  1.8644;

const WAVING_LSHOULDER_X                  =  0.1932;
const WAVING_LSHOULDER_Y                  =  1.8013;
const WAVING_LSHOULDER_Z                  = -1.7348;

const WAVING_NECK_X                       =  0.0504;
const WAVING_NECK_Y                       =  0.0378;
const WAVING_NECK_Z                       =  0.0167;

const WAVING_HEAD_X                       =  0.0479;
const WAVING_HEAD_Y                       = -0.0162;
const WAVING_HEAD_Z                       = -0.0143;

const WAVING_HIPS_X                       =  0.0034;
const WAVING_HIPS_Y                       = -0.0361;
const WAVING_HIPS_Z                       = -0.0047;

const WAVING_SPINE_X                      = -0.0101;
const WAVING_SPINE_Y                      = -0.1476;
const WAVING_SPINE_Z                      =  0.0014;

const WAVING_CHEST_X                      = -0.0150;
const WAVING_CHEST_Y                      =  0.0257;
const WAVING_CHEST_Z                      =  0.0003;

// Optional: micro-motion parameters for waving
const WAVING_MICRO_FREQ                   =  2.5;   // faster waving motion
const WAVING_MICRO_AMP                    =  0.08;  // larger amplitude
```

## Step 3: Update GestureId Type

Find the `GestureId` type (around line 279):

```typescript
type GestureId = 'idle' | 'explain' | 'point' | 'think' | 'waving';  // add 'waving'
```

## Step 4: Add Switch Case in useFrame

Find the gesture switch statement (around line 1220) and add AFTER the `think` block:

```typescript
    } else if (g === 'waving') {
      const cal = (_calibrationRef.current?.gesture === 'waving') ? _calibrationRef.current.pose : null;
      
      // Micro-motion for animated waving
      const micro = (
        Math.sin(t * WAVING_MICRO_FREQ) * BIO_ORG_SINE +
        noiseArm(t * BIO_ORG_NOISE_SPD, 9.1, 0) * BIO_ORG_NOISE
      ) * WAVING_MICRO_AMP * gArm * gestureAmp;

      // Right arm (waving hand)
      slerpArmEuler(
        ruaRef.current,
        cal ? cal.ruaX : WAVING_RUA_X + micro * 1.2,
        cal ? cal.ruaY : WAVING_RUA_Y,
        cal ? cal.ruaZ : WAVING_RUA_Z,
        1.1 * gArm + 0.08,
      );
      slerpArmEuler(
        rlaRef.current,
        WAVING_RLA_X + micro * 0.3,
        0,
        cal ? cal.rlaZ : WAVING_RLA_Z,
        1 * gArm + 0.08,
      );
      slerpArmEuler(
        rhRef.current,
        WAVING_RH_X + wristJitterX * 0.5,
        WAVING_RH_Y + micro * 0.15,  // wrist rotates during wave
        WAVING_RH_Z + wristJitterZ * 0.5,
        0.9 * gArm + 0.08,
      );

      // Left arm (resting)
      slerpArmEuler(
        luaRef.current,
        cal ? cal.luaX : WAVING_LUA_X,
        cal ? cal.luaY : WAVING_LUA_Y,
        cal ? cal.luaZ : WAVING_LUA_Z,
        0.4,
      );
      slerpArmEuler(
        llaRef.current,
        WAVING_LLA_X,
        0,
        cal ? cal.llaZ : WAVING_LLA_Z,
        0.4,
      );
      slerpArmEuler(
        lhRef.current,
        WAVING_LH_X,
        WAVING_LH_Y,
        WAVING_LH_Z,
        0.35,
      );

      // Shoulders
      slerpBoneFromBind(
        rightShoulderRef.current,
        'rightShoulder',
        WAVING_RSHOULDER_X * gBlend,
        WAVING_RSHOULDER_Y * gBlend,
        WAVING_RSHOULDER_Z * gBlend,
        5,
      );
      slerpBoneFromBind(
        leftShoulderRef.current,
        'leftShoulder',
        WAVING_LSHOULDER_X * gBlend,
        WAVING_LSHOULDER_Y * gBlend,
        WAVING_LSHOULDER_Z * gBlend,
        5,
      );

      // Torso
      slerpBoneFromBind(
        hipsRef.current,
        'hips',
        WAVING_HIPS_X * gBlend,
        WAVING_HIPS_Y * gBlend,
        WAVING_HIPS_Z * gBlend,
        4,
      );
      slerpBoneFromBind(
        spineRef.current,
        'spine',
        WAVING_SPINE_X * gBlend,
        WAVING_SPINE_Y * gBlend,
        WAVING_SPINE_Z * gBlend,
        5,
      );
      slerpBoneFromBind(
        chestRef.current,
        'chest',
        WAVING_CHEST_X * gBlend,
        WAVING_CHEST_Y * gBlend,
        WAVING_CHEST_Z * gBlend,
        5,
      );

    } else {
      // idle case continues...
```

## Step 5: Add Neck/Head Support (Optional)

If you want the avatar to turn head while waving, add to the neck/head section (around line 890):

```typescript
    // ─── VRMA neck / head offsets during gestures ────────────────────────────
    const thinkNkX = g === 'think' ? THINK_NECK_X * gBlend : 0;
    const thinkNkY = g === 'think' ? THINK_NECK_Y * gBlend : 0;
    const thinkNkZ = g === 'think' ? THINK_NECK_Z * gBlend : 0;
    const thinkHdX = g === 'think' ? THINK_HEAD_X * gBlend : 0;
    const thinkHdY = g === 'think' ? THINK_HEAD_Y * gBlend : 0;
    const thinkHdZ = g === 'think' ? THINK_HEAD_Z * gBlend : 0;

    // Waving head offset
    const wavingNkX = g === 'waving' ? WAVING_NECK_X * gBlend : 0;
    const wavingNkY = g === 'waving' ? WAVING_NECK_Y * gBlend : 0;
    const wavingNkZ = g === 'waving' ? WAVING_NECK_Z * gBlend : 0;
    const wavingHdX = g === 'waving' ? WAVING_HEAD_X * gBlend : 0;
    const wavingHdY = g === 'waving' ? WAVING_HEAD_Y * gBlend : 0;
    const wavingHdZ = g === 'waving' ? WAVING_HEAD_Z * gBlend : 0;
```

Then update neck/head Euler:

```typescript
      SK_E.set(
        nx * NECK_SWAY_MUL + gPitch * 0.48 + thinkNkX + wavingNkX + listenHeadPitch * 0.55 + nodPitch * 0.6,
        ny * NECK_SWAY_MUL + gYaw * 0.48 + thinkNkY + wavingNkY,
        nz * NECK_SWAY_MUL + thinkNkZ + wavingNkZ + listenHeadTilt * 0.55,
        'YXZ',
      );
```

```typescript
      SK_E.set(
        nx * 1.05 + gPitch * 0.62 + thinkHdX + wavingHdX + listenHeadPitch * 0.45 + nodPitch,
        ny * 1.05 + gYaw * 0.62 + thinkHdY + wavingHdY,
        nz + thinkHdZ + wavingHdZ + listenHeadTilt * 0.45,
        'YXZ',
      );
```

## Step 6: Test the Gesture

Open browser console on `/avatar-agent` page and trigger:

```javascript
window.dispatchEvent(new CustomEvent('avatar:gesture', { 
  detail: { gesture: 'waving', duration: 4000 } 
}));
```

Or from AgentDirector/behavior code:

```typescript
this.setGesture('waving', 4000);
```

## Step 7: Fine-Tune (Optional)

If the gesture doesn't look perfect:

1. Open GestureCalibrator UI (if enabled)
2. Select "waving" gesture
3. Adjust sliders in real-time
4. Copy new values from calibrator
5. Update constants in VRMSkeletonManager.tsx

## Tips

### For Fast Waving:
```typescript
const WAVING_MICRO_FREQ = 3.5;   // faster oscillation
const WAVING_MICRO_AMP  = 0.12;  // bigger movement
```

### For Slow Friendly Wave:
```typescript
const WAVING_MICRO_FREQ = 1.8;   // slower oscillation
const WAVING_MICRO_AMP  = 0.06;  // subtle movement
```

### Add Finger Curl (from THINK example):
```typescript
const wavingFingerBlend = gBlend;
slerpFingerCurl(rIndexProximalRef.current,  'rIndexProximal',  0.1 * wavingFingerBlend, FINGER_SLERP_SPEED);
slerpFingerCurl(rMiddleProximalRef.current, 'rMiddleProximal', 0.15 * wavingFingerBlend, FINGER_SLERP_SPEED);
slerpFingerCurl(rRingProximalRef.current,   'rRingProximal',   0.2 * wavingFingerBlend, FINGER_SLERP_SPEED);
slerpFingerCurl(rLittleProximalRef.current, 'rLittleProximal', 0.25 * wavingFingerBlend, FINGER_SLERP_SPEED);
slerpFingerCurl(rThumbProximalRef.current,  'rThumbProximal',  0.15 * wavingFingerBlend, FINGER_SLERP_SPEED);
```

## Done! 🎉

You now have a working `waving` gesture. Repeat this process for other gestures like:
- `clapping`
- `jumping`
- `walking`
- `sitting`
- etc.

All constants are already extracted in `generatedGestures.ts` — just copy, paste, and implement!
