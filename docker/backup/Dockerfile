# syntax=docker/dockerfile:1

FROM postgres:16-alpine

RUN apk add --no-cache curl \
  && curl -fsSL https://dl.min.io/client/mc/release/linux-amd64/mc -o /usr/local/bin/mc \
  && chmod +x /usr/local/bin/mc

COPY docker/backup/backup.sh /backup.sh
COPY docker/backup/entrypoint.sh /entrypoint.sh
COPY docker/backup/crontab /etc/crontabs/root
RUN chmod +x /backup.sh /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
