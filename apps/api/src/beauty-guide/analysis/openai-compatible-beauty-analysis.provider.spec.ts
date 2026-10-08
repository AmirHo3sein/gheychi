import { BeautyAnalysisProviderError } from './beauty-analysis.provider';
import { OpenAiCompatibleBeautyAnalysisProvider, parseJsonContent } from './openai-compatible-beauty-analysis.provider';

const config = {
  baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
  apiKey: 'test-key',
  model: 'gemini-test',
  timeoutMs: 1000,
  maxTokens: 512,
  responseFormat: 'json_schema' as const,
};
const request = { imageJpeg: Buffer.from('jpegbytes'), vocabulary: [], systemPrompt: 'SYS', jsonSchema: { type: 'object' } };

function mockFetch(impl: () => Promise<unknown>) {
  return jest.spyOn(global, 'fetch').mockImplementation(impl as never);
}

describe('OpenAiCompatibleBeautyAnalysisProvider', () => {
  afterEach(() => jest.restoreAllMocks());

  it('posts a vision chat completion with the image inline and parses the JSON content', async () => {
    const spy = mockFetch(async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"suitable":false}' } }] }), { status: 200 }));
    const result = await new OpenAiCompatibleBeautyAnalysisProvider(config).analyze(request);
    expect(result).toEqual({ raw: { suitable: false }, provider: 'openai-compatible', model: 'gemini-test' });
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-key');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('gemini-test');
    expect(body.response_format.type).toBe('json_schema');
    expect(body.messages[0]).toEqual({ role: 'system', content: 'SYS' });
    expect(body.messages[1].content[1].image_url.url).toBe(`data:image/jpeg;base64,${Buffer.from('jpegbytes').toString('base64')}`);
  });

  it('uses json_object mode when configured', async () => {
    const spy = mockFetch(async () => new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] })));
    await new OpenAiCompatibleBeautyAnalysisProvider({ ...config, responseFormat: 'json_object' }).analyze(request);
    expect(JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string).response_format).toEqual({ type: 'json_object' });
  });

  it('maps rate-limit/overload (429, 503) to provider_busy and other HTTP errors to provider_error', async () => {
    for (const status of [429, 503]) {
      mockFetch(async () => new Response('{"error":"busy"}', { status }));
      await expect(new OpenAiCompatibleBeautyAnalysisProvider(config).analyze(request)).rejects.toMatchObject({ code: 'provider_busy' });
    }
    for (const status of [400, 403, 500]) {
      mockFetch(async () => new Response('{"error":"x"}', { status }));
      await expect(new OpenAiCompatibleBeautyAnalysisProvider(config).analyze(request)).rejects.toMatchObject({ code: 'provider_error' });
    }
  });

  it('maps a connection failure (e.g. VPN/proxy down) to provider_unreachable', async () => {
    mockFetch(async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    });
    await expect(new OpenAiCompatibleBeautyAnalysisProvider(config).analyze(request)).rejects.toMatchObject({ code: 'provider_unreachable' });
  });

  it('maps timeouts to timeout', async () => {
    mockFetch(async () => {
      throw Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    });
    await expect(new OpenAiCompatibleBeautyAnalysisProvider(config).analyze(request)).rejects.toMatchObject({ code: 'timeout' });
  });

  it('maps empty or non-JSON content to invalid_output', async () => {
    mockFetch(async () => new Response(JSON.stringify({ choices: [{ message: { content: 'I think it is balayage!' } }] })));
    await expect(new OpenAiCompatibleBeautyAnalysisProvider(config).analyze(request)).rejects.toMatchObject({ code: 'invalid_output' });
    mockFetch(async () => new Response(JSON.stringify({ choices: [] })));
    await expect(new OpenAiCompatibleBeautyAnalysisProvider(config).analyze(request)).rejects.toBeInstanceOf(BeautyAnalysisProviderError);
  });

  it('unwraps a ```json fenced response', () => {
    expect(parseJsonContent('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });
});
