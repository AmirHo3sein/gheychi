import { EventEmitter } from 'node:events';
import { HttpMetricsMiddleware } from './http-metrics.middleware';
import { MetricsService } from './metrics.service';

// A minimal fake Response that's just enough of a Node EventEmitter to drive
// res.on('finish', ...) -- the same idiom request-logging.middleware.spec.ts already
// uses for the sibling middleware this one is modeled on.
function makeFakeRes(statusCode: number): { res: EventEmitter & { statusCode: number }; finish: () => void } {
  const res = new EventEmitter() as EventEmitter & { statusCode: number };
  res.statusCode = statusCode;
  return { res, finish: () => res.emit('finish') };
}

describe('HttpMetricsMiddleware', () => {
  it('records method, matched route pattern, status code, and a real duration on finish', () => {
    const observeHttpRequest = jest.fn();
    const middleware = new HttpMetricsMiddleware({ observeHttpRequest } as unknown as MetricsService);
    const { res, finish } = makeFakeRes(201);
    const req = { method: 'POST', route: { path: '/api/salons/:slug/bookings' } } as unknown as Parameters<
      HttpMetricsMiddleware['use']
    >[0];
    const next = jest.fn();

    middleware.use(req, res as never, next);
    expect(next).toHaveBeenCalled();
    expect(observeHttpRequest).not.toHaveBeenCalled(); // not yet -- only recorded once the response actually finishes

    finish();

    expect(observeHttpRequest).toHaveBeenCalledTimes(1);
    const [method, route, statusCode, durationSeconds] = observeHttpRequest.mock.calls[0];
    expect(method).toBe('POST');
    expect(route).toBe('/api/salons/:slug/bookings');
    expect(statusCode).toBe(201);
    expect(typeof durationSeconds).toBe('number');
    expect(durationSeconds).toBeGreaterThanOrEqual(0);
  });

  it('falls back to a bounded label when the request never matched a route (e.g. a 404)', () => {
    const observeHttpRequest = jest.fn();
    const middleware = new HttpMetricsMiddleware({ observeHttpRequest } as unknown as MetricsService);
    const { res, finish } = makeFakeRes(404);
    const req = { method: 'GET', route: undefined } as unknown as Parameters<HttpMetricsMiddleware['use']>[0];

    middleware.use(req, res as never, jest.fn());
    finish();

    expect(observeHttpRequest).toHaveBeenCalledWith('GET', 'unmatched_route', 404, expect.any(Number));
  });

  it('never lets a metrics failure propagate out of the finish handler', () => {
    const observeHttpRequest = jest.fn(() => {
      throw new Error('boom');
    });
    const middleware = new HttpMetricsMiddleware({ observeHttpRequest } as unknown as MetricsService);
    const { res, finish } = makeFakeRes(200);
    const req = { method: 'GET', route: { path: '/api/health' } } as unknown as Parameters<
      HttpMetricsMiddleware['use']
    >[0];

    middleware.use(req, res as never, jest.fn());

    expect(() => finish()).not.toThrow();
  });

  it('always calls next() synchronously, regardless of metrics behavior', () => {
    const middleware = new HttpMetricsMiddleware(new MetricsService());
    const { res } = makeFakeRes(200);
    const req = { method: 'GET', route: { path: '/api/health' } } as unknown as Parameters<
      HttpMetricsMiddleware['use']
    >[0];
    const next = jest.fn();

    middleware.use(req, res as never, next);

    expect(next).toHaveBeenCalledTimes(1);
  });
});
