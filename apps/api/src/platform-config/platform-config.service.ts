import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PlatformConfig } from './platform-config.entity';

@Injectable()
export class PlatformConfigService {
  constructor(
    @InjectRepository(PlatformConfig) private readonly repo: Repository<PlatformConfig>,
  ) {}

  private async getNumber(key: string): Promise<number> {
    const row = await this.repo.findOneBy({ key });
    if (!row) throw new Error(`Missing platform_config key: ${key}`);
    return Number(row.value);
  }

  getDepositPercent(): Promise<number> {
    return this.getNumber('deposit_percent');
  }

  getDepositMinToman(): Promise<number> {
    return this.getNumber('deposit_min_toman');
  }

  getCancellationWindowHours(): Promise<number> {
    return this.getNumber('cancellation_window_hours');
  }

  getCommissionPercent(): Promise<number> {
    return this.getNumber('commission_percent');
  }

  getBookingHoldTtlMinutes(): Promise<number> {
    return this.getNumber('booking_hold_ttl_minutes');
  }

  getReminderLeadHours(): Promise<number> {
    return this.getNumber('reminder_lead_hours');
  }

  listAll(): Promise<PlatformConfig[]> {
    return this.repo.find({ order: { key: 'ASC' } });
  }

  async set(key: string, value: number | string | boolean): Promise<void> {
    await this.repo.upsert({ key, value }, ['key']);
  }
}
