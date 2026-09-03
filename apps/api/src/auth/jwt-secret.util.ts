/**
 * Refuses a JWT secret that would make every session forgeable in production: the
 * `.env.example` placeholder copied verbatim, or anything too short to resist brute force.
 * Deliberately production-only -- `.env.test`/local dev keep their short fixed secrets --
 * and checked at module registration so a bad deploy fails at boot, not at first login.
 * Same fail-fast posture as PAYMENT_GATEWAY=zarinpal's own missing-credential handling.
 */
const PLACEHOLDER_SECRETS = new Set(['dev-secret-change-me', 'test-secret', 'secret', 'changeme']);
const MIN_PRODUCTION_SECRET_LENGTH = 32;

export function assertProductionJwtSecret(secret: string, nodeEnv: string | undefined): string {
  if (nodeEnv !== 'production') return secret;
  if (PLACEHOLDER_SECRETS.has(secret) || secret.length < MIN_PRODUCTION_SECRET_LENGTH) {
    throw new Error(
      `JWT_SECRET is a placeholder or shorter than ${MIN_PRODUCTION_SECRET_LENGTH} characters -- refusing to start in production with a forgeable session secret`,
    );
  }
  return secret;
}
