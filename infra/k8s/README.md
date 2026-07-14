# Kubernetes deploy (k3d/k3s) — lumin-studio

Deploys lumin-studio to the home **k3d cluster `luminstudio`** (single-node k3s on WSL2), namespace
**`prod`**. Chosen over the compose path (`infra/docker-compose.yml`) because `*.luminstudio.vn`
already routes to this cluster's traefik. All-home, accept-downtime (ADR-009).

**Routing:** Cloudflare (TLS) → tunnel → k3d serverlb `:80` → **traefik** → Ingress (by Host):
`www.luminstudio.vn`→storefront · `admin.luminstudio.vn`→admin · `api.luminstudio.vn`→core-api.
Ingress uses `entrypoints: web` (HTTP) — TLS is Cloudflare's, so no cert-manager.

**Images:** built on the box and `k3d image import`ed (no registry) with `imagePullPolicy: IfNotPresent`.

## In this pass

**Web stack:** postgres · nats · core-api · storefront · admin · migrate Job · ingress.
**Storage + render:** garage (S3, `garage.yaml`) · asset-worker (GPU, `asset-worker.yaml`). Uploads stay
fail-closed until the Garage bootstrap below runs (buckets + keys); core-api boots regardless. The
asset-worker needs a GPU-schedulable node (see below) — apply it last, on its own.

## Deploy runbook (on the box)

```sh
export KUBECONFIG=~/.config/k3d/kubeconfig-luminstudio.yaml
cd ~/lumin-studio                       # a clone of huongnguyenduc/lumin-studio on this branch

# 1. Build + import images (amd64, on the box). storefront needs a LIVE core-api → built in step 6.
docker build -f services/core-api/Dockerfile      -t lumin-core-api:prod services/core-api
docker build -f infra/k8s/migrate.Dockerfile      -t lumin-migrate:prod  services/core-api/db/migrations
docker build --network=host -f apps/admin/Dockerfile -t lumin-admin:prod .   # --network=host: next/font fetches Google Fonts at build (the docker bridge can't reach it)
for i in lumin-core-api lumin-migrate lumin-admin; do k3d image import $i:prod -c luminstudio; done

# 2. Secret (values from `openssl rand -hex 32`, all JWT secrets DISTINCT) — see secret.example.yaml.
#    (create lumin-secrets in the prod namespace)

# 3. Infra + migrate + core-api  (garage joins the stateful infra; bootstrap it once, see below)
kubectl apply -f infra/k8s/postgres.yaml -f infra/k8s/nats.yaml -f infra/k8s/garage.yaml
kubectl -n prod rollout status deploy/postgres deploy/nats deploy/garage
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

# 5. Ingress (also routes s3.luminstudio.vn → garage; add that hostname to the Cloudflare tunnel + DNS)
kubectl apply -f infra/k8s/ingress.yaml

# 6. Garage bootstrap (once) — see "Garage — bootstrap" below, then roll core-api so it picks up creds
kubectl -n prod rollout restart deploy/core-api

# 7. asset-worker — ONLY on a GPU-schedulable node (see "asset-worker — GPU prerequisite")
docker build -t lumin-asset-worker:prod services/asset-worker && k3d image import lumin-asset-worker:prod -c luminstudio
kubectl apply -f infra/k8s/asset-worker.yaml && kubectl -n prod rollout status deploy/asset-worker
```

Redeploy after a code change = rebuild the affected image → `k3d image import` → `kubectl -n prod
rollout restart deploy/<name>`. Rollback = rebuild a prior git SHA.

## Garage — bootstrap (once, after the first `garage.yaml` apply)

A fresh Garage node reports healthy but 503s every write until a layout is applied — then it needs the
two buckets + two S3 keys core-api expects. Run inside the pod (`G() { kubectl -n prod exec deploy/garage -- /garage "$@"; }`):

```sh
# Layout: assign capacity to the single node (grab its id from status first).
G status                                    # copy the node id
G layout assign -z home -c 20G <NODE_ID>
G layout apply --version 1

# Buckets: public catalog assets (models/sprites/pet photos) + private receipts.
G bucket create lumin-assets
G bucket create lumin-payment-proofs

# Keys: one per bucket. Each `key create` prints a Key ID + Secret — put them in lumin-secrets as
# ASSETS_ACCESS_KEY_ID/ASSETS_SECRET_ACCESS_KEY and PAYMENT_PROOF_ACCESS_KEY_ID/…_SECRET_ACCESS_KEY.
G key create lumin-assets-key
G key create lumin-proof-key
G bucket allow --read --write lumin-assets           --key lumin-assets-key
G bucket allow --read --write lumin-payment-proofs   --key lumin-proof-key
```

Two more settings, per the Garage v1.0 docs (exact subcommands vary by version — check `G bucket --help`):

- **Public read on `lumin-assets`** — models/sprites/pet photos are served by anonymous GET through
  Cloudflare. `lumin-payment-proofs` stays private (keyed access only; PDPL receipts).
- **CORS on both buckets** — allow the browser to presign-POST cross-origin: origins
  `https://www.luminstudio.vn` + `https://admin.luminstudio.vn`, methods GET/PUT/POST, the `x-amz-*`
  - `Content-Type` headers.

Then create the secret keys and `kubectl -n prod rollout restart deploy/core-api` so the stores pick
them up (an empty pair keeps that upload path fail-closed — the server still boots).

## asset-worker — GPU prerequisite

`asset-worker.yaml` requests `nvidia.com/gpu: 1` and `runtimeClassName: nvidia`; without a GPU it stays
**Pending** (the honest signal — nothing else is affected). The node needs, once:

- the **NVIDIA Container Toolkit** on the WSL2 host (driver on Windows, cuda-toolkit in WSL2 — never a
  Linux driver inside WSL2, ADR-007 / operations.md §GPU);
- k3s to see the `nvidia` container runtime (it auto-creates the RuntimeClass), and the **NVIDIA k8s
  device plugin** DaemonSet advertising `nvidia.com/gpu`;
- k3d caveat: the k3s node is itself a container — it must be started with GPU access for passthrough
  to reach the pod. Validate with `kubectl -n prod exec deploy/asset-worker -- blender -b --debug-cycles`
  seeing the CUDA device before calling the pipeline done (Blender #126014).
