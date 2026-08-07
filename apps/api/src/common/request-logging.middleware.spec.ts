import { EventEmitter } from 'events';
import { Logger } from '@nestjs/common';
import { Request, Response } from 'express';
import { requestLoggingMiddleware } from './request-logging.middleware';

function fakeReqRes(headers: Record<string, string> = {}) {
  const req = { method: 'GET', originalUrl: '/api/salons/mine', headers } as unknown as Request;
  const res = Object.assign(new EventEmitter(), {
    statusCode: 200,
    setHeader: jest.fn(),
  }) as unknown as Response;
  return { req, res };
}

describe('requestLoggingMiddleware', () => {
  it('generates a request id and echoes it back as a response header when none was supplied', () => {
    const { req, res } = fakeReqRes();
    const next = jest.fn();

    requestLoggingMiddleware(req, res, next);

    expect(req.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', req.requestId);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('reuses a well-formed incoming X-Request-Id instead of generating a new one', () => {
    const { req, res } = fakeReqRes({ 'x-request-id': 'proxy-abc-123' });

    requestLoggingMiddleware(req, res, jest.fn());

    expect(req.requestId).toBe('proxy-abc-123');
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', 'proxy-abc-123');
  });

  it('ignores an incoming X-Request-Id with unsafe characters and generates a fresh one instead', () => {
    const { req, res } = fakeReqRes({ 'x-request-id': 'bad\nvalue\r\ninjected: true' });

    requestLoggingMiddleware(req, res, jest.fn());

    expect(req.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('ignores an incoming X-Request-Id that is too long', () => {
    const { req, res } = fakeReqRes({ 'x-request-id': 'a'.repeat(65) });

    requestLoggingMiddleware(req, res, jest.fn());

    expect(req.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('logs one access-log line, including the method, url, status, and request id, when the response finishes', () => {
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const { req, res } = fakeReqRes();
    requestLoggingMiddleware(req, res, jest.fn());
    res.statusCode = 201;

    (res as unknown as EventEmitter).emit('finish');

    expect(logSpy).toHaveBeenCalledTimes(1);
    const [line] = logSpy.mock.calls[0]!;
    expect(line).toContain('GET /api/salons/mine 201');
    expect(line).toContain(`[${req.requestId}]`);
  });
});
