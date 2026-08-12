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

# Deliberately NOT in the `:?required` block above: this container must keep taking
# real, working backups even if the reporting wiring to the API is misconfigured or the
# api service itself is down -- see report_backup() below, which no-ops (loudly) rather
# than failing the script when BACKUP_REPORT_SECRET is unset. BACKUP_REPORT_URL defaults
# to how every other service in docker-compose.prod.yml addresses api: by its compose
# service name on the shared `internal` network, port 3002 (see api's own healthcheck in
# that file for the same host:port), plus the global `api` prefix every route in this
# NestJS app is served under (see apps/api/src/main.ts's setGlobalPrefix('api')).
BACKUP_REPORT_URL="${BACKUP_REPORT_URL:-http://api:3002/api/internal/backup-report}"
BACKUP_REPORT_SECRET="${BACKUP_REPORT_SECRET:-}"

# A genuinely empty/corrupt pg_dump -Fc (custom format) output is just its header --
# a few hundred bytes. This codebase's real schema (apps/api/src/migrations) is dozens
# of tables, indexes, constraints, and sequences, which alone puts even a fully empty
# (zero-row) database's custom-format table-of-contents well into five figures of bytes
# before a single row of actual data is counted. 10 KiB sits comfortably below that
# "empty database, real schema" floor -- so it won't false-alarm on a tiny dev/staging
# DB -- while still catching a dump that got truncated seconds after starting (network
# drop, disk full, postgres killed mid-dump, pg_dump itself crashing after writing only
# its header), which is the actual failure mode this check exists to catch.
MIN_DUMP_SIZE_BYTES=10240

TIMESTAMP=$(date -u +%Y-%m-%dT%H%M%SZ)
FILENAME="gheychi-${TIMESTAMP}.dump"
DUMP_PATH="/tmp/${FILENAME}"
STARTED_AT_S=$(date +%s)

# Ensure the (possibly large, possibly partial) dump file never survives this script,
# whether it exits successfully or fails partway through -- otherwise repeated failures
# accumulate disk usage in /tmp across daily cron runs until it starves the next dump too.
trap 'rm -f "$DUMP_PATH"' EXIT

# Best-effort POST to the API's internal backup-monitoring endpoint. Deliberately ALWAYS
# returns 0 -- whatever curl does -- so this reporting step can never itself change
# backup.sh's own exit code. A genuinely successful backup (dump taken, size sane,
# upload verified in S3 -- see below) must never be reported to cron/this container's
# own health as a failure just because the api container happens to be unreachable right
# now; that would be strictly worse than not reporting at all. A failure to report is
# still logged loudly (not silently swallowed): it means the operator-facing "when did
# backup last succeed" signal (backup:last-success in Redis, read by
# BackupStalenessCheckJob) is blind for this run, which is worth noticing on its own.
report_backup() {
  status="$1"
  size_bytes="$2"
  duration_ms="$3"
  error_message="$4"

  if [ -z "$BACKUP_REPORT_SECRET" ]; then
    echo "[backup] BACKUP_REPORT_SECRET is not set -- skipping backup report to ${BACKUP_REPORT_URL}"
    return 0
  fi

  body="{\"status\":\"${status}\""
  if [ -n "$size_bytes" ]; then
    body="${body},\"sizeBytes\":${size_bytes}"
  fi
  if [ -n "$duration_ms" ]; then
    body="${body},\"durationMs\":${duration_ms}"
  fi
  if [ -n "$error_message" ]; then
    # Minimal JSON string escaping (backslashes, double quotes, newlines-to-spaces) --
    # error_message only ever comes from this script's own fixed, fail()-authored
    # strings plus a captured command's stderr, never arbitrary external/user input, but
    # stderr text can still legitimately contain a `"` or embedded newline.
    escaped_error=$(printf '%s' "$error_message" | sed 's/\\/\\\\/g; s/"/\\"/g' | tr '\n' ' ')
    body="${body},\"error\":\"${escaped_error}\""
  fi
  body="${body}}"

  http_code=$(curl -s -o /tmp/backup-report-response.txt -w '%{http_code}' \
    --max-time 10 \
    -X POST "$BACKUP_REPORT_URL" \
    -H 'Content-Type: application/json' \
    -H "x-backup-report-secret: ${BACKUP_REPORT_SECRET}" \
    -d "$body" 2>/tmp/backup-report-curl-stderr.txt) || http_code="curl_failed"

  if [ "$http_code" = "204" ] || [ "$http_code" = "200" ]; then
    echo "[backup] reported ${status} to ${BACKUP_REPORT_URL} (HTTP ${http_code})"
  else
    echo "[backup] WARNING: failed to report ${status} to ${BACKUP_REPORT_URL} (HTTP ${http_code}) -- this does NOT affect the backup's own success/failure, but backup-staleness-check will not see this run until the next report actually lands" >&2
    if [ -s /tmp/backup-report-curl-stderr.txt ]; then
      cat /tmp/backup-report-curl-stderr.txt >&2
    fi
  fi
  rm -f /tmp/backup-report-response.txt /tmp/backup-report-curl-stderr.txt
  return 0
}

