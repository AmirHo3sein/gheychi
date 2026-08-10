import 'reflect-metadata';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { AdminNotificationsController } from './admin-notifications/admin-notifications.controller';
import { AdminAuditController } from './audit/admin-audit.controller';
import { AuthController } from './auth/auth.controller';
import { AvailabilityController } from './booking/availability.controller';
import { BookingsController } from './booking/bookings.controller';
import { PaymentsController } from './booking/payments.controller';
import { SalonBookingsController } from './booking/salon-bookings.controller';
import { SalonEarningsController } from './booking/salon-earnings.controller';
import { AdminCategoriesController } from './catalog/admin-categories.controller';
import { CatalogController } from './catalog/catalog.controller';
import { CitiesController } from './cities/cities.controller';
import { AdminBlogController } from './content/admin-blog.controller';
import { BlogController } from './content/blog.controller';
import { SitemapBlogController } from './content/sitemap-blog.controller';
import { AdminCouponsController } from './coupons/admin-coupons.controller';
import { CouponValidationController } from './coupons/coupon-validation.controller';
import { SalonCouponsController } from './coupons/salon-coupons.controller';
import { FavoritesController } from './favorites/favorites.controller';
import { HealthController } from './health/health.controller';
import { AdminInvoicesController } from './invoicing/admin-invoices.controller';
import { SalonInvoicesController } from './invoicing/salon-invoices.controller';
import { AdminConfigController } from './platform-config/admin-config.controller';
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
import { AdminWalletController } from './wallet/admin-wallet.controller';
import { WalletController } from './wallet/wallet.controller';

// Nest stores these under fixed string keys (see GUARDS_METADATA/PATH_METADATA in
// @nestjs/common/constants) -- hardcoded here rather than imported, matching the existing
// precedent in audit/audit-wiring.spec.ts (INTERCEPTORS_METADATA).
const GUARDS_METADATA = '__guards__';
const PATH_METADATA = 'path';

// Every controller in the app, so a newly-added controller file that forgets to be imported
// here fails loudly (via the "every route is guarded or explicitly public" assertion below
// simply never running for it) is caught by the companion "controller count" sanity check.
const ALL_CONTROLLERS: Function[] = [
  AdminNotificationsController,
  AdminAuditController,
  AuthController,
  AvailabilityController,
  BookingsController,
  PaymentsController,
  SalonBookingsController,
  SalonEarningsController,
  AdminCategoriesController,
  CatalogController,
  CitiesController,
  AdminBlogController,
  BlogController,
  SitemapBlogController,
  AdminCouponsController,
  CouponValidationController,
  SalonCouponsController,
  FavoritesController,
  HealthController,
  AdminInvoicesController,
  SalonInvoicesController,
  AdminConfigController,
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
  AdminWalletController,
  WalletController,
];

// Every deliberately-unauthenticated route in the API. Adding an entry here is a reviewable
// SECURITY DECISION, not a formality -- it is asserting "this data/action is safe for anyone
// on the internet to reach with no session at all." Cross-reference docs/phase1-audit.md
// section 1 for why each of these is intentionally public before adding a new one.
const PUBLIC_ROUTES: Array<[Function, string]> = [
  [AuthController, 'requestOtp'],
  [AuthController, 'verifyOtp'],
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
  [PlatformConfigController, 'bookingTerms'],
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

function hasClassGuards(controller: Function): boolean {
  const guards = Reflect.getMetadata(GUARDS_METADATA, controller);
  return Array.isArray(guards) && guards.length > 0;
}

function hasMethodGuards(controller: Function, methodName: string): boolean {
  const handler = (controller.prototype as Record<string, unknown>)[methodName];
  const guards = Reflect.getMetadata(GUARDS_METADATA, handler as object);
  return Array.isArray(guards) && guards.length > 0;
}

function isPublicRoute(controller: Function, methodName: string): boolean {
  return PUBLIC_ROUTES.some(([c, m]) => c === controller && m === methodName);
}

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

  const violations: string[] = [];
  for (const controller of ALL_CONTROLLERS) {
    const classGuarded = hasClassGuards(controller);
    for (const methodName of routeHandlerNames(controller)) {
      if (classGuarded || hasMethodGuards(controller, methodName) || isPublicRoute(controller, methodName)) {
        continue;
      }
      violations.push(`${controller.name}.${methodName}`);
    }
  }

  it('every route handler is either guarded (class- or method-level @UseGuards) or on the explicit PUBLIC_ROUTES allowlist', () => {
    expect(violations).toEqual([]);
  });
});
