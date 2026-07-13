# DB Backup Automation

**Date:** 2026-07-14
**Status:** Approved
**Depends on:** Plan 9 (production deployment) — reuses `docker-compose.prod.yml`, the existing S3-compatible credentials, and the same bucket already wired up for salon photos and blog covers.

## 1. Product Summary

Plan 9 shipped a production deployment with zero backup story for the Postgres database — flagged at the time as a real gap, not an oversight. This plan closes it: a self-contained `backup` service in `docker-compose.prod.yml` that runs a daily `pg_dump`, uploads it to the same S3-compatible bucket the app already uses, and prunes anything older than 14 days. No new manual setup step beyond what `DEPLOY.md` already documents — `docker compose up -d` continues to be the entire deploy story.

### Decisions locked during brainstorming

- **Destination:** the same S3-compatible bucket already configured for salon photos/blog covers (`S3_BUCKET` etc.), under a new `backups/` prefix — reuses existing credentials, no new infrastructure.
- **Schedule/retention:** daily, 14 days kept.
- **Scope:** backups *and* a documented, actually-exercised restore procedure — a backup nobody has ever restored from is not a real safety net.

## 2. Architecture

### 2.1 New files

```
docker/backup/
├── Dockerfile      # postgres:16-alpine + the `mc` (MinIO Client) static binary
├── backup.sh       # one backup cycle: dump -> upload -> prune
└── crontab         # one daily entry, 03:00 UTC
```

`postgres:16-alpine` is the base because it ships the exact matching `pg_dump`/`pg_restore` for this Postgres version (16.x, matching `postgis/postgis:16-3.4`) and, being Alpine, already includes `crond` (part of busybox) — no extra scheduler package needed. `mc` is a single static binary that speaks the S3 API generically (AWS, MinIO, ArvanCloud, Liara, etc.), matching the same "any S3-compatible provider" assumption the app's own `S3StorageProvider` already makes — no AWS-specific tooling.

### 2.2 `backup.sh`

One script, used both for the immediate on-start backup and every scheduled cron firing:

1. Validate `DB_HOST`, `DB_USER`, `DB_PASS`, `DB_NAME`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` are all non-empty. If any are missing, log a clear, loud error and exit non-zero for that run — but the container itself keeps running (see §2.4), so this doesn't crash-loop.
2. `pg_dump -Fc` (custom compressed format — smaller than plain SQL + separate gzip, and `pg_restore` supports selective/parallel restore later if ever needed) to a temp file: `arayeshgah-<UTC ISO8601 timestamp, filesystem-safe>.dump`.
3. `mc alias set s3backup "$S3_ENDPOINT" "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY"` (the alias is always named `s3backup`, referenced the same way in the restore runbook below), then `mc cp` the dump to `s3backup/$S3_BUCKET/backups/<filename>`.
4. On successful upload, delete the local temp file.
5. `mc rm --older-than 14d` against the `backups/` prefix — MinIO Client's built-in age-based deletion, no hand-rolled date parsing.
6. Log a one-line success/failure summary either way.

Every step logs what it's doing; a failure at any step exits non-zero with the specific error visible in `docker compose logs backup` — no silent partial failures.

### 2.3 `crontab`

```
0 3 * * * /backup.sh >> /proc/1/fd/1 2>&1
```

Redirecting to the container's PID 1 stdout/stderr is the standard pattern for making `crond`'s output visible via `docker compose logs`, since cron jobs otherwise run detached from the container's own log stream.

### 2.4 Container entrypoint

The container's entrypoint runs `backup.sh` once immediately (so a fresh deploy gets a same-day backup instead of waiting up to 24h for the first cron firing), then starts `crond -f` in the foreground (keeping the container alive and handling all subsequent scheduled runs). If the immediate first run fails (e.g., misconfigured env vars), the entrypoint still proceeds to start `crond` rather than exiting — a config that's fixed later will pick up cleanly at the next scheduled run without needing a manual container restart.

### 2.5 `docker-compose.prod.yml` addition

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

Note this is the one service in the file built locally (`build:`) rather than pulled from GHCR — matching the plan's design (this is operational tooling, not a customer-facing app; no need for it to go through the CI image-build pipeline like the four app images do).

**Ambiguity resolved during self-review:** `DB_HOST` for `pg_dump` must resolve to `postgres` (the Docker Compose service name) for both this new `backup` service and the existing `api` service to reach the database — but `.env.example`'s committed default is `DB_HOST=localhost` (correct for local dev, wrong for this compose stack), and `DEPLOY.md`'s current one-time-setup step doesn't call out that a real production `.env` needs to override this (same issue applies to `REDIS_HOST`). This was never exercised end-to-end in Plan 9's own validation (which only checked `docker compose config` syntax, never a live `up -d`), so it's a latent, pre-existing gap this plan's testing step will surface and this plan's `DEPLOY.md` update will fix — not scope creep, since the backup service's own correctness depends on it.

## 3. Restore Runbook (`DEPLOY.md` addition)

Two documented paths, both starting from downloading a specific dated backup:

```bash
docker compose -f docker-compose.prod.yml exec backup mc cp \
  s3backup/$S3_BUCKET/backups/arayeshgah-2026-07-14T030000Z.dump /tmp/restore.dump
