import { escapeLikePattern, likeContains } from './like-pattern';

describe('escapeLikePattern', () => {
  it('leaves ordinary text (including Persian) untouched', () => {
    expect(escapeLikePattern('مریم')).toBe('مریم');
    expect(escapeLikePattern('09121234567')).toBe('09121234567');
  });

  it('escapes the multi-character wildcard so a bare % is a literal, not "match everything"', () => {
    expect(escapeLikePattern('%')).toBe('\\%');
    expect(escapeLikePattern('10%')).toBe('10\\%');
  });

  it('escapes the single-character wildcard', () => {
    expect(escapeLikePattern('09_2')).toBe('09\\_2');
  });

  it("escapes LIKE's own escape character, so a trailing backslash can't produce an invalid pattern", () => {
    expect(escapeLikePattern('a\\')).toBe('a\\\\');
    // Escaping the backslash FIRST matters: a naive replace order would turn `\%` into
    // `\\\%`-with-the-wrong-grouping and change what the pattern means.
    expect(escapeLikePattern('\\%')).toBe('\\\\\\%');
  });

  it('escapes every occurrence, not just the first', () => {
    expect(escapeLikePattern('%a%b%')).toBe('\\%a\\%b\\%');
  });
});

describe('likeContains', () => {
  it('wraps the escaped value in unescaped wildcards -- the only two that stay meaningful', () => {
    expect(likeContains('علی')).toBe('%علی%');
    expect(likeContains('50%')).toBe('%50\\%%');
  });
});
