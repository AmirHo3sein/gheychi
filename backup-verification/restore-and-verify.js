#!/usr/bin/env node
// restore-and-verify.js -- takes a dump file produced by backup.sh, restores it into a
// brand-new, clearly-throwaway-named database (never an existing/real one), then runs a
// handful of real sanity queries against the restored copy to prove the restored data is
// actually structurally intact -- not just that `pg_restore` exited 0.
//
// WHAT THIS IS: a plain Node.js script (built-in `child_process`, no dependencies -- 'pg'
// is not resolvable from this directory without adding it to a package.json, so this
// shells out to the `createdb`/`pg_restore`/`psql`/`dropdb` Postgres client binaries
// instead, same "shell out where needed" convention ../chaos-tests/ uses for `docker`).
//
// This is a standalone operator tool, same spirit as ../load-tests/, ../smoke-tests/,
// and ../chaos-tests/: it is NOT part of the pnpm workspace, NOT wired into any CI/CD
// workflow (.github/workflows/), and NOT wired into any app's `test` or `test:e2e`
// script. Nothing runs it automatically -- you run it manually, on demand.
//
// SAFETY -- READ THIS BEFORE CHANGING RESTORE_DB_NAME:
// Unlike backup.sh (strictly read-only against whatever you point it at -- see its own
// header and README.md), THIS SCRIPT CREATES AND THEN DROPS A REAL DATABASE. It never
// touches the source database the dump came from, but it will happily DROP whatever
// database RESTORE_DB_NAME names once it's done -- so RESTORE_DB_NAME must always be a
// throwaway name, never a real/existing database. As a backstop (not a substitute for
// you knowing what you're pointing this at): by default the name must contain
// "restore_verify" and must not match a small list of known-real database names from
// this repo (gheychi, gheychi_test, gheychi_e2e, postgres, template0, template1). Override
// the substring requirement with I_KNOW_THIS_DROPS_DATABASES=1 -- but never point this at
// a database anything else depends on.
//
// WHAT IT VERIFIES:
//   1. pg_restore actually completes (no fatal errors -- warnings about objects that
//      already exist on a fresh template, e.g. plpgsql, are expected and not fatal).
//   2. Row counts on users/salons/bookings in the restored copy match the SOURCE
//      database's own counts *at dump time* (read from the `<dump>.counts.json`
//      sidecar file backup.sh writes next to every dump -- not re-queried from the
//      live source now, which could have drifted since the dump was taken). If that
//      sidecar file is missing (a dump produced some other way), this falls back to
//      querying the live source database now and prints a clear warning that the
//      comparison is against current, not dump-time, counts.
//   3. A real foreign-key-heavy join (bookings -> users, bookings -> salons) resolves
//      against the restored copy and returns the same count as the bookings table
//      itself -- proving relational integrity survived the round-trip, not just that
//      the tables exist and have rows.
//
// USAGE:
//   node restore-and-verify.js ./backups/gheychi_20260811_120000.dump
//   DUMP_FILE=./backups/gheychi_20260811_120000.dump node restore-and-verify.js
//
// Exit code: 0 if every check passes, 1 otherwise. The throwaway database is always
// dropped in a `finally` (even on failure) unless KEEP_RESTORE_DB=1 is set.

'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

// ---------------------------------------------------------------------------
// Config -- same defaults as backup.sh / ../docker-compose.yml / apps/api/.env.
// ---------------------------------------------------------------------------
const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_PORT = process.env.DB_PORT || '5544';
const DB_USER = process.env.DB_USER || 'gheychi';
const DB_PASS = process.env.DB_PASS || 'gheychi';
// Name of the SOURCE database the dump came from -- only used as a fallback to query
// live counts if the dump's `.counts.json` sidecar is missing, and to refuse to ever
// name the restore target the same as the source.
const SOURCE_DB_NAME = process.env.SOURCE_DB_NAME || process.env.DB_NAME || 'gheychi';

