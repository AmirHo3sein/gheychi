import { Logger } from '@nestjs/common';
import { BeautyAnalysisProvider, BeautyAnalysisProviderError, BeautyAnalysisRequest, BeautyAnalysisResponse } from './beauty-analysis.provider';

export interface OpenAiCompatibleConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  maxTokens: number;
  /** `json_schema` (strict structured output) or `json_object` for endpoints that only support JSON mode. */
  responseFormat: 'json_schema' | 'json_object';
}

/**
 * Any OpenAI-compatible `/chat/completions` endpoint with vision: Google Gemini's
 * OpenAI-compatible endpoint (https://generativelanguage.googleapis.com/v1beta/openai),
 * an aggregator/gateway reachable from Iran, or a self-hosted vLLM vision model. Which one
 * is purely configuration -- moving production to an Iran-reachable endpoint later needs no
 * code change.
 *
 * Privacy/logging: the image travels as an inline base64 data URL (no public URL ever
 * exists for it). Neither the image, the prompt, nor the model's output is logged -- only
 * status codes, latency and the model name.
 */
export class OpenAiCompatibleBeautyAnalysisProvider implements BeautyAnalysisProvider {
  readonly name = 'openai-compatible';
  private readonly logger = new Logger(OpenAiCompatibleBeautyAnalysisProvider.name);

  constructor(private readonly config: OpenAiCompatibleConfig) {}

  async analyze(request: BeautyAnalysisRequest): Promise<BeautyAnalysisResponse> {
    const url = `${this.config.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    const responseFormat =
      this.config.responseFormat === 'json_schema'
        ? { type: 'json_schema', json_schema: { name: 'beauty_analysis', strict: true, schema: request.jsonSchema } }
        : { type: 'json_object' };

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.config.apiKey}` },
        signal: AbortSignal.timeout(this.config.timeoutMs),
        body: JSON.stringify({
          model: this.config.model,
          temperature: 0.2,
          max_tokens: this.config.maxTokens,
          response_format: responseFormat,
          messages: [
            { role: 'system', content: request.systemPrompt },
            {
              role: 'user',
              content: [
                { type: 'text', text: 'Analyze this inspiration image and return the JSON object.' },
                { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${request.imageJpeg.toString('base64')}` } },
              ],
            },
          ],
        }),
      });
    } catch (err) {
      const isTimeout = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
      // fetch() wraps the real network reason (ECONNREFUSED, ENOTFOUND, a TLS reset…) in
      // `cause` -- logging it is what makes "the VPN/proxy is down" diagnosable at a glance.
      const cause = err instanceof Error ? ((err.cause as { code?: string; message?: string } | undefined) ?? undefined) : undefined;
      const reason = cause?.code ?? cause?.message ?? (err instanceof Error ? err.message : String(err));
      this.logger.warn(`Beauty analysis request ${isTimeout ? 'timed out' : `could not reach the endpoint (${reason})`} (model ${this.config.model})`);
      throw new BeautyAnalysisProviderError(
        isTimeout ? 'timeout' : 'provider_unreachable',
        isTimeout ? 'Beauty analysis request timed out' : 'Beauty analysis endpoint unreachable',
      );
    }

    if (!res.ok) {
      this.logger.warn(`Beauty analysis endpoint returned HTTP ${res.status} (model ${this.config.model})`);
      const busy = res.status === 429 || res.status === 503;
      throw new BeautyAnalysisProviderError(busy ? 'provider_busy' : 'provider_error', `Beauty analysis endpoint returned HTTP ${res.status}`);
    }

    let content: unknown;
    try {
      const body = (await res.json()) as { choices?: Array<{ message?: { content?: unknown } }> };
      content = body.choices?.[0]?.message?.content;
    } catch {
      throw new BeautyAnalysisProviderError('provider_error', 'Beauty analysis endpoint returned a non-JSON body');
    }
    if (typeof content !== 'string' || !content.trim()) {
      throw new BeautyAnalysisProviderError('invalid_output', 'Beauty analysis returned no content');
    }
    return { raw: parseJsonContent(content), provider: this.name, model: this.config.model };
  }
}

/** Models in JSON mode occasionally wrap output in a ```json fence; anything unparseable is invalid output. */
export function parseJsonContent(content: string): unknown {
  const unfenced = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(unfenced);
  } catch {
    throw new BeautyAnalysisProviderError('invalid_output', 'Beauty analysis content is not valid JSON');
  }
}
