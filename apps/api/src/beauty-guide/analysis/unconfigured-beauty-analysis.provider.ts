import { BeautyAnalysisProvider, BeautyAnalysisProviderError, BeautyAnalysisResponse } from './beauty-analysis.provider';

/**
 * The default when no AI endpoint is configured. Fails loudly rather than fabricating an
 * analysis (same stance as src/ai's UnconfiguredAiProvider); the guide is marked failed
 * with code `unconfigured` and never consumes the customer's daily quota.
 */
export class UnconfiguredBeautyAnalysisProvider implements BeautyAnalysisProvider {
  readonly name = 'unconfigured';

  async analyze(): Promise<BeautyAnalysisResponse> {
    throw new BeautyAnalysisProviderError('unconfigured', 'No beauty analysis provider is configured');
  }
}
