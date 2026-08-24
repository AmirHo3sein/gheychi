import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConsoleSmsProvider } from './console-sms.provider';
import { FaragostareshRelaySmsProvider } from './faragostaresh-relay-sms.provider';
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
        // TEMPORARY stopgap -- see FaragostareshRelaySmsProvider's own doc comment.
        // Switch back to SMS_PROVIDER=payamakyab once the panel authorizes our
        // server's IP for the SendSms method directly; don't forget this exists.
        if (provider === 'faragostaresh-relay') {
          return new FaragostareshRelaySmsProvider();
        }
        return new ConsoleSmsProvider();
      },
    },
  ],
  exports: [SMS_PROVIDER],
})
export class SmsModule {}
