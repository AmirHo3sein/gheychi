import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { PushService } from '../push/push.service';
import { SMS_PROVIDER } from '../sms/sms.provider';
import { SalonsService } from '../salons/salons.service';
import { UsersService } from '../users/users.service';
import { Booking } from './booking.entity';
import { PAYMENT_GATEWAY } from './payment-gateway';
import { Payment } from './payment.entity';
import { PaymentsService } from './payments.service';

describe('PaymentsService.attemptRefund', () => {
  let service: PaymentsService;
  let paymentsFindOneBy: jest.Mock;
  let paymentsUpdate: jest.Mock;
  let bookingsFindOneBy: jest.Mock;
  let refundPayment: jest.Mock;
  let smsSend: jest.Mock;
  let pushSend: jest.Mock;

  const REFUND_PENDING_PAYMENT = {
    id: 'pay-1',
    bookingId: 'booking-1',
    authority: 'AUTH123',
    status: 'refund_pending',
  };

  beforeEach(async () => {
    paymentsFindOneBy = jest.fn();
    paymentsUpdate = jest.fn().mockResolvedValue({ affected: 1 });
    bookingsFindOneBy = jest.fn().mockResolvedValue({ id: 'booking-1', userId: 'user-1', salonId: 'salon-1' });
    refundPayment = jest.fn();
    smsSend = jest.fn().mockResolvedValue(undefined);
    pushSend = jest.fn().mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: getRepositoryToken(Payment), useValue: { findOneBy: paymentsFindOneBy, update: paymentsUpdate } },
        { provide: getRepositoryToken(Booking), useValue: { findOneBy: bookingsFindOneBy } },
        { provide: DataSource, useValue: {} },
        { provide: SalonsService, useValue: {} },
        { provide: UsersService, useValue: { findById: jest.fn().mockResolvedValue({ id: 'user-1', phone: '09120000000' }) } },
        { provide: SMS_PROVIDER, useValue: { send: smsSend } },
        { provide: PAYMENT_GATEWAY, useValue: { refundPayment } },
        { provide: PushService, useValue: { sendToUser: pushSend } },
      ],
    }).compile();

    service = moduleRef.get(PaymentsService);
  });

  it('refunds a refund_pending payment: gateway call, race-safe update, customer notification', async () => {
    paymentsFindOneBy.mockResolvedValue({ ...REFUND_PENDING_PAYMENT });
    refundPayment.mockResolvedValue({ success: true, refundRefId: 'RR-1' });

    const outcome = await service.attemptRefund('booking-1');

    expect(outcome).toBe('refunded');
    expect(refundPayment).toHaveBeenCalledWith('AUTH123');
    expect(paymentsUpdate).toHaveBeenCalledWith(
      { id: 'pay-1', status: 'refund_pending' },
      expect.objectContaining({ status: 'refunded', refundRefId: 'RR-1', refundedAt: expect.any(Date) }),
    );
    expect(smsSend).toHaveBeenCalledWith('09120000000', expect.any(String));
    expect(pushSend).toHaveBeenCalledWith('user-1', expect.objectContaining({ title: expect.any(String) }));
  });

  it('skips a payment that is not refund_pending without touching the gateway', async () => {
    paymentsFindOneBy.mockResolvedValue({ ...REFUND_PENDING_PAYMENT, status: 'paid' });
    const outcome = await service.attemptRefund('booking-1');
    expect(outcome).toBe('skipped');
    expect(refundPayment).not.toHaveBeenCalled();
  });

  it('skips a missing payment', async () => {
    paymentsFindOneBy.mockResolvedValue(null);
    const outcome = await service.attemptRefund('booking-1');
    expect(outcome).toBe('skipped');
    expect(refundPayment).not.toHaveBeenCalled();
  });

  it('leaves a payment with no authority pending and never calls the gateway', async () => {
    paymentsFindOneBy.mockResolvedValue({ ...REFUND_PENDING_PAYMENT, authority: null });
    const outcome = await service.attemptRefund('booking-1');
    expect(outcome).toBe('pending');
    expect(refundPayment).not.toHaveBeenCalled();
    expect(paymentsUpdate).not.toHaveBeenCalled();
  });

  it('leaves the payment pending when the gateway refuses the refund', async () => {
    paymentsFindOneBy.mockResolvedValue({ ...REFUND_PENDING_PAYMENT });
    refundPayment.mockResolvedValue({ success: false, refundRefId: null });
    const outcome = await service.attemptRefund('booking-1');
    expect(outcome).toBe('pending');
    expect(paymentsUpdate).not.toHaveBeenCalled();
    expect(smsSend).not.toHaveBeenCalled();
  });

  it('catches a gateway throw and leaves the payment pending (never propagates)', async () => {
    paymentsFindOneBy.mockResolvedValue({ ...REFUND_PENDING_PAYMENT });
    refundPayment.mockRejectedValue(new Error('Zarinpal refund failed: fetch failed'));
    const outcome = await service.attemptRefund('booking-1');
    expect(outcome).toBe('pending');
    expect(paymentsUpdate).not.toHaveBeenCalled();
  });

  it('does not notify when a concurrent attempt already won the conditional update', async () => {
    paymentsFindOneBy.mockResolvedValue({ ...REFUND_PENDING_PAYMENT });
    refundPayment.mockResolvedValue({ success: true, refundRefId: 'RR-1' });
    paymentsUpdate.mockResolvedValue({ affected: 0 });

    const outcome = await service.attemptRefund('booking-1');

    expect(outcome).toBe('skipped');
    expect(smsSend).not.toHaveBeenCalled();
    expect(pushSend).not.toHaveBeenCalled();
  });
});
