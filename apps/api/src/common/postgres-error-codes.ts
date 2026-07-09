import { QueryFailedError } from 'typeorm';

/** Postgres error codes referenced when translating `QueryFailedError`s into clean HTTP responses. */
export const UNIQUE_VIOLATION = '23505';

export function isUniqueViolation(err: unknown): boolean {
  return err instanceof QueryFailedError && (err as unknown as { code?: string }).code === UNIQUE_VIOLATION;
}

export const FOREIGN_KEY_VIOLATION = '23503';

export function isForeignKeyViolation(err: unknown): boolean {
  return err instanceof QueryFailedError && (err as unknown as { code?: string }).code === FOREIGN_KEY_VIOLATION;
}
