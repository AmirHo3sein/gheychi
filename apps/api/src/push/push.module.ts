import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { ConsolePushProvider } from './console-push.provider';
import { PushSubscription } from './push-subscription.entity';
import { PUSH_PROVIDER } from './push.provider';
import { PushController } from './push.controller';
import { PushService } from './push.service';
import { WebPushProvider } from './web-push.provider';

@Module({
  imports: [TypeOrmModule.forFeature([PushSubscription]), AuthModule],
  controllers: [PushController],
  providers: [
    PushService,
    {
      provide: PUSH_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        config.get('PUSH_PROVIDER') === 'webpush'
          ? new WebPushProvider(
              config.getOrThrow('VAPID_PUBLIC_KEY'),
              config.getOrThrow('VAPID_PRIVATE_KEY'),
              config.getOrThrow('VAPID_SUBJECT'),
            )
          : new ConsolePushProvider(),
    },
  ],
  exports: [PushService],
})
export class PushModule {}
