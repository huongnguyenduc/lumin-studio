# core-api (Go + Chi BFF) — multi-stage: static build → minimal alpine runtime.
# Self-host all-home (ADR-009). Runtime config comes entirely from env (internal/config);
# see infra/docker-compose.yml + infra/.env.example for the wiring. Migrations run as a
# SEPARATE gated one-shot (the `migrate` compose service, golang-migrate — ADR-028); this
# image only carries the server binary.

FROM golang:1.23.6-alpine AS build
WORKDIR /src
# Deps first so `go mod download` is cached until go.mod/go.sum change.
COPY go.mod go.sum ./
RUN go mod download
COPY . .
# CGO off → a fully static binary (pgx / minio-go / jwtauth are pure Go), so the runtime
# stage needs no libc. -trimpath + -s -w drop paths and the symbol table (smaller, reproducible).
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags='-s -w' -o /out/core-api ./cmd/core-api

FROM alpine:3.20
# ca-certificates: outbound TLS (public S3/CDN base URLs). busybox `wget` (already in alpine)
# serves the compose /healthz probe. Run as a non-root user.
RUN apk add --no-cache ca-certificates && adduser -D -u 10001 app
USER app
COPY --from=build /out/core-api /usr/local/bin/core-api
EXPOSE 8080
ENTRYPOINT ["core-api"]
