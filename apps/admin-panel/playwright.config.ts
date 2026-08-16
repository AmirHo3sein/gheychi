import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  // DB/seed prep is NOT wired here as Playwright's `globalSetup` -- Playwright gives no
  // ordering guarantee between globalSetup and webServer startup (confirmed empirically: the
  // webServer-spawned API process raced ahead of a schema reset/migration happening inside
  // globalSetup on real runs). It runs instead as its own strictly-sequential step in
  // package.json's test:e2e script (`node e2e/prepare-db.cjs && playwright test`), which
  // guarantees the database is fully ready before this config ever spawns the webServer
  // that queries it. See prepare-db.cjs's own header comment for the full story.
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL: 'http://localhost:3005',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'pnpm --filter @gheychi/api dev',
      url: 'http://localhost:3002/api/health',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      // Must match prepare-db.cjs's own DB_NAME default exactly -- that script seeds and
      // resets this database; if this spawned API process instead fell through to
      // apps/api/.env's own DB_NAME (typically the shared dev DB), every test would 404 on
      // data prepare-db.cjs just seeded into a database this server never queries. NOTE: this
      // env override only takes effect when Playwright actually spawns this command --
      // `reuseExistingServer` above means a `pnpm dev` API already running on :3002 (the
      // ordinary local dev stack) gets reused as-is instead, still pointed at ITS OWN
      // DB_NAME. Stop that server (or export DB_NAME=gheychi_e2e before starting it) before
      // running this suite locally, or the reused server won't see prepare-db.cjs's seed data.
      env: { ...process.env, DB_NAME: process.env.DB_NAME ?? 'gheychi_e2e' },
    },
    {
      command: 'pnpm --filter @gheychi/admin-panel dev',
      url: 'http://localhost:3005',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
})
