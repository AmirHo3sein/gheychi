import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { And, LessThan, MoreThanOrEqual, Repository } from 'typeorm';
import { jalaliMonthBounds, jalaliMonthOf } from '../invoicing/jalali-period.util';
import { SalonsService } from '../salons/salons.service';
import { SMS_PROVIDER, SmsProvider } from '../sms/sms.provider';
import { EntitlementsService } from '../subscriptions/entitlements.service';
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
    private readonly entitlements: EntitlementsService,
    private readonly salons: SalonsService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    @InjectRepository(SalonSmsMessage) private readonly messages: Repository<SalonSmsMessage>,
  ) {}

  // Resolution (including the "absent means 0, never unlimited" rule) lives in the
  // entitlement registry now, not here -- this was the only feature that enforced an
  // entitlement, and its inline coercion was the shape every later feature would have
  // copy-pasted. See subscriptions/entitlement-keys.ts.
  private resolveQuota(salonId: string): Promise<number> {
    return this.entitlements.getQuota(salonId, 'smsMonthlyQuota');
  }

  private async countUsedThisMonth(salonId: string): Promise<number> {
    // Half-open [periodStart, periodEnd) -- periodEnd IS the next month's first instant
    // (see jalaliMonthBounds), so an inclusive Between would count a message sent at
    // exactly that instant in both months; same range shape every invoicing query uses.
    const { periodStart, periodEnd } = jalaliMonthBounds(jalaliMonthOf(new Date()));
    return this.messages.count({
      where: { salonId, createdAt: And(MoreThanOrEqual(periodStart), LessThan(periodEnd)) },
    });
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
    const salon = await this.salons.findById(salonId);
    if (!salon) throw new NotFoundException('Salon not found');
    // Approved salons only -- the same standing approve() requires before a salon can take
    // on committed work. A suspended/rejected salon keeping a free-text SMS channel to every
    // past customer (on the platform's own sender number) is exactly what suspension exists
    // to stop; the CRM read side stays available so nothing about their own records is lost.
    if (salon.status !== 'approved') {
      throw new ConflictException('تا زمانی که وضعیت سالن تایید‌شده نباشد، امکان ارسال پیامک وجود ندارد');
    }

    const customer = await this.crm.getCustomerContact(salonId, customerId);
    const quota = await this.resolveQuota(salonId);
    const used = await this.countUsedThisMonth(salonId);
    if (used >= quota) {
      throw new ConflictException('سقف ارسال پیامک این ماه برای این سالن تمام شده است');
    }

    // Always attributed to the salon, server-side, on the wire: the text is free-form and
    // goes out on the platform's own sender number, so an unprefixed message could pass
    // itself off as the platform ("your booking was cancelled, pay here"). The logged
    // `message` stays the owner's own text -- the prefix is delivery framing, not content.
    await this.sms.send(customer.phone, `${salon.name}: ${message}`);

    await this.messages.save(this.messages.create({ salonId, customerId, phone: customer.phone, message, sentBy: actorId }));

    return { quota, used: used + 1, remaining: Math.max(0, quota - used - 1) };
  }
}
