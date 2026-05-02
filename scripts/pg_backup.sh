#!/bin/sh
# Encoding: UTF-8, Unix line endings (LF) only. Saving as UTF-16/UTF-8-BOM breaks the shebang in Linux/Docker.
# Daily PostgreSQL logical backup into /backups (Docker volume).
# Env: PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE (set by docker-compose).
# Restore (example): psql -h db -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f /backups/backup_YYYY-MM-DD.sql

set -eu

BACKUP_DIR="${BACKUP_DIR:-/backups}"
RETAIN="${BACKUP_RETAIN:-7}"
SLEEP_SEC="${BACKUP_INTERVAL_SEC:-86400}"

run_once() {
  DATE="$(date +%F)"
  OUT="${BACKUP_DIR}/backup_${DATE}.sql"
  echo "[pg_backup] $(date -Iseconds 2>/dev/null || date) starting -> ${OUT}"
  if ! pg_dump -h "${PGHOST:-db}" -p "${PGPORT:-5432}" -U "${PGUSER}" -d "${PGDATABASE}" \
    --no-owner --no-acl -F p -f "$OUT"; then
    echo "[pg_backup] pg_dump failed"
    return 1
  fi
  # Retention: list newest first, drop from file (RETAIN+1) onward
  n=$((RETAIN + 1))
  ls -1t "$BACKUP_DIR"/backup_*.sql 2>/dev/null | tail -n +"$n" | while IFS= read -r f; do
    [ -n "$f" ] && [ -f "$f" ] && rm -f "$f" && echo "[pg_backup] removed old: $f"
  done
  echo "[pg_backup] done. $(du -h "$OUT" 2>/dev/null | cut -f1) ${OUT}"
}

wait_for_db() {
  i=0
  while [ "$i" -lt 60 ]; do
    if pg_isready -h "${PGHOST:-db}" -p "${PGPORT:-5432}" -U "${PGUSER}" -d "${PGDATABASE}" -q; then
      return 0
    fi
    i=$((i + 1))
    sleep 2
  done
  echo "[pg_backup] ERROR: database not ready"
  return 1
}

wait_for_db || exit 1

# First backup soon after start, then every BACKUP_INTERVAL_SEC (default 24h)
while true; do
  if ! run_once; then
    echo "[pg_backup] run failed, will retry after sleep"
  fi
  echo "[pg_backup] sleeping ${SLEEP_SEC}s"
  sleep "$SLEEP_SEC"
done
