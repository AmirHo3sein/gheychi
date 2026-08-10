import { Inject, Injectable } from '@nestjs/common';
import { AI_PROVIDER, AiCompletionOptions, AiProvider } from './ai.provider';

/**
 * The one seam a future call site would talk to for an LLM completion -- never a
 * provider or a vendor SDK directly (see `AiProvider`'s own doc comment for the
 * vendor-swap story). Mirrors `AnalyticsService`'s own shape: a thin pass-through
 * that injects the provider token and forwards the call, with nowhere else in the
 * app importing `AiModule` today -- this is an unused, unwired seam, not a live
 * feature. See `docs/technical-overview/27-ai-foundation.md`.
 */
@Injectable()
export class AiService {
  constructor(@Inject(AI_PROVIDER) private readonly provider: AiProvider) {}

  async complete(prompt: string, options?: AiCompletionOptions): Promise<string> {
    return this.provider.complete(prompt, options);
  }
}
