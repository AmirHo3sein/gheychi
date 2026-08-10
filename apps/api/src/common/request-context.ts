import { AsyncLocalStorage } from 'async_hooks';

export interface RequestContextStore {
  requestId: string;
}

/**
 * Node's built-in AsyncLocalStorage, seeded once per request by
 * `requestLoggingMiddleware` (which wraps the rest of the request's handling --
 * routing, guards, controller, every downstream service/repository call -- in a
 * single `.run()` call). Any code running anywhere in that async chain can read the
 * current request's id back out via `getRequestId()` without it being threaded
 * through as an explicit function parameter. No new dependency: this is the same
 * mechanism a package like nestjs-cls wraps, used directly since this app has no
 * other request-scoped-storage need that would justify that extra dependency.
 */
export const requestContextStorage = new AsyncLocalStorage<RequestContextStore>();

/** The current request's id, or `undefined` outside of any request (e.g. a cron job). */
export function getRequestId(): string | undefined {
  return requestContextStorage.getStore()?.requestId;
}
