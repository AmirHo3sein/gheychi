import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminNotificationsModule } from '../admin-notifications/admin-notifications.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { Salon } from '../salons/salon.entity';
import { SalonsModule } from '../salons/salons.module';
import { AdminCategoryRequestsController } from './admin-category-requests.controller';
import { CatalogModule } from './catalog.module';
import { CategoryRequestsController } from './category-requests.controller';
import { CategoryRequestsService } from './category-requests.service';
import { CategoryRequest } from './category-request.entity';

// Deliberately its own module, not folded into CatalogModule: this controller needs
// SalonOwnerGuard (SalonsModule), and SalonsModule already imports CatalogModule as a
// plain one-directional edge ("CatalogModule has no dependency back on SalonsModule",
// see salons.module.ts's own comment) -- importing SalonsModule back into CatalogModule
// would close exactly that cycle. A separate module importing both SalonsModule (for the
// guard) and CatalogModule (for the ServiceCategory repo, exported via TypeOrmModule) is
// two safe one-directional edges instead.
@Module({
  imports: [
    TypeOrmModule.forFeature([CategoryRequest, Salon]),
    CatalogModule,
    SalonsModule,
    AuthModule,
    AuditModule,
    AdminNotificationsModule,
  ],
  controllers: [CategoryRequestsController, AdminCategoryRequestsController],
  providers: [CategoryRequestsService],
})
export class CategoryRequestsModule {}
