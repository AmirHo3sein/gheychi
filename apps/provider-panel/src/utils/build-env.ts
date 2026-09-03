/**
 * Reads a build-time `import.meta.env` value, treating an EMPTY string as absent.
 *
 * `??` is wrong here: Vite inlines `import.meta.env.VITE_X` at build time, and CI passes
 * these from repo variables (`VITE_API_BASE=${{ vars.VITE_API_BASE_PROD }}`). An unset
 * repo variable expands to the empty string rather than being omitted, so it OVERRIDES the
 * Dockerfile's own ARG default and `??` happily keeps it -- baking `''` into the bundle.
 * The result is a relative URL that fails silently at runtime with no build error: for the
 * API base every request goes to the panel's own origin, and for the customer-app base
 * every generated QR code encodes an unscannable relative path onto physical printed
 * material that cannot be recalled.
 */
export function buildEnv(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim()
  return trimmed ? trimmed : fallback
}
