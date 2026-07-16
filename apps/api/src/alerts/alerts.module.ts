import { Module } from '@nestjs/common';
import { SmsModule } from '../sms/sms.module';
import { AlertsService } from './alerts.service';

// Not global: only BookingModule consumes it today. REDIS comes from the
// @Global() RedisModule, ConfigService from the global ConfigModule.
@Module({
  imports: [SmsModule],
  providers: [AlertsService],
  exports: [AlertsService],
})
export class AlertsModule {}
