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

# 7. Render worker — runs OUT of the cluster on this WSL2 box (ADR-048; k3d+WSL2 can't inject the GPU
#    into a pod — see "asset-worker — GPU prerequisite"). Build the image, ensure the NATS NodePort is
#    applied (nats.yaml), then run it (reads creds from lumin-secrets, joins the k3d docker net for NATS,
#    reaches core-api/garage over their public hostnames). asset-worker.yaml is kept but NOT applied.
docker build -t lumin-asset-worker:prod services/asset-worker
kubectl apply -f infra/k8s/nats.yaml                  # includes the nats-ext NodePort (:30422)
bash infra/k8s/run-asset-worker.sh                    # docker run --gpus all …
docker logs -f lumin-asset-worker                     # want: "connected to NATS" + "consumer bound"

# 8. (optional) demo catalog so the storefront has products to browse / smoke-test the order flow.
#    Idempotent; demo data — see seed-catalog-job.yaml. Delete the rows before a real launch.
kubectl -n prod create configmap seed-catalog-sql --from-file=seed-catalog.sql=infra/k8s/seed-catalog.sql \
  --dry-run=client -o yaml | kubectl -n prod apply -f -
kubectl -n prod delete job seed-catalog --ignore-not-found && kubectl apply -f infra/k8s/seed-catalog-job.yaml
kubectl -n prod wait --for=condition=complete job/seed-catalog --timeout=90s
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
# --owner (not just read/write) — PutBucketCors below needs an owner-capable key.
G bucket allow --read --write --owner lumin-assets         --key lumin-assets-key
G bucket allow --read --write --owner lumin-payment-proofs --key lumin-proof-key
```

Then put the two key pairs into `lumin-secrets` (`ASSETS_ACCESS_KEY_ID`/`ASSETS_SECRET_ACCESS_KEY` +
`PAYMENT_PROOF_ACCESS_KEY_ID`/`…_SECRET_ACCESS_KEY`) and `kubectl -n prod rollout restart deploy/core-api`
so the upload stores pick them up (an empty pair keeps that store fail-closed — the server still boots).

### CORS (required for browser uploads)

The storefront/admin upload receipts + photos by presigned POST **directly to `s3.luminstudio.vn`**, a
cross-origin request — without CORS the browser blocks reading the response (the object still uploads:
`POST … net::ERR_FAILED 201 (Created)`). Garage v1.0.1 has **no `garage bucket cors` CLI**, so set it via
the S3 `PutBucketCors` API. **One rule PER origin** — a single rule with multiple `AllowedOrigins` makes
Garage echo them comma-joined, which browsers reject (the response's `Access-Control-Allow-Origin` must be
exactly the request's `Origin`). aws-cli must be forced to path-style (Garage is path-style; the bucket is
not a DNS vhost):

```sh
cat > cors.json <<'JSON'
{"CORSRules":[
 {"AllowedOrigins":["https://admin.luminstudio.vn"],"AllowedMethods":["GET","PUT","POST","HEAD"],"AllowedHeaders":["*"],"ExposeHeaders":["ETag","Location"],"MaxAgeSeconds":600},
 {"AllowedOrigins":["https://www.luminstudio.vn"],"AllowedMethods":["GET","PUT","POST","HEAD"],"AllowedHeaders":["*"],"ExposeHeaders":["ETag","Location"],"MaxAgeSeconds":600}
]}
JSON
aws configure set default.s3.addressing_style path
for b in lumin-payment-proofs lumin-assets; do   # use that bucket's owner key for AWS_ACCESS_KEY_ID/SECRET
  AWS_ACCESS_KEY_ID=<key> AWS_SECRET_ACCESS_KEY=<secret> AWS_DEFAULT_REGION=garage \
    aws --endpoint-url https://s3.luminstudio.vn s3api put-bucket-cors --bucket $b --cors-configuration file://cors.json
