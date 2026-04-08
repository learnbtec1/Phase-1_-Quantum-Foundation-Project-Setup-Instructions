-- Add Postgres role `eduverse` when the data directory was first initialized
-- with another POSTGRES_USER (e.g. nexus). Env vars do NOT re-run init on an existing volume.
--
-- Usage (replace OLD_USER with the superuser that actually exists: often `nexus` or `postgres`):
--   bash:  docker compose exec -T db psql -U OLD_USER -d postgres < backend/scripts/postgres_add_eduverse_role.sql
--   PowerShell: Get-Content -Raw backend/scripts/postgres_add_eduverse_role.sql | docker compose exec -T db psql -U OLD_USER -d postgres
--
-- Then connect to your app DB (default name: eduverse) and fix schema privileges:
--   bash:  docker compose exec -T db psql -U OLD_USER -d eduverse < backend/scripts/postgres_grant_eduverse_schema.sql
--   PowerShell: Get-Content -Raw backend/scripts/postgres_grant_eduverse_schema.sql | docker compose exec -T db psql -U OLD_USER -d eduverse
--
-- Password below must match POSTGRES_PASSWORD in project root `.env` (default in compose: eduverse).

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'eduverse') THEN
    CREATE ROLE eduverse WITH LOGIN PASSWORD 'eduverse';
  END IF;
END
$$;

-- Do not GRANT ON DATABASE here: on old clusters the DB may be named `nexus` only and
-- `eduverse` does not exist yet. Create the database first (see run_postgres_eduverse_fix.ps1
-- or postgres_create_eduverse_database.sql), then run postgres_grant_eduverse_schema.sql.
