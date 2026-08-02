import { CouponRedemption } from '../coupons/coupon-redemption.entity';
import { WalletService } from '../wallet/wallet.service';
import { Booking } from './booking.entity';
import { releaseBookingHold } from './booking-hold-release.util';

function makeEm(bookingRows: Array<{ id: string; userId: string; walletAmountUsed: number | null }>) {
  return {
    delete: jest.fn().mockResolvedValue({ affected: bookingRows.length }),
    find: jest.fn().mockResolvedValue(bookingRows),
  };
}

describe('releaseBookingHold', () => {
  it('no-ops entirely for an empty id list -- no delete, no lookup', async () => {
    const em = makeEm([]);
    const wallet = { credit: jest.fn() } as unknown as WalletService;

    await releaseBookingHold(em as never, wallet, []);

    expect(em.delete).not.toHaveBeenCalled();
    expect(em.find).not.toHaveBeenCalled();
  });

  it('always deletes any CouponRedemption row for the booking(s), coupon or not', async () => {
    const em = makeEm([{ id: 'booking-1', userId: 'user-1', walletAmountUsed: null }]);
    const wallet = { credit: jest.fn() } as unknown as WalletService;

    await releaseBookingHold(em as never, wallet, 'booking-1');

    expect(em.delete).toHaveBeenCalledWith(CouponRedemption, { bookingId: expect.anything() });
  });

  it('credits the wallet back when the released booking had walletAmountUsed set', async () => {
    const em = makeEm([{ id: 'booking-1', userId: 'user-1', walletAmountUsed: 50_000 }]);
    const credit = jest.fn().mockResolvedValue({ balanceAfter: 50_000, transactionId: 'wt-2' });
    const wallet = { credit } as unknown as WalletService;

    await releaseBookingHold(em as never, wallet, 'booking-1');

    expect(em.find).toHaveBeenCalledWith(Booking, {
      where: { id: expect.anything() },
      select: ['id', 'userId', 'walletAmountUsed'],
    });
    expect(credit).toHaveBeenCalledWith(
      em,
      'user-1',
      'toman',
      50_000,
      'booking_spend_reversal',
      expect.objectContaining({ referenceType: 'booking', referenceId: 'booking-1' }),
    );
  });

  it('never calls credit for a booking that never used its wallet', async () => {
    const em = makeEm([{ id: 'booking-1', userId: 'user-1', walletAmountUsed: null }]);
    const credit = jest.fn();
    const wallet = { credit } as unknown as WalletService;

    await releaseBookingHold(em as never, wallet, 'booking-1');

    expect(credit).not.toHaveBeenCalled();
  });

  it('handles a mixed batch: credits back only the bookings that actually used wallet balance', async () => {
    const em = makeEm([
      { id: 'booking-1', userId: 'user-1', walletAmountUsed: 20_000 },
      { id: 'booking-2', userId: 'user-2', walletAmountUsed: null },
      { id: 'booking-3', userId: 'user-3', walletAmountUsed: 5_000 },
    ]);
    const credit = jest.fn().mockResolvedValue({ balanceAfter: 0, transactionId: 'wt-x' });
    const wallet = { credit } as unknown as WalletService;

    await releaseBookingHold(em as never, wallet, ['booking-1', 'booking-2', 'booking-3']);

    expect(credit).toHaveBeenCalledTimes(2);
    expect(credit).toHaveBeenCalledWith(em, 'user-1', 'toman', 20_000, 'booking_spend_reversal', expect.anything());
    expect(credit).toHaveBeenCalledWith(em, 'user-3', 'toman', 5_000, 'booking_spend_reversal', expect.anything());
  });
});
