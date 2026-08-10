import { getRequestId, requestContextStorage } from './request-context';

describe('request-context', () => {
  it('returns undefined when read outside of any request context', () => {
    expect(getRequestId()).toBeUndefined();
  });

  it('returns the seeded request id while inside .run()', () => {
    requestContextStorage.run({ requestId: 'req-123' }, () => {
      expect(getRequestId()).toBe('req-123');
    });
  });

  it('propagates the request id across an async continuation (e.g. an awaited service call)', async () => {
    let observed: string | undefined;

    await requestContextStorage.run({ requestId: 'req-async' }, async () => {
      await Promise.resolve();
      observed = getRequestId();
    });

    expect(observed).toBe('req-async');
  });

  it('is undefined again once the .run() call has returned', () => {
    requestContextStorage.run({ requestId: 'req-scoped' }, () => {
      // no-op, just entering/leaving the context
    });

    expect(getRequestId()).toBeUndefined();
  });

  it('keeps nested/concurrent contexts isolated from each other', async () => {
    const results: string[] = [];

    await Promise.all([
      requestContextStorage.run({ requestId: 'req-a' }, async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        results.push(getRequestId()!);
      }),
      requestContextStorage.run({ requestId: 'req-b' }, async () => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        results.push(getRequestId()!);
      }),
    ]);

    expect(results.sort()).toEqual(['req-a', 'req-b']);
  });
});
