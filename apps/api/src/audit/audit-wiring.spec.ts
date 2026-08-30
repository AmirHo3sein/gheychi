import 'reflect-metadata';
import { AdminBookingSettingsController } from '../booking/admin-booking-settings.controller';
import { SalonBookingsController } from '../booking/salon-bookings.controller';
import { AdminCategoriesController } from '../catalog/admin-categories.controller';
import { AdminCategoryRequestsController } from '../catalog/admin-category-requests.controller';
import { AdminBlogController } from '../content/admin-blog.controller';
import { AdminCouponsController } from '../coupons/admin-coupons.controller';
import { AdminInvoicesController } from '../invoicing/admin-invoices.controller';
import { AdminConfigController } from '../platform-config/admin-config.controller';
import { AdminFeatureFlagsController } from '../platform-config/admin-feature-flags.controller';
import { AdminReferralRewardTypesController, AdminReferralsController } from '../referrals/admin-referrals.controller';
import { AdminReportsController } from '../reports/admin-reports.controller';
import { AdminReviewsController } from '../reviews/admin-reviews.controller';
import { AdminWorkerRatingsController } from '../reviews/admin-worker-ratings.controller';
import { AdminSalonsController } from '../salons/admin-salons.controller';
import { AdminShowcaseController } from '../salons/admin-showcase.controller';
import { AdminPlansController } from '../subscriptions/admin-plans.controller';
import { AdminSalonSubscriptionsController } from '../subscriptions/admin-salon-subscriptions.controller';
import { AdminUsersController } from '../users/admin-users.controller';
import { AdminWalletController } from '../wallet/admin-wallet.controller';
import { AUDIT_ACTION } from './audit.decorator';
import { AuditInterceptor } from './audit.interceptor';

// Nest stores @UseInterceptors metadata under this key (INTERCEPTORS_METADATA in @nestjs/common/constants).
const INTERCEPTORS_METADATA = '__interceptors__';

