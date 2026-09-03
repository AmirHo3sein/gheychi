import { assertProductionJwtSecret } from './jwt-secret.util';

describe('assertProductionJwtSecret', () => {
  const strong = 'a'.repeat(48);

  it('accepts any secret outside production (dev/test keep their short fixed secrets)', () => {
    expect(assertProductionJwtSecret('dev-secret-change-me', 'development')).toBe('dev-secret-change-me');
    expect(assertProductionJwtSecret('test-secret', 'test')).toBe('test-secret');
    expect(assertProductionJwtSecret('x', undefined)).toBe('x');
  });

  it('refuses the .env.example placeholder in production', () => {
    expect(() => assertProductionJwtSecret('dev-secret-change-me', 'production')).toThrow(/placeholder/);
  });

  it('refuses a short secret in production', () => {
    expect(() => assertProductionJwtSecret('short-but-not-a-placeholder', 'production')).toThrow(/placeholder/);
  });

  it('accepts a long, non-placeholder secret in production', () => {
    expect(assertProductionJwtSecret(strong, 'production')).toBe(strong);
  });
});
