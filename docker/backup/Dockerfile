# syntax=docker/dockerfile:1

FROM alpine:3.20 AS mc-builder

# Pinned MinIO Client release (not the floating "release/linux-amd64/mc" latest path) so
# builds are reproducible and can't silently pick up an unreviewed binary. Bump this (and
# the checksum below) deliberately when upgrading.
ARG MC_VERSION=RELEASE.2025-08-13T08-35-41Z

RUN apk add --no-cache curl \
  && curl -fsSL -o /tmp/mc "https://dl.min.io/client/mc/release/linux-amd64/archive/mc.${MC_VERSION}" \
  && curl -fsSL -o /tmp/mc.sha256sum "https://dl.min.io/client/mc/release/linux-amd64/archive/mc.${MC_VERSION}.sha256sum" \
  && cd /tmp \
  && sed -i "s/mc.${MC_VERSION}/mc/" mc.sha256sum \
  && sha256sum -c mc.sha256sum \
  && chmod +x /tmp/mc

FROM postgres:16-alpine

COPY --from=mc-builder /tmp/mc /usr/local/bin/mc

COPY docker/backup/backup.sh /backup.sh
COPY docker/backup/entrypoint.sh /entrypoint.sh
COPY docker/backup/crontab /etc/crontabs/root
RUN chmod +x /backup.sh /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