```

**Verify a backup restores cleanly (no data changed):**
```bash
docker compose -f docker-compose.prod.yml exec postgres createdb -U $DB_USER restore_check
docker compose -f docker-compose.prod.yml exec backup pg_restore -h postgres -U $DB_USER -d restore_check /tmp/restore.dump
# spot-check row counts, then:
docker compose -f docker-compose.prod.yml exec postgres dropdb -U $DB_USER restore_check
```

**Real disaster recovery (replace the live database):** same `pg_restore` command targeting `$DB_NAME` directly, with the API stopped first (`docker compose stop api`) to avoid writes racing the restore, `--clean --if-exists` flags to drop existing objects before recreating them, and the API restarted afterward.

`DEPLOY.md`'s one-time-setup step also gets a fix alongside this: explicitly call out that the real production `.env` must set `DB_HOST=postgres` and `REDIS_HOST=redis` (the Docker Compose service names), not the `.env.example` defaults of `localhost` — the pre-existing gap identified in §2.5.

## 4. Error Handling

- Missing/invalid credentials, a failed `pg_dump`, or a failed `mc` upload all exit non-zero and log clearly — no automated alerting/paging, consistent with this project's existing accepted MVP cut for payment-reconciliation errors (`logger.error(...)` with no paging integration). `DEPLOY.md` tells the operator to check `docker compose logs backup` periodically.
- Pruning (`mc rm --older-than 14d`) only runs after a successful upload in that cycle — a failed backup never deletes older, still-valid ones.

## 5. Testing

- **Local backup mechanics:** a throwaway local MinIO container stands in for S3 (no real cloud credentials needed for this). Point `backup.sh` at it via env vars, run it against the local dev Postgres, confirm a real `.dump` lands in the bucket under `backups/`, and confirm `--older-than` pruning removes an artificially-aged test object.
- **Restore, actually exercised:** dump the local dev database for real, restore it into a scratch database, and compare row counts per table against the source to prove the restore path produces a genuinely usable database — not just that the commands exit 0.

## 6. Out of Scope (deliberate)

- Automated alerting/paging on backup failure (matches the existing accepted cut for payment-reconciliation errors).
- Point-in-time recovery (WAL archiving) — daily full dumps only. Acceptable data-loss window for this plan: up to 24 hours.
- Backup encryption at rest beyond whatever the S3-compatible provider already does server-side — no additional application-level encryption layer.
- A sitemap-index-style multi-file/incremental backup strategy for when the database grows very large — daily full `pg_dump -Fc` is the whole story for now.