const RESTORE_DB_NAME = process.env.RESTORE_DB_NAME || 'gheychi_restore_verify';
const KEEP_RESTORE_DB = process.env.KEEP_RESTORE_DB === '1';
const I_KNOW_THIS_DROPS_DATABASES = process.env.I_KNOW_THIS_DROPS_DATABASES === '1';

const KNOWN_REAL_DB_NAMES = new Set([
  SOURCE_DB_NAME,
  'gheychi',
  'gheychi_test',
  'gheychi_e2e',
  'postgres',
  'template0',
  'template1',
]);

const DUMP_FILE = process.argv[2] || process.env.DUMP_FILE;

const results = []; // { name, pass, detail }

function log(msg) {
  console.log(msg);
}

function record(name, pass, detail) {
  results.push({ name, pass, detail });
  log(`[${pass ? 'PASS' : 'FAIL'}] ${name}${detail ? ' -- ' + detail : ''}`);
}

function psqlArgsBase(dbName) {
  return ['--host', DB_HOST, '--port', String(DB_PORT), '--username', DB_USER, '--dbname', dbName, '--no-password'];
}

function psqlQuery(dbName, sql) {
  const out = execFileSync(
    'psql',
    [...psqlArgsBase(dbName), '--tuples-only', '--no-align', '--command', sql],
    { env: { ...process.env, PGPASSWORD: DB_PASS }, encoding: 'utf8' },
  );
  return out.trim();
}

function psqlExec(dbName, sql) {
  execFileSync(
    'psql',
    [...psqlArgsBase(dbName), '--command', sql],
    { env: { ...process.env, PGPASSWORD: DB_PASS }, stdio: 'inherit' },
  );
}

function assertBinariesPresent() {
  for (const bin of ['psql', 'createdb', 'dropdb', 'pg_restore']) {
    try {
      execFileSync('sh', ['-c', `command -v ${bin}`], { stdio: 'ignore' });
    } catch {
      log(`[restore-and-verify] ERROR: '${bin}' not found on PATH -- install the Postgres client tools (e.g. 'brew install postgresql').`);
      process.exit(1);
    }
  }
}

function validateInputs() {
  if (!DUMP_FILE) {
    log('[restore-and-verify] ERROR: no dump file given. Usage: node restore-and-verify.js <dump-file>  (or set DUMP_FILE=...)');
    process.exit(1);
  }
  if (!fs.existsSync(DUMP_FILE)) {
    log(`[restore-and-verify] ERROR: dump file not found: ${DUMP_FILE}`);
    process.exit(1);
  }

  if (KNOWN_REAL_DB_NAMES.has(RESTORE_DB_NAME)) {
    log(`[restore-and-verify] REFUSING TO RUN: RESTORE_DB_NAME="${RESTORE_DB_NAME}" matches a known real database name (${[...KNOWN_REAL_DB_NAMES].join(', ')}).`);
    log('[restore-and-verify] This script creates AND DROPS the restore-target database -- pointing it at a real database name would destroy real data. Pick a clearly throwaway name.');
    process.exit(1);
  }
  if (!RESTORE_DB_NAME.includes('restore_verify') && !I_KNOW_THIS_DROPS_DATABASES) {
    log(`[restore-and-verify] REFUSING TO RUN: RESTORE_DB_NAME="${RESTORE_DB_NAME}" does not contain "restore_verify".`);
    log('[restore-and-verify] This is a backstop against accidentally pointing this at a real database -- set I_KNOW_THIS_DROPS_DATABASES=1 to override, but only ever with a genuinely throwaway name.');
    process.exit(1);
  }
}

