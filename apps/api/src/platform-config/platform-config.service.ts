import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { PlatformConfig } from './platform-config.entity';

@Injectable()
export class PlatformConfigService {
  constructor(
    @InjectRepository(PlatformConfig) private readonly repo: Repository<PlatformConfig>,
    private readonly dataSource: DataSource,
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

  getReviewEditWindowHours(): Promise<number> {
    return this.getNumber('review_edit_window_hours');
  }

  listAll(): Promise<PlatformConfig[]> {
    return this.repo.find({ order: { key: 'ASC' } });
  }

  async set(key: string, value: number | string | boolean): Promise<void> {
    await this.repo.upsert({ key, value }, ['key']);
  }

  /**
   * Bulk-updates existing config rows atomically. Every key in the batch must
   * already exist -- a typo'd key throws NotFoundException instead of silently
   * creating a permanent, unreachable row, and validation happens before any
   * write so a bad key never leaves earlier entries partially committed.
   */
  async setMany(entries: { key: string; value: number | string | boolean }[]): Promise<void> {
    const keys = entries.map((entry) => entry.key);
    const existingRows = await this.repo.find({ where: { key: In(keys) }, select: ['key'] });
    const existingKeys = new Set(existingRows.map((row) => row.key));
    const missingKeys = keys.filter((key) => !existingKeys.has(key));
    if (missingKeys.length) {
      throw new NotFoundException(`Unknown platform_config key(s): ${missingKeys.join(', ')}`);
    }

    await this.dataSource.transaction(async (em) => {
      for (const entry of entries) {
        await em.update(PlatformConfig, { key: entry.key }, { value: entry.value });
      }
    });
  }
}
