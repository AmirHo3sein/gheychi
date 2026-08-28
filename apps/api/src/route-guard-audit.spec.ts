import 'reflect-metadata';
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ActivityController } from './activity/activity.controller';
import { AdminNotificationsController } from './admin-notifications/admin-notifications.controller';
import { AdminAuditController } from './audit/admin-audit.controller';
import { AuthController } from './auth/auth.controller';
import { AuthGuard } from './auth/auth.guard';
import { IS_PUBLIC_KEY, Public } from './auth/public.decorator';
import { BackupReportController } from './backup-monitoring/backup-report.controller';
import { AdminBookingSettingsController } from './booking/admin-booking-settings.controller';
import { AvailabilityController } from './booking/availability.controller';
import { BookingsController } from './booking/bookings.controller';
import { PaymentsController } from './booking/payments.controller';
import { SalonBookingsController } from './booking/salon-bookings.controller';
import { SalonEarningsController } from './booking/salon-earnings.controller';
import { AdminCategoriesController } from './catalog/admin-categories.controller';
import { AdminCategoryRequestsController } from './catalog/admin-category-requests.controller';
import { CatalogController } from './catalog/catalog.controller';
import { CategoryRequestsController } from './catalog/category-requests.controller';
import { CitiesController } from './cities/cities.controller';
import { AdminBlogController } from './content/admin-blog.controller';
import { BlogController } from './content/blog.controller';
import { SitemapBlogController } from './content/sitemap-blog.controller';
import { AdminCouponsController } from './coupons/admin-coupons.controller';
import { CouponValidationController } from './coupons/coupon-validation.controller';
import { SalonCouponsController } from './coupons/salon-coupons.controller';
import { CspReportController } from './csp-report/csp-report.controller';
import { FavoritesController } from './favorites/favorites.controller';
import { HealthController } from './health/health.controller';
import { AdminInvoicesController } from './invoicing/admin-invoices.controller';
import { SalonInvoicesController } from './invoicing/salon-invoices.controller';
import { MetricsController } from './metrics/metrics.controller';
import { AdminConfigController } from './platform-config/admin-config.controller';
import { AdminFeatureFlagsController } from './platform-config/admin-feature-flags.controller';
import { PlatformConfigController } from './platform-config/platform-config.controller';
import { PushController } from './push/push.controller';
import { AdminReferralRewardTypesController, AdminReferralsController } from './referrals/admin-referrals.controller';
import { ReferralsController } from './referrals/referrals.controller';
import { AdminReportsController } from './reports/admin-reports.controller';
import { ReportsController } from './reports/reports.controller';
import { AdminReviewsController } from './reviews/admin-reviews.controller';
import { AdminWorkerRatingsController } from './reviews/admin-worker-ratings.controller';
import { ReviewsController } from './reviews/reviews.controller';
import { SalonReviewReplyController } from './reviews/salon-review-reply.controller';
import { SalonReviewsController } from './reviews/salon-reviews.controller';
import { AdminSalonsController } from './salons/admin-salons.controller';
import { AdminShowcaseController } from './salons/admin-showcase.controller';
import { PublicSalonContentController } from './salons/public-salon-content.controller';
import { SalonPhotosController } from './salons/salon-photos.controller';
import { SalonPortfolioController } from './salons/salon-portfolio.controller';
import { SalonServicesController } from './salons/salon-services.controller';
import { SalonStoriesController } from './salons/salon-stories.controller';
import { SalonWorkersController } from './salons/salon-workers.controller';
import { SalonsController } from './salons/salons.controller';
import { ScheduleController } from './salons/schedule.controller';
import { SitemapSalonsController } from './salons/sitemap-salons.controller';
import { SearchController } from './search/search.controller';
import { AdminUsersController } from './users/admin-users.controller';
import { VersionController } from './version/version.controller';
import { AdminWalletController } from './wallet/admin-wallet.controller';
import { WalletController } from './wallet/wallet.controller';

// Nest stores route paths under this fixed string key (see PATH_METADATA in
// @nestjs/common/constants) -- hardcoded here rather than imported, matching the existing
// precedent in audit/audit-wiring.spec.ts (INTERCEPTORS_METADATA).
const PATH_METADATA = 'path';

