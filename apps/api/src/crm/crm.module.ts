import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { SalonsModule } from '../salons/salons.module';
import { CrmService } from './crm.service';
import { CustomerNote } from './customer-note.entity';
import { SalonCustomersController } from './salon-customers.controller';

// Needs SalonOwnerGuard, hence SalonsModule -- SalonsModule has no dependency back on
// CrmModule, so this is a plain one-directional import, no cycle (same reasoning as
// CategoryRequestsModule's own need for the same guard).
@Module({
  imports: [TypeOrmModule.forFeature([CustomerNote]), AuthModule, SalonsModule],
  controllers: [SalonCustomersController],
  providers: [CrmService],
})
export class CrmModule {}
