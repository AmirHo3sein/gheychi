import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { And, LessThan, MoreThanOrEqual, Repository } from 'typeorm';
import { SalonSmsMessage } from '../crm/salon-sms-message.entity';
import { jalaliMonthBounds, jalaliMonthOf } from '../invoicing/jalali-period.util';
import { EntitlementsService } from '../subscriptions/entitlements.service';

export interface SmsQuotaStatus {
  quota: number;
  used: number;
  remaining: number;
}

/**
 * The single meter for every SMS a SALON causes the platform to send.
 *
 * It exists because the quota was previously enforced in exactly one place -- the CRM's
 * free-text customer message -- while two other salon-triggerable paths sent SMS with no
 * accounting at all: adding a worker (an arbitrary phone gets a salon-worded invite) and
 * creating a manual booking (a confirmation to any phone). An approved salon could loop
 * either endpoint for unlimited platform-paid SMS, so "per-salon SMS spend is bounded" was
 * simply not true. One meter, one log, one entitlement key.
 *
 * Usage is DERIVED (a COUNT over the append-only `salon_sms_messages` log within the
 * current Jalali month), never a stored counter: a counter can drift from the messages
 * actually sent, and a derived count cannot. The month boundary is half-open
 * `[periodStart, periodEnd)` -- `periodEnd` IS the next month's first instant -- matching
 * every invoicing query against the same helper.
 *
 * One real entry point today -- `tryConsume`, for an SMS that is a side effect of some
 * other successful action (a worker was added; a walk-in was booked). Those must NOT fail
 * the real operation just because the SMS budget is gone -- the roster row and the booking
 * still stand, the message is simply skipped and logged. It records the send AFTER it
 * succeeds, so a failed send never consumes quota.
 *
 * The CRM free-text message (an action the owner explicitly asked for, where being over
 * quota is a real answer they must see rather than a silent skip) does NOT go through this
 * service -- `CustomerSmsService` carries its own separate, duplicated resolve+count+check
 * logic against the same `smsMonthlyQuota` entitlement and the same `salon_sms_messages`
 * table (see its own doc comment). The meter stays accurate either way since both write to
 * the same log; this is a maintenance hazard (a future change to one path can silently
 * diverge from the other), not a metering gap. Unifying the two is a real, still-open
 * follow-up, not something this comment should pretend already happened.
 */
@Injectable()
export class SalonSmsQuotaService {
  private readonly logger = new Logger('SalonSmsQuotaService');

  constructor(
    @InjectRepository(SalonSmsMessage) private readonly messages: Repository<SalonSmsMessage>,
    private readonly entitlements: EntitlementsService,
  ) {}

  async countUsedThisMonth(salonId: string): Promise<number> {
    const { periodStart, periodEnd } = jalaliMonthBounds(jalaliMonthOf(new Date()));
    return this.messages.count({
      where: { salonId, createdAt: And(MoreThanOrEqual(periodStart), LessThan(periodEnd)) },
    });
  }

  async getStatus(salonId: string): Promise<SmsQuotaStatus> {
    const [quota, used] = await Promise.all([
      this.entitlements.getQuota(salonId, 'smsMonthlyQuota'),
      this.countUsedThisMonth(salonId),
    ]);
    return { quota, used, remaining: Math.max(0, quota - used) };
  }

  /** True when at least one more message fits in this month's quota. */
  async hasRemaining(salonId: string): Promise<boolean> {
    const { remaining } = await this.getStatus(salonId);
    return remaining > 0;
  }

  /**
   * Records one sent message against the salon's quota. Call only AFTER the send resolved.
   *
   * `customerId` is the RECIPIENT's user id -- the column's FK is to `users(id)`, not to any
   * customer-of-this-salon relation, so a freshly-invited worker (who `findOrCreateByPhone`
   * has just given a real user row) records perfectly well against it. The column name
   * predates these call sites; widening it would mean a rename migration for no behavioural
   * gain.
   */
  async record(params: {
    salonId: string;
    customerId: string;
    phone: string;
    message: string;
    sentBy: string;
  }): Promise<void> {
    await this.messages.save(this.messages.create(params));
  }

  /**
   * For a best-effort, side-effect SMS: returns false (and logs) instead of throwing when
   * the salon is out of quota, so the caller can skip the message without failing the
   * operation that triggered it.
   */
  async tryConsume(
    salonId: string,
    send: () => Promise<void>,
    params: { customerId: string; phone: string; message: string; sentBy: string },
  ): Promise<boolean> {
    if (!(await this.hasRemaining(salonId))) {
      this.logger.warn(`Skipped a salon-triggered SMS for salon ${salonId}: monthly quota exhausted`);
      return false;
    }
    await send();
    await this.record({ salonId, ...params });
    return true;
  }
}
