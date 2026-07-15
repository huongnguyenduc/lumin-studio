# Backup image = pg_dump (Postgres 17 client, matches postgres.yaml's server) + restic (pinned,
# copied as a static binary so there is NO nightly apk-mirror dependency in the backup path).
# Build + import ONCE on the box (it rarely changes; deliberately NOT wired into deploy.yml — a backup
# image has no reason to rebuild on every app roll):
#   docker build -f infra/k8s/backup.Dockerfile -t lumin-backup:prod infra/k8s
#   k3d image import lumin-backup:prod -c luminstudio
# Repo init + restore drill: README "Backup & restore (ADR-018)".
FROM restic/restic:0.17.3 AS restic
FROM postgres:17-alpine
COPY --from=restic /usr/bin/restic /usr/local/bin/restic
