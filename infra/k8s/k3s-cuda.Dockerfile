# k3s-cuda — a k3s NODE image with the NVIDIA container runtime baked in, so the k3d cluster's k3s can
# schedule GPU pods (asset-worker's Blender/Cycles+CUDA on the GTX 1060 — ADR-007/ADR-047). Stock
# rancher/k3s can't: k3s only auto-creates the `nvidia` RuntimeClass when it detects the NVIDIA container
# runtime INSIDE the node, and a plain k3d node container has neither the toolkit nor GPU access. Build
# this, then `k3d cluster create --gpus all --image k3s-cuda:<tag>` — the node container gets the GPU
# (--gpus), k3s inside finds the runtime and creates RuntimeClass `nvidia` (what nvidia-device-plugin.yaml
# + asset-worker.yaml request). k3d node create has NO --gpus, so a whole-cluster recreate is the only
# k3d-native path (ADR-047). Box-only — NEVER in deploy.yml (that runs GPU-less and must stay green).
#
# Canonical k3d-CUDA recipe (k3d.io/v5/usage/advanced/cuda), pinned: K3S_TAG = the cluster's EXACT k3s
# version (a node image mismatched to the server drifts the cluster), CUDA_TAG = 12.4 to match the
# asset-worker runtime image / Blender build. Bump K3S_TAG in lockstep with any k3s upgrade.
#   docker build -f infra/k8s/k3s-cuda.Dockerfile -t k3s-cuda:v1.35.5-k3s1-cuda12.4.1 infra/k8s
# See infra/k8s/README §"GPU cluster recreate".
ARG K3S_TAG=v1.35.5-k3s1
ARG CUDA_TAG=12.4.1-base-ubuntu22.04

FROM rancher/k3s:${K3S_TAG} AS k3s
FROM nvcr.io/nvidia/cuda:${CUDA_TAG}

# nvidia-container-toolkit + wire it into containerd (writes the `nvidia` runtime handler). k3s then
# auto-detects that runtime on start and creates the `nvidia` RuntimeClass the device-plugin + worker use.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl gnupg ca-certificates \
    && curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey \
       | gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg \
    && curl -fsSL https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list \
       | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' \
       > /etc/apt/sources.list.d/nvidia-container-toolkit.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends nvidia-container-toolkit \
    && nvidia-ctk runtime configure --runtime=containerd \
    && rm -rf /var/lib/apt/lists/*

# Overlay the k3s binaries + assets onto the CUDA base. BuildKit `--exclude=/bin` keeps the base image's
# own /bin (coreutils the CUDA image needs) while copying everything else k3s ships, then /bin explicitly.
COPY --from=k3s / / --exclude=/bin
COPY --from=k3s /bin /bin

VOLUME /var/lib/kubelet
VOLUME /var/lib/rancher/k3s
VOLUME /var/lib/cni
VOLUME /var/log

# k3s stages a few helper binaries (containerd, runc, …) under /bin/aux at runtime.
ENV PATH="$PATH:/bin/aux"
ENTRYPOINT ["/bin/k3s"]
CMD ["agent"]
