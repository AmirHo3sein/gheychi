import { Logger } from '@nestjs/common';
import { CspReportController } from './csp-report.controller';
import { MetricsService } from '../metrics/metrics.service';

describe('CspReportController', () => {
  let metrics: { observeCspViolation: jest.Mock };
  let controller: CspReportController;

  beforeEach(() => {
    metrics = { observeCspViolation: jest.fn() };
    controller = new CspReportController(metrics as unknown as MetricsService);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('extracts violated-directive from a standard csp-report body and records the metric', () => {
    controller.report({
      'csp-report': {
        'document-uri': 'https://gheychi.co/',
        'violated-directive': 'script-src',
        'blocked-uri': 'https://evil.example/x.js',
      },
    });

    expect(metrics.observeCspViolation).toHaveBeenCalledWith('script-src');
  });

  it('falls back to effective-directive when violated-directive is absent', () => {
    controller.report({
      'csp-report': {
        'effective-directive': 'img-src',
      },
    });

    expect(metrics.observeCspViolation).toHaveBeenCalledWith('img-src');
  });

  it('records "unknown" when the body has neither field', () => {
    controller.report({ 'csp-report': {} });

    expect(metrics.observeCspViolation).toHaveBeenCalledWith('unknown');
  });

  it('does not throw on a malformed/unexpected body shape, and still records "unknown"', () => {
    expect(() => controller.report('not an object')).not.toThrow();
    expect(metrics.observeCspViolation).toHaveBeenCalledWith('unknown');

    expect(() => controller.report(null)).not.toThrow();
    expect(() => controller.report(undefined)).not.toThrow();
    expect(() => controller.report({ unrelated: true })).not.toThrow();
  });

  it('logs the raw report for triage', () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn');
    controller.report({ 'csp-report': { 'violated-directive': 'style-src' } });

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('style-src'));
  });
});
