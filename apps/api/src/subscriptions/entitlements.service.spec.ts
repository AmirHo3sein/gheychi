import { ForbiddenException } from '@nestjs/common';
import { EntitlementsService } from './entitlements.service';

describe('EntitlementsService', () => {
  let getEntitlements: jest.Mock;
  let service: EntitlementsService;

  beforeEach(() => {
    getEntitlements = jest.fn().mockResolvedValue({});
    service = new EntitlementsService({ getEntitlements } as never);
  });

  describe('hasFeature', () => {
    it('honours an explicit false even for a key that defaults to true', async () => {
      getEntitlements.mockResolvedValue({ customHandle: false });
      await expect(service.hasFeature('salon-1', 'customHandle')).resolves.toBe(false);
    });

    it('honours an explicit true', async () => {
      getEntitlements.mockResolvedValue({ qrCode: true });
      await expect(service.hasFeature('salon-1', 'qrCode')).resolves.toBe(true);
    });

    it('falls back to the registry default when the key is absent -- handle/QR stay ON so no live salon loses a capability on deploy', async () => {
      await expect(service.hasFeature('salon-1', 'customHandle')).resolves.toBe(true);
      await expect(service.hasFeature('salon-1', 'qrCode')).resolves.toBe(true);
    });

    it('falls back to the default for a malformed (non-boolean) value rather than trusting truthiness', async () => {
      getEntitlements.mockResolvedValue({ customHandle: 'no' });
      // 'no' is a truthy string; coercing it would grant the feature by accident. The
      // registry default wins instead.
      await expect(service.hasFeature('salon-1', 'customHandle')).resolves.toBe(true);
    });
  });

  describe('requireFeature', () => {
    it('passes silently when granted', async () => {
      getEntitlements.mockResolvedValue({ customHandle: true });
      await expect(service.requireFeature('salon-1', 'customHandle', 'nope')).resolves.toBeUndefined();
    });

    it('throws a 403 carrying the caller-supplied Persian message', async () => {
      getEntitlements.mockResolvedValue({ customHandle: false });
      await expect(service.requireFeature('salon-1', 'customHandle', 'پلن شما این امکان را ندارد')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  describe('getQuota', () => {
    it('reads a configured quota', async () => {
      getEntitlements.mockResolvedValue({ smsMonthlyQuota: 250 });
      await expect(service.getQuota('salon-1', 'smsMonthlyQuota')).resolves.toBe(250);
    });

    it('treats an absent quota as ZERO, not unlimited -- an unconfigured plan must not hand out free SMS', async () => {
      await expect(service.getQuota('salon-1', 'smsMonthlyQuota')).resolves.toBe(0);
    });

    it.each([['unlimited'], [null], [-5], [Number.NaN], [Number.POSITIVE_INFINITY]])(
      'treats a malformed quota value (%s) as zero',
      async (value) => {
        getEntitlements.mockResolvedValue({ smsMonthlyQuota: value });
        await expect(service.getQuota('salon-1', 'smsMonthlyQuota')).resolves.toBe(0);
      },
    );

    it('allows an explicit zero quota', async () => {
      getEntitlements.mockResolvedValue({ smsMonthlyQuota: 0 });
      await expect(service.getQuota('salon-1', 'smsMonthlyQuota')).resolves.toBe(0);
    });
  });

  describe('getLimit', () => {
    it('returns null (unlimited) for an absent limit-kind key', async () => {
      await expect(service.getLimit('salon-1', 'crmCustomerCap')).resolves.toBeNull();
    });

    it('returns a configured ceiling', async () => {
      getEntitlements.mockResolvedValue({ crmCustomerCap: 500 });
      await expect(service.getLimit('salon-1', 'crmCustomerCap')).resolves.toBe(500);
    });
  });

  describe('remainingQuota', () => {
    it('subtracts usage the calling feature already counted', async () => {
      getEntitlements.mockResolvedValue({ smsMonthlyQuota: 20 });
      await expect(service.remainingQuota('salon-1', 'smsMonthlyQuota', 8)).resolves.toBe(12);
    });

    it('never reports a negative remainder when usage somehow exceeds the quota', async () => {
      getEntitlements.mockResolvedValue({ smsMonthlyQuota: 20 });
      await expect(service.remainingQuota('salon-1', 'smsMonthlyQuota', 25)).resolves.toBe(0);
    });
  });
});
