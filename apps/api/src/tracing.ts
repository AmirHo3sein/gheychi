// OpenTelemetry SDK bootstrap. Imported as the VERY FIRST line of main.ts, before
// `NestFactory.create` and before anything else requires 'http'/'pg'/'ioredis' -- this is
// OTel's own documented required order: auto-instrumentation patches a module's exports
// the first time that module is required, so it must run before any other import chain
// gets there first. See main.ts's own comment at the top for why this is a separate file
// rather than inline code (a `require('./tracing')` there is the only way to guarantee
// this runs before `import`-hoisted dependencies elsewhere in main.ts's module graph).
//
// Exporter/default-provider choice: no real tracing backend (Jaeger, Honeycomb, Datadog,
// ...) exists in this environment, so the default -- and only -- exporter is OTel's own
// `ConsoleSpanExporter`, which writes each finished span as JSON to stdout. This is the
// same "real capability, honest default provider, documented vendor-swap seam" shape this
// codebase already uses for error tracking (see error-tracking.module.ts) and analytics:
// nothing here is a stub or a fake -- it is a real, spec-compliant OTel SDK, wired to a
// real (if unglamorous) exporter. Swapping in a real backend later means installing
// `@opentelemetry/exporter-trace-otlp-http` (deliberately NOT a dependency today -- see
// package.json) and replacing the single `traceExporter` line below with an
// `OTLPTraceExporter` pointed at `OTEL_EXPORTER_OTLP_ENDPOINT`; every instrumentation,
// every span this app produces, and every call site stays unchanged.
//
// Instrumented: incoming HTTP (`@opentelemetry/instrumentation-http`), Postgres
// (`@opentelemetry/instrumentation-pg` -- this is what TypeORM's queries actually show up
// as, since TypeORM has no OTel instrumentation of its own and issues every query through
// `pg`), and Redis (`@opentelemetry/instrumentation-ioredis`).
//
// Known gap, documented rather than silently missing: this codebase's external-provider
// calls (ZarinpalGateway, KavenegarSmsProvider, web-push) all go through the global
// `fetch()`, not the legacy `http`/`https` core modules `instrumentation-http` patches --
// so none of them currently produce a span. Closing that gap means adding
// `@opentelemetry/instrumentation-undici`, deliberately left out for now to keep today's
// dependency footprint to exactly the three instrumentations the brief asked to check
// for (HTTP/pg/ioredis); see this file's own requestHook doc comment below for the one
// place that gap actually touches this file's redaction logic.
import { NodeSDK } from '@opentelemetry/sdk-node';
import { ConsoleSpanExporter } from '@opentelemetry/sdk-trace';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { IORedisInstrumentation } from '@opentelemetry/instrumentation-ioredis';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { resourceFromAttributes } from '@opentelemetry/resources';
import type { ClientRequest, IncomingMessage } from 'http';
import type { Span } from '@opentelemetry/api';
import { redactSensitiveQueryParams } from './tracing-query-redaction.util';

/**
 * Overwrites the `url.query` span attribute (`getIncomingRequestAttributes` in
 * instrumentation-http already set it, unredacted, before this hook runs -- span
 * attributes are a plain mutable map, so setAttribute here simply replaces that value)
 * for both incoming (`IncomingMessage`, has `.url`) and outgoing (`ClientRequest`, has
 * `.path`) requests alike. In practice this codebase's only current outgoing-request
 * caller (ZarinpalGateway -- see zarinpal-payment.gateway.ts) uses the global `fetch()`,
 * not `http.request`/`https.request`, so `@opentelemetry/instrumentation-http` (which
 * only patches the legacy `http`/`https` core modules, not undici/fetch) never creates a
 * span for those calls at all today -- see this file's own module doc comment's "known
 * gap" note. This branch is kept anyway: it's a few lines, and it's what would make any
 * future legacy-`http`-based outgoing caller (or a swap to `@opentelemetry/instrumentation-undici`)
 * safe by default rather than by omission.
 */
function requestHook(span: Span, req: ClientRequest | IncomingMessage): void {
  const target = 'url' in req && typeof req.url === 'string' ? req.url : 'path' in req && typeof req.path === 'string' ? req.path : undefined;
  if (!target) return;
  const queryIndex = target.indexOf('?');
  if (queryIndex === -1) return;
  span.setAttribute('url.query', redactSensitiveQueryParams(target.slice(queryIndex + 1)));
}

const sdk = new NodeSDK({
  resource: resourceFromAttributes({ 'service.name': process.env.OTEL_SERVICE_NAME ?? 'gheychi-api' }),
  traceExporter: new ConsoleSpanExporter(),
  instrumentations: [
    new HttpInstrumentation({
      // `headersToSpanAttributes` is opt-in and left unset here -- confirmed by reading
      // the installed 0.221.0 source (types.d.ts) that with it unset, NO request or
      // response header (Authorization, Cookie, or anything else) is ever attached to a
      // span. This is the library's own default, not something added here; it is called
      // out explicitly so a future reader doesn't have to re-derive it from source.
      requestHook,
    }),
    new PgInstrumentation({
      // Explicit, not just relying on the (already-false) default: `true` would attach
      // a query's bound PARAMETER VALUES to its span. Query TEXT (with $1/$2 placeholders,
      // never the values themselves) is still captured either way -- see
      // PgInstrumentationConfig's own doc comment for `enhancedDatabaseReporting`.
      enhancedDatabaseReporting: false,
    }),
    new IORedisInstrumentation({
      // Defense-in-depth, independent of @opentelemetry/redis-common's own per-command
      // args allowlist (`serializationSubsets`): that allowlist already excludes the
      // VALUE argument for SET-family commands (only the key is serialized) -- verified
      // by reading the installed 0.69.0 source -- which matters here because this
      // codebase writes OTP codes straight into Redis via `redis.set(\`otp:${phone}\`,
      // code, ...)` (see auth/otp.service.ts). Hard-coding "command name + key only"
      // here means a future upstream change to that allowlist can't silently start
      // attaching a value (an OTP code, a lock token) to a span without a matching
      // change in this codebase.
      dbStatementSerializer: (cmdName, cmdArgs) => `${cmdName} ${cmdArgs?.[0] ?? ''}`.trim(),
    }),
  ],
});

try {
  sdk.start();
} catch (err) {
  // Tracing is best-effort, same as MetricsService and error-tracking's own posture: it
  // must never be capable of preventing the API from booting. `console.error` (not Nest's
  // `Logger`) because this runs before Nest exists at all -- see main.ts.
  console.error('Failed to initialize OpenTelemetry SDK', err);
}

// Flushes any spans still sitting in the BatchSpanProcessor's queue before the process
// actually exits -- without this, a clean `SIGTERM` (the normal shutdown path in
// production, e.g. a container orchestrator's rolling deploy) can drop the last batch.
process.on('SIGTERM', () => {
  sdk.shutdown().catch((err) => console.error('Error shutting down OpenTelemetry SDK', err));
});

export { sdk };