done
# verify — must echo the SINGLE requesting origin, not a comma list:
curl -si -X OPTIONS https://s3.luminstudio.vn/lumin-payment-proofs/ \
  -H 'Origin: https://admin.luminstudio.vn' -H 'Access-Control-Request-Method: POST' | grep -i access-control-allow-origin
```

> **This CORS is prod state NOT captured in a manifest** — re-run it after any garage/bucket rebuild, or
> browser uploads silently break again.

### Public asset serving — Garage website mode (anon read)

Garage v1.0.1 has **no anonymous S3 read** (`Forbidden: Garage does not support anonymous access yet`), so
`lumin-assets` objects (product/pet/review images + the derivative `.glb`) can't be served by a plain GET
on `s3.luminstudio.vn/lumin-assets/…`. They're served instead through Garage **website mode** on the web
endpoint (`:3902`), exposed as `https://assets.luminstudio.vn` (Ingress → `garage:3902`). In website mode the
**Host is the bucket** (resolved via a global alias) and the **path is the object key**, so the public URL is
`https://assets.luminstudio.vn/<key>` — no `/lumin-assets` segment. That is why the three public-base envs
(`MODEL_UPLOAD_PUBLIC_BASE_URL`, `IMAGE_UPLOAD_PUBLIC_BASE_URL`, `ASSETS_PUBLIC_BASE_URL`) are host-only.
Uploads still PUT/POST path-style to `s3.luminstudio.vn` (the S3 endpoint is unchanged); only the serve /
host-pin origin moved. `lumin-payment-proofs` stays private (authenticated/presigned reads) — never given a
website alias, never routed to `:3902`.

Enable it once, on the box (cluster state, NOT in a manifest — like the layout + CORS bootstrap):

```sh
# 1. website mode + a global alias equal to the serve domain (the web endpoint resolves Host → bucket by alias)
kubectl -n prod exec deploy/garage -- /garage bucket website --allow lumin-assets
kubectl -n prod exec deploy/garage -- /garage bucket alias lumin-assets assets.luminstudio.vn
kubectl -n prod exec deploy/garage -- /garage bucket info lumin-assets   # verify: "Website access: true" + the alias
```

2. **DNS/tunnel:** add `assets.luminstudio.vn` the same way as `s3.luminstudio.vn` (CF DNS → cloudflared
   tunnel → traefik `:80`; the Ingress routes Host → `garage:3902`). TLS terminates at Cloudflare.

3. **CORS (model-viewer only):** plain `<img>` needs none, but the storefront `<model-viewer>` fetches the
   `.glb` cross-origin (`www.` → `assets.`), so the web endpoint must return `Access-Control-Allow-Origin`.
   **Confirmed live 2026-07-15 (ADR-046): Garage v1.0.1's web endpoint DOES replay the bucket CORS rules** —
   an OPTIONS preflight from `https://www.luminstudio.vn` returns `200` + `access-control-allow-origin`
   echoing the origin, so the existing `PutBucketCors` GET rules for `www.`/`admin.` (set above) already
   cover model-viewer with no extra config. Re-verify after any bucket/CORS rebuild (CORS is prod state, not
   in a manifest):

   ```sh
   curl -si -X OPTIONS https://assets.luminstudio.vn/<key> \
     -H 'Origin: https://www.luminstudio.vn' -H 'Access-Control-Request-Method: GET' \
     | grep -iE 'HTTP/|access-control-allow-origin'   # want 200 + an ACAO echoing the origin
   ```

   Fallback, only if the bucket CORS is ever lost and can't be replayed: a Cloudflare **Response Header
   Transform Rule** on `assets.luminstudio.vn` setting `Access-Control-Allow-Origin: *` — the assets are
   public + immutable, so `*` is safe.

> **Website mode + the alias are prod state NOT in a manifest** — like the CORS/layout bootstrap, re-run the
> two `garage bucket` commands after any garage/bucket rebuild, or every public image + `.glb` 404s.

The order/proof data path does **not** depend on any of this.

### Go-live app config (not k8s, but the deploy needs it)

