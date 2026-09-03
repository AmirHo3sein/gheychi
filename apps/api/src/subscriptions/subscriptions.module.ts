import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { AdminPlansController } from './admin-plans.controller';
import { AdminSalonSubscriptionsController } from './admin-salon-subscriptions.controller';
import { EntitlementsService } from './entitlements.service';
import { Plan } from './plan.entity';
import { PlansService } from './plans.service';
import { SalonSubscription } from './salon-subscription.entity';
import { SubscriptionsService } from './subscriptions.service';

// No dependency on SalonsModule -- salon existence is enforced by the DB's own FK on
// salon_subscriptions.salon_id (see the migration), not a Salon repository lookup here.
// This is what lets SalonsModule import this module (for createDefaultSubscription) without
// a cycle.
@Module({
  imports: [TypeOrmModule.forFeature([Plan, SalonSubscription]), AuthModule, AuditModule],
  controllers: [AdminPlansController, AdminSalonSubscriptionsController],
  providers: [PlansService, SubscriptionsService, EntitlementsService],
  exports: [SubscriptionsService, EntitlementsService, TypeOrmModule],
})
export class SubscriptionsModule {}
