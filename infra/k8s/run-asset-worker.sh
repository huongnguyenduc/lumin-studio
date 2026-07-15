#!/usr/bin/env bash
# Run the render worker OUT of the k8s cluster, on the WSL host (ADR-048: k3d + WSL2 can't inject the GPU
# into a pod — the toolkit's WSL lib injection doesn't cross host→node→pod — but `docker run --gpus all`
# works). The worker joins the `k3d-luminstudio` docker network to reach JetStream via the `nats-ext`
# NodePort; core-api + garage are reached over their public hostnames. Creds are read from the in-cluster
# `lumin-secrets` at runtime and never printed. Idempotent — re-run to restart with a fresh image/creds.
# Concurrency = 1, off-peak (ADR-007). Logs: `docker logs -f lumin-asset-worker`.
set -euo pipefail
export KUBECONFIG=${KUBECONFIG:-$(k3d kubeconfig write luminstudio 2>/dev/null)}

sec() { kubectl -n prod get secret lumin-secrets -o "jsonpath={.data.$1}" | base64 -d; }
AKID=$(sec ASSETS_ACCESS_KEY_ID); ASEC=$(sec ASSETS_SECRET_ACCESS_KEY); TOKEN=$(sec WORKER_CALLBACK_TOKEN)
[ -n "$AKID" ] && [ -n "$ASEC" ] && [ -n "$TOKEN" ] || {
  echo "missing ASSETS_* key or WORKER_CALLBACK_TOKEN in lumin-secrets (run the Garage bootstrap first)" >&2
  exit 1
}

docker rm -f lumin-asset-worker >/dev/null 2>&1 || true
docker run -d --name lumin-asset-worker \
  --gpus all \
  --network k3d-luminstudio \
  --restart unless-stopped \
  -e NATS_URL=nats://k3d-luminstudio-server-0:30422 \
  -e CORE_API_URL=https://api.luminstudio.vn \
  -e WORKER_CALLBACK_TOKEN="$TOKEN" \
  -e ASSETS_S3_ENDPOINT=https://s3.luminstudio.vn \
  -e ASSETS_PUBLIC_BASE_URL=https://assets.luminstudio.vn \
  -e ASSETS_BUCKET=lumin-assets \
  -e ASSETS_ACCESS_KEY_ID="$AKID" \
  -e ASSETS_SECRET_ACCESS_KEY="$ASEC" \
  lumin-asset-worker:prod >/dev/null
echo "lumin-asset-worker started (--gpus all, on the k3d-luminstudio network)."