// Every controller in the app, so a newly-added controller file that forgets to be imported
// here fails loudly (via the "every route is either public or must reject an anonymous
// caller" assertion below simply never running for it) is caught by the companion
// "controller count" sanity check.
const ALL_CONTROLLERS: Function[] = [
  ActivityController,
  AdminNotificationsController,
  AdminAuditController,
  AuthController,
  BackupReportController,
  AdminBookingSettingsController,
  AvailabilityController,
  BookingsController,
  PaymentsController,
  SalonBookingsController,
  SalonEarningsController,
  AdminCategoriesController,
  AdminCategoryRequestsController,
  CatalogController,
  CategoryRequestsController,
  CitiesController,
  AdminBlogController,
  BlogController,
  SitemapBlogController,
  AdminCouponsController,
  CouponValidationController,
  SalonCouponsController,
  CspReportController,
  FavoritesController,
  HealthController,
  AdminInvoicesController,
  SalonInvoicesController,
  MetricsController,
  AdminConfigController,
  AdminFeatureFlagsController,
  PlatformConfigController,
  PushController,
  AdminReferralRewardTypesController,
  AdminReferralsController,
  ReferralsController,
  AdminReportsController,
  ReportsController,
  AdminReviewsController,
  AdminWorkerRatingsController,
  ReviewsController,
  SalonReviewReplyController,
  SalonReviewsController,
  AdminSalonsController,
  AdminShowcaseController,
  PublicSalonContentController,
  SalonPhotosController,
  SalonPortfolioController,
  SalonServicesController,
  SalonStoriesController,
  SalonWorkersController,
  SalonsController,
  ScheduleController,
  SitemapSalonsController,
  SearchController,
  AdminUsersController,
  VersionController,
  AdminWalletController,
  WalletController,
];

// Every deliberately-unauthenticated route in the API. Adding an entry here is a reviewable
// SECURITY DECISION, not a formality -- it is asserting "this data/action is safe for anyone
// on the internet to reach with no session at all." Cross-reference docs/phase1-audit.md
// section 1 for why each of these is intentionally public before adding a new one.
//
// This is now a regression pin for the @Public() mechanism, not the safety net itself: the
// safety net is AuthGuard running globally via APP_GUARD (app.module.ts) -- every route is
// protected by default and must opt OUT with @Public() to be reachable anonymously. What
// this file verifies is narrower but still valuable: (1) every route below actually carries
// the @Public() metadata the guard reads, so a route can't silently drift off the allowlist
// while still being reachable, and (2) AuthGuard itself correctly honours that metadata.
const PUBLIC_ROUTES: Array<[Function, string]> = [
  [AuthController, 'requestOtp'],
  [AuthController, 'verifyOtp'],
  // @Public() only to skip AuthGuard's session-cookie check (the caller is
  // docker/backup/backup.sh, which has no user session) -- real access control is
  // BackupReportSecretGuard's shared-secret comparison, applied via @UseGuards on the
  // controller. See backup-report-secret.guard.ts's doc comment for why that secret is
  // load-bearing (Caddy's reverse_proxy for {$DOMAIN_API} has no path restriction, so
  // this route is reachable from the public internet today, not just in a hypothetical
  // misconfiguration).
  [BackupReportController, 'report'],
  [AvailabilityController, 'get'],
  [PaymentsController, 'callback'], // Zarinpal's own browser redirect target, not a webhook
  [CatalogController, 'list'],
  [CitiesController, 'list'],
  [BlogController, 'list'],
  [BlogController, 'bySlug'],
  [BlogController, 'categories'],
  [SitemapBlogController, 'list'],
  [HealthController, 'check'],
  [HealthController, 'liveness'], // orchestrator process-liveness probe, must be reachable with no session
  [HealthController, 'readiness'], // orchestrator readiness probe, must be reachable with no session
  [MetricsController, 'metrics'], // Prometheus scraper target, must be reachable with no session (scrapers don't authenticate)
  [VersionController, 'getVersion'], // deploy-identity endpoint (version/git SHA/build timestamp); no secrets, safe for anyone to read with no session
  [CspReportController, 'report'], // browser-submitted CSP violation reports (report-uri) -- no session concept applies, any browser can send one
  [PlatformConfigController, 'bookingTerms'],
  [PlatformConfigController, 'getFeatureFlags'], // consumed by user-app/provider-panel to gate their own UI; no secrets, safe for anyone to read with no session
  [ReferralsController, 'validate'], // IP-rate-limited separately, see referrals.controller.ts
  [SalonReviewsController, 'list'],
  [PublicSalonContentController, 'listServices'],
  [PublicSalonContentController, 'listHours'],
  [PublicSalonContentController, 'listExceptions'],
  [PublicSalonContentController, 'listPhotos'],
  [PublicSalonContentController, 'listStories'],
  [PublicSalonContentController, 'listPortfolio'],
  [PublicSalonContentController, 'listWorkers'],
  [PublicSalonContentController, 'listWorkerRatings'],
  [SalonsController, 'publicProfile'],
  [SitemapSalonsController, 'list'],
  [SearchController, 'run'],
];

function routeHandlerNames(controller: Function): string[] {
  const proto = controller.prototype as Record<string, unknown>;
  return Object.getOwnPropertyNames(proto).filter((name) => {
    if (name === 'constructor') return false;
    if (typeof proto[name] !== 'function') return false;
    // Only actual @Get/@Post/@Patch/@Delete/@Put handlers carry PATH_METADATA -- a plain
    // private helper method on a controller class must not be mistaken for a route.
    return Reflect.getMetadata(PATH_METADATA, proto[name] as object) !== undefined;
  });
}

