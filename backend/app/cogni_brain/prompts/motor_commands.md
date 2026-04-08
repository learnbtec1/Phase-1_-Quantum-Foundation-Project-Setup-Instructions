# Motor command schema (LLM → avatar)

Optional `motor_commands` object may include:

- `speed_multiplier` — 0.7–1.3 (idle procedural / VRMA timeScale).
- `breathing_rate` — ~0.5–1.5 multiplier on procedural sine breathing (web client).
- `eye_contact_intensity` — 0.3–1.2 (1 = follow cursor / low saccade noise).
- `gaze_target` — `user` | `screen_code` | `thinking_away`.
- `facial_expression` — `neutral` | `empathetic_smile` | `concerned` | `proud_smile` | `thinking_hard` (mapped to emotion / blendshapes on client).
- `primary_gesture` — semantic label; see `gesture_library.json`.

Psychological JSON may also include `psychological_analysis.avatar_energy_level` (0.1–1.5) → merged into `speed_multiplier` on the server.
