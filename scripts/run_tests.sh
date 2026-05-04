#!/usr/bin/env bash
# Full TTS load pipeline: lightweight httpx batch, then Locust headless.
# Optional: export LOAD_TEST_TOKENS='jwt1,jwt2,...' (comma-separated) to spread per-user rate limits.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PYTHON="${PYTHON:-python}"
LOCUST_HOST="${LOCUST_HOST:-http://localhost:8000}"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " Stage 1 — httpx async load test"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
"${PYTHON}" scripts/load_test_tts.py --concurrency 10 --requests 50

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " Stage 2 — Locust (headless)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
"${PYTHON}" -m locust -f scripts/locustfile.py \
  --headless \
  -u 20 \
  -r 5 \
  --run-time 1m \
  --host "${LOCUST_HOST}"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " All stages finished."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
