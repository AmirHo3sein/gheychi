import { requestContextStorage } from './request-context';
import { RequestContextConsoleLogger } from './request-context-logger.service';

describe('RequestContextConsoleLogger', () => {
  it('prefixes formatted log lines with the current request id', () => {
    const logger = new RequestContextConsoleLogger('TestCtx', { colors: false, timestamp: false });

    let formatted = '';
    requestContextStorage.run({ requestId: 'rid-1' }, () => {
      // formatMessage is protected -- called the same way ConsoleLogger's own
      // printMessages() calls it internally; exercised directly here to pin the
      // exact prefix shape without depending on stdout/TTY color detection.
      formatted = (logger as unknown as { formatMessage: (...args: unknown[]) => string }).formatMessage(
        'log',
        'hello',
        '[Nest] 1  - ',
        '    LOG',
        '[TestCtx] ',
        '',
      );
    });

    expect(formatted.startsWith('[rid:rid-1] ')).toBe(true);
    expect(formatted).toContain('hello');
  });

  it('does not add a prefix when there is no active request context (e.g. a cron job log)', () => {
    const logger = new RequestContextConsoleLogger('TestCtx', { colors: false, timestamp: false });

    const formatted = (logger as unknown as { formatMessage: (...args: unknown[]) => string }).formatMessage(
      'log',
      'hello',
      '[Nest] 1  - ',
      '    LOG',
      '[TestCtx] ',
      '',
    );

    expect(formatted.startsWith('[rid:')).toBe(false);
    expect(formatted).toContain('hello');
  });

  it('adds a requestId field to the json log object when json logging is enabled', () => {
    const logger = new RequestContextConsoleLogger('TestCtx', { json: true });

    let jsonObject: Record<string, unknown> = {};
    requestContextStorage.run({ requestId: 'rid-json' }, () => {
      jsonObject = (
        logger as unknown as { getJsonLogObject: (...args: unknown[]) => Record<string, unknown> }
      ).getJsonLogObject('hello', { context: 'TestCtx', logLevel: 'log' });
    });

    expect(jsonObject.requestId).toBe('rid-json');
  });

  it('does not add a requestId field to the json log object outside a request context', () => {
    const logger = new RequestContextConsoleLogger('TestCtx', { json: true });

    const jsonObject = (
      logger as unknown as { getJsonLogObject: (...args: unknown[]) => Record<string, unknown> }
    ).getJsonLogObject('hello', { context: 'TestCtx', logLevel: 'log' });

    expect(jsonObject.requestId).toBeUndefined();
  });

  it('end-to-end: a logger.log() call made inside the request context writes a line containing the request id', () => {
    const logger = new RequestContextConsoleLogger('TestCtx', { colors: false, timestamp: false });
    const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

    requestContextStorage.run({ requestId: 'rid-e2e' }, () => {
      logger.log('processing booking');
    });

    expect(writeSpy).toHaveBeenCalledTimes(1);
    expect(writeSpy.mock.calls[0]![0]).toContain('[rid:rid-e2e]');
    expect(writeSpy.mock.calls[0]![0]).toContain('processing booking');

    writeSpy.mockRestore();
  });

  it('end-to-end: a logger.log() call made outside any request context writes a line with no rid prefix', () => {
    const logger = new RequestContextConsoleLogger('TestCtx', { colors: false, timestamp: false });
    const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

    logger.log('cron tick');

    expect(writeSpy).toHaveBeenCalledTimes(1);
    expect(writeSpy.mock.calls[0]![0]).not.toContain('[rid:');
    expect(writeSpy.mock.calls[0]![0]).toContain('cron tick');

    writeSpy.mockRestore();
  });
});
