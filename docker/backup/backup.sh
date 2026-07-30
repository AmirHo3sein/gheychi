#!/bin/sh
set -eu

: "${DB_HOST:?DB_HOST is required}"
: "${DB_USER:?DB_USER is required}"
: "${DB_PASS:?DB_PASS is required}"
: "${DB_NAME:?DB_NAME is required}"
: "${S3_ENDPOINT:?S3_ENDPOINT is required}"
: "${S3_BUCKET:?S3_BUCKET is required}"
: "${S3_ACCESS_KEY_ID:?S3_ACCESS_KEY_ID is required}"
: "${S3_SECRET_ACCESS_KEY:?S3_SECRET_ACCESS_KEY is required}"

TIMESTAMP=$(date -u +%Y-%m-%dT%H%M%SZ)
FILENAME="gheychi-${TIMESTAMP}.dump"
DUMP_PATH="/tmp/${FILENAME}"

# Ensure the (possibly large, possibly partial) dump file never survives this script,
# whether it exits successfully or fails partway through -- otherwise repeated failures
# accumulate disk usage in /tmp across daily cron runs until it starves the next dump too.
trap 'rm -f "$DUMP_PATH"' EXIT

echo "[backup] starting dump to ${DUMP_PATH}"
PGPASSWORD="$DB_PASS" pg_dump -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -Fc -f "$DUMP_PATH"
echo "[backup] dump complete ($(du -h "$DUMP_PATH" | cut -f1))"

mc alias set s3backup "$S3_ENDPOINT" "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY" >/dev/null
echo "[backup] uploading to s3backup/${S3_BUCKET}/backups/${FILENAME}"
mc cp "$DUMP_PATH" "s3backup/${S3_BUCKET}/backups/${FILENAME}"

echo "[backup] pruning backups older than 14 days"
mc rm --recursive --force --older-than "14d" "s3backup/${S3_BUCKET}/backups/"

echo "[backup] done: ${FILENAME}"
