import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';

describe('MetricsController', () => {
  it('GET /metrics returns valid Prometheus text-exposition format for a fresh registry', async () => {
    const metrics = new MetricsService();
    const controller = new MetricsController(metrics);

    const body = await controller.metrics();

    expect(typeof body).toBe('string');
    // Every metric this codebase registers must appear with its declared HELP/TYPE
    // preamble -- the standard Prometheus text-exposition-format shape -- even before
    // any real request/booking/payment/etc. has moved a single counter.
    expect(body).toContain('# HELP http_requests_total');
    expect(body).toContain('# TYPE http_requests_total counter');
    expect(body).toContain('# HELP cron_job_duration_seconds');
    expect(body).toContain('# TYPE cron_job_duration_seconds histogram');
  });

  it('GET /metrics reflects a real counter increment', async () => {
    const metrics = new MetricsService();
    const controller = new MetricsController(metrics);

    metrics.incBookingAttempt('online');
    metrics.incBookingSuccess('online');

    const body = await controller.metrics();

    expect(body).toContain('booking_attempts_total{flow="online"} 1');
    expect(body).toContain('booking_successes_total{flow="online"} 1');
  });
});
