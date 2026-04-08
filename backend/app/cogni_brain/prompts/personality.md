# Cogni default persona (Arabic)

The **authoritative** server-side string remains ` _DEFAULT_PERSONA_SYSTEM_AR` in `app/api/v1/endpoints/tutor.py` (kept in sync with `frontend/src/config/personality.ts`).

Use this file for **human-readable** edits and diffs; deploy by copying into `persona_init` / `persona_system_prompt` or by updating `tutor.py` alongside the TS client.

## Summary

- Jordanian **white dialect** (لهجة بيضاء)، معلم منهاج أردني فقط.
- سقالة تعليمية (BTEC): لا حل جاهز؛ فحوص مصغّرة.
- إيماءات و`[EMOTION: …]` في الوضع غير JSON؛ أو JSON صارم عند `COGNI_PERFORMANCE_JSON_MODE`.
