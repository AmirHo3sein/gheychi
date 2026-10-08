import { VocabularyEntry } from './beauty-analysis.contract';

export const BEAUTY_ANALYSIS_PROVIDER = 'BEAUTY_ANALYSIS_PROVIDER';

export interface BeautyAnalysisRequest {
  /** Already validated, EXIF-stripped, ≤1024px JPEG -- never the raw upload. */
  imageJpeg: Buffer;
  /** The active controlled vocabulary; the only concept keys the model may use. */
  vocabulary: VocabularyEntry[];
  systemPrompt: string;
  jsonSchema: Record<string, unknown>;
}

export interface BeautyAnalysisResponse {
  /** Untrusted model output -- always passed through parseBeautyAnalysis() before use. */
  raw: unknown;
  provider: string;
  model: string;
}

// provider_busy (HTTP 429/503 -- rate-limited or overloaded, common on free tiers) and
// provider_unreachable (the request never reached the endpoint: DNS/TLS/connection failure,
// e.g. a VPN or proxy that's down) are distinct from provider_error because the provider did
// no work -- they must not consume the customer's daily quota.
export type BeautyAnalysisErrorCode =
  | 'timeout'
  | 'provider_error'
  | 'provider_busy'
  | 'provider_unreachable'
  | 'unconfigured'
  | 'invalid_output';

export class BeautyAnalysisProviderError extends Error {
  constructor(
    readonly code: BeautyAnalysisErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Beauty Guide's domain-specific AI seam (same interface-token-factory shape as
 * SmsProvider / PaymentGateway). Deliberately NOT the generic `AiProvider.complete()` in
 * src/ai: that seam is string-in/string-out, and its own doc asks for a purpose-built
 * method when a real use case appears. One method, image in, untrusted JSON out -- no
 * tools, no conversation, no way to act on anything.
 */
export interface BeautyAnalysisProvider {
  readonly name: string;
  analyze(request: BeautyAnalysisRequest): Promise<BeautyAnalysisResponse>;
}
