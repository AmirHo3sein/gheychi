/**
 * Client-only by the `.client.ts` suffix, deliberately: this is browser crash reporting,
 * and the SSR half of the app already surfaces its failures as real log lines in
 * `docker compose logs user-app`. Loading `@sentry/vue` on the server would put the SDK in
 * the Nitro bundle for no added signal.
 *
 * **Why the SDK is behind a dynamic import here, but statically imported in the two
 * panels.** Measured on this build: statically importing `@sentry/vue` grows the client
 * entry chunk from 81.7 kB to 116.4 kB gzipped -- +42%, paid by every customer on every
 * first page load, forever, including the (default) case where no DSN is configured and
 * the SDK does nothing at all. This is a mobile-first PWA for the Iranian market, so that
 * is not a reasonable standing cost. Importing it only once a DSN is known keeps the SDK
 * out of the entry chunk entirely.
 * The cost of that choice is a short window at the very start of the first page load
 * during which the SDK is still being fetched and a crash would go unreported. That is an
 * acceptable trade *here specifically* because this app is server-rendered: the customer
 * has real HTML before any of this runs. The panels are pure SPAs where a first-paint
 * crash is exactly the failure that matters, so they pay the bytes and initialize
 * synchronously in `main.ts` instead. Neither app is "the wrong one" -- the constraint
 * genuinely differs.
 *
 * `parallel: true` so the fetch never blocks Nuxt's remaining plugins or hydration.
 *
 * A note on `@sentry/nuxt`: the official Nuxt module was NOT used. Its value over this
 * plugin is server-side (Nitro) instrumentation, which requires `@sentry/node` plus its
 * OpenTelemetry auto-instrumentation inside the SSR container and an
 * `--import ./.output/server/sentry.server.config.mjs` flag on the container's `CMD` (see
 * apps/user-app/Dockerfile) -- a heavier image and a second tracing stack, in a
 * memory-capped container, duplicating coverage the API's own error tracking already
 * provides for everything that matters. The client half of `@sentry/nuxt` is `@sentry/vue`
 * anyway, so nothing is lost on the crash-reporting axis this exists for. Reconsider if
 * SSR-specific render failures ever become a recurring problem.
 *
 * See `~/utils/error-reporting` for the DSN gating and the PII scrub.
 */
export default defineNuxtPlugin({
  name: 'sentry-client',
  parallel: true,
  async setup(nuxtApp) {
    const dsn = useRuntimeConfig().public.sentryDsn
    // Checked here as well as inside initErrorReporting so the SDK chunk is never even
    // requested when reporting is off -- that is the whole point of the dynamic import.
    if (typeof dsn !== 'string' || dsn.trim() === '') return

    const { initErrorReporting, captureFatalError } = await import('~/utils/error-reporting')
    if (!initErrorReporting(dsn, nuxtApp.vueApp)) return

    // `Sentry.init({ app })` installs a Vue `errorHandler` that chains to Nuxt's own, so
    // component render/setup errors are already covered. This hook adds the other half:
    // fatal errors raised outside a component's render (route middleware, plugins, a
    // failed `useAsyncData`), which reach `app:error` and never touch the Vue handler.
    nuxtApp.hook('app:error', (error) => {
      captureFatalError(error)
    })
  },
})