A freshly-deployed shop rejects every order until the owner configures, in Admin → Settings:
**bank account (STK)** — else `422 NO_STK_CONFIGURED`; and **shipping rules** — else `422 NO_SHIPPING_RULE`
(the order's `shippingAddress.province` must match a rule key or a `*` wildcard). Optionally seed a demo
catalog (see `seed-catalog-job.yaml`) so there is something to order.

## asset-worker — GPU prerequisite

`asset-worker.yaml` requests `nvidia.com/gpu: 1` and `runtimeClassName: nvidia`; without a GPU it stays
**Pending** (the honest signal — nothing else is affected). The node needs, once:

- the **NVIDIA Container Toolkit** on the WSL2 host (driver on Windows, cuda-toolkit in WSL2 — never a
  Linux driver inside WSL2, ADR-007 / operations.md §GPU);
- k3s to see the `nvidia` container runtime (it auto-creates the RuntimeClass), and the **NVIDIA k8s
  device plugin** advertising `nvidia.com/gpu` — `kubectl apply -f infra/k8s/nvidia-device-plugin.yaml`
  (runbook step 7). It stays `0/1 Running` until the node's GPU is visible; confirm the node reports
  the resource before rolling the worker:
  `kubectl get nodes -o "custom-columns=GPU:.status.allocatable.nvidia\.com/gpu"` → want `1`, not `<none>`.
- k3d caveat: the k3s node is itself a container — it must be started with GPU access for passthrough
  to reach BOTH the device plugin and the worker pod. Validate with
  `kubectl -n prod exec deploy/asset-worker -- blender -b --debug-cycles`
  seeing the CUDA device before calling the pipeline done (Blender #126014).

### GPU cluster recreate (maintenance window) — ADR-047

The running cluster was created WITHOUT `--gpus`, and k3d cannot add a GPU to a live cluster (`--gpus` is
`cluster create`-only; `node create` has none). So the k3d caveat above is resolved by **recreating** the
cluster with `--gpus all` + the `k3s-cuda` node image (`k3s-cuda.Dockerfile` = the current k3s version +
nvidia-container-toolkit, so k3s inside auto-creates the `nvidia` RuntimeClass).

> ⚠️ **DESTRUCTIVE.** `k3d cluster delete` removes the docker volume holding every local-path PVC —
> `postgres-data` (real orders) **and** `garage-data`/`garage-meta` (payment-proof objects). Back up and
> PROVE a restore of BOTH before deleting. restic covers only postgres; garage needs a separate copy.

**0. Prereqs (once, no prod impact):**

```sh
docker run --rm --gpus all ubuntu:22.04 nvidia-smi -L                 # host GPU works → GTX 1060
docker build -f infra/k8s/k3s-cuda.Dockerfile -t k3s-cuda:v1.35.5-k3s1-cuda12.4.1 infra/k8s
```

**1. Back up everything, verify each — BEFORE any delete:**

```sh
export KUBECONFIG=~/.config/k3d/kubeconfig-luminstudio.yaml
# postgres → restic/B2 (existing CronJob) + verify a fresh snapshot
kubectl -n prod create job --from=cronjob/postgres-backup backup-prerecreate
kubectl -n prod wait --for=condition=complete job/backup-prerecreate --timeout=300s
# garage payment-proof objects → mirror out, key-preserving (no S3 client on the box → mc in a container).
kubectl -n prod port-forward svc/garage 3900:3900 &
docker run --rm --network host -e MC_HOST_g="http://<proof-owner-key>:<secret>@localhost:3900" \
  -v /home/duchuong/garage-proofs:/out minio/mc mirror --overwrite g/lumin-payment-proofs /out
# record garage config so the re-bootstrap reproduces it (bucket + key IDs, not secrets)
kubectl -n prod exec deploy/garage -- /garage bucket list
kubectl -n prod exec deploy/garage -- /garage key list
```

Do NOT proceed until both restore-check: `restic snapshots` shows the new one (and `pg_restore --list` it),
and the mirrored `/home/duchuong/garage-proofs` is non-empty.

**2. Recreate with GPU** (reproduce the current flags — serverlb `80/443/6443`, k3s-bundled traefik):

```sh
k3d cluster delete luminstudio
k3d cluster create luminstudio \
  --gpus all --image k3s-cuda:v1.35.5-k3s1-cuda12.4.1 \
  --port '80:80@loadbalancer' --port '443:443@loadbalancer'
# default k3s bundles traefik (the current install) + serves the API on 6443 — do NOT --disable=traefik.
```

**3. Redeploy + restore:**

- Recreate `lumin-secrets` + `lumin-backup-secrets` (secret.example.yaml).
- Rebuild + `k3d image import` the `lumin-*` images (or run the `deploy` workflow), then apply the stateful
  tier: `kubectl apply -f infra/k8s/postgres.yaml -f infra/k8s/nats.yaml -f infra/k8s/garage.yaml`.
- **Restore postgres** into the fresh DB (§Backup & restore below).
- **Re-bootstrap garage** fully: §Garage bootstrap (layout/keys/buckets) → §CORS → §Public asset serving
  (`bucket website --allow` + alias). Then mirror the proofs back:
  `docker run … minio/mc mirror --overwrite /out g/lumin-payment-proofs`.
- Apply the rest of the deploy runbook (migrate, core-api, storefront, admin, ingress, backup, uptime-kuma).

**4. GPU up:** `kubectl apply -f infra/k8s/nvidia-device-plugin.yaml` → node reports `nvidia.com/gpu: 1` →
deploy asset-worker → the Blender-sees-GPU check above (o-1c).

**5. Verify:** www/admin/api `200`, an existing order still opens, a public asset serves via
`assets.luminstudio.vn`.

> ⚠️ **WSL2 outcome (proven 2026-07-15).** This recreate DOES put the GPU into the k3d node container
> (`docker exec k3d-luminstudio-server-0 nvidia-smi -L` → the GTX 1060; `/dev/dxg` present) and k3s
> auto-creates RuntimeClass `nvidia` — BUT **pods still can't use it**: the device-plugin's NVML init
> fails (`ERROR_NOT_SUPPORTED`) and a pod under `runtimeClassName: nvidia` gets `NVML: N/A`. The
> nvidia-container-toolkit injects the WSL GPU libs host→node-container but NOT node-container→pod (nested
> containerd doesn't detect WSL). **In-cluster GPU is not viable on this k3d + WSL2 box** — step 4 never
> advertises `nvidia.com/gpu`. Run the render worker OUT of the cluster (`docker run --gpus all`, which
> works — the ADR-047 rejected-option (a)) instead. The recreate is still fine for the web stack.

## Backup & restore (ADR-018)

Daily `pg_dump -Fc` → **restic** snapshot to an **offsite** encrypted repo, retention 7d/4w/6m
(`backup-cronjob.yaml`). Deliberately **not** WAL-G/PITR: one all-home box that accepts downtime (ADR-009)
doesn't need near-zero RPO — this gives ~24h RPO, offsite + encrypted + dedup + a trivial `pg_restore`,
which is exactly ADR-018's invariant. Want point-in-time recovery instead? That's WAL-G (a custom Postgres
image + `archive_command` + a WAL store) — swap the mechanism, keep the offsite+tested-restore rule.

```sh
# 1. backup image = pg_dump + restic (once; not in deploy.yml — a backup image needn't rebuild per roll)
docker build -f infra/k8s/backup.Dockerfile -t lumin-backup:prod infra/k8s
k3d image import lumin-backup:prod -c luminstudio

# 2. offsite creds (full command in backup-secret.example.yaml). Two things that bite:
#    - RESTIC_REPOSITORY MUST carry the restic scheme: s3:https://s3.<region>.backblazeb2.com/<bucket>/lumin-pg
#      A bare host (no s3:https://) is read as a LOCAL path — restic fake-inits an in-pod dir that vanishes,
#      then backup fails with a MISLEADING ".../config: no such file or directory". (Bit us live 2026-07-15.)
#    - STORE RESTIC_PASSWORD OFFLINE too (a password manager) — lose it = every backup is unrecoverable.
kubectl -n prod create secret generic lumin-backup-secrets \
  --from-literal=RESTIC_REPOSITORY="s3:https://s3.<region>.backblazeb2.com/<bucket>/lumin-pg" ... # see example file

# 3. init the repo ONCE, then schedule + prove it runs now (don't wait for 03:00)
kubectl -n prod run restic-init --rm -it --restart=Never --image=lumin-backup:prod \
  --overrides='{"spec":{"containers":[{"name":"restic-init","image":"lumin-backup:prod","command":["restic","init"],"envFrom":[{"secretRef":{"name":"lumin-backup-secrets"}}]}]}}'
kubectl apply -f infra/k8s/backup-cronjob.yaml
kubectl -n prod create job --from=cronjob/postgres-backup backup-now
kubectl -n prod logs -f job/backup-now   # expect: backup ok
```

> **Backblaze B2 (the live backend, activated + verified 2026-07-15):** repo =
> `s3:https://s3.us-east-005.backblazeb2.com/lumin-backup/lumin-pg`. Scope the B2 app key to just the bucket
> (least privilege), and **leave B2 lifecycle rules OFF** — restic's `forget --prune` owns retention; a B2
> auto-delete rule would drop pack files restic still needs and corrupt the repo. Verify anytime from a
> `lumin-backup:prod` pod (`envFrom` `lumin-backup-secrets`): `restic snapshots` + `restic check` → expect the
> daily snapshot and "no errors were found".

**Restore drill — ADR-018 makes this non-negotiable; a backup you have never restored is not a backup.**
Non-destructive: it restores into a scratch DB beside prod, never over prod. Run it once now (the site is
already live) and after any repo change. `lumin-backup:prod` carries restic + pg_restore + psql, so one pod
does it all:

```sh
kubectl -n prod run restore-drill --rm -it --restart=Never --image=lumin-backup:prod \
  --overrides='{"spec":{"containers":[{"name":"r","image":"lumin-backup:prod","stdin":true,"tty":true,"command":["sh"],"envFrom":[{"secretRef":{"name":"lumin-backup-secrets"}}],"env":[{"name":"DATABASE_URL","valueFrom":{"secretKeyRef":{"name":"lumin-secrets","key":"DATABASE_URL"}}}]}]}}'
# inside the pod:
restic dump latest /scratch/lumin.dump > /tmp/lumin.dump          # pull the newest snapshot back
RT=$(echo "$DATABASE_URL" | sed 's,/lumin?,/restore_test?,')      # same server, scratch db
psql "$DATABASE_URL" -c 'DROP DATABASE IF EXISTS restore_test' -c 'CREATE DATABASE restore_test'
pg_restore -d "$RT" /tmp/lumin.dump
psql "$RT" -c 'SELECT count(*) FROM orders;'                       # sanity-check real data landed
psql "$DATABASE_URL" -c 'DROP DATABASE restore_test'
```

Real disaster (restore **over** prod — only when prod is already lost): from the same pod,
`restic dump latest /scratch/lumin.dump | pg_restore --clean --if-exists -d "$DATABASE_URL"`.

## Down-alert (operations.md §6)

Two layers — the external one is load-bearing:

- **Whole box down → Cloudflare Health Checks** (Traffic → Health Checks on `www` + `api.luminstudio.vn`,
  wired to Notifications → email/webhook). Cloudflare already fronts the site, so this pings from the edge
  and fires when the box/tunnel dies — the exact case an in-cluster monitor can't see. No new infra.
- **Per-service depth → Uptime Kuma** (`kubectl apply -f infra/k8s/uptime-kuma.yaml`, then
  `kubectl -n prod port-forward svc/uptime-kuma 3001:3001` to add monitors: core-api `/readyz`, storefront,
  admin, garage, and a **push** monitor for the backup's `BACKUP_HEARTBEAT_URL` so a silently-dead backup
  alerts too). Keep its UI off the public internet — port-forward, or a Cloudflare-Access-gated hostname.
