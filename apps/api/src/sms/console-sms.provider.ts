import { Injectable, Logger } from '@nestjs/common';
import { SmsProvider } from './sms.provider';

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
