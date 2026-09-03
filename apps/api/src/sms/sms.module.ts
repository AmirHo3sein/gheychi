import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConsoleSmsProvider } from './console-sms.provider';
import { FaragostareshRelaySmsProvider } from './faragostaresh-relay-sms.provider';
import { KavenegarSmsProvider } from './kavenegar-sms.provider';
import { PayamakYabSmsProvider } from './payamakyab-sms.provider';
import { SMS_PROVIDER, SmsProvider } from './sms.provider';

/**
 * Refuses to fall back to (or explicitly select) ConsoleSmsProvider in production.
 *
 * ConsoleSmsProvider logs the OTP code itself, so the failure mode this prevents is not
 * merely "SMS is broken": a misspelled `SMS_PROVIDER=kavenegarr` in production used to be
 * completely silent -- every login OTP printed to stdout, no real message ever sent, and
 * the app otherwise behaving normally. Anyone who can read logs could then log in as
 * anyone. Deliberately production-only: dev and test rely on exactly this fallback and
 * their behaviour is unchanged. Same fail-fast posture as assertProductionJwtSecret.
 */
export function assertProductionSmsProvider(provider: unknown, nodeEnv: string | undefined): void {
  if (nodeEnv !== 'production') return;
  throw new Error(
    provider
      ? `SMS_PROVIDER=${JSON.stringify(provider)} is not a real SMS provider -- refusing to start in production with the console provider, which logs OTP codes and sends nothing`
      : 'SMS_PROVIDER is not set -- refusing to start in production with the console provider, which logs OTP codes and sends nothing',
  );
}

// Named and exported rather than inlined in `useFactory` purely so the selection rules
// (including the production guard) are directly unit-testable without standing up a real
// ConfigModule, whose ConfigService.get() reads the live process.env NODE_ENV.
export function createSmsProvider(config: ConfigService): SmsProvider {
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
    return new FaragostareshRelaySmsProvider(config.getOrThrow('FARAGOSTARESH_RELAY_TOKEN'));
  }
  // Falling through to the console provider is correct in dev/test and dangerous in
  // production: ConsoleSmsProvider prints every OTP to stdout and never sends anything, so
  // a typo'd or absent SMS_PROVIDER would leave login *looking* like it works while leaking
  // every login code into the logs and delivering no real SMS. Refuse to boot instead --
  // same fail-fast posture as PAYMENT_GATEWAY=zarinpal's missing-credential handling and
  // assertProductionJwtSecret. An explicit SMS_PROVIDER=console in production is refused
  // for the same reason: naming it deliberately doesn't make logging OTPs to stdout safe.
  assertProductionSmsProvider(provider, config.get('NODE_ENV'));
  return new ConsoleSmsProvider();
}

@Module({
  providers: [
    {
      provide: SMS_PROVIDER,
      inject: [ConfigService],
      useFactory: createSmsProvider,
    },
  ],
  exports: [SMS_PROVIDER],
})
export class SmsModule {}