// Mirrors exactly what AuthGuard itself does (reflector.getAllAndOverride over handler then
// class) -- deliberately reimplemented here rather than imported, so this test independently
// exercises the real Reflector/SetMetadata wiring instead of trusting the guard's own logic.
function isMarkedPublic(controller: Function, methodName: string): boolean {
  const reflector = new Reflector();
  const proto = controller.prototype as Record<string, unknown>;
  const handler = proto[methodName] as Function;
  return reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [handler, controller]) ?? false;
}

function isPublicRoute(controller: Function, methodName: string): boolean {
  return PUBLIC_ROUTES.some(([c, m]) => c === controller && m === methodName);
}

function mockExecutionContext(handler: object, controllerClass: Function): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ cookies: {} }) }),
    getHandler: () => handler,
    getClass: () => controllerClass,
  } as unknown as ExecutionContext;
}

describe('route guard audit (security regression test)', () => {
  it('covers every controller file currently in src/ (fails if a controller is added but not imported above)', () => {
    // A cheap, independent cross-check against a plain recursive filesystem walk -- keeps
    // this spec from silently going stale as new controllers are added. No glob dependency
    // needed for a one-off recursive *.controller.ts count.
    function countControllerFiles(dir: string): number {
      let count = 0;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          count += countControllerFiles(path);
        } else if (entry.isFile() && entry.name.endsWith('.controller.ts')) {
          count += 1;
        }
      }
      return count;
    }
    const controllerFileCount = countControllerFiles(__dirname);
    expect(controllerFileCount).toBeGreaterThan(0);
    expect(ALL_CONTROLLERS.length).toBeGreaterThanOrEqual(controllerFileCount);
  });

  it('every PUBLIC_ROUTES entry resolves to a real, currently-existing route handler', () => {
    // Guards the allowlist itself against typos or a handler that got renamed/removed --
    // otherwise a stale entry would silently stop protecting anything.
    for (const [controller, methodName] of PUBLIC_ROUTES) {
      const proto = controller.prototype as Record<string, unknown>;
      expect(typeof proto[methodName]).toBe('function');
      expect(Reflect.getMetadata(PATH_METADATA, proto[methodName] as object)).toBeDefined();
    }
  });

  it('every PUBLIC_ROUTES entry actually carries the @Public() metadata AuthGuard reads', () => {
    // The forward direction: nothing on the allowlist was left unmarked (which would mean
    // it's actually still guarded despite being "documented" as public here).
    const missing: string[] = [];
    for (const [controller, methodName] of PUBLIC_ROUTES) {
      if (!isMarkedPublic(controller, methodName)) {
        missing.push(`${controller.name}.${methodName}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('no route outside PUBLIC_ROUTES is marked @Public() (catches an accidental over-broad decorator)', () => {
    // The reverse direction: nothing became reachable anonymously without a corresponding,
    // reviewed PUBLIC_ROUTES entry. This is the actual security backstop now that AuthGuard
    // runs globally -- @Public() is the only way to open a route, so a stray/mistaken
    // @Public() is the only way this mechanism can regress into an unintentional exposure.
    const unexpectedlyPublic: string[] = [];
    for (const controller of ALL_CONTROLLERS) {
      for (const methodName of routeHandlerNames(controller)) {
        if (isMarkedPublic(controller, methodName) && !isPublicRoute(controller, methodName)) {
          unexpectedlyPublic.push(`${controller.name}.${methodName}`);
        }
      }
    }
    expect(unexpectedlyPublic).toEqual([]);
  });

  describe('AuthGuard honours @Public() end-to-end (real Reflector + real decorator metadata)', () => {
    @Public()
    class PublicDummyController {
      handler() {}
    }

    class ProtectedDummyController {
      handler() {}
    }

    it('skips the auth check for a class marked @Public()', async () => {
      const jwt = { verifyAsync: jest.fn() } as any;
      const users = { findById: jest.fn() } as any;
      const guard = new AuthGuard(jwt, users, new Reflector());

      const context = mockExecutionContext(PublicDummyController.prototype.handler, PublicDummyController);
      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(jwt.verifyAsync).not.toHaveBeenCalled();
    });

    it('still enforces auth (throws with no session cookie) for a route with no @Public()', async () => {
      const jwt = { verifyAsync: jest.fn() } as any;
      const users = { findById: jest.fn() } as any;
      const guard = new AuthGuard(jwt, users, new Reflector());

      const context = mockExecutionContext(ProtectedDummyController.prototype.handler, ProtectedDummyController);
      await expect(guard.canActivate(context)).rejects.toThrow();
    });
  });
});
