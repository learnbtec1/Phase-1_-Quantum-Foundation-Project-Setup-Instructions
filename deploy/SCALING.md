# Horizontal scaling (Phase C)

## Docker Compose

Scale API workers:

```bash
docker compose up -d --scale backend=2
```

Place an external load balancer (or `nginx` from `deploy/nginx.conf`) in front of the published backend port so traffic is split across instances. WebSocket clients should use the same host; enable **sticky sessions** at the load balancer if you observe reconnect churn (optional — Cogni lesson/emotional state is also stored in **Redis** under `user:{user_id}:cogni_state` when `REDIS_URL` is set).

## Docker Swarm (outline)

1. `docker swarm init`
2. Build and push images to a registry.
3. Create a stack file from `docker-compose.yml` (use `deploy.replicas` for `backend`).
4. Attach an ingress **routing mesh** or external LB to published ports; terminate TLS at ingress or at `nginx`.

## Kubernetes (outline)

- **Deployment** for `backend` with `replicas: 2+`, **Service** (ClusterIP) and **Ingress** (TLS).
- **StatefulSet** or managed DB for PostgreSQL; **Redis** as a single instance or Redis Cluster for HA.
- Configure `REDIS_URL` and `DATABASE_URL` via **Secrets**.

## Health checks

- Backend: `GET /api/health` — includes `redis: true/false` when Redis is configured.
- Database and Redis health are defined in `docker-compose.yml` for local stacks.
