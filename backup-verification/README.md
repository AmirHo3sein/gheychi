# Backup / restore verification

Two standalone scripts that prove a real `pg_dump` backup of this database can actually
be restored and is structurally intact -- not just "the file exists" or "`pg_restore`
exited 0", but real row counts and a real foreign-key join checked against the restored
copy. This fills a real, previously-flagged gap: nothing else in this codebase exercises
backup/restore at all.

This is a standalone operator tool, same spirit as `../load-tests/`, `../smoke-tests/`,
and `../chaos-tests/`: it is **not** part of the pnpm workspace, **not** wired into any
CI/CD workflow (`.github/workflows/`), and **not** wired into any app's `test` or
`test:e2e` script. Nothing runs it automatically. You run it manually, on demand.

## Safety note -- read this, especially if you've just read `../chaos-tests/README.md`

`../chaos-tests/` kills real Docker containers by name -- that's genuinely dangerous
against the wrong target. **This directory is a different risk profile, and the two
scripts here are different risk profiles from each other:**

- **`backup.sh` is strictly read-only.** `pg_dump` never writes to, locks out, or
  mutates the database it targets in any way that matters -- it takes an MVCC snapshot
  and reads. It is always safe to point at any Postgres database you have read access
  to, including a real production database, in the sense that it cannot corrupt or
  change it. The only real-world caveat is unrelated to correctness: a `pg_dump` of a
  large production database is I/O and (briefly) lock-load on that instance, so treat it
  with the same operational courtesy you'd give any other large read query -- but it will
  not corrupt your data. Never run it against a database whose data you don't actually
  intend to be reading a full copy of, for the ordinary reason that it copies that data
  out to a file on disk wherever `OUTPUT_DIR` points.

- **`restore-and-verify.js` is NOT read-only -- it creates a database, then drops it.**
  It only ever creates and drops the *throwaway* restore-target database named by
  `RESTORE_DB_NAME` -- it never touches the source database the dump came from. But
  because it does run `dropdb` on whatever `RESTORE_DB_NAME` names, **never point
  `RESTORE_DB_NAME` at a real or existing database name.** The script guards against
  this by default (see below), but that guard is a backstop, not a substitute for you
  knowing what you're pointing it at.

Put simply: `backup.sh` is safe against anything, the same way
`../smoke-tests/post-deploy-smoke-test.js` is always safe against a live instance.
`restore-and-verify.js` is safe *only* because it's careful about exactly one thing --
the throwaway database name -- the same way `../chaos-tests/` is safe *only* because
you point it at containers you actually control. Don't conflate "the read half of this
directory is always safe" with "the whole directory is always safe."

## Required env vars (all optional -- defaults match this repo's own dev stack)

Defaults match `../docker-compose.yml`'s Postgres service and `apps/api/.env`.

| Var | Applies to | Default | Meaning |
|---|---|---|---|
| `DB_HOST` | both | `localhost` | Postgres host. |
| `DB_PORT` | both | `5544` | Postgres port (this repo maps container `5432` -> host `5544`, see `../docker-compose.yml`). |
| `DB_USER` | both | `gheychi` | Postgres user. |
| `DB_PASS` | both | `gheychi` | Postgres password. |
| `DB_NAME` | `backup.sh` | `gheychi` | Source database to dump. |
| `SOURCE_DB_NAME` | `restore-and-verify.js` | value of `DB_NAME`, else `gheychi` | Source database name, used only to (a) refuse to ever let `RESTORE_DB_NAME` collide with it, and (b) as a live-count fallback if a dump's `.counts.json` sidecar is missing. |
| `OUTPUT_DIR` | `backup.sh` | `./backups` (next to this README) | Where dump files (and their `.counts.json` sidecars) are written. |
| `RESTORE_DB_NAME` | `restore-and-verify.js` | `gheychi_restore_verify` | Throwaway database name to restore into. **Never a real database name** -- see safety note above and the guard rails below. |
| `KEEP_RESTORE_DB` | `restore-and-verify.js` | unset | Set to `1` to skip the final `dropdb` and leave the restored throwaway database in place for manual inspection. |
| `I_KNOW_THIS_DROPS_DATABASES` | `restore-and-verify.js` | unset | Set to `1` to allow a `RESTORE_DB_NAME` that doesn't contain the substring `restore_verify`. See guard rails below -- this is a backstop, not permission to use a real database name. |

## `backup.sh`

