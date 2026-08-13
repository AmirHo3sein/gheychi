import { CHECKS, defaultTargetUrls, runSmokeTest } from './smoke-test';

const urls = { apex: 'https://apex.test', api: 'https://api.test', panel: 'https://panel.test', admin: 'https://admin.test' };

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return {
    status,
    text: async () => JSON.stringify(body),
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
  } as unknown as Response;
}

function plainResponse(status: number, headers: Record<string, string> = {}): Response {
  return {
    status,
    text: async () => '',
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
  } as unknown as Response;
}

describe('runSmokeTest', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('reports every check as passing when all responses are healthy', async () => {
    const fetchMock = jest.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/health')) return jsonResponse(200, { status: 'ok', db: 'ok', redis: 'ok' }, { 'content-security-policy-report-only': 'default-src none' });
      if (url.endsWith('/api/version')) return jsonResponse(200, { version: 'v1.0.0-1-gabc', gitSha: 'abc123' });
      if (url.endsWith('/api/categories')) return jsonResponse(200, []);
      if (url.endsWith('/api/cities')) return jsonResponse(200, []);
      if (url.endsWith('/api/auth/verify-otp')) return jsonResponse(400, { message: ['code must be longer than or equal to 6 characters'] });
      if (url.endsWith('/api/csp-report')) return plainResponse(204);
      return plainResponse(200, { 'content-security-policy-report-only': 'default-src self' });
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const results = await runSmokeTest(urls);

    expect(results.every((r) => r.ok)).toBe(true);
    expect(results).toHaveLength(CHECKS.length);
  });

  it('fails the body-parsing check when the server reports a missing-body error instead of a length error', async () => {
    // Exactly what the real incident looked like: req.body was undefined, so
    // @IsString() failed before @Length(6,6) ever ran.
    const fetchMock = jest.fn(async (url: string) => {
      if (url.endsWith('/api/auth/verify-otp')) return jsonResponse(400, { message: ['code must be a string'] });
      return jsonResponse(200, { status: 'ok', db: 'ok', redis: 'ok' });
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const results = await runSmokeTest(urls, [CHECKS.find((c) => c.name.includes('unscoped JSON body parsing'))!]);

    expect(results[0].ok).toBe(false);
    expect(results[0].error).toContain('code must be a string');
  });

  it('fails a check when the expected status code is wrong', async () => {
    const fetchMock = jest.fn(async () => jsonResponse(500, { message: 'boom' }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const results = await runSmokeTest(urls, [CHECKS.find((c) => c.name === 'api health')!]);

    expect(results[0].ok).toBe(false);
    expect(results[0].error).toContain('expected 200, got 500');
  });

  it('fails the CSP header check when the header is missing', async () => {
    const fetchMock = jest.fn(async () => plainResponse(200));
    global.fetch = fetchMock as unknown as typeof fetch;

    const results = await runSmokeTest(urls, [CHECKS.find((c) => c.name === 'CSP header on user-app')!]);

    expect(results[0].ok).toBe(false);
    expect(results[0].error).toContain('Content-Security-Policy-Report-Only');
  });

  it('continues running remaining checks after one fails', async () => {
    let call = 0;
    const fetchMock = jest.fn(async () => {
      call += 1;
      if (call === 1) throw new Error('ECONNRESET');
      return jsonResponse(200, { version: 'v1.0.0-1-gabc', gitSha: 'abc123' });
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const results = await runSmokeTest(urls, [
      CHECKS.find((c) => c.name === 'api health')!,
      CHECKS.find((c) => c.name === 'api version reports a real deploy identity')!,
    ]);

    expect(results[0].ok).toBe(false);
    expect(results[0].error).toContain('ECONNRESET');
    expect(results[1].ok).toBe(true);
  });
});

describe('defaultTargetUrls', () => {
  it('falls back to the real production domains when no overrides are set', () => {
    expect(defaultTargetUrls({})).toEqual({
      apex: 'https://gheychi.co',
      api: 'https://api.gheychi.co',
      panel: 'https://panel.gheychi.co',
      admin: 'https://admin.gheychi.co',
    });
  });

  it('honours SMOKE_TEST_*_URL overrides, e.g. for a staging run', () => {
    expect(
      defaultTargetUrls({
        SMOKE_TEST_APEX_URL: 'https://staging.example.com',
        SMOKE_TEST_API_URL: 'https://staging-api.example.com',
        SMOKE_TEST_PANEL_URL: 'https://staging-panel.example.com',
        SMOKE_TEST_ADMIN_URL: 'https://staging-admin.example.com',
      }),
    ).toEqual({
      apex: 'https://staging.example.com',
      api: 'https://staging-api.example.com',
      panel: 'https://staging-panel.example.com',
      admin: 'https://staging-admin.example.com',
    });
  });
});
