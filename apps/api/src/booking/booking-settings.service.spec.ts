import { Test } from '@nestjs/testing';
import { PlatformConfigService } from '../platform-config/platform-config.service';
import { BookingSettingsService } from './booking-settings.service';

describe('BookingSettingsService.resolveFor', () => {
  let service: BookingSettingsService;
  let config: { getBookingApprovalTimeoutMinutes: jest.Mock; getBookingHoldTtlMinutes: jest.Mock };

  beforeEach(async () => {
    config = {
      getBookingApprovalTimeoutMinutes: jest.fn().mockResolvedValue(30),
      // The payment-window global default IS the pre-existing hold TTL -- deliberately
      // the same key, not a forked second one.
      getBookingHoldTtlMinutes: jest.fn().mockResolvedValue(15),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [BookingSettingsService, { provide: PlatformConfigService, useValue: config }],
    }).compile();
    service = moduleRef.get(BookingSettingsService);
  });

  it('falls back to the global defaults when the salon has no overrides', async () => {
    const result = await service.resolveFor({ approvalTimeoutMinutes: null, paymentTimeoutMinutes: null });

    expect(result.approvalTimeoutMinutes).toBe(30);
    expect(result.paymentTimeoutMinutes).toBe(15);
    expect(result.approvalTimeoutIsOverridden).toBe(false);
    expect(result.paymentTimeoutIsOverridden).toBe(false);
  });

  it("prefers the salon's own admin-set overrides over the global defaults", async () => {
    const result = await service.resolveFor({ approvalTimeoutMinutes: 60, paymentTimeoutMinutes: 20 });

    expect(result.approvalTimeoutMinutes).toBe(60);
    expect(result.paymentTimeoutMinutes).toBe(20);
    expect(result.approvalTimeoutIsOverridden).toBe(true);
    expect(result.paymentTimeoutIsOverridden).toBe(true);
  });

  it('resolves each value independently -- one override does not drag the other along', async () => {
    const result = await service.resolveFor({ approvalTimeoutMinutes: 60, paymentTimeoutMinutes: null });

    expect(result.approvalTimeoutMinutes).toBe(60);
    expect(result.approvalTimeoutIsOverridden).toBe(true);
    expect(result.paymentTimeoutMinutes).toBe(15);
    expect(result.paymentTimeoutIsOverridden).toBe(false);
  });

  it('always reports the global defaults alongside, so the admin UI can show provenance without a second call', async () => {
    const result = await service.resolveFor({ approvalTimeoutMinutes: 60, paymentTimeoutMinutes: 20 });

    expect(result.globalApprovalTimeoutMinutes).toBe(30);
    expect(result.globalPaymentTimeoutMinutes).toBe(15);
  });

  // A 0 override would be indistinguishable from "unset" under a `||` fallback, and would
  // mean every request expires before a human could see it. The DB CHECK and the DTO both
  // forbid it, but ?? is what makes the resolver itself honest about the difference.
  it('treats a 0 override as a real value, not as "unset" (?? semantics, not ||)', async () => {
    const result = await service.resolveFor({ approvalTimeoutMinutes: 0, paymentTimeoutMinutes: 0 });

    expect(result.approvalTimeoutMinutes).toBe(0);
    expect(result.paymentTimeoutMinutes).toBe(0);
    expect(result.approvalTimeoutIsOverridden).toBe(true);
  });
});

describe('BookingSettingsService.deadlineFrom', () => {
  it('adds the given minutes to the given instant', () => {
    const from = new Date('2026-08-28T10:00:00.000Z');
    expect(BookingSettingsService.deadlineFrom(from, 30).toISOString()).toBe('2026-08-28T10:30:00.000Z');
  });

  it('does not mutate the instant it was given', () => {
    const from = new Date('2026-08-28T10:00:00.000Z');
    BookingSettingsService.deadlineFrom(from, 30);
    expect(from.toISOString()).toBe('2026-08-28T10:00:00.000Z');
  });
});
