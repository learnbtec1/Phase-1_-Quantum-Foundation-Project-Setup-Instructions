#!/bin/sh
# Encoding: UTF-8, Unix line endings (LF) only. UTF-16/BOM can break the shebang on Linux.
# Manual / cron-friendly logical dump into /backups (install postgresql-client in the image).
# Environment (typical in Docker):
#   PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE  OR  DATABASE_URL
#   BACKUP_DIR  (default /backups)
#   BACKUP_RETAIN  (default 7)

set -eu

BACKUP_DIR="${BACKUP_DIR:-/backups}"
RETAIN="${BACKUP_RETAIN:-7}"
DATE="$(date +%F_%H-%M-%S)"
FILE="${BACKUP_DIR}/backup_${DATE}.sql"

if [ -n "${DATABASE_URL:-}" ]; then
  pg_dump "$DATABASE_URL" --no-owner --no-acl -F p -f "$FILE"
else
  : "${POSTGRES_USER:?}" "${POSTGRES_DB:?}"
  pg_dump -h "${PGHOST:-db}" -p "${PGPORT:-5432}" -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
    --no-owner --no-acl -F p -f "$FILE"
fi

echo "Backup created: $FILE"

# Keep only last RETAIN copies (oldest first after sort)
# shellcheck disable=SC2012
ls -1t "$BACKUP_DIR"/backup_*.sql 2>/dev/null | tail -n +"$((RETAIN + 1))" | while IFS= read -r f; do
  [ -n "$f" ] && [ -f "$f" ] && rm -f -- "$f" && echo "Removed old: $f"
done
