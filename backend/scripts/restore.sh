#!/bin/sh
# Encoding: UTF-8, Unix line endings (LF) only. UTF-16/BOM can break the shebang on Linux.
# Restore a plain SQL dump into the target database (destructive — replaces objects per dump content).
# Usage: restore.sh /backups/backup_2026-01-01.sql
# Environment: same as backup.sh (DATABASE_URL or PG* + PGPASSWORD)

set -eu

FILE="${1:-}"
if [ -z "$FILE" ]; then
  echo "Usage: restore.sh <backup_file.sql>" >&2
  exit 1
fi
if [ ! -f "$FILE" ]; then
  echo "File not found: $FILE" >&2
  exit 1
fi

if [ -n "${DATABASE_URL:-}" ]; then
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$FILE"
else
  : "${POSTGRES_USER:?}" "${POSTGRES_DB:?}"
  export PGPASSWORD="${POSTGRES_PASSWORD:-$PGPASSWORD}"
  psql -h "${PGHOST:-db}" -p "${PGPORT:-5432}" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -f "$FILE"
fi

echo "Restored from: $FILE"
