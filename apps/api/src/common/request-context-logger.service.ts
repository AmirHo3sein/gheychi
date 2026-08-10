import { ConsoleLogger, LogLevel } from '@nestjs/common';
import { getRequestId } from './request-context';

/**
 * Installed once via `app.useLogger(new RequestContextConsoleLogger())` in main.ts.
 *
 * NestJS's `Logger` class is a thin wrapper: every `new Logger(context)` instance
 * used throughout the codebase (`private readonly logger = new Logger(Foo.name)`)
 * delegates its actual output to a single shared instance (`Logger.staticInstanceRef`),
 * which `app.useLogger()` overrides app-wide (see `Logger.overrideLogger` /
 * `Logger.prototype.localInstance` in `@nestjs/common`). That means overriding just the
 * two low-level formatting hooks below -- without touching a single call site -- makes
 * *every* `logger.log/warn/error/...` call anywhere in the app (controllers, services,
 * cron jobs) automatically include the current request's id, read from the
 * AsyncLocalStorage store `requestLoggingMiddleware` seeds per request (see
 * `request-context.ts`). Outside of a request (e.g. a cron job tick), `getRequestId()`
 * is `undefined` and log lines are unchanged.
 */
export class RequestContextConsoleLogger extends ConsoleLogger {
  protected override formatMessage(
    logLevel: LogLevel,
    message: unknown,
    pidMessage: string,
    formattedLogLevel: string,
    contextMessage: string,
    timestampDiff: string,
  ): string {
    const formatted = super.formatMessage(logLevel, message, pidMessage, formattedLogLevel, contextMessage, timestampDiff);
    const requestId = getRequestId();
    return requestId ? `[rid:${requestId}] ${formatted}` : formatted;
  }

  // Covers the `json: true` ConsoleLogger option too, in case that's ever turned on --
  // formatMessage() alone isn't used on that code path (see printAsJson in
  // @nestjs/common's console-logger.service.ts).
  protected override getJsonLogObject(
    message: unknown,
    options: { context: string; logLevel: LogLevel; writeStreamType?: 'stdout' | 'stderr'; errorStack?: unknown },
  ): ReturnType<ConsoleLogger['getJsonLogObject']> & { requestId?: string } {
    const base = super.getJsonLogObject(message, options);
    const requestId = getRequestId();
    return requestId ? { ...base, requestId } : base;
  }
}
