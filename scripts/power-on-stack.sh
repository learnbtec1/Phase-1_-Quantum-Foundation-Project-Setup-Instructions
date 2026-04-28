#!/usr/bin/env bash
# PHASE 14 — Prune dead containers, rebuild backend (edge-tts), start stack detached.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
clear || true
echo "PHASE 14: container prune + rebuild backend/avatar_brain + up -d --build"
docker container prune -f
docker compose build --no-cache backend avatar_brain
docker compose up -d --build
echo ""
echo "Post-start TTS check (inside backend):"
echo '  docker exec eduverse_backend python -c "import edge_tts; print('\''Audio Engine: READY'\'')"'
