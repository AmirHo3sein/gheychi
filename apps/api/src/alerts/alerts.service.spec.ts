import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AdminNotificationsService } from '../admin-notifications/admin-notifications.service';
import { REDIS } from '../redis/redis.module';
import { SMS_PROVIDER } from '../sms/sms.provider';
import { AlertsService } from './alerts.service';

describe('AlertsService.raise', () => {
  let service: AlertsService;
  let redisSet: jest.Mock;
  let emit: jest.Mock;
  let smsSend: jest.Mock;
  let configGet: jest.Mock;

  const CRITICAL_ALERT = {
    key: 'refund-stuck:pay-1',
    severity: 'critical' as const,
    title: 'بازپرداخت معوق',
    body: 'پرداخت pay-1 بیش از ۲۴ ساعت در انتظار بازگشت وجه است.',
  };

  beforeEach(async () => {
    redisSet = jest.fn().mockResolvedValue('OK'); // 'OK' = key was fresh, not a duplicate
    emit = jest.fn().mockResolvedValue(undefined);
    smsSend = jest.fn().mockResolvedValue(undefined);
    configGet = jest.fn().mockReturnValue('09121112233');

    const moduleRef = await Test.createTestingModule({
      providers: [
        AlertsService,
        { provide: REDIS, useValue: { set: redisSet } },
        { provide: AdminNotificationsService, useValue: { emit } },
        { provide: SMS_PROVIDER, useValue: { send: smsSend } },
        { provide: ConfigService, useValue: { get: configGet } },
      ],
    }).compile();

    service = moduleRef.get(AlertsService);
  });

  it('sends an in-app notification and an SMS for a fresh critical alert', async () => {
    await service.raise(CRITICAL_ALERT);

    expect(redisSet).toHaveBeenCalledWith('alert:dedup:refund-stuck:pay-1', '1', 'EX', 6 * 3600, 'NX');
    expect(emit).toHaveBeenCalledWith('alert', CRITICAL_ALERT.title, CRITICAL_ALERT.body, null);
    expect(smsSend).toHaveBeenCalledWith('09121112233', `${CRITICAL_ALERT.title} — ${CRITICAL_ALERT.body}`);
  });

  it('passes the link through to the notification when provided', async () => {
    await service.raise({ ...CRITICAL_ALERT, link: '/payments/pay-1' });
    expect(emit).toHaveBeenCalledWith('alert', CRITICAL_ALERT.title, CRITICAL_ALERT.body, '/payments/pay-1');
  });

  it('suppresses a duplicate key inside the dedup window (no notification, no SMS)', async () => {
    redisSet.mockResolvedValue(null); // NX miss: key already present
    await service.raise(CRITICAL_ALERT);
    expect(emit).not.toHaveBeenCalled();
    expect(smsSend).not.toHaveBeenCalled();
  });

  it('never SMSes for warning severity', async () => {
    await service.raise({ ...CRITICAL_ALERT, severity: 'warning' });
    expect(emit).toHaveBeenCalled();
    expect(smsSend).not.toHaveBeenCalled();
  });

  it('skips SMS (but not the notification) when ALERT_ADMIN_PHONE is empty', async () => {
    configGet.mockReturnValue('');
    await service.raise(CRITICAL_ALERT);
    expect(emit).toHaveBeenCalled();
    expect(smsSend).not.toHaveBeenCalled();
  });

  it('fails open when Redis errors: the alert still sends', async () => {
    redisSet.mockRejectedValue(new Error('redis down'));
    await service.raise(CRITICAL_ALERT);
    expect(emit).toHaveBeenCalled();
    expect(smsSend).toHaveBeenCalled();
  });

  it('swallows a notification-emit failure and still attempts the SMS', async () => {
    emit.mockRejectedValue(new Error('db down'));
    await expect(service.raise(CRITICAL_ALERT)).resolves.toBeUndefined();
    expect(smsSend).toHaveBeenCalled();
  });

  it('swallows an SMS failure (never throws to the caller)', async () => {
    smsSend.mockRejectedValue(new Error('kavenegar down'));
    await expect(service.raise(CRITICAL_ALERT)).resolves.toBeUndefined();
  });
});
