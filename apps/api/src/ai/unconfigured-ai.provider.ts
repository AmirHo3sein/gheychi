import { Injectable, NotImplementedException } from '@nestjs/common';
import { AiCompletionOptions, AiProvider } from './ai.provider';

// A single, static, generic message -- never interpolates `prompt` or `options` into
// the thrown error. `complete()`'s caller may pass user-authored text (a search query,
// review text, anything) as `prompt`; since this provider never calls a real vendor,
// the only way that text could leak anywhere (logs, error-tracking, a client response)
// is if this class echoed it back itself. It never does.
const NOT_CONFIGURED_MESSAGE =
  'AiProvider has no real implementation in this environment -- no AI/LLM vendor account exists. ' +
  'This is the default (and, today, only) AiProvider; see AiProvider\'s own doc comment for the swap-in seam.';

/**
 * The default (and, in this environment, only) `AiProvider` -- there is no real
 * AI/LLM vendor account to call out to, so this deliberately throws rather than
 * fabricate a fake completion, exactly like `LoggerErrorTrackingService` stands in
 * for a real Sentry/APM SDK without pretending to be one. Unlike
 * `ConsoleSmsProvider`/`ConsoleAnalyticsProvider`/`ConsolePushProvider` -- which have
 * an honest "just log it" fallback behavior for their concern -- there is no honest
 * fallback for "generate text with an LLM" short of actually calling one, so throwing
 * a clear, typed error is the only non-misleading option here.
 *
 * Never returns a hardcoded/canned string pretending to be an AI response. Never
 * logs, echoes, or otherwise transmits `prompt`/`options` anywhere -- see
 * `NOT_CONFIGURED_MESSAGE`.
 */
@Injectable()
export class UnconfiguredAiProvider implements AiProvider {
  async complete(_prompt: string, _options?: AiCompletionOptions): Promise<string> {
    throw new NotImplementedException(NOT_CONFIGURED_MESSAGE);
  }
}
