import { ConfigService } from '@nestjs/config';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { BackupReportSecretGuard } from './backup-report-secret.guard';

function mockContext(headers: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  } as unknown as ExecutionContext;
}

function guardWithSecret(secret: string): BackupReportSecretGuard {
  const config = { getOrThrow: jest.fn().mockReturnValue(secret) } as unknown as ConfigService;
  return new BackupReportSecretGuard(config);
}

describe('BackupReportSecretGuard', () => {
  it('accepts a request whose x-backup-report-secret header matches exactly', () => {
    const guard = guardWithSecret('correct-secret');
    expect(guard.canActivate(mockContext({ 'x-backup-report-secret': 'correct-secret' }))).toBe(true);
  });

  it('rejects a wrong secret with UnauthorizedException', () => {
    const guard = guardWithSecret('correct-secret');
    expect(() => guard.canActivate(mockContext({ 'x-backup-report-secret': 'wrong-secret' }))).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a request with no header at all', () => {
    const guard = guardWithSecret('correct-secret');
    expect(() => guard.canActivate(mockContext({}))).toThrow(UnauthorizedException);
  });

  it('rejects an empty-string header', () => {
    const guard = guardWithSecret('correct-secret');
    expect(() => guard.canActivate(mockContext({ 'x-backup-report-secret': '' }))).toThrow(UnauthorizedException);
  });

  // Node/Express represents a duplicated header as a string[] -- must be rejected, not
  // passed into the hash comparison (which would throw a raw TypeError instead of the
  // intended 401).
  it('rejects a duplicated header (array value) without throwing an unrelated error', () => {
    const guard = guardWithSecret('correct-secret');
    expect(() => guard.canActivate(mockContext({ 'x-backup-report-secret': ['a', 'b'] }))).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a secret that only differs in length from the correct one (no length-based bypass)', () => {
    const guard = guardWithSecret('correct-secret');
    expect(() => guard.canActivate(mockContext({ 'x-backup-report-secret': 'correct-secret-but-longer' }))).toThrow(
      UnauthorizedException,
    );
    expect(() => guard.canActivate(mockContext({ 'x-backup-report-secret': 'short' }))).toThrow(
      UnauthorizedException,
    );
  });

  it('is case-sensitive', () => {
    const guard = guardWithSecret('Correct-Secret');
    expect(() => guard.canActivate(mockContext({ 'x-backup-report-secret': 'correct-secret' }))).toThrow(
      UnauthorizedException,
    );
  });
});
