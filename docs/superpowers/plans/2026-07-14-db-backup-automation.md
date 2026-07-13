# DB Backup Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the "no database backup automation" gap flagged in Plan 9 — a self-contained `backup` service in `docker-compose.prod.yml` that daily-dumps Postgres, uploads to the same S3-compatible bucket already used for salon photos/blog covers, prunes anything older than 14 days, and has an actually-exercised restore procedure documented in `DEPLOY.md`.

**Architecture:** A new `docker/backup/` image built from `postgres:16-alpine` (matching `pg_dump`/`pg_restore` version) plus the official MinIO Client (`mc`) static binary. A POSIX-sh script does one backup cycle (dump → upload → prune); Alpine's built-in `crond` runs it daily, and the container also runs it once immediately on start. Along the way, a real pre-existing gap in `DEPLOY.md` gets fixed: the production `.env` needs `DB_HOST=postgres`/`REDIS_HOST=redis` overrides that were never called out.

**Tech Stack:** `postgres:16-alpine` (for `pg_dump`/`pg_restore`), MinIO Client (`mc`) for S3-compatible uploads, Alpine's `crond`, Docker Compose.

---

## Before You Start

All commands below assume the repo root (`~/projects/Arayeshgah`) as the working directory. Testing this plan requires a local MinIO container as a stand-in for real S3 (no real cloud credentials needed) and the existing dev Postgres from the root `docker-compose.yml` (`docker compose up -d` if not already running).

---

## Task 1: `docker/backup/` image — dump, upload, prune script

**Files:**
- Create: `docker/backup/backup.sh`
- Create: `docker/backup/entrypoint.sh`
- Create: `docker/backup/crontab`
- Create: `docker/backup/Dockerfile`

- [ ] **Step 1: Write the backup script**

Create `docker/backup/backup.sh`:

```sh
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
FILENAME="arayeshgah-${TIMESTAMP}.dump"
DUMP_PATH="/tmp/${FILENAME}"

echo "[backup] starting dump to ${DUMP_PATH}"
PGPASSWORD="$DB_PASS" pg_dump -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -Fc -f "$DUMP_PATH"
echo "[backup] dump complete ($(du -h "$DUMP_PATH" | cut -f1))"

mc alias set s3backup "$S3_ENDPOINT" "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY" >/dev/null
echo "[backup] uploading to s3backup/${S3_BUCKET}/backups/${FILENAME}"
mc cp "$DUMP_PATH" "s3backup/${S3_BUCKET}/backups/${FILENAME}"
rm -f "$DUMP_PATH"

echo "[backup] pruning backups older than 14 days"
mc rm --recursive --force --older-than "14d" "s3backup/${S3_BUCKET}/backups/"

echo "[backup] done: ${FILENAME}"
```

The `: "${VAR:?message}"` lines are POSIX `sh` parameter-expansion errors — each one exits the script immediately with `message` on stderr if that variable is unset or empty, before any dump/upload work starts. `-Fc` is Postgres's custom compressed dump format (smaller than plain SQL, and `pg_restore` supports selective/parallel restore later if ever needed).

- [ ] **Step 2: Write the entrypoint**

Create `docker/backup/entrypoint.sh`:

```sh
#!/bin/sh
set -eu

# Run once immediately so a fresh deploy gets a same-day backup instead of waiting for
# the next scheduled cron firing (up to 24h away). A failure here must not stop the
# container -- crond still needs to start so later scheduled runs can succeed once
# whatever's wrong (e.g. missing env vars) is fixed, without a manual restart.
/backup.sh || echo "[entrypoint] initial backup run failed, continuing to start crond anyway"

exec crond -f -l 2
```

`crond -f` keeps the process in the foreground (required for the container to stay alive); `-l 2` sets crond's own log verbosity to include normal job-start/end lines.

- [ ] **Step 3: Write the crontab**

Create `docker/backup/crontab`:

```
0 3 * * * /backup.sh >> /proc/1/fd/1 2>&1
```

