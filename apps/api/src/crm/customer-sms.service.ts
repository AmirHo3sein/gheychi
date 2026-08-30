import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { jalaliMonthBounds, jalaliMonthOf } from '../invoicing/jalali-period.util';
import { SMS_PROVIDER, SmsProvider } from '../sms/sms.provider';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { CrmService } from './crm.service';
import { SalonSmsMessage } from './salon-sms-message.entity';

export interface SmsQuotaStatus {
  quota: number;
  used: number;
  remaining: number;
}

/**
 * Salon-initiated customer SMS, quota-gated by the Phase 2/3 entitlement engine
 * (entitlements.smsMonthlyQuota). Phase 6 of the monetization initiative -- see
 * docs/technical-overview/33-salon-sms-quota.md.
 *
 * Reuses the existing SmsProvider send path (the same interface notifyConfirmed/notifyOne
 * already use elsewhere), but deliberately does NOT swallow a send failure the way those
 * best-effort notification call sites do -- this send IS the primary action the owner asked
 * for, not a side effect of something else, so a real failure must surface to them as a real
 * error rather than silently pretending it worked.
 */
@Injectable()
export class CustomerSmsService {
  constructor(
    private readonly crm: CrmService,
    private readonly subscriptions: SubscriptionsService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    @InjectRepository(SalonSmsMessage) private readonly messages: Repository<SalonSmsMessage>,
  ) {}

  // A missing/non-numeric entitlement resolves to 0 (blocked), not unlimited -- a
  // plan an admin hasn't configured yet must never grant free-form SMS for nothing,
  // matching this codebase's "off/zero until an admin explicitly opts in" posture
  // (the global payment toggle's own seeded-off default).
  private async resolveQuota(salonId: string): Promise<number> {
    const entitlements = await this.subscriptions.getEntitlements(salonId);
    const raw = entitlements.smsMonthlyQuota;
    return typeof raw === 'number' && raw >= 0 ? raw : 0;
  }

  private async countUsedThisMonth(salonId: string): Promise<number> {
    const { periodStart, periodEnd } = jalaliMonthBounds(jalaliMonthOf(new Date()));
    return this.messages.count({ where: { salonId, createdAt: Between(periodStart, periodEnd) } });
  }

  async getQuotaStatus(salonId: string): Promise<SmsQuotaStatus> {
    const [quota, used] = await Promise.all([this.resolveQuota(salonId), this.countUsedThisMonth(salonId)]);
    return { quota, used, remaining: Math.max(0, quota - used) };
  }

  /**
   * Checks quota, sends, then logs the send -- in that order, so a failed send never
   * consumes quota. The check-then-send-then-insert sequence has an accepted, documented
   * race window (two concurrent sends near the quota boundary could both pass the check):
   * a deliberate MVP simplification, not an oversight -- unlike the referral system's
   * per-referrer cap (real money per redemption), overrunning an SMS quota by one or two
   * messages during a human owner's own manual, low-frequency action costs the platform a
   * fraction of a cent and nothing more. Revisit only if usage patterns ever show otherwise.
   */
  async send(salonId: string, customerId: string, actorId: string, message: string): Promise<SmsQuotaStatus> {
    const customer = await this.crm.getCustomerContact(salonId, customerId);
    const quota = await this.resolveQuota(salonId);
    const used = await this.countUsedThisMonth(salonId);
    if (used >= quota) {
      throw new ConflictException('سقف ارسال پیامک این ماه برای این سالن تمام شده است');
    }

    await this.sms.send(customer.phone, message);

    await this.messages.save(this.messages.create({ salonId, customerId, phone: customer.phone, message, sentBy: actorId }));

    return { quota, used: used + 1, remaining: Math.max(0, quota - used - 1) };
  }
}