# Logs, best-effort-reports failure, then exits non-zero. The one place this script
# gives up -- every real failure path below (pg_dump, size check, mc cp, mc stat, size
# mismatch) routes through here so a failure is reported exactly once, consistently.
fail() {
  message="$1"
  echo "[backup] FAILED: ${message}" >&2
  duration_ms=$(( ($(date +%s) - STARTED_AT_S) * 1000 ))
  report_backup "failure" "" "$duration_ms" "$message"
  exit 1
}

echo "[backup] starting dump to ${DUMP_PATH}"
if ! PGPASSWORD="$DB_PASS" pg_dump -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -Fc -f "$DUMP_PATH"; then
  fail "pg_dump exited non-zero"
fi

DUMP_SIZE_BYTES=$(wc -c < "$DUMP_PATH" | tr -d ' ')
echo "[backup] dump complete (${DUMP_SIZE_BYTES} bytes)"

if [ "$DUMP_SIZE_BYTES" -lt "$MIN_DUMP_SIZE_BYTES" ]; then
  fail "dump file is suspiciously small: ${DUMP_SIZE_BYTES} bytes (minimum sane size is ${MIN_DUMP_SIZE_BYTES} bytes) -- likely truncated or empty"
fi

mc alias set s3backup "$S3_ENDPOINT" "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY" >/dev/null
echo "[backup] uploading to s3backup/${S3_BUCKET}/backups/${FILENAME}"
if ! mc cp "$DUMP_PATH" "s3backup/${S3_BUCKET}/backups/${FILENAME}"; then
  fail "mc cp upload failed"
fi

# mc cp's own exit code only confirms the client-side request completed without a
# transport-level error -- it does not, on its own, guarantee the bytes that landed in
# S3 match what was sent (e.g. a partial multipart upload the server nonetheless
# acknowledged). mc stat --json queries S3 directly for what it actually has right now
# and reports the real object size, which is compared byte-for-byte against the local
# dump below -- this is the check that catches a partial/corrupt upload mc cp's exit
# code alone can miss.
REMOTE_STAT_JSON=$(mc stat --json "s3backup/${S3_BUCKET}/backups/${FILENAME}" 2>/tmp/mc-stat-stderr.txt) || {
  stat_err=$(cat /tmp/mc-stat-stderr.txt 2>/dev/null)
  rm -f /tmp/mc-stat-stderr.txt
  fail "mc stat could not read back the uploaded object: ${stat_err}"
}
rm -f /tmp/mc-stat-stderr.txt

REMOTE_SIZE_BYTES=$(printf '%s' "$REMOTE_STAT_JSON" | tr -d '\n' | grep -o '"size": *[0-9]*' | head -n1 | grep -o '[0-9]*$')
if [ -z "$REMOTE_SIZE_BYTES" ]; then
  fail "could not parse an object size out of mc stat --json output: ${REMOTE_STAT_JSON}"
fi
if [ "$REMOTE_SIZE_BYTES" != "$DUMP_SIZE_BYTES" ]; then
  fail "uploaded object size mismatch: local dump is ${DUMP_SIZE_BYTES} bytes, S3 reports ${REMOTE_SIZE_BYTES} bytes -- upload may be partial or corrupt"
fi
echo "[backup] verified upload: S3 object size matches local dump exactly (${REMOTE_SIZE_BYTES} bytes)"

# Pruning old backups is intentionally NOT routed through fail(): whether last month's
# backups got swept today has no bearing on whether TODAY's backup (already verified
# good in S3, above) succeeded. A transient S3 error here must not report a genuinely
# good backup as a failure and must not stop the success report below.
echo "[backup] pruning backups older than 14 days"
if ! mc rm --recursive --force --older-than "14d" "s3backup/${S3_BUCKET}/backups/"; then
  echo "[backup] WARNING: pruning old backups failed -- this backup itself is still good; will retry pruning on the next run" >&2
fi

DURATION_MS=$(( ($(date +%s) - STARTED_AT_S) * 1000 ))
report_backup "success" "$DUMP_SIZE_BYTES" "$DURATION_MS" ""

echo "[backup] done: ${FILENAME}"