Redirecting to `/proc/1/fd/1` (the container's PID 1 stdout) is the standard way to make a cron job's output show up in `docker compose logs backup` — cron jobs otherwise run detached from the container's own log stream.

- [ ] **Step 4: Write the Dockerfile**

Create `docker/backup/Dockerfile`:

```dockerfile
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
```

The `COPY` paths are relative to the build context (repo root — see Task 2's `context: .`), matching the pattern the other four Dockerfiles in this repo already use. `postgres:16-alpine`'s own `ENTRYPOINT`/`CMD` (which normally boots a Postgres *server*) is fully overridden here — this container only ever uses the image for its bundled client tools (`pg_dump`, `pg_restore`, `psql`, `createdb`, `dropdb`), it never runs `postgres` itself.

- [ ] **Step 5: Build the image**

Run: `docker build -f docker/backup/Dockerfile -t arayeshgah-backup:test .`
Expected: builds cleanly through the single stage; `docker run --rm arayeshgah-backup:test pg_dump --version` prints a `pg_dump (PostgreSQL) 16.x` line, and `docker run --rm arayeshgah-backup:test mc --version` prints a MinIO client version line.

- [ ] **Step 6: Stand up a local MinIO container as a stand-in for real S3**

```bash
docker run -d --name arayeshgah-minio-test -p 9000:9000 -p 9001:9001 \
  -e MINIO_ROOT_USER=minioadmin -e MINIO_ROOT_PASSWORD=minioadmin123 \
  minio/minio server /data --console-address ":9001"
sleep 3
docker run --rm --network host -e MC_HOST_local=http://minioadmin:minioadmin123@localhost:9000 \
  minio/mc mb local/arayeshgah-backups-test
```

Expected: the second command prints `Bucket created successfully`. This MinIO instance and bucket are purely local test infrastructure, not committed anywhere.

- [ ] **Step 7: Run a real backup cycle against local dev Postgres + the test bucket**

Ensure the dev stack is up first: `docker compose up -d` (from repo root, starts the pre-existing dev Postgres/Redis) and migrations have been run at least once (`pnpm --filter @arayeshgah/api migration:run`).

```bash
docker run --rm --network host \
  -e DB_HOST=localhost -e DB_USER=arayeshgah -e DB_PASS=arayeshgah -e DB_NAME=arayeshgah \
  -e S3_ENDPOINT=http://localhost:9000 -e S3_BUCKET=arayeshgah-backups-test \
  -e S3_ACCESS_KEY_ID=minioadmin -e S3_SECRET_ACCESS_KEY=minioadmin123 \
  arayeshgah-backup:test /backup.sh
```

Expected: prints `[backup] starting dump...`, `[backup] dump complete (<size>)`, `[backup] uploading to s3backup/arayeshgah-backups-test/backups/arayeshgah-<timestamp>.dump`, `[backup] pruning backups older than 14 days`, `[backup] done: <filename>`. Note `--network host` is used only for this local test so the container can reach the dev Postgres/MinIO bound to `localhost` — the real deployment uses the compose-internal `internal` network instead (Task 2), no `--network host` there.

- [ ] **Step 8: Verify the dump actually landed in the bucket, and that pruning didn't delete it**

```bash
docker run --rm --network host -e MC_HOST_local=http://minioadmin:minioadmin123@localhost:9000 \
  minio/mc ls local/arayeshgah-backups-test/backups/
```

Expected: lists exactly one `.dump` file (the one just uploaded) with a non-trivial size (at least a few KB, confirming it's a real dump, not an empty/failed file) — proving the upload succeeded and the immediately-following prune step correctly left a fresh (well under 14 days old) object alone.

- [ ] **Step 9: Tear down the local test MinIO container**

```bash
docker rm -f arayeshgah-minio-test
```

- [ ] **Step 10: Commit**

```bash
git add docker/backup/backup.sh docker/backup/entrypoint.sh docker/backup/crontab docker/backup/Dockerfile
git commit -m "feat(deploy): add DB backup service image (dump, upload to S3, prune)"
```

---

## Task 2: Wire the `backup` service into `docker-compose.prod.yml`

**Files:**
- Modify: `docker-compose.prod.yml`

- [ ] **Step 1: Add the service**

In `docker-compose.prod.yml`, add this new service (after `caddy:`, before the top-level `networks:` key):

```yaml
  backup:
    build:
      context: .
      dockerfile: docker/backup/Dockerfile
    restart: unless-stopped
    env_file: .env
    depends_on:
      postgres:
        condition: service_healthy
    networks: [internal]
```

This is the one service in the file built locally (`build:`) rather than pulled from GHCR — it's operational tooling, not a customer-facing app, so it doesn't need to go through the CI image-build pipeline the four app images use (Plan 9's `build-and-push` CI job is not modified by this plan). `DB_HOST`/`REDIS_HOST` resolve via the compose-internal `internal` network's DNS (service name `postgres`) — see Task 3 for a related pre-existing gap this surfaces.

- [ ] **Step 2: Validate the compose file resolves correctly**

```bash
cp .env.example .env
docker compose -f docker-compose.prod.yml config --quiet
rm .env
```

Expected: exit code 0, no warnings — confirms the new service's `env_file`/`depends_on`/network wiring is syntactically and referentially correct. **Delete the throwaway `.env` before finishing** — do not leave it in the working tree or commit it.

- [ ] **Step 3: Commit**

```bash
git add docker-compose.prod.yml
git commit -m "feat(deploy): add backup service to the production compose stack"
```

---

## Task 3: Fix the `DB_HOST`/`REDIS_HOST` production gap in `DEPLOY.md`

Plan 9's `docker-compose.prod.yml` design requires `DB_HOST=postgres` and `REDIS_HOST=redis` (the Docker Compose service names) in the real production `.env`, but `.env.example`'s committed defaults are `DB_HOST=localhost`/`REDIS_HOST=localhost` (correct for local dev, wrong for this compose stack) — and `DEPLOY.md`'s one-time-setup step never called this out. This was never exercised end-to-end in Plan 9 (only `docker compose config` syntax was checked, never a live `up -d`), so it's a latent gap this plan's Task 4 (which does bring the stack up for real) would otherwise hit. Not scope creep — the `backup` service's own correctness depends on `DB_HOST` resolving correctly, same as `api`'s already does.

**Files:**
- Modify: `docs/deployment/DEPLOY.md`

- [ ] **Step 1: Fix the one-time setup step**

In `docs/deployment/DEPLOY.md`, find this line in the "One-time VPS setup" numbered list:

```
3. Create a deploy directory and copy three files into it from this repo: `docker-compose.prod.yml`, `Caddyfile`, and a `.env` you create from `.env.example` — **fill in real values**, especially `DB_PASS`, `JWT_SECRET`, the four `DOMAIN_*` vars, `ACME_EMAIL`, and (per the provider cutover checklist below) the real SMS/payment/storage/push credentials once you're ready to go live with them.
```

Replace it with:

```
3. Create a deploy directory and copy three files into it from this repo: `docker-compose.prod.yml`, `Caddyfile`, and a `.env` you create from `.env.example` — **fill in real values**, especially `DB_PASS`, `JWT_SECRET`, the four `DOMAIN_*` vars, `ACME_EMAIL`, and (per the provider cutover checklist below) the real SMS/payment/storage/push credentials once you're ready to go live with them. **Also override `DB_HOST=postgres` and `REDIS_HOST=redis`** — `.env.example`'s `localhost` defaults are correct for local dev only; in this compose stack, `api`, `user-app`, and `backup` all reach Postgres/Redis by their Docker Compose service names, not `localhost`.
```

- [ ] **Step 2: Commit**

```bash
git add docs/deployment/DEPLOY.md
git commit -m "docs: fix DB_HOST/REDIS_HOST production override gap in DEPLOY.md"
```

---

## Task 4: Restore runbook + operational note in `DEPLOY.md`, actually exercised

**Files:**
- Modify: `docs/deployment/DEPLOY.md`

- [ ] **Step 1: Replace the "no backup automation" operational note**

In `docs/deployment/DEPLOY.md`, find this line under "## Operational notes":

```
- **No database backup automation exists yet.** This is a known gap, not an oversight — see the design doc's Open Risks section. Set up a `pg_dump` cron (e.g., to the same S3 bucket already wired up below) before trusting this with real customer data long-term.
```

Replace it with:

```
- **Database backups run automatically.** The `backup` service dumps Postgres daily (03:00 UTC, plus once immediately whenever the stack starts) to `s3://$S3_BUCKET/backups/`, keeping 14 days. A failed backup logs loudly to `docker compose logs backup` rather than paging anyone — check it periodically. See "## Restoring a backup" below.
```

- [ ] **Step 2: Add the restore runbook section**

In `docs/deployment/DEPLOY.md`, add this new section immediately after the "## Rollback" section (before "## Operational notes"):

```markdown
## Restoring a backup

Download a specific dated backup from S3 (list what's available with `docker compose -f docker-compose.prod.yml exec backup mc ls s3backup/$S3_BUCKET/backups/` first):

```bash
docker compose -f docker-compose.prod.yml exec backup mc cp \
  s3backup/$S3_BUCKET/backups/arayeshgah-2026-07-14T030000Z.dump /tmp/restore.dump
```

**Verify a backup restores cleanly, without touching the live database:**

```bash
docker compose -f docker-compose.prod.yml exec postgres createdb -U $DB_USER restore_check
docker compose -f docker-compose.prod.yml exec backup pg_restore -h postgres -U $DB_USER -d restore_check /tmp/restore.dump
# spot-check row counts against the live database here, then:
docker compose -f docker-compose.prod.yml exec postgres dropdb -U $DB_USER restore_check
```

**Real disaster recovery (replaces the live database):**

```bash
docker compose -f docker-compose.prod.yml stop api
docker compose -f docker-compose.prod.yml exec backup pg_restore -h postgres -U $DB_USER -d $DB_NAME --clean --if-exists /tmp/restore.dump
docker compose -f docker-compose.prod.yml start api
```

Stopping `api` first avoids live writes racing the restore; `--clean --if-exists` drops existing objects before recreating them from the dump.
```

- [ ] **Step 3: Commit the documentation**

```bash
git add docs/deployment/DEPLOY.md
git commit -m "docs: add backup restore runbook to DEPLOY.md"
```

- [ ] **Step 4: Actually exercise the restore path against real local data**

This step proves the restore procedure genuinely works, not just that the commands run without erroring — per the design's locked decision, a backup nobody has ever restored from is not a real safety net.

Ensure dev Postgres is up and migrated (`docker compose up -d`, `pnpm --filter @arayeshgah/api migration:run` if not already run). If the `arayeshgah-backup:test` image from Task 1 is no longer in your local Docker image cache (e.g. resuming in a fresh environment), rebuild it first: `docker build -f docker/backup/Dockerfile -t arayeshgah-backup:test .`

Dump the dev database for real, using the same tool the backup service uses, with the host's current directory volume-mounted so the dump file lands on disk (not trapped inside an ephemeral container):

```bash
docker run --rm --network host -e PGPASSWORD=arayeshgah -v "$(pwd)":/out \
  arayeshgah-backup:test pg_dump -h localhost -U arayeshgah -d arayeshgah -Fc -f /out/local-test.dump
```

Record the source row counts for a couple of seeded tables (migrations seed `service_categories`, among others):

```bash
docker compose exec postgres psql -U arayeshgah -d arayeshgah -c "SELECT count(*) FROM service_categories;"
```

Restore into a scratch database and compare:

```bash
docker compose exec postgres createdb -U arayeshgah restore_verify_test
docker run --rm --network host -e PGPASSWORD=arayeshgah -v "$(pwd)":/out \
  arayeshgah-backup:test pg_restore -h localhost -U arayeshgah -d restore_verify_test /out/local-test.dump
docker compose exec postgres psql -U arayeshgah -d restore_verify_test -c "SELECT count(*) FROM service_categories;"
```

Expected: the `service_categories` count (and any other table you spot-check) matches exactly between the source `arayeshgah` database and the restored `restore_verify_test` database. Clean up afterward:

```bash
docker compose exec postgres dropdb -U arayeshgah restore_verify_test
rm -f local-test.dump
```

- [ ] **Step 5: Record the verification result**

No code change here — this step is the actual proof the design's "restore actually exercised" requirement is met. If step 4's counts didn't match, stop and debug before proceeding — do not mark this task complete with a silently-broken restore path.

---

## Task 5: Update `CLAUDE.md`'s Known Gaps

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Close out the gap**

In `CLAUDE.md`, find this sentence inside the Plan 9 bullet under "## Known Gaps / Future Plans":

```
**No database backup automation** — flagged as an immediate next follow-up, not part of this plan's scope.
```

Replace it with:

```
**Database backup automation shipped as a follow-up.** A `backup` service in `docker-compose.prod.yml` (built from `docker/backup/`, `postgres:16-alpine` + the MinIO Client) dumps Postgres daily to the same S3-compatible bucket under a `backups/` prefix, keeps 14 days, and the restore path is documented and was actually exercised (not just written) — see `docs/deployment/DEPLOY.md`'s "Restoring a backup" section and `docs/superpowers/specs/2026-07-14-db-backup-automation-design.md`. Along the way this surfaced and fixed a real pre-existing gap: `DEPLOY.md`'s one-time setup never called out that production `.env` needs `DB_HOST=postgres`/`REDIS_HOST=redis` overrides (Plan 9's own validation never exercised a live `docker compose up -d`, only `config` syntax checks). No point-in-time recovery (WAL archiving) — daily full dumps only, accepted up-to-24h data-loss window. No automated alerting on backup failure — matches the existing accepted cut for payment-reconciliation errors.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: record DB backup automation in CLAUDE.md Known Gaps"
```

---

## Final Verification

- [ ] `docker build -f docker/backup/Dockerfile -t arayeshgah-backup:test .` succeeds
- [ ] A real backup cycle (Task 1, Step 7) uploads a valid, non-trivial-sized `.dump` to a test bucket
- [ ] `docker compose -f docker-compose.prod.yml config --quiet` succeeds with the new `backup` service present
- [ ] The restore path (Task 4, Step 4) was actually run once, with matching row counts confirmed — not just documented
- [ ] No stray test artifacts (`local-test.dump`, throwaway `.env` files, the test MinIO container) left behind