Runs a real `pg_dump` (custom format, compressed, `--no-owner --no-privileges`) against
the target database and writes a timestamped `.dump` file into `OUTPUT_DIR`, plus a
sidecar `<dump-file>.counts.json` recording row counts on `users`, `salons`, and
`bookings` **at dump time** (queried from the source database in the same run, right
after `pg_dump` finishes) -- this is what lets `restore-and-verify.js` compare against
counts as they were *when the dump was taken*, not counts as they happen to be whenever
someone later gets around to running the restore check.

```bash
./backup.sh
# or, fully explicit (these happen to be the defaults):
DB_HOST=localhost DB_PORT=5544 DB_USER=gheychi DB_PASS=gheychi DB_NAME=gheychi \
  OUTPUT_DIR=./backups ./backup.sh
```

Writes progress to stderr; the very last line on stdout is the dump file's absolute
path, so you can capture it directly:

```bash
DUMP_FILE=$(./backup.sh | tail -1)
node restore-and-verify.js "$DUMP_FILE"
```

## `restore-and-verify.js`

Plain Node.js (built-in `child_process` only -- no dependencies; `pg` is not resolvable
from this directory without adding it to a `package.json`, so this shells out to the
`createdb` / `pg_restore` / `psql` / `dropdb` Postgres client binaries instead, the same
"shell out where needed" convention `../chaos-tests/` uses for `docker`).

```bash
node restore-and-verify.js ./backups/gheychi_20260811_120000.dump
# or
DUMP_FILE=./backups/gheychi_20260811_120000.dump node restore-and-verify.js
```

What it does, in order:

1. **Guard rails on `RESTORE_DB_NAME`** (default `gheychi_restore_verify`): refuses to
   run if it matches a known real database name from this repo (`gheychi`,
   `gheychi_test`, `gheychi_e2e`, `postgres`, `template0`, `template1`, or whatever
   `SOURCE_DB_NAME`/`DB_NAME` resolves to), and by default refuses to run unless the
   name contains the substring `restore_verify` (override with
   `I_KNOW_THIS_DROPS_DATABASES=1`, but only ever with a genuinely throwaway name).
2. If a database with that name already exists (e.g. left over from a previous run that
   crashed before cleanup), drops it first -- safe, because the name is already
   guard-railed to be a throwaway one.
3. `createdb` a fresh database with that name, then `pg_restore` the dump file into it.
4. Loads dump-time row counts from the dump's `<file>.counts.json` sidecar (falls back
   to querying the *live* source database now, with a clearly printed warning, if the
   sidecar is missing).
5. Runs sanity queries against the restored copy:
   - `SELECT count(*) FROM users` / `salons` / `bookings`, each compared against the
     recorded source counts.
   - A real foreign-key-heavy join -- `bookings JOIN users ON user_id JOIN salons ON
     salon_id` -- compared against the restored `bookings` count, proving every booking's
     relationships survived the restore, not just that the tables have the right number
     of rows. Prints one concrete joined row as human-readable evidence.
6. **Always** drops the throwaway database in a `finally` block -- even if a check above
   failed -- unless `KEEP_RESTORE_DB=1` is set, in which case it prints the exact
   `dropdb` command to run by hand later.

Prints `[PASS]`/`[FAIL]` per check, then a summary, then exits `0` if everything passed
or `1` if anything failed.

## Full example

```bash
DUMP_FILE=$(./backup.sh | tail -1)
node restore-and-verify.js "$DUMP_FILE"
echo "exit code: $?"
```

## A real warning you may see: `pg_restore: warning: errors ignored on restore: 1`

If your local `pg_dump`/`pg_restore` client (e.g. Homebrew's, often the latest major
version) is newer than the Postgres *server* this repo's `../docker-compose.yml` runs
(`postgis/postgis:16-3.4`, i.e. server 16), `pg_restore` prints exactly one ignorable
error:

```
pg_restore: error: could not execute query: ERROR:  unrecognized configuration parameter "transaction_timeout"
Command was: SET transaction_timeout = 0;
pg_restore: warning: errors ignored on restore: 1
```

`transaction_timeout` is a session-scoped `SET` a newer client's dump preamble emits
unconditionally; it's simply not a parameter Postgres 16 knows about, and skipping it
has no effect on the actual restored data. `restore-and-verify.js` already accounts for
this: it doesn't treat a non-zero `pg_restore` exit code as fatal by itself -- it checks
that the core tables actually exist afterward, then lets the row-count and join checks
be the real proof the data came back intact. This was observed on a real run against
this repo's own dev stack (client `pg_dump`/`pg_restore` 17.x, server 16.4) and every
check still passed.
