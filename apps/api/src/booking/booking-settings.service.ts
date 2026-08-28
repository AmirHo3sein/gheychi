import { Injectable } from '@nestjs/common';
import { PlatformConfigService } from '../platform-config/platform-config.service';
import { Salon } from '../salons/salon.entity';

/**
 * The effective timing values for one salon, with enough provenance for the admin UI to
 * show "60 minutes" vs "30 minutes (global)" without re-deriving the rule itself.
 */
export interface EffectiveBookingSettings {
  approvalTimeoutMinutes: number;
  paymentTimeoutMinutes: number;
  /** Global defaults, so the admin UI can render "inherited from" without a second call. */
  globalApprovalTimeoutMinutes: number;
  globalPaymentTimeoutMinutes: number;
  /** True when this salon carries its own admin-set override for that value. */
  approvalTimeoutIsOverridden: boolean;
  paymentTimeoutIsOverridden: boolean;
}

/**
 * Resolves the two-level timeout configuration (global platform default, optionally
 * overridden per salon by an admin) into the concrete numbers the booking workflow uses.
 *
 * Deliberately the ONLY place that rule lives. Every deadline this platform stamps onto a
 * booking is computed from here, so "which value actually applies to salon X" can never
 * disagree between the booking path, the expiry jobs, and the admin screen that displays it.
 *
 * Note this resolves values, it does not stamp deadlines. Callers snapshot the resulting
 * deadline onto the booking (see Booking.approvalExpiresAt / paymentExpiresAt) precisely so
 * that a later config change cannot move a deadline that a customer or salon is already
 * counting on.
 */
@Injectable()
export class BookingSettingsService {
  constructor(private readonly config: PlatformConfigService) {}

  async resolveFor(salon: Pick<Salon, 'approvalTimeoutMinutes' | 'paymentTimeoutMinutes'>): Promise<EffectiveBookingSettings> {
    const [globalApproval, globalPayment] = await Promise.all([
      this.config.getBookingApprovalTimeoutMinutes(),
      // The payment window's global default IS the pre-existing hold TTL -- see that
      // getter's own doc comment for why this isn't a separate config key.
      this.config.getBookingHoldTtlMinutes(),
    ]);

    return {
      approvalTimeoutMinutes: salon.approvalTimeoutMinutes ?? globalApproval,
      paymentTimeoutMinutes: salon.paymentTimeoutMinutes ?? globalPayment,
      globalApprovalTimeoutMinutes: globalApproval,
      globalPaymentTimeoutMinutes: globalPayment,
      approvalTimeoutIsOverridden: salon.approvalTimeoutMinutes !== null,
      paymentTimeoutIsOverridden: salon.paymentTimeoutMinutes !== null,
    };
  }

  /** `from + minutes`, as an absolute instant to be snapshotted onto a booking row. */
  static deadlineFrom(from: Date, minutes: number): Date {
    return new Date(from.getTime() + minutes * 60_000);
  }
}
