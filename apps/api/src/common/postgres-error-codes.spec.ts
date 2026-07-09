import { QueryFailedError } from 'typeorm';
import {
  FOREIGN_KEY_VIOLATION,
  isForeignKeyViolation,
  isUniqueViolation,
  UNIQUE_VIOLATION,
} from './postgres-error-codes';

function pgError(code: string): QueryFailedError {
  const driverError = Object.assign(new Error('db error'), { code });
  return new QueryFailedError('DELETE FROM service_categories WHERE id = $1', [1], driverError);
}

describe('postgres-error-codes', () => {
  it('exports the foreign-key violation code 23503', () => {
    expect(FOREIGN_KEY_VIOLATION).toBe('23503');
  });

  it('detects a QueryFailedError carrying the FK violation code', () => {
    expect(isForeignKeyViolation(pgError('23503'))).toBe(true);
  });

  it('rejects a QueryFailedError with a different code', () => {
    expect(isForeignKeyViolation(pgError('23505'))).toBe(false);
  });

  it('rejects values that are not QueryFailedErrors', () => {
    expect(isForeignKeyViolation(new Error('boom'))).toBe(false);
    expect(isForeignKeyViolation(undefined)).toBe(false);
    expect(isForeignKeyViolation({ code: '23503' })).toBe(false);
  });

  it('keeps the existing unique-violation helper intact', () => {
    expect(UNIQUE_VIOLATION).toBe('23505');
    expect(isUniqueViolation(pgError('23505'))).toBe(true);
    expect(isUniqueViolation(pgError('23503'))).toBe(false);
  });
});
