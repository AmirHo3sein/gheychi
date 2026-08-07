import { bigintToNumber, nullableBigintToNumber, nullableNumericToNumber, numericToNumber } from './numeric-transformers';

describe('bigintToNumber', () => {
  it('coerces the string pg returns for a bigint column into a number on read', () => {
    expect(bigintToNumber.from('150000')).toBe(150000);
  });

  it('passes a number straight through on write (TypeORM sends the JS value to pg as-is)', () => {
    expect(bigintToNumber.to(150000)).toBe(150000);
  });
});

describe('nullableBigintToNumber', () => {
  it('coerces a non-null string to a number', () => {
    expect(nullableBigintToNumber.from('42')).toBe(42);
  });

  it('passes null straight through instead of coercing it to 0', () => {
    expect(nullableBigintToNumber.from(null)).toBeNull();
  });
});

describe('numericToNumber', () => {
  it('coerces the string pg returns for a numeric column into a number on read', () => {
    expect(numericToNumber.from('12.50')).toBe(12.5);
  });
});

describe('nullableNumericToNumber', () => {
  it('coerces a non-null numeric string to a number', () => {
    expect(nullableNumericToNumber.from('99.99')).toBe(99.99);
  });

  it('passes null straight through', () => {
    expect(nullableNumericToNumber.from(null)).toBeNull();
  });
});
