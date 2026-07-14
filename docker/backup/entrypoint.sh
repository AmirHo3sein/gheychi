#!/bin/sh
set -eu

# Run once immediately so a fresh deploy gets a same-day backup instead of waiting for
# the next scheduled cron firing (up to 24h away). A failure here must not stop the
# container -- crond still needs to start so later scheduled runs can succeed once
# whatever's wrong (e.g. missing env vars) is fixed, without a manual restart.
/backup.sh || echo "[entrypoint] initial backup run failed, continuing to start crond anyway"

exec crond -f -l 2
