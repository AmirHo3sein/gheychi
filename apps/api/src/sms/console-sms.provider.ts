import { Injectable, Logger } from '@nestjs/common';
import { SmsProvider } from './sms.provider';

/**
 * Dev/test only -- it prints the OTP code instead of sending anything, which is the whole
 * point locally and an account-takeover vector in production (anyone who can read the logs
 * can log in as anyone). `assertProductionSmsProvider` in sms.module.ts is what keeps it
 * from ever being selected there, by fallback OR explicitly; the log line below is
 * deliberately left un-redacted because that guard, not self-censorship here, is the
 * boundary -- a redacted OTP would make local development useless.
 */
@Injectable()
export class ConsoleSmsProvider implements SmsProvider {
  private readonly logger = new Logger('SMS');

  async sendOtp(phone: string, code: string): Promise<void> {
    this.logger.log(`OTP for ${phone}: ${code}`);
  }

  async send(phone: string, message: string): Promise<void> {
    this.logger.log(`SMS to ${phone}: ${message}`);
  }
}
