#!/usr/bin/env bash
# One-shot host metrics + TTS observability snapshot (optional Bearer).
set -u

BASE="${TTS_BASE_URL:-http://localhost:8000}"
TOKEN="${TTS_LOAD_TEST_TOKEN:-}"
if [[ -z "${TOKEN}" && -n "${LOAD_TEST_TOKENS:-}" ]]; then
  TOKEN="${LOAD_TEST_TOKENS%%,*}"
fi

echo "=== Docker stats (single snapshot) ==="
if command -v docker >/dev/null 2>&1; then
  docker stats --no-stream || true
else
  echo "(docker not in PATH — skipped)"
fi

echo ""
echo "=== TTS observability ==="
echo "GET ${BASE}/api/v1/tts-observability"
if [[ -n "${TOKEN}" ]]; then
  curl -sS "${BASE}/api/v1/tts-observability" \
    -H "Authorization: Bearer ${TOKEN}"
else
  echo "(no Bearer: set TTS_LOAD_TEST_TOKEN or LOAD_TEST_TOKENS — trying unauthenticated; expect 401 if bypass auth is off)"
  curl -sS "${BASE}/api/v1/tts-observability" || true
fi
echo ""
