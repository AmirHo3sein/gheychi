import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Response } from 'express';
import { PaymentsController } from './payments.controller';
import { CallbackOutcome, PaymentsService } from './payments.service';

describe('PaymentsController.callback -- redirect status', () => {
  let controller: PaymentsController;
  let handleCallback: jest.Mock;
  let redirect: jest.Mock;

  beforeEach(async () => {
    handleCallback = jest.fn();
    redirect = jest.fn();

    const moduleRef = await Test.createTestingModule({
      controllers: [PaymentsController],
      providers: [
        { provide: PaymentsService, useValue: { handleCallback } },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('http://front.example') } },
      ],
    }).compile();

    controller = moduleRef.get(PaymentsController);
  });

  async function callbackFor(outcome: CallbackOutcome, bookingId: string | null): Promise<string> {
    handleCallback.mockResolvedValue({ status: outcome, bookingId });
    await controller.callback('AUTH123', 'OK', { redirect } as unknown as Response);
    expect(redirect).toHaveBeenCalledWith(302, expect.any(String));
    return redirect.mock.calls[0][1] as string;
  }

  it('redirects a confirmed capture to status=success with the booking id', async () => {
    expect(await callbackFor('success', 'booking-1')).toBe(
      'http://front.example/booking/callback?status=success&bookingId=booking-1',
    );
  });

  it('redirects a duplicate delivery of an already-confirmed payment to status=success', async () => {
    expect(await callbackFor('already-confirmed', 'booking-1')).toBe(
      'http://front.example/booking/callback?status=success&bookingId=booking-1',
    );
  });

  // The finding this test pins: a capture onto a dead booking (refund queued) used to be
  // redirected with status=failed -- the same value as a genuine decline -- so the customer
  // was told no payment happened and no booking exists while their bank showed the
  // deduction. It gets its own third state.
  it('redirects a captured-but-refunding outcome to status=refunding, NOT failed', async () => {
    expect(await callbackFor('refunding', 'booking-1')).toBe(
      'http://front.example/booking/callback?status=refunding&bookingId=booking-1',
    );
  });

  it('redirects a genuine decline to status=failed', async () => {
    expect(await callbackFor('failed', 'booking-1')).toBe(
      'http://front.example/booking/callback?status=failed&bookingId=booking-1',
    );
  });

  it('redirects an unattributable authority to status=failed with no bookingId at all', async () => {
    expect(await callbackFor('unknown-authority', null)).toBe('http://front.example/booking/callback?status=failed');
  });
});
