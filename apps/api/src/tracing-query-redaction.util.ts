// Pure, side-effect-free -- deliberately split out of tracing.ts (see that file's own
// doc comment) so this can be unit-tested directly, without pulling in tracing.ts's
// process-global 'http'/'pg'/'ioredis' patching as a side effect of the import.

/**
 * Query-string parameter names (case-insensitive) that must never reach a span verbatim.
 * 'authority' is Zarinpal's per-transaction payment token (see PaymentsController#callback
 * and mock-payment.gateway.ts) -- it rides in on the bank's own redirect as
 * `GET /api/payments/callback?Authority=...&Status=...`, and
 * @opentelemetry/instrumentation-http does NOT run its `redactedQueryParams` config
 * against incoming-request spans (that option only applies to the `url.full` attribute
 * it builds for OUTGOING/client spans -- confirmed by reading the installed 0.221.0
 * source; incoming spans set `url.query` from the raw parsed URL with no redaction at
 * all). The rest of this list mirrors, deliberately does not import (tracing and
 * error-tracking are separate concerns -- see tracing.ts's requestHook), the same broad
 * substring posture as error-tracking/redact-context.ts's SENSITIVE_KEY_SUBSTRINGS: a
 * harmless field that happens to match costs nothing, a real secret that slips through
 * costs a lot.
 */
const SENSITIVE_QUERY_PARAM_SUBSTRINGS = [
  'authority',
  'token',
  'jwt',
  'cookie',
  'session',
  'secret',
  'otp',
  'password',
  'passwd',
  'cvv',
  'card',
  'apikey',
  'signature',
];

function isSensitiveQueryParam(name: string): boolean {
  const normalized = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  return SENSITIVE_QUERY_PARAM_SUBSTRINGS.some((needle) => normalized.includes(needle));
}

/** Replaces the value of every sensitive param with 'REDACTED'; leaves everything else untouched. */
export function redactSensitiveQueryParams(rawQuery: string): string {
  if (!rawQuery) return rawQuery;
  const params = new URLSearchParams(rawQuery);
  for (const key of params.keys()) {
    if (isSensitiveQueryParam(key)) params.set(key, 'REDACTED');
  }
  return params.toString();
}
