# Eduverse (eduverse-1)

## Emergency dev login (“Golden Ticket”)

Use **only on localhost / trusted dev machines**. Never enable `AUTH_DEV_BYPASS` on production APIs.

Templates with matching values: **`backend/.env.example`** → copy to **`backend/.env`**; **`frontend/.env.example`** → copy to **`frontend/.env`** (or `.env.local`).

1. **Backend** (`backend/.env` or Compose `env_file`), match token and user id:

```env
AUTH_DEV_BYPASS=true
AUTH_DEV_STATIC_TOKEN=test-token-123
AUTH_DEV_STATIC_USER_ID=1
```

Ensure user `AUTH_DEV_STATIC_USER_ID` exists (e.g. register once, then promote admin — see below).

2. **Frontend** (`frontend/.env` baked at image build for Docker):

```env
NEXT_PUBLIC_AUTH_DEV_INJECT=true
NEXT_PUBLIC_DEV_TOKEN=test-token-123
NEXT_PUBLIC_AUTH_DEV_REDIRECT=/avatar-agent
```
(Legacy alias: `NEXT_PUBLIC_DEV_AUTH_TOKEN` — same effect if `NEXT_PUBLIC_DEV_TOKEN` is unset.)

Rebuild frontend after changing `NEXT_PUBLIC_*`.

3. Open `/login`. The app injects the opaque token into `localStorage` + `eduvor_token` cookie and redirects (default `/avatar-agent`).

---

## Database seed / admin promotion

There is **no** `initial_data.py` in this repo. Use:

| Script | Purpose |
|--------|---------|
| `backend/scripts/ensure_eduverse_platform_admin.py` | Sets `role=admin` for the fixed platform email (`admin@eduversejo.com` in `app/crud/user.py`). Does **not** create users — register that email first. |

**Exact command (Compose container name `eduvor-backend`, working directory `/app`):**

```bash
docker exec eduvor-backend python scripts/ensure_eduverse_platform_admin.py
```

If `PYTHONPATH` issues appear, run as module from `/app` (WORKDIR is already `/app` in `backend/Dockerfile`):

```bash
docker exec -w /app eduvor-backend python scripts/ensure_eduverse_platform_admin.py
```

---

## Backend layout notes

- Application package: `backend/app/` → imports use `from app....`.
- Docker image `WORKDIR`: `/app` with project files copied from `./backend`, so `python scripts/....py` runs correctly inside the container.
