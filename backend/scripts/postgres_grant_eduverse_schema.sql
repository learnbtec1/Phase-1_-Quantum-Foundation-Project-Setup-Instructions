-- Run as superuser against the application database (default: eduverse).
--   docker compose exec -T db psql -U OLD_USER -d eduverse < backend/scripts/postgres_grant_eduverse_schema.sql

GRANT ALL ON SCHEMA public TO eduverse;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO eduverse;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO eduverse;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO eduverse;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO eduverse;
