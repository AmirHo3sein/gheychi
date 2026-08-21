import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConsoleSmsProvider } from './console-sms.provider';
import { KavenegarSmsProvider } from './kavenegar-sms.provider';
import { PayamakYabSmsProvider } from './payamakyab-sms.provider';
import { SMS_PROVIDER } from './sms.provider';

@Module({
  providers: [
    {
      provide: SMS_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const provider = config.get('SMS_PROVIDER');
        if (provider === 'kavenegar') {
          return new KavenegarSmsProvider(
            config.getOrThrow('KAVENEGAR_API_KEY'),
            config.get('KAVENEGAR_OTP_TEMPLATE', 'gheychi-otp'),
          );
        }
        if (provider === 'payamakyab') {
          return new PayamakYabSmsProvider(
            config.getOrThrow('PAYAMAKYAB_USERNAME'),
            config.getOrThrow('PAYAMAKYAB_PASSWORD'),
            config.getOrThrow('PAYAMAKYAB_SENDER'),
          );
        }
        return new ConsoleSmsProvider();
      },
    },
  ],
  exports: [SMS_PROVIDER],
})
export class SmsModule {}
