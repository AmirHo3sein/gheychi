import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 20_000 },
  use: { baseURL: 'http://localhost:3005' },
  webServer: [
    {
      command: 'pnpm --filter @gheychi/api dev',
      url: 'http://localhost:3002/api/health',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: 'pnpm --filter @gheychi/admin-panel dev',
      url: 'http://localhost:3005',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
})
