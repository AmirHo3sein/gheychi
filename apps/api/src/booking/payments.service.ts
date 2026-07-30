import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AlertsService } from '../alerts/alerts.service';
import { PushService } from '../push/push.service';
import { ReferralsService } from '../referrals/referrals.service';
import { SMS_PROVIDER, SmsProvider } from '../sms/sms.provider';
import { SalonsService } from '../salons/salons.service';
import { User } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import { Booking } from './booking.entity';
import { releaseCouponRedemption } from './coupon-release.util';
import { PAYMENT_GATEWAY, PaymentGateway, PaymentRefundResult } from './payment-gateway';
import { Payment } from './payment.entity';

export type CallbackOutcome = 'success' | 'failed' | 'already-confirmed' | 'unknown-authority';

// What handleCallback's capture transaction actually did. 'dead-booking' means the
// booking is no longer in pending_payment, so the capture must be refunded rather
// than confirmed -- never resurrected into a slot that was already released.
type CaptureOutcome = 'captured' | 'duplicate' | 'dead-booking';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @InjectRepository(Payment) private readonly payments: Repository<Payment>,
    @InjectRepository(Booking) private readonly bookings: Repository<Booking>,
    private readonly dataSource: DataSource,
    private readonly salonsService: SalonsService,
    private readonly usersService: UsersService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    private readonly push: PushService,
    private readonly alerts: AlertsService,
    private readonly referralsService: ReferralsService,
  ) {}

  async handleCallback(authority: string, status: string): Promise<{ status: CallbackOutcome; bookingId: string | null }> {
    const payment = await this.resolveByAuthority(authority);
    if (!payment) {
      await this.reportUnknownAuthority(authority, status);
      return { status: 'unknown-authority', bookingId: null };
    }

    if (payment.status === 'paid') {
      return { status: 'already-confirmed', bookingId: payment.bookingId };
    }
    // The capture is already on record and a refund is owed or already issued -- the
    // booking is not coming back, and re-verifying would only risk re-queueing work.
    if (payment.status === 'refund_pending' || payment.status === 'refunded') {
      return { status: 'failed', bookingId: payment.bookingId };
    }

    // 'initiated' or 'failed' from here on. A 'failed' payment is NOT a dead end this
    // callback can drop: cancel()'s pending_payment branch and reconciliation's
    // verify-failed branch both mark a payment 'failed' without asking Zarinpal
    // anything, so a customer who completes the payment afterwards genuinely has money
    // captured against it -- and no background job ever revisits a 'failed' payment
    // (reconciliation scans 'initiated', RefundRetryJob scans 'refund_pending').
    // Returning early here without verifying was silent money loss: captured deposit,
    // cancelled booking, no refund queued, no alert, no record. So a success-shaped
    // callback is verified either way, and a real capture takes the same late-capture
    // recovery as every other captured-money-on-a-dead-booking case.
    const wasAlreadyFailed = payment.status === 'failed';

    if (status !== 'OK') {
      if (!wasAlreadyFailed) await this.markFailed(payment.id, payment.bookingId);
      return { status: 'failed', bookingId: payment.bookingId };
    }

    let verify: { success: boolean; refId: string | null };
    try {
      verify = await this.gateway.verifyPayment(authority, payment.amount);
    } catch (err) {
      // Left at 'initiated' on gateway failure (network error, Zarinpal outage) --
      // a later payment-reconciliation job re-verifies any 'initiated' payment
      // past a cutoff and will correctly transition it once Zarinpal is
      // reachable again (its own code 101 "already verified" makes a repeat
      // verify call safe), so this is self-healing, not a stuck state. Logged
      // so an unusually persistent outage is still visible to operators.
      this.logger.error(
        `Zarinpal verify threw for authority ${authority}, payment ${payment.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw err;
    }
    if (!verify.success) {
      if (!wasAlreadyFailed) await this.markFailed(payment.id, payment.bookingId);
      return { status: 'failed', bookingId: payment.bookingId };
    }

    if (wasAlreadyFailed) {
      // Money captured against a payment that something already declared failed. By
      // definition its booking has left pending_payment, so it must not be resurrected
      // -- queue the refund instead.
      const recovery = await this.recoverCapturedOnDeadBooking(payment, authority, verify.refId);
      return { status: recovery === 'already-paid' ? 'success' : 'failed', bookingId: payment.bookingId };
    }

    // Zarinpal's callback is a browser redirect, not a server-issued webhook --
    // a back-button + refresh, a double-tap on "return to merchant", or an
    // in-app browser retry can genuinely deliver the same authority twice, with
    // a live network round-trip to verifyPayment above in between the two
    // calls' reads of payment.status. The conditional WHEREs below mean only the
    // call that actually performs the transition gets affected=1 and proceeds to
    // notify; a losing concurrent call sees affected=0 and skips notifyConfirmed,
    // since the winner already sent it -- this prevents a duplicate "booking
    // confirmed" SMS without needing a distributed lock, just Postgres's own
    // row-level atomicity.
    const outcome = await this.dataSource
      .transaction<CaptureOutcome>(async (em) => {
        // The booking write comes FIRST and is conditional on the booking still being
        // live. It used to be an unconditional `update(Booking, { id })` -- the only
        // status write in this module with no status predicate -- so a callback arriving
        // after BookingExpiryJob released the hold still won: the job flips the booking
        // to 'expired' but leaves the payment 'initiated', so the payment CAS succeeded
        // 16+ minutes later and re-confirmed a slot that had been released and possibly
        // already rebooked, silently exceeding salon.capacity. PaymentReconciliationJob
        // has always refused to resurrect a dead booking (README documents that as
        // deliberate); identical money now gets identical treatment whether or not the
        // browser redirect happened to arrive.
        const confirmed = await em.update(
          Booking,
          { id: payment.bookingId, status: 'pending_payment' },
          { status: 'confirmed' },
        );
        if (!confirmed.affected) return 'dead-booking';
        const paid = await em.update(
          Payment,
          { id: payment.id, status: 'initiated' },
          // `authority` is re-pointed at the session that actually captured: with
          // retryPayment the paying session can be a superseded one, and refunds are
          // issued against payments.authority, so it has to name the real transaction.
          { status: 'paid', refId: verify.refId, paidAt: new Date(), authority },
        );
        // Booking and payment are written together in one transaction by every other
        // writer (cancel(), reconciliation), so a won booking CAS with a lost payment
        // CAS shouldn't be reachable; if it ever is, some other writer already recorded
        // the capture and notified -- don't notify a second time.
        return paid.affected ? 'captured' : 'duplicate';
      })
      .catch((err) => {
        // Zarinpal has already confirmed the charge at this point (verify.success
        // was true) -- if persisting that here fails, the payment is left at
        // 'initiated' even though Zarinpal genuinely captured the money. Same
        // self-healing story as the gateway-throw case above: the reconciliation
        // job re-verifies 'initiated' payments and will call verifyPayment
        // again, which resolves this -- but log it, since a stuck payment here
        // means a customer paid and doesn't yet see a confirmed booking.
        this.logger.error(
          `Failed to persist paid/confirmed state for authority ${authority}, payment ${payment.id}, booking ${payment.bookingId}: ${err instanceof Error ? err.message : String(err)}`,
        );
        void this.alerts.raise({
          key: `verify-persist:${payment.id}`,
          severity: 'warning',
          title: 'ثبت پرداخت ناموفق',
          body: `پرداخت ${payment.id} توسط زرین‌پال تایید شد اما ثبت آن در پایگاه داده ناموفق بود؛ تطبیق خودکار آن را اصلاح می‌کند.`,
        });
        throw err;
      });

    if (outcome === 'captured') {
      await this.notifyConfirmed(payment.bookingId);
      return { status: 'success', bookingId: payment.bookingId };
    }
    if (outcome === 'duplicate') {
      // A duplicate callback delivery: the winning call already recorded 'paid' and
      // sent the notification, so reporting success is correct and notifying is not.
      return { status: 'success', bookingId: payment.bookingId };
    }

    const recovery = await this.recoverCapturedOnDeadBooking(payment, authority, verify.refId);
    return { status: recovery === 'already-paid' ? 'success' : 'failed', bookingId: payment.bookingId };
  }

  /**
   * Zarinpal captured the money but the booking is no longer live -- it expired, or was
   * cancelled while this callback was inside verifyPayment (cancel() commits
   * booking->cancelled + payment->failed as one transaction), so its slot is released
   * and may already be rebooked. The deposit has to go back: queue a real refund, which
   * the RefundRetryJob then performs. Shared by both of handleCallback's
   * captured-money-on-a-dead-booking paths -- a payment something already marked
   * 'failed', and a booking that lost the pending_payment CAS -- because getting either
   * one wrong strands captured money on a payment no background job ever revisits.
   *
   * The conditional UPDATE (on the status just read) is what makes this safe against a
   * concurrent cancel/reconciliation/duplicate callback: only one writer queues the
   * refund and only that writer alerts, and a payment that reached 'paid' meanwhile --
   * i.e. a concurrent callback genuinely confirmed the booking -- is left untouched.
   */
  private async recoverCapturedOnDeadBooking(
    payment: Payment,
    authority: string,
    refId: string | null,
  ): Promise<'refund-queued' | 'already-paid' | 'already-handled'> {
    const current = await this.payments.findOneBy({ id: payment.id });
    if (!current) return 'already-handled';
    if (current.status === 'paid') return 'already-paid';
    // refund_pending/refunded: another writer already queued or completed the refund.
    if (current.status !== 'initiated' && current.status !== 'failed') return 'already-handled';

    const queued = await this.payments.update(
      { id: payment.id, status: current.status },
      // authority: the session that actually captured, which is what must be refunded.
      { status: 'refund_pending', refId, refundRequestedAt: new Date(), authority },
    );
    if (!queued.affected) return 'already-handled';

    this.logger.error(
      `Payment ${payment.id} (authority ${authority}) was captured by Zarinpal after booking ${payment.bookingId} left pending_payment -- queueing automatic refund`,
    );
    await this.alerts.raise({
      key: `late-capture:${payment.id}`,
      severity: 'warning',
      title: 'پرداخت پس از پایان انتظار رزرو',
      body: `مبلغ پرداخت ${payment.id} پس از خروج رزرو ${payment.bookingId} از حالت انتظار دریافت شد؛ بازگشت وجه به‌صورت خودکار در صف قرار گرفت.`,
    });
    return 'refund-queued';
  }

  /**
   * The callback's authority is normally payments.authority -- but retryPayment mints a
   * fresh session and overwrites that column while the customer's earlier Zarinpal tab
   * stays chargeable, so an authority that is no longer the current one can still be
   * the one the money went through. payment_authorities records every authority ever
   * issued for the payment (see the 1753700000000 migration); the fallback lookup is
   * what stops a real, captured payment from 404ing with the money recorded nowhere.
   */
  private async resolveByAuthority(authority: string): Promise<Payment | null> {
    // Guarded: /api/payments/callback is public, so a request with no Authority at all
    // must resolve to "unknown", not build a query on an undefined value.
    if (!authority) return null;
    const current = await this.payments.findOneBy({ authority });
    if (current) return current;
    const rows = await this.payments.manager.query<Array<{ payment_id: string }>>(
      `SELECT payment_id FROM payment_authorities WHERE authority = $1`,
      [authority],
    );
    if (rows.length === 0) return null;
    return this.payments.findOneBy({ id: rows[0].payment_id });
  }

  /**
   * A callback whose authority matches no payment at all -- not even as a superseded
   * session. When the gateway claims success this is money-critical: a capture this
   * platform cannot attribute to any booking, which only a human can reconcile (the one
   * known non-malicious cause is createPaymentSession failing to persist a minted
   * authority, which alerts on its own too). The customer never sees a raw 404 for it;
   * PaymentsController redirects them to the normal failure page.
   *
   * The dedup key is deliberately COARSE -- one alert per window, with the authority in
   * the body and in the log -- rather than per-authority: this endpoint is public and
   * unauthenticated, so a per-authority key would let anyone mint unlimited distinct
   * alert identities and flood the admin notification queue. Every occurrence is
   * logged, so the log, not the alert, is the complete record.
   */
  private async reportUnknownAuthority(authority: string, status: string): Promise<void> {
    this.logger.error(
      `Payment callback for unknown authority ${JSON.stringify(authority)} (Status=${status}) -- no payment matches it, not even as a superseded session`,
    );
    if (!authority || status !== 'OK') return; // a failed/garbage callback carries no money
    await this.alerts.raise({
      key: 'unknown-authority',
      severity: 'critical',
      title: 'بازگشت پرداخت با شناسه ناشناس',
      body: `یک بازگشت پرداخت موفق با شناسه ناشناس دریافت شد (${authority.slice(0, 64)}) که به هیچ پرداختی متصل نیست؛ ممکن است مبلغی دریافت شده باشد. لاگ‌ها را بررسی کنید.`,
    });
  }

  /**
   * The single consumer for refund_pending payments -- called inline by
   * BookingsService.cancel() right after its transaction commits, and by
   * RefundRetryJob for anything that slipped through. Gateway failures are
   * caught internally (the payment just stays refund_pending for the retry
   * job's next tick), but an unexpected error -- e.g. a transient DB failure in
   * the reads/update below -- CAN still propagate, so callers for whom a throw
   * must not surface (cancel(), the retry job's batch loop) wrap this call.
   * Idempotent at both layers -- the conditional UPDATE means only one
   * concurrent attempt records the refund (and sends the one notification),
   * and the gateway treats a repeat refund of the same authority as success.
   */
  async attemptRefund(bookingId: string): Promise<'refunded' | 'pending' | 'skipped'> {
    const payment = await this.payments.findOneBy({ bookingId });
    if (!payment || payment.status !== 'refund_pending') return 'skipped';
    if (!payment.authority) {
      // Shouldn't occur -- a captured payment always has an authority -- but if it
      // does, an automatic refund is impossible and an operator has to step in.
      this.logger.error(`Payment ${payment.id} is refund_pending but has no authority -- needs manual refund`);
      await this.alerts.raise({
        key: `refund-no-authority:${payment.id}`,
        severity: 'critical',
        title: 'بازپرداخت بدون شناسه پرداخت',
        body: `پرداخت ${payment.id} در انتظار بازگشت وجه است اما شناسه (authority) ندارد؛ بازپرداخت خودکار ممکن نیست.`,
      });
      return 'pending';
    }

    let result: PaymentRefundResult;
    try {
      result = await this.gateway.refundPayment(payment.authority);
    } catch (err) {
      this.logger.error(
        `Zarinpal refund threw for payment ${payment.id} (authority ${payment.authority}): ${err instanceof Error ? err.message : String(err)}`,
      );
      return 'pending';
    }
    if (!result.success) {
      this.logger.error(`Zarinpal refused the refund for payment ${payment.id} (authority ${payment.authority}) -- will retry`);
      await this.alerts.raise({
        key: `refund-refused:${payment.id}`,
        severity: 'warning',
        title: 'بازپرداخت پذیرفته نشد',
        body: `زرین‌پال بازگشت وجه پرداخت ${payment.id} را نپذیرفت؛ تلاش مجدد به‌صورت خودکار ادامه دارد.`,
      });
      return 'pending';
    }

    const updated = await this.payments.update(
      { id: payment.id, status: 'refund_pending' },
      { status: 'refunded', refundRefId: result.refundRefId, refundedAt: new Date() },
    );
    // A losing concurrent attempt (inline cancel vs retry job) sees affected=0;
    // the winner already recorded the refund and sent the notification.
    if (!updated.affected) return 'skipped';

    await this.notifyRefunded(payment.bookingId);

    // The refund itself already committed and is the priority -- a failure reversing
    // any referral reward tied to this booking must never surface as a failed refund.
    // reverseIfNeeded is internally try/catch'd and alerts on real failures, but guard
    // here too as defense-in-depth (matches this method's existing policy for every
    // other post-refund side effect).
    try {
      await this.referralsService.reverseIfNeeded(payment.bookingId);
    } catch (err) {
      this.logger.error(
        `Referral reward reversal check failed after refunding payment ${payment.id} (booking ${payment.bookingId}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return 'refunded';
  }

  private async notifyRefunded(bookingId: string): Promise<void> {
    const booking = await this.bookings.findOneBy({ id: bookingId });
    if (!booking) return;
    const customer = await this.usersService.findById(booking.userId);
    if (!customer) return;
    await this.notifyOne(customer, 'مبلغ ودیعه نوبت شما بازگردانده شد.', {
      title: 'بازگشت وجه',
      body: 'مبلغ ودیعه نوبت شما بازگردانده شد.',
    });
  }

  // Only called for a payment still at 'initiated' whose gateway outcome was a real
  // failure (Status=NOK, or a declined verify) -- nothing was captured.
  private async markFailed(paymentId: string, bookingId: string): Promise<void> {
    await this.dataSource.transaction(async (em) => {
      await em.update(Payment, { id: paymentId, status: 'initiated' }, { status: 'failed' });
      // Both writes are status-guarded, like every other status write on the money
      // path: unconditionally stamping cancelled_by_user would rewrite the history of a
      // booking that had already expired or been cancelled by the salon.
      await em.update(Booking, { id: bookingId, status: 'pending_payment' }, { status: 'cancelled_by_user' });
      // The deposit was never captured, so the coupon code this hold consumed goes back
      // to the customer instead of being burned for life.
      await releaseCouponRedemption(em, bookingId);
    });
  }

  private async notifyConfirmed(bookingId: string): Promise<void> {
    const booking = await this.bookings.findOneBy({ id: bookingId });
    if (!booking) return;
    const salon = await this.salonsService.findById(booking.salonId);
    if (!salon) return;
    const [customer, owner] = await Promise.all([
      this.usersService.findById(booking.userId),
      this.usersService.findById(salon.ownerId),
    ]);
    const when = booking.startsAt.toISOString();

    // SMS/push failures never roll back a confirmed booking (per the design spec's
    // error-handling section) -- these are best-effort notifications, not a queued-with-retry
    // system yet. The customer and owner notifications are independent of each other, so they
    // run concurrently to avoid stacking their latency onto the payment-callback response.
    await Promise.all([
      customer
        ? this.notifyOne(customer, `Booking confirmed at ${salon.name}, ${when}. Address: ${salon.address}`, {
            title: 'Booking confirmed',
            body: `${salon.name} — ${when}`,
          })
        : Promise.resolve(),
      owner
        ? this.notifyOne(owner, `New booking at ${salon.name} for ${when}`, {
            title: 'New booking',
            body: `${salon.name} — ${when}`,
          })
        : Promise.resolve(),
    ]);
  }

  private async notifyOne(user: User, smsBody: string, push: { title: string; body: string }): Promise<void> {
    await this.sms.send(user.phone, smsBody).catch(() => {});
    await this.push.sendToUser(user.id, push).catch(() => {});
  }
}