describe('admin mutation audit wiring', () => {
  const cases = [
    {
      label: 'salon status',
      handler: AdminSalonsController.prototype.setStatus,
      action: 'salon.status.set',
      targetType: 'salon',
    },
    {
      label: 'salon featured',
      handler: AdminSalonsController.prototype.setFeatured,
      action: 'salon.featured.set',
      targetType: 'salon',
    },
    {
      label: 'salon handle set',
      handler: AdminSalonsController.prototype.setHandle,
      action: 'salon.handle.set',
      targetType: 'salon',
    },
    {
      label: 'story status',
      handler: AdminShowcaseController.prototype.setStoryStatus,
      action: 'salon.story.status.set',
      targetType: 'story',
    },
    {
      label: 'portfolio status',
      handler: AdminShowcaseController.prototype.setPortfolioStatus,
      action: 'salon.portfolio.status.set',
      targetType: 'portfolioitem',
    },
    {
      label: 'user status',
      handler: AdminUsersController.prototype.setStatus,
      action: 'user.status.set',
      targetType: 'user',
    },
    {
      label: 'review moderate',
      handler: AdminReviewsController.prototype.moderate,
      action: 'review.moderate',
      targetType: 'review',
    },
    {
      label: 'category create',
      handler: AdminCategoriesController.prototype.create,
      action: 'category.create',
      targetType: 'category',
    },
    {
      label: 'category update',
      handler: AdminCategoriesController.prototype.update,
      action: 'category.update',
      targetType: 'category',
    },
    {
      label: 'category delete',
      handler: AdminCategoriesController.prototype.remove,
      action: 'category.delete',
      targetType: 'category',
    },
    {
      label: 'category request approve',
      handler: AdminCategoryRequestsController.prototype.approve,
      action: 'category-request.approve',
      targetType: 'category-request',
    },
    {
      label: 'category request reject',
      handler: AdminCategoryRequestsController.prototype.reject,
      action: 'category-request.reject',
      targetType: 'category-request',
    },
    // Provider-performed, not admin-performed -- but audit_log's contract is "a real
    // person did this", not "an admin did this", and a salon owner accepting or declining
    // a customer's request is exactly that.
    {
      label: 'booking approval approved',
      handler: SalonBookingsController.prototype.approve,
      action: 'booking.approval.approved',
      targetType: 'booking',
    },
    {
      label: 'booking approval rejected',
      handler: SalonBookingsController.prototype.reject,
      action: 'booking.approval.rejected',
      targetType: 'booking',
    },
    {
      label: 'salon booking settings update',
      handler: AdminBookingSettingsController.prototype.update,
      action: 'booking-settings.update',
      targetType: 'salon',
    },
    {
      label: 'config update',
      handler: AdminConfigController.prototype.update,
      action: 'config.update',
      targetType: 'config',
    },
    {
      label: 'feature flags update',
      handler: AdminFeatureFlagsController.prototype.update,
      action: 'feature-flags.update',
      targetType: 'feature-flags',
    },
    {
      label: 'report resolve',
      handler: AdminReportsController.prototype.resolve,
      action: 'report.resolve',
      targetType: 'report',
    },
    {
      label: 'blog post create',
      handler: AdminBlogController.prototype.create,
      action: 'post.create',
      targetType: 'post',
    },
    {
      label: 'blog post update',
      handler: AdminBlogController.prototype.update,
      action: 'post.update',
      targetType: 'post',
    },
    {
      label: 'blog post publish',
      handler: AdminBlogController.prototype.publish,
      action: 'post.publish',
      targetType: 'post',
    },
    {
      label: 'blog post unpublish',
      handler: AdminBlogController.prototype.unpublish,
      action: 'post.unpublish',
      targetType: 'post',
    },
    {
      label: 'blog post delete',
      handler: AdminBlogController.prototype.remove,
      action: 'post.delete',
      targetType: 'post',
    },
    {
      label: 'blog category create',
      handler: AdminBlogController.prototype.createCategory,
      action: 'blogcategory.create',
      targetType: 'blogcategory',
    },
    {
      label: 'blog category update',
      handler: AdminBlogController.prototype.updateCategory,
      action: 'blogcategory.update',
      targetType: 'blogcategory',
    },
    {
      label: 'blog category delete',
      handler: AdminBlogController.prototype.removeCategory,
      action: 'blogcategory.delete',
      targetType: 'blogcategory',
    },
    {
      label: 'blog post cover upload',
      handler: AdminBlogController.prototype.uploadCover,
      action: 'post.cover.upload',
      targetType: 'post',
    },
    {
      label: 'blog post cover remove',
      handler: AdminBlogController.prototype.removeCover,
      action: 'post.cover.remove',
      targetType: 'post',
    },
    {
      label: 'wallet adjust',
      handler: AdminWalletController.prototype.adjust,
      action: 'wallet.adjust',
      targetType: 'wallet',
    },
    {
      label: 'referral reward type update',
      handler: AdminReferralRewardTypesController.prototype.update,
      action: 'referral-reward-type.update',
      targetType: 'referral-reward-type',
      // Route is @Patch(':type'), not @Patch(':id') -- without this override the
      // recorded audit row's targetId would silently be null on every call.
      targetIdParam: 'type',
    },
    {
      label: 'referral cancel',
      handler: AdminReferralsController.prototype.cancel,
      action: 'referral.cancel',
      targetType: 'referral',
    },
    {
      label: 'coupon create',
      handler: AdminCouponsController.prototype.create,
      action: 'coupon.create',
      targetType: 'coupon',
    },
    {
      label: 'coupon update',
      handler: AdminCouponsController.prototype.update,
      action: 'coupon.update',
      targetType: 'coupon',
    },
    {
      label: 'coupon delete',
      handler: AdminCouponsController.prototype.remove,
      action: 'coupon.delete',
      targetType: 'coupon',
    },
    {
      label: 'invoice payment record',
      handler: AdminInvoicesController.prototype.recordPayment,
      action: 'invoice.payment.record',
      targetType: 'invoice',
    },
    {
      label: 'worker rating moderate',
      handler: AdminWorkerRatingsController.prototype.moderate,
      action: 'worker-rating.moderate',
      targetType: 'worker-rating',
    },
    {
      label: 'plan create',
      handler: AdminPlansController.prototype.create,
      action: 'plan.create',
      targetType: 'plan',
    },
    {
      label: 'plan update',
      handler: AdminPlansController.prototype.update,
      action: 'plan.update',
      targetType: 'plan',
    },
    {
      label: 'plan delete',
      handler: AdminPlansController.prototype.remove,
      action: 'plan.delete',
      targetType: 'plan',
    },
    {
      label: 'salon subscription plan set',
      handler: AdminSalonSubscriptionsController.prototype.assign,
      action: 'subscription.plan.set',
      targetType: 'salon-subscription',
      targetIdParam: 'salonId',
    },
    {
      label: 'salon subscription cancel',
      handler: AdminSalonSubscriptionsController.prototype.cancel,
      action: 'subscription.cancel',
      targetType: 'salon-subscription',
      targetIdParam: 'salonId',
    },
    {
      label: 'salon subscription overrides set',
      handler: AdminSalonSubscriptionsController.prototype.setOverrides,
      action: 'subscription.overrides.set',
      targetType: 'salon-subscription',
      targetIdParam: 'salonId',
    },
  ];

  for (const { label, handler, action, targetType, targetIdParam = 'id' } of cases) {
    it(`${label} handler carries @AuditAction('${action}', '${targetType}', '${targetIdParam}')`, () => {
      expect(Reflect.getMetadata(AUDIT_ACTION, handler)).toEqual({ action, targetType, targetIdParam });
    });

    it(`${label} handler runs through AuditInterceptor`, () => {
      expect(Reflect.getMetadata(INTERCEPTORS_METADATA, handler)).toContain(AuditInterceptor);
    });
  }
});
