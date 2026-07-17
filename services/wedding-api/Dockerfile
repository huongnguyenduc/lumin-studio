# wedding-api (Go + Chi) — multi-stage: static build → minimal alpine runtime.
# Mirrors services/core-api/Dockerfile. Runtime config comes entirely from env
# (internal/config). Migrations will run as a separate gated one-shot (step 2).

FROM golang:1.23.6-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags='-s -w' -o /out/wedding-api ./cmd/wedding-api

FROM alpine:3.20
RUN apk add --no-cache ca-certificates && adduser -D -u 10001 app
USER app
COPY --from=build /out/wedding-api /usr/local/bin/wedding-api
EXPOSE 8081
ENTRYPOINT ["wedding-api"]
