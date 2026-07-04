import { Injectable } from '@nestjs/common';
import { SmsProvider } from './sms.provider';

interface KavenegarResponse {
  return?: {
    status: number;
    message?: string;
  };
}

@Injectable()
export class KavenegarSmsProvider implements SmsProvider {
  constructor(
    private readonly apiKey: string,
    private readonly otpTemplate: string,
  ) {}

  async sendOtp(phone: string, code: string): Promise<void> {
    const params = new URLSearchParams({
      receptor: phone,
      token: code,
      template: this.otpTemplate,
    });
    // URL embeds the OTP code and phone number as query params (matches Kavenegar's
    // documented API) — must never be logged verbatim by request-logging middleware.
    const url = `https://api.kavenegar.com/v1/${this.apiKey}/verify/lookup.json?${params}`;
    let res: Response;
    try {
      res = await fetch(url);
    } catch (err) {
      throw new Error(`Kavenegar send failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    const body = (await res.json()) as KavenegarResponse;
    if (!res.ok || body?.return?.status !== 200) {
      throw new Error(`Kavenegar send failed: ${body?.return?.message ?? res.status}`);
    }
  }
}
