import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConsoleSmsProvider } from './console-sms.provider';
import { KavenegarSmsProvider } from './kavenegar-sms.provider';
import { SMS_PROVIDER } from './sms.provider';

@Module({
  providers: [
    {
      provide: SMS_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        config.get('SMS_PROVIDER') === 'kavenegar'
          ? new KavenegarSmsProvider(
              config.getOrThrow('KAVENEGAR_API_KEY'),
              config.get('KAVENEGAR_OTP_TEMPLATE', 'gheychi-otp'),
            )
          : new ConsoleSmsProvider(),
    },
  ],
  exports: [SMS_PROVIDER],
})
export class SmsModule {}
