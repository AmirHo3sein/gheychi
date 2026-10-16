import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminDashboardController } from './admin-dashboard.controller';
import { AdminDashboardService } from './admin-dashboard.service';

// Read-only aggregates over other modules' tables via raw SQL (DataSource) -- no entity of
// its own, so no TypeOrmModule.forFeature. REDIS comes from the @Global() RedisModule.
@Module({
  imports: [AuthModule],
  controllers: [AdminDashboardController],
  providers: [AdminDashboardService],
})
export class AdminDashboardModule {}
