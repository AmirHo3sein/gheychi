# 27 — AI Foundation

A provider-agnostic seam for calling an LLM, added ahead of any concrete AI feature. **No real AI capability is live anywhere in this app** — nothing calls this code today. This document exists so that fact, and the constraints any future real integration must respect, are written down before the first real call site is added.

## What exists

`apps/api/src/ai/`:

- `ai.provider.ts` — the `AiProvider` interface (`AI_PROVIDER` token) and `AiCompletionOptions`. One method: `complete(prompt: string, options?: AiCompletionOptions): Promise<string>` — a single free-text prompt in, a single free-text completion out. This is the same interface-token-factory shape already used for `SmsProvider`, `PushProvider`, `PaymentGateway`, `ErrorTrackingService`, and `AnalyticsProvider` (see [02-system-architecture.md](./02-system-architecture.md) and CLAUDE.md's "External service abstractions" table).
- `unconfigured-ai.provider.ts` — `UnconfiguredAiProvider`, the only implementation. It throws `NotImplementedException` on every call rather than returning a fabricated/hardcoded string pretending to be an AI response. It never logs, echoes, or otherwise transmits the `prompt`/`options` it receives — the thrown error message is static and generic.
- `ai.service.ts` — `AiService`, a thin pass-through that injects `AI_PROVIDER` and forwards the call, mirroring `AnalyticsService`'s own shape. A future real call site would depend on this, never on a provider or vendor SDK directly.
- `ai.module.ts` — registers `AiService` bound to `UnconfiguredAiProvider`. **Not imported into `AppModule` or any other module.** This is an unused seam, not a wired feature.

## Why `complete()` is generic rather than use-case-specific

No AI use case is committed scope in this codebase. `docs/phase-p-ai-readiness.md` (Phase P) surveys candidates — Persian-language moderation assist, search-query understanding — but explicitly defers all of them pending product/business sign-off (§5 of that document), and concludes "do not build any AI feature yet." There is nothing to design a purpose-built interface around yet. A generic `complete(prompt, options)` — the minimal shape a real LLM API call normally takes — is the honest seam for that state: it captures the eventual integration point without inventing a structured contract (e.g. a specific `{gender, location, ratingMin, date, timeRange}` search-intent shape) that no spec has actually committed to. When a specific use case is committed, the right move is a purpose-built method added alongside `complete()`, not stretching a string-in/string-out shape to fit a contract it wasn't designed for.

## Why the default provider throws instead of returning something

Every other provider abstraction in this codebase has an honest "just log it" fallback for its own concern when no real vendor account exists (`ConsoleSmsProvider` logs the OTP, `ConsoleAnalyticsProvider` logs the event, `LoggerErrorTrackingService` logs the exception). There is no equivalent honest fallback for "generate text with an LLM" — the only way to produce *a* string without a real model is to fabricate one, which would silently look like real AI output to anything that called it. `UnconfiguredAiProvider` throws a clear, typed `NotImplementedException` instead, exactly the failure mode any real call site should get today: loud and immediate, not a plausible-looking fake.

## No PII/redaction concern today, and why

`AiProvider.complete()` takes an opaque `prompt: string`, not a structured object with named fields the way `ErrorTrackingContext.extra` or `AnalyticsEvent.properties` are — there's no per-key redaction to apply the way `error-tracking/redact-context.ts` does. More importantly, `UnconfiguredAiProvider` never transmits `prompt` anywhere: it throws before touching it, and the thrown message is a static string that never embeds the input (covered by a test in `unconfigured-ai.provider.spec.ts`). If a real provider is ever added, *that* implementation — not this document — becomes the place to decide what, if anything, needs redaction before a prompt leaves the process; see [21-security.md](./21-security.md) for this codebase's existing secrets/PII-handling stance to extend at that point.

## Constraints any future real integration must respect

These are non-negotiable regardless of which vendor or self-hosted model eventually implements `AiProvider`. AI must never bypass:

- **The gender filter** — every search result already goes through a mandatory, unconditional gender filter ([20-business-rules.md](./20-business-rules.md)); an AI-assisted search feature composes with that filter, it never substitutes for or routes around it.
- **Availability** — slot computation (`AvailabilityService`, [10-scheduling.md](./10-scheduling.md)) is the sole source of truth for what can be booked; AI never invents or overrides availability.
- **Salon status** — only approved, non-suspended salons are ever eligible to appear or be booked; an AI feature never surfaces or acts on a salon that the existing status checks would exclude.
- **Worker eligibility** — worker assignment/overlap rules ([09-booking-engine.md](./09-booking-engine.md)) apply exactly as they do today; AI never assigns or suggests a worker outside those rules.
- **Booking rules** — deposit calculation, cancellation windows, hold/lock mechanics, and every other rule catalogued in [20-business-rules.md](./20-business-rules.md) stay exactly as enforced today; AI is, at most, a layer that helps a human or an existing deterministic code path reach one of these rules faster (e.g. parsing free text into structured filters), never a replacement for the rule itself.

This mirrors the existing platform-wide pattern already documented elsewhere in this codebase — e.g. featured-placement boosting "can never bypass the gender/geo/category/status filters" ([20-business-rules.md](./20-business-rules.md)) — extended to the same non-negotiable posture for any future AI-assisted feature.

## Related documents

- [19-third-party-services.md](./19-third-party-services.md) — every other external-service abstraction this pattern is copied from
- [25-future-improvements.md](./25-future-improvements.md) — reserved seams already visible in the code
- `docs/phase-p-ai-readiness.md` — the draft strategy document this foundation traces back to; still not an approved plan
