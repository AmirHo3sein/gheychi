import { defineConfig } from '@playwright/test'

// The one deliberate coverage gap CLAUDE.md calls out: every other e2e suite in this repo
// (user-app, provider-panel, admin-panel) stays entirely within its own app -- a booking
// created via user-app is never followed onto provider-panel/admin-panel in the same test.
// This package exists specifically to close that gap. It has no app of its own; it spins up
// three real dev servers (api + user-app + provider-panel) and drives them from a single
// spec using two separate browser contexts (one customer session, one owner session), the
// same way a real cross-app bug would actually be caught.
export default defineConfig({
  testDir: './e2e',
  // Same reasoning as every other suite's own config comment: prepare-db.cjs runs as its
  // own strictly-sequential pretest step (package.json's test:e2e), not Playwright's
  // globalSetup, since Playwright gives no ordering guarantee against the webServer-spawned
  // processes racing ahead of a schema reset.
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 20_000 },
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'pnpm --filter @gheychi/api dev',
      url: 'http://localhost:3002/api/health',
      reuseExistingServer: !process.env.CI,
      // Measured cold-start (nest start --watch, first ts-node compile) at ~78s -- see
      // user-app's own playwright.config.ts for the same measurement.
      timeout: 120_000,
      env: { ...process.env, DB_NAME: process.env.DB_NAME ?? 'gheychi_e2e' },
    },
    {
      command: 'pnpm --filter @gheychi/user-app dev',
      url: 'http://localhost:3003',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: 'pnpm --filter @gheychi/provider-panel dev',
      url: 'http://localhost:3004',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
})
