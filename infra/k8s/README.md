# Kubernetes deploy (k3d/k3s) — lumin-studio

Deploys lumin-studio to the home **k3d cluster `luminstudio`** (single-node k3s on WSL2), namespace
**`prod`**. Chosen over the compose path (`infra/docker-compose.yml`) because `*.luminstudio.vn`
already routes to this cluster's traefik. All-home, accept-downtime (ADR-009).

**Routing:** Cloudflare (TLS) → tunnel → k3d serverlb `:80` → **traefik** → Ingress (by Host):
`www.luminstudio.vn`→storefront · `admin.luminstudio.vn`→admin · `api.luminstudio.vn`→core-api.
Ingress uses `entrypoints: web` (HTTP) — TLS is Cloudflare's, so no cert-manager.

**Images:** built on the box and `k3d image import`ed (no registry) with `imagePullPolicy: IfNotPresent`.

## In this pass (web stack)

postgres · nats · core-api · storefront · admin · migrate Job · ingress. **Deferred fast-follows:**
garage/S3 (uploads fail closed until then — core-api still boots) and the GPU asset-worker.

## Deploy runbook (on the box)

```sh
export KUBECONFIG=~/.config/k3d/kubeconfig-luminstudio.yaml
cd ~/lumin-studio                       # a clone of huongnguyenduc/lumin-studio on this branch

# 1. Build + import images (amd64, on the box). storefront needs a LIVE core-api → built in step 6.
docker build -f services/core-api/Dockerfile      -t lumin-core-api:prod services/core-api
docker build -f infra/k8s/migrate.Dockerfile      -t lumin-migrate:prod  .
docker build -f apps/admin/Dockerfile             -t lumin-admin:prod    .
for i in lumin-core-api lumin-migrate lumin-admin; do k3d image import $i:prod -c luminstudio; done

# 2. Secret (values from `openssl rand -hex 32`, all JWT secrets DISTINCT) — see secret.example.yaml.
#    (create lumin-secrets in the prod namespace)

# 3. Infra + migrate + core-api
kubectl apply -f infra/k8s/postgres.yaml -f infra/k8s/nats.yaml
kubectl -n prod rollout status deploy/postgres deploy/nats
kubectl apply -f infra/k8s/migrate-job.yaml && kubectl -n prod wait --for=condition=complete job/migrate --timeout=180s
kubectl apply -f infra/k8s/core-api.yaml && kubectl -n prod rollout status deploy/core-api

# 4. storefront: build against the live core-api (port-forward), import, deploy
kubectl -n prod port-forward svc/core-api 8080:8080 &
docker build --network=host \
  --build-arg SITE_URL=https://www.luminstudio.vn \
  --build-arg CORE_API_URL=http://localhost:8080 \
  -f apps/storefront/Dockerfile -t lumin-storefront:prod .
k3d image import lumin-storefront:prod -c luminstudio
kubectl apply -f infra/k8s/storefront.yaml -f infra/k8s/admin.yaml
kubectl -n prod rollout status deploy/storefront deploy/admin

# 5. Ingress
kubectl apply -f infra/k8s/ingress.yaml
```

Redeploy after a code change = rebuild the affected image → `k3d image import` → `kubectl -n prod
rollout restart deploy/<name>`. Rollback = rebuild a prior git SHA.
