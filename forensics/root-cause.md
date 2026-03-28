# Root Cause Analysis (Phase 5)

Date: 2026-03-28
Branch: hotfix/avatar-floor-lock-v1

## Incident

Avatar exhibited two coupled failures:
- sinking below room/carpet floor,
- lower-body/feet instability and deformation under repeated correction cycles.

## Root Cause

### 1) Late write on root transform (core defect)
A late-frame Y write on the avatar root/container path could override floor-calibrated intent after foot measurement.

Effect:
- floor calibration computed a valid correction,
- then a later root Y assignment reintroduced vertical drift,
- drift accumulated into visible sub-floor sinking.

### 2) IK deformation cascade (secondary effect)
When root drifted far enough, IK/pose compensation attempted aggressive recovery from invalid vertical state.

Effect:
- repeated over-correction in legs/feet,
- unstable posture and occasional twisted/inverted-looking lower body.

### 3) Event spam amplifier (walk zero-distance)
Walk events with near-zero/zero distance still entered motion path in previous runtime build, causing repeated no-op/short-step transitions and noise.

Effect:
- avoidable motion churn and log spam,
- additional pressure on pose stabilization loop.

## Why LIFT_NODE Solves It

LIFT_NODE (`LIFT_NODE_V121`) separates concerns:
- navigation/root intent remains on container level,
- floor calibration correction is applied on a dedicated intermediate node,
- late root writes no longer directly cancel floor-lock correction path.

This architectural decoupling prevents the same transform channel from handling both navigation and floor calibration in conflicting order.

## Stabilizers Added Around LIFT_NODE

- Drift watchdog: periodic correction when measured drift exceeds tolerance.
- Standing Y guard (V122): one-way clamp preventing sub-floor sink in standing/walk branch.
- Min-walk guard: explicit zero/short walk inputs are rejected under threshold.

## Runtime Confirmation

- LIFT_NODE active at runtime (`liftNodeName = LIFT_NODE_V121`).
- Zero-distance walk suppression confirmed (`ignoredCount = 5`, `acceptedCount = 0` for 5 injected zero-distance events).
- Drift correction loop active via V121 watchdog console markers.

## Conclusion

Primary failure was transform-order conflict (late root Y write) causing floor-lock drift.
LIFT_NODE resolved the architectural conflict; watchdog + standing clamp + walk-min guard completed stability hardening.
