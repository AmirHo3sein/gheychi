import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { SalonsModule } from '../salons/salons.module';
import { SmsModule } from '../sms/sms.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { CrmService } from './crm.service';
import { CustomerNote } from './customer-note.entity';
import { CustomerSmsService } from './customer-sms.service';
import { SalonCustomersController } from './salon-customers.controller';
import { SalonSmsMessage } from './salon-sms-message.entity';

// Needs SalonOwnerGuard, hence SalonsModule -- SalonsModule has no dependency back on
// CrmModule, so this is a plain one-directional import, no cycle (same reasoning as
// CategoryRequestsModule's own need for the same guard). SmsModule/SubscriptionsModule are
// both leaf-ish modules with no dependency back here either -- CustomerSmsService (Phase 6)
// reuses the existing SmsProvider send path and the Phase 2/3 entitlement engine rather than
// inventing either.
@Module({
  imports: [TypeOrmModule.forFeature([CustomerNote, SalonSmsMessage]), AuthModule, SalonsModule, SmsModule, SubscriptionsModule],
  controllers: [SalonCustomersController],
  providers: [CrmService, CustomerSmsService],
})
export class CrmModule {}
