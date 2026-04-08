# -*- coding: utf-8 -*-
"""
API v1 dependency helpers.

- Auth: prefer ``app.api.deps``; ``dependencies.auth`` re-exports the same symbols for compatibility.
- Rate/LLM gates: ``phase2_gates`` (wraps ``get_current_user`` from ``app.api.deps``).
"""
