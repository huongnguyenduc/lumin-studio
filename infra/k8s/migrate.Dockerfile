# Bakes the repo's golang-migrate migrations into the migrate/migrate image so the k8s Job carries
# them (k8s has no host-path mount like the compose `migrate` service did). ADR-028.
# Context = the migrations dir itself (the repo-root .dockerignore excludes services/):
#   docker build -f infra/k8s/migrate.Dockerfile -t lumin-migrate:prod services/core-api/db/migrations
FROM migrate/migrate:v4.18.1
COPY . /migrations
