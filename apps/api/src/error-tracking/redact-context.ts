const REDACTED = '[redacted]';

// Substring match against a normalized (lowercased, non-alphanumeric-stripped) key name --
// catches password/Password/api_key/apiKey/access-token/refreshToken/Authorization/etc.
// without needing an exhaustive exact-match list. Deliberately broad: a false-positive
// redaction (a harmless field that happens to contain "token") costs nothing; a false
// negative that leaks a real secret into whatever backend eventually replaces
// LoggerErrorTrackingService is exactly the failure this exists to prevent. See
// docs/technical-overview/21-security.md.
const SENSITIVE_KEY_SUBSTRINGS = [
  'password',
  'passwd',
  'token',
  'jwt',
  'cookie',
  'session',
  'secret',
  'otp',
  'cvv',
  'card',
  'authorization',
  'apikey',
  'privatekey',
  // Zarinpal's per-transaction session id (payments.authority -- see payment.entity.ts).
  // Not itself a full credential (refunding still requires the separate gateway access
  // token), but it identifies one specific real transaction and this codebase already
  // treats it carefully everywhere else (GlobalExceptionFilter deliberately logs
  // req.path, not req.originalUrl, so a stray ?Authority=... query string never reaches
  // it -- see that file's own comment) -- so it gets the same defense-in-depth backstop
  // as the rest of this list even though no current call site puts it in `extra`.
  'authority',
];

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isSensitiveKey(key: string): boolean {
  const normalized = normalizeKey(key);
  return SENSITIVE_KEY_SUBSTRINGS.some((needle) => normalized.includes(needle));
}

// Defensive bound against a pathological or accidentally-circular `extra` payload --
// redaction must never be the thing that crashes or hangs an error-capture call.
const MAX_DEPTH = 5;

function redactValue(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) return '[max-depth-exceeded]';
  if (Array.isArray(value)) return value.map((item) => redactValue(item, depth + 1));
  if (value !== null && typeof value === 'object') return redactObject(value as Record<string, unknown>, depth);
  return value;
}

function redactObject(obj: Record<string, unknown>, depth: number): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    result[key] = isSensitiveKey(key) ? REDACTED : redactValue(value, depth + 1);
  }
  return result;
}

/**
 * Recursively redacts any key that looks sensitive (see `SENSITIVE_KEY_SUBSTRINGS`)
 * anywhere in `extra`, however deeply nested -- the one piece of `ErrorTrackingContext`
 * that is free-form and therefore the one place a secret could accidentally slip in.
 * Returns a NEW object; never mutates the input.
 *
 * Deliberately out of scope: an `Error`'s own `.message`/`.stack` string is never
 * scanned or redacted -- the same boundary `CronJobRunner`/`AlertsService` already rely
 * on elsewhere in this codebase (they log `err.message` directly). Call sites must not
 * construct an error message that embeds a raw secret.
 */
export function redactExtra(extra: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!extra) return extra;
  return redactObject(extra, 0);
}
