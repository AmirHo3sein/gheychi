import { EntityManager } from 'typeorm';
import { AnalyticsService } from '../analytics/analytics.service';
import { ReferralsService } from '../referrals/referrals.service';
import { UsersService } from '../users/users.service';
import { AuthController } from './auth.controller';
import { OtpService } from './otp.service';

describe('AuthController.verifyOtp -- referral-code extension', () => {
  let controller: AuthController;
  let otp: { verify: jest.Mock; issue: jest.Mock };
  let users: { findOrCreateByPhone: jest.Mock };
  let jwt: { signAsync: jest.Mock };
  let referrals: { applyReferralAtRegistration: jest.Mock };
  let sms: { sendOtp: jest.Mock };
  let emQuery: jest.Mock;
  let dataSource: { transaction: jest.Mock };
  let res: { cookie: jest.Mock };
  let analytics: { track: jest.Mock };

  const NEW_USER = { id: 'new-user-1', phone: '09120000000', status: 'active', name: null, gender: null, role: 'customer' };

  beforeEach(() => {
    otp = { verify: jest.fn().mockResolvedValue(true), issue: jest.fn() };
    users = { findOrCreateByPhone: jest.fn() };
    jwt = { signAsync: jest.fn().mockResolvedValue('signed-token') };
    referrals = { applyReferralAtRegistration: jest.fn() };
    sms = { sendOtp: jest.fn() };
    res = { cookie: jest.fn() };
    analytics = { track: jest.fn().mockResolvedValue(undefined) };
    emQuery = jest.fn().mockResolvedValue(undefined);

    // Mirrors real DataSource.transaction(cb) -- invokes cb with a fake EntityManager
    // whose .query() is a no-op mock (SAVEPOINT/RELEASE/ROLLBACK TO SAVEPOINT).
    dataSource = {
      transaction: jest.fn(async (cb: (em: EntityManager) => unknown) => cb({ query: emQuery } as unknown as EntityManager)),
    };

    controller = new AuthController(
      otp as unknown as OtpService,
      users as unknown as UsersService,
      jwt as never,
      referrals as unknown as ReferralsService,
      dataSource as never,
      sms as never,
      analytics as unknown as AnalyticsService,
    );
  });

  it('never opens a transaction when no referralCode is provided', async () => {
    users.findOrCreateByPhone.mockResolvedValue({ user: NEW_USER, isNew: true });

    const result = await controller.verifyOtp({ phone: NEW_USER.phone, code: '123456' }, res as never);

    expect(dataSource.transaction).not.toHaveBeenCalled();
    expect(users.findOrCreateByPhone).toHaveBeenCalledWith(NEW_USER.phone);
    expect(result).not.toHaveProperty('referralStatus');
  });

  it('never reads referralCode for an already-existing account (R2) -- referralStatus omitted entirely', async () => {
    users.findOrCreateByPhone.mockResolvedValue({ user: NEW_USER, isNew: false });

    const result = await controller.verifyOtp(
      { phone: NEW_USER.phone, code: '123456', referralCode: 'ABC12345' },
      res as never,
    );

    expect(referrals.applyReferralAtRegistration).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty('referralStatus');
  });

  it('applies the referral code for a brand-new registration and surfaces the status', async () => {
    users.findOrCreateByPhone.mockResolvedValue({ user: NEW_USER, isNew: true });
    referrals.applyReferralAtRegistration.mockResolvedValue({ status: 'applied' });

    const result = await controller.verifyOtp(
      { phone: NEW_USER.phone, code: '123456', referralCode: 'ABC12345' },
      res as never,
    );

    expect(referrals.applyReferralAtRegistration).toHaveBeenCalledWith(NEW_USER.id, 'ABC12345', expect.anything());
    expect(result).toMatchObject({ referralStatus: 'applied', isNewUser: true });
    expect(emQuery).toHaveBeenCalledWith('RELEASE SAVEPOINT registration_referral');
  });

  it('surfaces referral_type_disabled from the service without failing registration', async () => {
    users.findOrCreateByPhone.mockResolvedValue({ user: NEW_USER, isNew: true });
    referrals.applyReferralAtRegistration.mockResolvedValue({ status: 'referral_type_disabled' });

    const result = await controller.verifyOtp(
      { phone: NEW_USER.phone, code: '123456', referralCode: 'ABC12345' },
      res as never,
    );

    expect(result).toMatchObject({ referralStatus: 'referral_type_disabled' });
  });

  it('registration never fails because of a referral-code problem: an unexpected throw is swallowed', async () => {
    users.findOrCreateByPhone.mockResolvedValue({ user: NEW_USER, isNew: true });
    referrals.applyReferralAtRegistration.mockRejectedValue(new Error('boom -- unexpected bug in referral resolution'));

    const result = await controller.verifyOtp(
      { phone: NEW_USER.phone, code: '123456', referralCode: 'ABC12345' },
      res as never,
    );

    // The whole call resolves successfully -- registration is NOT rolled back or
    // rejected just because the referral path threw.
    expect(result).toMatchObject({ isNewUser: true, referralStatus: 'invalid_code' });
    expect(result.user.id).toBe(NEW_USER.id);
    expect(res.cookie).toHaveBeenCalled();
    // The savepoint taken before the referral call is rolled back, not the whole
    // registration transaction.
    expect(emQuery).toHaveBeenCalledWith('SAVEPOINT registration_referral');
    expect(emQuery).toHaveBeenCalledWith('ROLLBACK TO SAVEPOINT registration_referral');
  });

  it('still sets the session cookie and returns the user even when the referral code is garbage', async () => {
    users.findOrCreateByPhone.mockResolvedValue({ user: NEW_USER, isNew: true });
    referrals.applyReferralAtRegistration.mockResolvedValue({ status: 'invalid_code' });

    const result = await controller.verifyOtp(
      { phone: NEW_USER.phone, code: '123456', referralCode: 'GARBAGE' },
      res as never,
    );

    expect(res.cookie).toHaveBeenCalledWith('session', 'signed-token', expect.any(Object));
    expect(result).toMatchObject({ referralStatus: 'invalid_code' });
  });

  describe('analytics', () => {
    it('tracks user_registered for a brand-new account, never for a returning one', async () => {
      users.findOrCreateByPhone.mockResolvedValue({ user: NEW_USER, isNew: true });

      await controller.verifyOtp({ phone: NEW_USER.phone, code: '123456' }, res as never);

      expect(analytics.track).toHaveBeenCalledWith(
        'user_registered',
        { role: NEW_USER.role, hasReferralCode: false },
        { userId: NEW_USER.id },
      );

      analytics.track.mockClear();
      users.findOrCreateByPhone.mockResolvedValue({ user: NEW_USER, isNew: false });

      await controller.verifyOtp({ phone: NEW_USER.phone, code: '123456' }, res as never);

      expect(analytics.track).not.toHaveBeenCalled();
    });

    it('still completes registration when the analytics provider fails (never affects the response)', async () => {
      users.findOrCreateByPhone.mockResolvedValue({ user: NEW_USER, isNew: true });
      analytics.track.mockRejectedValue(new Error('analytics vendor down'));

      const result = await controller.verifyOtp({ phone: NEW_USER.phone, code: '123456' }, res as never);

      expect(result).toMatchObject({ isNewUser: true });
      expect(res.cookie).toHaveBeenCalled();
    });
  });
});
