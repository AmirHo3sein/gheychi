export const AI_PROVIDER = 'AI_PROVIDER';

// Passthrough knobs a real LLM SDK call normally exposes (model selection, sampling
// temperature, an output-length cap). Every field is optional and `UnconfiguredAiProvider`
// ignores all of them -- they exist so a real implementation later has somewhere to
// receive them without changing this interface.
export interface AiCompletionOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

/**
 * Vendor-agnostic seam for calling out to an LLM, the exact same interface-token-
 * factory shape this codebase already uses for `SmsProvider`, `PushProvider`,
 * `PaymentGateway`, `ErrorTrackingService`, and `AnalyticsProvider` (see CLAUDE.md's
 * "External service abstractions" table). One small interface, one injection token
 * (`AI_PROVIDER`), and `AiModule` picks the concrete implementation.
 *
 * `complete()` is deliberately generic -- a single free-text prompt in, a single
 * free-text completion out -- rather than shaped around any specific product feature.
 * As of this writing, no AI use case is committed scope anywhere in this codebase:
 * `docs/phase-p-ai-readiness.md` lists candidates (Persian-language moderation assist,
 * search-query understanding) but explicitly defers all of them pending
 * product/business sign-off, and nothing calls this interface today. When a specific
 * use case *is* committed, prefer adding a purpose-built method next to this one
 * (e.g. a `parseSearchIntent()`) over stretching `complete()`'s string-in/string-out
 * shape to fit a structured contract it was never designed for.
 *
 * No real AI/LLM vendor account (OpenAI, Anthropic, or otherwise) exists in this
 * environment, so today the only implementation is `UnconfiguredAiProvider`, which
 * throws rather than fabricate a response -- see its own doc comment. Swapping in a
 * real provider later means writing ONE class that implements this interface (calling
 * the vendor SDK's own completion call from `complete()` below) and pointing
 * `AiModule`'s provider registration at it -- nothing else in the app changes, because
 * every future call site would talk to `AiService`, never to a provider or a vendor
 * SDK directly. See `docs/technical-overview/27-ai-foundation.md` for the constraints
 * any such real integration must respect.
 */
export interface AiProvider {
  complete(prompt: string, options?: AiCompletionOptions): Promise<string>;
}
