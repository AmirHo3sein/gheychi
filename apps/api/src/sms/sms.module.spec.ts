import { ConfigService } from '@nestjs/config';
import { ConsoleSmsProvider } from './console-sms.provider';
import { KavenegarSmsProvider } from './kavenegar-sms.provider';
import { assertProductionSmsProvider, createSmsProvider } from './sms.module';

describe('assertProductionSmsProvider', () => {
  it('allows the console fallback outside production', () => {
    expect(() => assertProductionSmsProvider(undefined, 'development')).not.toThrow();
    expect(() => assertProductionSmsProvider('console', 'test')).not.toThrow();
    expect(() => assertProductionSmsProvider('kavenegarr', undefined)).not.toThrow();
  });

  it('refuses a missing SMS_PROVIDER in production', () => {
    expect(() => assertProductionSmsProvider(undefined, 'production')).toThrow(/SMS_PROVIDER is not set/);
  });

  it('refuses a typo (unrecognized value) in production rather than silently logging OTPs', () => {
    expect(() => assertProductionSmsProvider('kavenegarr', 'production')).toThrow(/"kavenegarr"/);
  });

  it('refuses an explicitly-selected console provider in production too', () => {
    expect(() => assertProductionSmsProvider('console', 'production')).toThrow(/logs OTP codes/);
  });
});

describe('createSmsProvider', () => {
  const build = (env: Record<string, string | undefined>) =>
    createSmsProvider({
      get: (key: string, fallback?: unknown) => env[key] ?? fallback,
      getOrThrow: (key: string) => {
        if (env[key] === undefined) throw new Error(`missing ${key}`);
        return env[key];
      },
    } as unknown as ConfigService);

  it('falls back to the console provider outside production (dev behaviour unchanged)', () => {
    expect(build({ NODE_ENV: 'development' })).toBeInstanceOf(ConsoleSmsProvider);
    expect(build({ NODE_ENV: 'test', SMS_PROVIDER: 'console' })).toBeInstanceOf(ConsoleSmsProvider);
    expect(build({ NODE_ENV: 'development', SMS_PROVIDER: 'typo' })).toBeInstanceOf(ConsoleSmsProvider);
  });

  it('still builds a real provider in production when SMS_PROVIDER names one', () => {
    const provider = build({ NODE_ENV: 'production', SMS_PROVIDER: 'kavenegar', KAVENEGAR_API_KEY: 'k' });
    expect(provider).toBeInstanceOf(KavenegarSmsProvider);
  });

  it('fails to boot in production when SMS_PROVIDER is missing', () => {
    expect(() => build({ NODE_ENV: 'production' })).toThrow(/SMS_PROVIDER is not set/);
  });

  it('fails to boot in production when SMS_PROVIDER is unrecognized', () => {
    expect(() => build({ NODE_ENV: 'production', SMS_PROVIDER: 'payamak-yab' })).toThrow(/"payamak-yab"/);
  });

  it('fails to boot in production even when console is selected on purpose', () => {
    expect(() => build({ NODE_ENV: 'production', SMS_PROVIDER: 'console' })).toThrow(/logs OTP codes/);
  });
});
