#!/usr/bin/env bash
# backup.sh -- runs a real `pg_dump` against a target Postgres database and produces a
# timestamped, compressed dump file in a configurable output directory, plus a small
# sidecar JSON file recording row counts for a few core tables *at dump time*.
#
# WHAT THIS IS: a plain shell script that shells out to the local `pg_dump`/`psql`
# binaries (the same Postgres client tools already on this machine -- see README) --
# no new npm dependency, nothing added to any package.json. Same "shell out where
# needed" convention ../chaos-tests/ uses for `docker` and
# apps/*/e2e/prepare-db.cjs uses for `pg`/`psql`.
#
# This is a standalone operator tool, same spirit as ../load-tests/, ../smoke-tests/,
# and ../chaos-tests/: it is NOT part of the pnpm workspace, NOT wired into any CI/CD
# workflow (.github/workflows/), and NOT wired into any app's `test` or `test:e2e`
# script. Nothing runs it automatically -- you run it manually, on demand.
#
# SAFETY: unlike ../chaos-tests/, which kills real containers, this script is strictly
# read-only against whatever database it targets -- `pg_dump` never writes to the
# source database. It is always safe to point at any reachable Postgres instance you
# have read access to, including a real production database, in the sense that it
# cannot corrupt or mutate it. See README.md for the full safety note and how this
# contrasts with ../restore-and-verify.js (which DOES create/drop a database) and with
# ../chaos-tests/ (which kills containers).
#
# USAGE:
#   ./backup.sh
#   DB_HOST=localhost DB_PORT=5544 DB_USER=gheychi DB_PASS=gheychi DB_NAME=gheychi \
#     OUTPUT_DIR=./backups ./backup.sh
#
# Prints the resulting dump file's absolute path as the last line of stdout, so it can
# be captured and handed straight to restore-and-verify.js:
#   DUMP_FILE=$(./backup.sh | tail -1)
#   node restore-and-verify.js "$DUMP_FILE"

set -euo pipefail

# Defaults match this repo's own docker-compose.yml Postgres service (see
# ../docker-compose.yml and apps/api/.env) -- so running this with no env vars set at
# all backs up your own local dev database.
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5544}"
DB_USER="${DB_USER:-gheychi}"
DB_PASS="${DB_PASS:-gheychi}"
DB_NAME="${DB_NAME:-gheychi}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT_DIR="${OUTPUT_DIR:-$SCRIPT_DIR/backups}"

for bin in pg_dump psql; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "[backup] ERROR: '$bin' not found on PATH -- install the Postgres client tools (e.g. 'brew install postgresql')." >&2
    exit 1
  fi
done

mkdir -p "$OUTPUT_DIR"

TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
DUMP_FILE="$OUTPUT_DIR/${DB_NAME}_${TIMESTAMP}.dump"
COUNTS_FILE="$DUMP_FILE.counts.json"

echo "[backup] target: ${DB_USER}@${DB_HOST}:${DB_PORT}/${DB_NAME}" >&2
echo "[backup] running pg_dump (custom format, compressed) -> $DUMP_FILE" >&2

# --format=custom is pg_restore-friendly and compressed by default (zlib level 6);
# --compress=9 squeezes a bit further since these are cold, timestamped archival
# dumps, not something being written under time pressure.
PGPASSWORD="$DB_PASS" pg_dump \
  --host="$DB_HOST" \
  --port="$DB_PORT" \
  --username="$DB_USER" \
  --dbname="$DB_NAME" \
  --format=custom \
  --compress=9 \
  --no-owner \
  --no-privileges \
  --file="$DUMP_FILE"

DUMP_SIZE="$(du -h "$DUMP_FILE" | cut -f1 | xargs)"
echo "[backup] pg_dump done: $DUMP_FILE ($DUMP_SIZE)" >&2

# Snapshot row counts on the same handful of core tables restore-and-verify.js checks,
# taken from the SOURCE database at dump time -- not re-queried later -- so a
# restore-and-verify.js run against this dump minutes, hours, or days from now still
# compares against what the database actually looked like at the moment it was
# dumped, even if real traffic has since changed the live source counts.
echo "[backup] recording source row counts at dump time -> $COUNTS_FILE" >&2

count_of() {
  PGPASSWORD="$DB_PASS" psql \
    --host="$DB_HOST" \
    --port="$DB_PORT" \
    --username="$DB_USER" \
    --dbname="$DB_NAME" \
    --tuples-only --no-align \
    --command="SELECT count(*) FROM $1;"
}

USERS_COUNT="$(count_of users)"
SALONS_COUNT="$(count_of salons)"
BOOKINGS_COUNT="$(count_of bookings)"

cat > "$COUNTS_FILE" <<JSON
{
  "sourceDb": "$DB_NAME",
  "sourceHost": "$DB_HOST",
  "sourcePort": $DB_PORT,
  "dumpedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "dumpFile": "$(basename "$DUMP_FILE")",
  "rowCounts": {
    "users": $USERS_COUNT,
    "salons": $SALONS_COUNT,
    "bookings": $BOOKINGS_COUNT
  }
}
JSON

echo "[backup] source row counts at dump time: users=$USERS_COUNT salons=$SALONS_COUNT bookings=$BOOKINGS_COUNT" >&2
echo "[backup] done." >&2

# Last stdout line only: the dump file's absolute path, for easy capture by a caller
# (everything else above is written to stderr specifically so this line can be piped
# cleanly, e.g. DUMP_FILE=$(./backup.sh | tail -1)).
echo "$DUMP_FILE"
