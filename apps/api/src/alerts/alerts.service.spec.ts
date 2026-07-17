import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AdminNotificationsService } from '../admin-notifications/admin-notifications.service';
import { REDIS } from '../redis/redis.module';
import { SMS_PROVIDER } from '../sms/sms.provider';
import { AlertsService } from './alerts.service';

describe('AlertsService.raise', () => {
  let service: AlertsService;
  let redisSet: jest.Mock;
  let redisDel: jest.Mock;
  let redisIncrReply: number;
  let redisExec: jest.Mock;
  let emit: jest.Mock;
  let smsSend: jest.Mock;
  let configValues: Record<string, string>;

  const CRITICAL_ALERT = {
    key: 'refund-stuck:pay-1',
    severity: 'critical' as const,
    title: 'بازپرداخت معوق',
    body: 'پرداخت pay-1 بیش از ۲۴ ساعت در انتظار بازگشت وجه است.',
  };

  async function build() {
    const moduleRef = await Test.createTestingModule({
      providers: [
        AlertsService,
        {
          provide: REDIS,
          useValue: {
            set: redisSet,
            del: redisDel,
            multi: () => ({ incr: jest.fn().mockReturnThis(), expire: jest.fn().mockReturnThis(), exec: redisExec }),
          },
        },
        { provide: AdminNotificationsService, useValue: { emit } },
        { provide: SMS_PROVIDER, useValue: { send: smsSend } },
        {
          provide: ConfigService,
          useValue: { get: (key: string, def?: string) => configValues[key] ?? def },
        },
      ],
    }).compile();
    return moduleRef.get(AlertsService);
  }

  beforeEach(async () => {
    redisSet = jest.fn().mockResolvedValue('OK'); // 'OK' = key was fresh, not a duplicate
    redisDel = jest.fn().mockResolvedValue(1);
    redisIncrReply = 1;
    redisExec = jest.fn().mockImplementation(() => Promise.resolve([[null, redisIncrReply++], [null, 1]]));
    emit = jest.fn().mockResolvedValue(undefined);
    smsSend = jest.fn().mockResolvedValue(undefined);
    configValues = { ALERT_ADMIN_PHONE: '09121112233' };

    service = await build();
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
    configValues = { ALERT_ADMIN_PHONE: '' };
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

  it('honors a per-alert dedupHours override', async () => {
    await service.raise({ ...CRITICAL_ALERT, dedupHours: 24 });
    expect(redisSet).toHaveBeenCalledWith('alert:dedup:refund-stuck:pay-1', '1', 'EX', 24 * 3600, 'NX');
  });

  it('fans out to every comma-separated admin phone', async () => {
    configValues = { ALERT_ADMIN_PHONE: '09121112233, 09354445566' };
    service = await build();
    await service.raise(CRITICAL_ALERT);
    expect(smsSend).toHaveBeenCalledTimes(2);
    expect(smsSend).toHaveBeenCalledWith('09121112233', expect.any(String));
    expect(smsSend).toHaveBeenCalledWith('09354445566', expect.any(String));
  });

  it('one phone failing does not stop the fan-out to the others', async () => {
    configValues = { ALERT_ADMIN_PHONE: '09121112233,09354445566' };
    service = await build();
    smsSend.mockRejectedValueOnce(new Error('kavenegar down'));
    await service.raise(CRITICAL_ALERT);
    expect(smsSend).toHaveBeenCalledTimes(2);
  });

  it('releases the dedup claim when nothing was delivered (emit failed, all SMS failed)', async () => {
    emit.mockRejectedValue(new Error('db down'));
    smsSend.mockRejectedValue(new Error('kavenegar down'));
    await service.raise(CRITICAL_ALERT);
    expect(redisDel).toHaveBeenCalledWith('alert:dedup:refund-stuck:pay-1');
  });

  it('keeps the dedup claim on partial success (emit failed but an SMS went out)', async () => {
    emit.mockRejectedValue(new Error('db down'));
    await service.raise(CRITICAL_ALERT);
    expect(smsSend).toHaveBeenCalled();
    expect(redisDel).not.toHaveBeenCalled();
  });

  it('keeps the dedup claim when the in-app notification landed but SMS failed', async () => {
    smsSend.mockRejectedValue(new Error('kavenegar down'));
    await service.raise(CRITICAL_ALERT);
    expect(redisDel).not.toHaveBeenCalled();
  });

  it('suppresses SMS (not the in-app notification) past the hourly cap, and does not release the claim', async () => {
    configValues = { ALERT_ADMIN_PHONE: '09121112233', ALERT_SMS_HOURLY_CAP: '1' };
    service = await build();
    await service.raise(CRITICAL_ALERT);
    await service.raise({ ...CRITICAL_ALERT, key: 'refund-stuck:pay-2' });
    expect(smsSend).toHaveBeenCalledTimes(1); // second alert's SMS capped
    expect(emit).toHaveBeenCalledTimes(2); // in-app never capped
    expect(redisDel).not.toHaveBeenCalled(); // in-app delivery keeps the claim
  });

  it('fails open when the hourly-cap counter errors: the SMS still sends', async () => {
    redisExec.mockRejectedValue(new Error('redis down'));
    await service.raise(CRITICAL_ALERT);
    expect(smsSend).toHaveBeenCalled();
  });

  it('falls back to the default hourly cap with a warning when ALERT_SMS_HOURLY_CAP is invalid', async () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    configValues = { ALERT_ADMIN_PHONE: '09121112233', ALERT_SMS_HOURLY_CAP: 'lots' };
    service = await build();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('ALERT_SMS_HOURLY_CAP'));
    await service.raise(CRITICAL_ALERT);
    expect(smsSend).toHaveBeenCalled(); // default cap (30) applies, not zero
    warnSpy.mockRestore();
  });
});
