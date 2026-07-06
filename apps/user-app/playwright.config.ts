import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
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
  use: { baseURL: 'http://localhost:3003' },
  webServer: [
    {
      command: 'pnpm --filter @arayeshgah/api dev',
      url: 'http://localhost:3002/api/health',
      reuseExistingServer: !process.env.CI,
      // Measured cold-start (nest start --watch, first ts-node compile) at ~78s on this
      // machine -- the plan's original 30s was tuned for a warm cache and flaked on a
      // genuinely cold boot.
      timeout: 120_000,
    },
    {
      command: 'pnpm --filter @arayeshgah/user-app dev',
      url: 'http://localhost:3003',
      reuseExistingServer: !process.env.CI,
      // Same reasoning as the api entry above -- a cold Nuxt/Vite dev server compiling
      // its full module graph for the first time can exceed 30s.
      timeout: 120_000,
    },
  ],
})
