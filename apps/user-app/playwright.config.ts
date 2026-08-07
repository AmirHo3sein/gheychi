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
  //
  // `fullyParallel: false` (the default, left unset here) only serializes tests *within*
  // a single file -- it does NOT serialize separate spec files against each other, which
  // by default still run concurrently across workers. admin-featured-badge.spec.ts reuses
  // the customer account/OTP flow from happy-path.spec.ts and both hit the same phone
  // number's OTP key in Redis, so running them concurrently races: one file's successful
  // verify-otp deletes the shared Redis key before the other reads its own code. workers: 1
  // forces spec files to run one at a time, which is what the ordering dependency needs.
  workers: 1,
  // The webServer `url` health-check only proves the dev server's HTTP listener is up --
  // it does NOT prove a given route's JS has been transformed by Vite yet, nor that Vue
  // has hydrated the SSR-rendered HTML and attached its event listeners. On a cold `nuxt
  // dev` process (which is what `test:e2e` always spawns -- see the webServer timeouts
  // below), the very first navigation to /login can take well over Playwright's default
  // 5s expect timeout to become interactive: a click landing before hydration finishes
  // hits a real DOM button with no Vue handler attached yet, so it silently does nothing
  // (no error, no network request -- confirmed by instrumenting requestfinished/pageerror
  // during debugging). Generous global timeouts absorb this rather than each spec having
  // to special-case its first interaction.
  timeout: 60_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL: 'http://localhost:3003',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'pnpm --filter @gheychi/api dev',
      url: 'http://localhost:3002/api/health',
      reuseExistingServer: !process.env.CI,
      // Measured cold-start (nest start --watch, first ts-node compile) at ~78s on this
      // machine -- the plan's original 30s was tuned for a warm cache and flaked on a
      // genuinely cold boot.
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
      command: 'pnpm --filter @gheychi/user-app dev',
      url: 'http://localhost:3003',
      reuseExistingServer: !process.env.CI,
      // Same reasoning as the api entry above -- a cold Nuxt/Vite dev server compiling
      // its full module graph for the first time can exceed 30s.
      timeout: 120_000,
    },
  ],
})
