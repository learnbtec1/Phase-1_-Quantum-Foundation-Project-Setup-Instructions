#!/usr/bin/env sh
# Promote designated platform admin email (see backend/app/crud/user.py EDUVERSE_PLATFORM_ADMIN_EMAIL).
set -eu
docker exec eduvor-backend python scripts/ensure_eduverse_platform_admin.py
