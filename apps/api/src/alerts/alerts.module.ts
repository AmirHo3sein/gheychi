import { Module } from '@nestjs/common';
import { AdminNotificationsModule } from '../admin-notifications/admin-notifications.module';
import { SmsModule } from '../sms/sms.module';
import { AlertsService } from './alerts.service';

// RedisModule is @Global(), so the REDIS token needs no import here.
@Module({
  imports: [AdminNotificationsModule, SmsModule],
  providers: [AlertsService],
  exports: [AlertsService],
})
export class AlertsModule {}
