# asset-worker (Rust + Blender) — multi-stage: build the Rust binary → CUDA runtime + headless
# Blender. Self-host all-home (ADR-009). Off the web-live critical path (o-1c): placing an order
# renders nothing, so this GPU-locked image never blocks go-live.
#
# GPU passthrough (--gpus all via nvidia-container-toolkit) + the in-container Blender CUDA gate
# (`blender -b --debug-cycles`, operations.md §3) are WSL2 + GTX 1060 ONLY — this image builds and
# the render gate passes ON THE BOX, not on the GPU-less dev machine.
#
# Render constraints (ADR-007 — do not relitigate): Cycles + CUDA only (no OptiX — Pascal has no
# RT cores; no EEVEE — dies headless), Blender run as a subprocess, concurrency=1, off-peak. The
# Rust worker today is a Phase-0 scaffold (connects to NATS + idles — no consumer, no Blender call
# yet); Blender is baked in NOW so the deploy substrate + GPU gate are proven before the render
# pipeline lands (a later worker phase).

# --- build: compile the worker binary ---
# bullseye (glibc 2.31), NOT bookworm (2.36): the binary must run on the ubuntu 22.04 runtime
# (glibc 2.35) below — build on the older glibc so it stays backward-compatible (build-old-run-
# newer). Floating `1` tag: no rust-toolchain.toml pins a version, so track latest stable.
FROM rust:1-slim-bullseye AS build
WORKDIR /src
# .dockerignore trims the context to Cargo.toml/lock + src/, so COPY . . is small. Skipping the
# manifests-first dep-cache split on purpose: for a 5-dep crate the dummy-main trick it needs isn't
# worth the complexity — a src change recompiles the few deps in seconds.
COPY . .
RUN cargo build --release --locked

# --- runtime: CUDA runtime + headless Blender + the worker binary ---
# The nvidia/cuda base bakes NVIDIA_DRIVER_CAPABILITIES=compute,utility + NVIDIA_VISIBLE_DEVICES=all
# — that env is what makes `--gpus all` expose *compute* (not just display) to Cycles CUDA. The GTX
# 1060 driver's libcuda is injected at runtime by nvidia-container-toolkit, never baked here.
# ponytail: -runtime (ships cudart) is belt-and-suspenders — Cycles uses the driver API so -base
# likely suffices; slim to -base if image size bites. CUDA 12.4 matches the host cuda-toolkit-12-x
# (operations.md §3) and supports Pascal sm_61.
FROM nvidia/cuda:12.4.1-runtime-ubuntu22.04 AS runtime

# Pinned official Blender (blender.org tarball, NOT distro apt): self-contained, ships its own
# portable Cycles CUDA kernels, avoids the ancient distro build + its huge GUI dep tree. ARGs are
# the tuning knob if the box's driver/CUDA needs a different series — GPU/driver compatibility is a
# physical-box property a fixed version can't see (leave the calibration knob). 4.2 is an LTS.
ARG BLENDER_SERIES=4.2
ARG BLENDER_VERSION=4.2.3

# Runtime .so's headless Blender still dlopen's even in `-b` background mode (it inits GHOST and
# links X/GL unconditionally — the classic "works with a display, crashes headless" gotcha).
# xz-utils extracts the tarball; ca-certificates for the outbound S3/CDN TLS the pipeline will use.
# The exact lib set is superset-then-prune: the on-box render gate is what confirms/trims it.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates xz-utils \
      libx11-6 libxext6 libxrender1 libxi6 libxxf86vm1 libxfixes3 libxkbcommon0 \
      libxrandr2 libxinerama1 libxcursor1 libsm6 libgl1 libglx-mesa0 libglu1-mesa \
    && rm -rf /var/lib/apt/lists/*

# ponytail: no --checksum on the download — HTTPS from blender.org is the v1; add
# `ADD --checksum=sha256:<hash>` to pin the tarball if supply-chain hardening is wanted.
ADD https://download.blender.org/release/Blender${BLENDER_SERIES}/blender-${BLENDER_VERSION}-linux-x64.tar.xz /tmp/blender.tar.xz
RUN mkdir -p /opt/blender \
    && tar -xf /tmp/blender.tar.xz -C /opt/blender --strip-components=1 \
    && rm /tmp/blender.tar.xz \
    && ln -s /opt/blender/blender /usr/local/bin/blender

# Non-root. Blender writes caches/scratch under $HOME, so give the user a home dir.
RUN useradd --create-home --uid 10001 app
USER app
ENV HOME=/home/app

COPY --from=build /src/target/release/asset-worker /usr/local/bin/asset-worker
ENTRYPOINT ["asset-worker"]