function loadDumpTimeCounts() {
  const countsFile = `${DUMP_FILE}.counts.json`;
  if (fs.existsSync(countsFile)) {
    const meta = JSON.parse(fs.readFileSync(countsFile, 'utf8'));
    log(`[restore-and-verify] using dump-time source counts from ${path.basename(countsFile)} (dumped at ${meta.dumpedAt})`);
    return meta.rowCounts;
  }

  log(`[restore-and-verify] WARNING: no sidecar counts file (${path.basename(countsFile)}) next to this dump.`);
  log(`[restore-and-verify] WARNING: falling back to querying the LIVE source database "${SOURCE_DB_NAME}" now -- this compares against CURRENT counts, not counts at dump time, which is a weaker check if the source has changed since the dump was taken.`);
  return {
    users: Number(psqlQuery(SOURCE_DB_NAME, 'SELECT count(*) FROM users;')),
    salons: Number(psqlQuery(SOURCE_DB_NAME, 'SELECT count(*) FROM salons;')),
    bookings: Number(psqlQuery(SOURCE_DB_NAME, 'SELECT count(*) FROM bookings;')),
  };
}

function main() {
  assertBinariesPresent();
  validateInputs();

  const sourceCounts = loadDumpTimeCounts();
  log(`[restore-and-verify] source counts to match: users=${sourceCounts.users} salons=${sourceCounts.salons} bookings=${sourceCounts.bookings}`);

  log(`[restore-and-verify] target restore database: "${RESTORE_DB_NAME}" on ${DB_HOST}:${DB_PORT}`);

  // If a previous run crashed before cleanup, the throwaway DB may still exist --
  // safe to drop and recreate since the name is guarded above to be a throwaway one.
  const existing = execFileSync(
    'psql',
    [...psqlArgsBase('postgres'), '--tuples-only', '--no-align', '--command', `SELECT 1 FROM pg_database WHERE datname = '${RESTORE_DB_NAME}';`],
    { env: { ...process.env, PGPASSWORD: DB_PASS }, encoding: 'utf8' },
  ).trim();
  if (existing === '1') {
    log(`[restore-and-verify] "${RESTORE_DB_NAME}" already exists (likely left over from an earlier interrupted run) -- dropping it first.`);
    execFileSync('dropdb', ['--host', DB_HOST, '--port', String(DB_PORT), '--username', DB_USER, '--no-password', RESTORE_DB_NAME], {
      env: { ...process.env, PGPASSWORD: DB_PASS },
    });
  }

  let restoreDbCreated = false;
  let allPass = true;

  try {
    log(`[restore-and-verify] createdb "${RESTORE_DB_NAME}"...`);
    execFileSync('createdb', ['--host', DB_HOST, '--port', String(DB_PORT), '--username', DB_USER, '--no-password', RESTORE_DB_NAME], {
      env: { ...process.env, PGPASSWORD: DB_PASS },
    });
    restoreDbCreated = true;
    log(`[restore-and-verify] created.`);

    log(`[restore-and-verify] pg_restore ${DUMP_FILE} -> "${RESTORE_DB_NAME}"...`);
    try {
      execFileSync(
        'pg_restore',
        ['--host', DB_HOST, '--port', String(DB_PORT), '--username', DB_USER, '--no-password', '--dbname', RESTORE_DB_NAME, '--no-owner', '--no-privileges', DUMP_FILE],
        { env: { ...process.env, PGPASSWORD: DB_PASS }, stdio: ['ignore', 'pipe', 'pipe'] },
      );
      record('pg_restore completes', true);
    } catch (err) {
      // pg_restore exits non-zero on ANY warning (e.g. "extension already exists" for
      // plpgsql on a fresh database), not just fatal errors. Treat it as a pass if the
      // restored database actually has the tables we care about; the row-count and
      // join checks below are the real proof either way.
      const stderr = (err.stderr || '').toString();
      log(`[restore-and-verify] pg_restore exited non-zero (this can be just warnings, e.g. pre-existing plpgsql). stderr:\n${stderr}`);
      const realTables = psqlQuery(RESTORE_DB_NAME, "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('users','salons','bookings');");
      record('pg_restore completes (tables present despite warnings)', realTables === '3', `stderr had ${stderr.split('\n').filter(Boolean).length} line(s); users/salons/bookings tables present: ${realTables}/3`);
    }

    const restoredUsers = Number(psqlQuery(RESTORE_DB_NAME, 'SELECT count(*) FROM users;'));
    const restoredSalons = Number(psqlQuery(RESTORE_DB_NAME, 'SELECT count(*) FROM salons;'));
    const restoredBookings = Number(psqlQuery(RESTORE_DB_NAME, 'SELECT count(*) FROM bookings;'));

    record('users row count matches source', restoredUsers === sourceCounts.users, `restored=${restoredUsers} source=${sourceCounts.users}`);
    record('salons row count matches source', restoredSalons === sourceCounts.salons, `restored=${restoredSalons} source=${sourceCounts.salons}`);
    record('bookings row count matches source', restoredBookings === sourceCounts.bookings, `restored=${restoredBookings} source=${sourceCounts.bookings}`);

    // Foreign-key-heavy join: every booking's user_id and salon_id are NOT NULL FKs
    // (see apps/api's bookings table -- bookings_user_id_fkey, bookings_salon_id_fkey),
    // so a correctly restored copy should resolve every single booking through both
    // joins. This is the check that actually distinguishes "tables exist with the
    // right row counts" from "the data -- and its relationships -- survived intact".
    const joinCount = Number(
      psqlQuery(
        RESTORE_DB_NAME,
        'SELECT count(*) FROM bookings b JOIN users u ON u.id = b.user_id JOIN salons s ON s.id = b.salon_id;',
      ),
    );
    record('booking -> user + salon join resolves for every booking', joinCount === restoredBookings, `joined=${joinCount} bookings=${restoredBookings}`);

    // Print one concrete joined row as human-readable evidence, not just a count.
    if (restoredBookings > 0) {
      const sample = psqlQuery(
        RESTORE_DB_NAME,
        "SELECT b.id || ' | user=' || u.phone || ' | salon=' || s.name || ' | status=' || b.status FROM bookings b JOIN users u ON u.id = b.user_id JOIN salons s ON s.id = b.salon_id ORDER BY b.created_at LIMIT 1;",
      );
      log(`[restore-and-verify] sample joined row: ${sample}`);
    }

    allPass = results.every((r) => r.pass);
  } finally {
    if (restoreDbCreated) {
      if (KEEP_RESTORE_DB) {
        log(`[restore-and-verify] KEEP_RESTORE_DB=1 set -- leaving "${RESTORE_DB_NAME}" in place for manual inspection. Drop it yourself when done:`);
        log(`  dropdb --host ${DB_HOST} --port ${DB_PORT} --username ${DB_USER} ${RESTORE_DB_NAME}`);
      } else {
        log(`[restore-and-verify] dropping throwaway database "${RESTORE_DB_NAME}"...`);
        try {
          execFileSync('dropdb', ['--host', DB_HOST, '--port', String(DB_PORT), '--username', DB_USER, '--no-password', RESTORE_DB_NAME], {
            env: { ...process.env, PGPASSWORD: DB_PASS },
          });
          log(`[restore-and-verify] dropped "${RESTORE_DB_NAME}".`);
        } catch (err) {
          log(`[restore-and-verify] WARNING: failed to drop "${RESTORE_DB_NAME}" automatically. Drop it by hand:`);
          log(`  dropdb --host ${DB_HOST} --port ${DB_PORT} --username ${DB_USER} ${RESTORE_DB_NAME}`);
          log(String(err.message || err));
        }
      }
    }
  }

  log('');
  log('[restore-and-verify] ==== summary ====');
  for (const r of results) {
    log(`  [${r.pass ? 'PASS' : 'FAIL'}] ${r.name}`);
  }
  if (allPass) {
    log('[restore-and-verify] ALL CHECKS PASSED -- restored copy is structurally intact.');
    process.exit(0);
  } else {
    log('[restore-and-verify] ONE OR MORE CHECKS FAILED.');
    process.exit(1);
  }
}

main();
