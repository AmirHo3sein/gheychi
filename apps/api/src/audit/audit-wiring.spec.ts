import 'reflect-metadata';
import { AdminCategoriesController } from '../catalog/admin-categories.controller';
import { AdminBlogController } from '../content/admin-blog.controller';
import { AdminConfigController } from '../platform-config/admin-config.controller';
import { AdminReportsController } from '../reports/admin-reports.controller';
import { AdminReviewsController } from '../reviews/admin-reviews.controller';
import { AdminSalonsController } from '../salons/admin-salons.controller';
import { AdminUsersController } from '../users/admin-users.controller';
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
      label: 'config update',
      handler: AdminConfigController.prototype.update,
      action: 'config.update',
      targetType: 'config',
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
  ];

  for (const { label, handler, action, targetType } of cases) {
    it(`${label} handler carries @AuditAction('${action}', '${targetType}')`, () => {
      expect(Reflect.getMetadata(AUDIT_ACTION, handler)).toEqual({ action, targetType });
    });

    it(`${label} handler runs through AuditInterceptor`, () => {
      expect(Reflect.getMetadata(INTERCEPTORS_METADATA, handler)).toContain(AuditInterceptor);
    });
  }
});
