import {
  BadRequestException,
  Controller,
  Get,
  INestApplication,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ERROR_TRACKING_PROVIDER } from './error-tracking.service';
import { GlobalExceptionFilter } from './global-exception.filter';

@Controller()
class ThrowingController {
  @Get('throws-unknown-error')
  throwsUnknownError(): never {
    throw new Error('something broke');
  }

  @Get('throws-503')
  throws503(): never {
    throw new ServiceUnavailableException('dependency down');
  }

  @Get('throws-404')
  throws404(): never {
    throw new NotFoundException('booking not found');
  }

  @Get('throws-400')
  throws400(): never {
    throw new BadRequestException('bad input');
  }
}

describe('GlobalExceptionFilter (integration)', () => {
  let app: INestApplication;
  let captureException: jest.Mock;

  beforeEach(async () => {
    captureException = jest.fn();

    const moduleRef = await Test.createTestingModule({
      controllers: [ThrowingController],
      providers: [
        { provide: ERROR_TRACKING_PROVIDER, useValue: { captureException } },
        { provide: APP_FILTER, useClass: GlobalExceptionFilter },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('captures an uncaught non-HttpException and still returns NestJS default 500 response unchanged', async () => {
    const res = await request(app.getHttpServer()).get('/throws-unknown-error');

    expect(res.status).toBe(500);
    // NestJS's own default unknown-exception body -- MESSAGES.UNKNOWN_EXCEPTION_MESSAGE in
    // @nestjs/core, unchanged from what it would be with no filter registered at all.
    expect(res.body).toEqual({ statusCode: 500, message: 'Internal server error' });
    expect(captureException).toHaveBeenCalledTimes(1);
    const [capturedError, context] = captureException.mock.calls[0]!;
    expect(capturedError).toBeInstanceOf(Error);
    expect((capturedError as Error).message).toBe('something broke');
    expect(context).toEqual({ requestId: undefined, userId: undefined, route: 'GET /throws-unknown-error' });
  });

  it('captures a thrown 5xx HttpException and preserves its own status/body unchanged', async () => {
    const res = await request(app.getHttpServer()).get('/throws-503');

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ statusCode: 503, message: 'dependency down', error: 'Service Unavailable' });
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it('does NOT capture an ordinary 404 business-rule exception, and the response is unchanged', async () => {
    const res = await request(app.getHttpServer()).get('/throws-404');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ statusCode: 404, message: 'booking not found', error: 'Not Found' });
    expect(captureException).not.toHaveBeenCalled();
  });

  it('does NOT capture an ordinary 400 business-rule exception, and the response is unchanged', async () => {
    const res = await request(app.getHttpServer()).get('/throws-400');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ statusCode: 400, message: 'bad input', error: 'Bad Request' });
    expect(captureException).not.toHaveBeenCalled();
  });
});
