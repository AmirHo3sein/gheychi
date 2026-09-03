import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Request } from 'express';
import { Observable, tap } from 'rxjs';
import { User } from '../users/user.entity';
import { AnalyticsService } from './analytics.service';

/**
 * Is this request the PUBLIC salon-profile read, `GET /api/salons/:slug`?
 *
 * Exported and pure so the matching rules are unit-testable on their own -- the sibling
 * routes it must NOT match are the whole risk here, and each of them is pinned by a test:
 *
 *   - `/api/salons/mine`               the owner's own salon (a provider tool, not a view)
 *   - `/api/salons/:slug/canonical`    handle-history resolution
 *   - `/api/salons/:slug/services`     and every other PublicSalonContentController route
 *   - `/api/admin/salons/:id`          the admin detail view
 *
 * Matching on the trailing two segments (rather than a hardcoded `/api/...` prefix) keeps
 * this from silently breaking if the global prefix is ever configured differently, while
 * the length check is what stops a nested route like `/api/admin/salons/:id` matching.
 */
export function isPublicSalonProfilePath(path: string): boolean {
  const segments = path.split('?')[0]!.split('/').filter(Boolean);
  if (segments.length < 2) return false;
  const [resource, slug] = segments.slice(-2);
  if (resource !== 'salons' || slug === 'mine') return false;
  return segments.length === 2 || (segments.length === 3 && segments[0] === 'api');
}

/**
 * Emits the `salon_profile_viewed` funnel event -- the top of the per-salon funnel, and
 * previously the missing stage that made a salon's conversion rate uncomputable (there was
 * no denominator at all).
 *
 * **Why an interceptor rather than a `track()` call inside the salon controller.** The
 * user-app is server-rendered: on a first visit the salon page is fetched by the Nuxt
 * server, not the browser, so a client-side beacon would miss exactly the traffic that
 * matters and would additionally be trivially spoofable and blockable. The event has to be
 * recorded where the profile is actually served. Putting it here rather than in
 * `SalonsController.publicProfile` keeps the analytics wiring out of a controller that has
 * no other reason to know analytics exists -- the same "cross-cutting concern, registered
 * globally" shape `AuditInterceptor` and `GlobalExceptionFilter` already use in this
 * codebase.
 *
 * **What it counts.** One event per successful public profile response: real visitors, the
 * SSR fetch on their behalf, crawlers, and the owner previewing their own page. That makes
 * it a view count, not a unique-visitor count, and the funnel below it should be read that
 * way. Deduplicating would need per-visitor identity this platform does not collect on a
 * public page, and inventing one is worse than a clearly-labeled view count.
 *
 * Fire-and-forget, exactly like every other `AnalyticsService.track` call site: never
 * awaited, errors swallowed, so an analytics outage can never add latency to or fail a
 * public page load.
 */
@Injectable()
export class SalonProfileViewInterceptor implements NestInterceptor {
  constructor(private readonly analytics: AnalyticsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    // Registered globally, so it runs for every request in the app -- the cheap checks come
    // first and the overwhelming majority of requests leave through this line untouched.
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest<Request>();
    if (req.method !== 'GET' || !isPublicSalonProfilePath(req.path)) return next.handle();

    return next.handle().pipe(
      tap((body) => {
        // Only on a real profile payload. `tap` doesn't run at all on the error path (a
        // 404 for an unknown/unapproved slug never emits), and the id check means a future
        // change to the response shape degrades into "no events" rather than into rows
        // with a garbage salonId.
        const salonId = (body as { id?: unknown } | null)?.id;
        if (typeof salonId !== 'string') return;

        // userId is present only if the viewer happened to be logged in; the route is
        // public, so most views are anonymous. No PII in properties -- a bare id reference,
        // per AnalyticsService's own call-site discipline.
        const viewerId = (req.user as User | undefined)?.id;
        void this.analytics.track('salon_profile_viewed', { salonId }, { userId: viewerId }).catch(() => {});
      }),
    );
  }
}
