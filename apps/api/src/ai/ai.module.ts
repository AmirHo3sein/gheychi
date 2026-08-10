import { Module } from '@nestjs/common';
import { AI_PROVIDER } from './ai.provider';
import { AiService } from './ai.service';
import { UnconfiguredAiProvider } from './unconfigured-ai.provider';

// Only UnconfiguredAiProvider exists today -- no real AI/LLM vendor account exists in
// this environment. Mirrors AnalyticsModule's own registration shape (a plain object
// provider bound to the injection token) so a real vendor later slots in the exact
// same way SmsModule/PushModule already gate their own real implementations behind an
// env var.
//
// Deliberately NOT imported into AppModule (or anywhere else) -- this module is an
// unused seam prepared for future work, not a wired feature. See
// docs/technical-overview/27-ai-foundation.md.
@Module({
  providers: [AiService, { provide: AI_PROVIDER, useClass: UnconfiguredAiProvider }],
  exports: [AiService],
})
export class AiModule {}
