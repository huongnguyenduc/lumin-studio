# One-shot owner bootstrap (ADR-030 self-issued auth) as a k8s Job — same multi-stage recipe as
# services/core-api/Dockerfile, but builds ./cmd/seed-owner. Context = services/core-api:
#   docker build -f infra/k8s/seed-owner.Dockerfile -t lumin-seed-owner:prod services/core-api
FROM golang:1.23.6-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags='-s -w' -o /out/seed-owner ./cmd/seed-owner

FROM alpine:3.20
RUN apk add --no-cache ca-certificates && adduser -D -u 10001 app
USER app
COPY --from=build /out/seed-owner /usr/local/bin/seed-owner
ENTRYPOINT ["seed-owner"]
