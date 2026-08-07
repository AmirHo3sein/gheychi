import { makeSlug } from './slug.util';

describe('makeSlug', () => {
  it('slugifies latin names and appends a 4-hex suffix', () => {
    const slug = makeSlug('VIP Beauty Salon');
    expect(slug).toMatch(/^vip-beauty-salon-[0-9a-f]{4}$/);
  });

  it('ignores the fallback prefix when the name slugifies cleanly', () => {
    const slug = makeSlug('Hair Color Guide', 'post');
    expect(slug).toMatch(/^hair-color-guide-[0-9a-f]{4}$/);
  });

  it('generates unique slugs for the same name', () => {
    expect(makeSlug('Rose')).not.toBe(makeSlug('Rose'));
  });

  describe('Persian transliteration (readable slugs, not an opaque hex fallback)', () => {
    it('transliterates a Persian salon name into a readable Latin slug', () => {
      // آرایشگاه رز طلایی ("Golden Rose Beauty Salon") -- every letter transliterates
      // character-for-character (آ=a ر=r ا=a ی=y ش=sh گ=g ا=a ه=h -> "arayshgah"; ط=t ل=l
      // ا=a and the double-ye یی -> "yi" -> "tlayi"). رز ("rose", a loanword written with
      // no vowel letter at all in Persian orthography) transliterates to "rz" rather than
      // the phonetic "roz" -- Persian script omits short vowels entirely, so recovering
      // one that was never written is not achievable from the text alone without a
      // pronunciation dictionary. Documented directly in slug.util.ts.
      const slug = makeSlug('آرایشگاه رز طلایی');
      expect(slug).toMatch(/^arayshgah-rz-tlayi-[0-9a-f]{4}$/);
    });

    it('renders the common Persian "-یی" (double-ye) adjectival ending as "-yi", not "-yy"', () => {
      // زیبایی ("beauty") -- ز-ی-ب-ا-ی-ی -> z,y,b,a,[یی -> yi] -> "zybayi".
      const slug = makeSlug('زیبایی');
      expect(slug).toMatch(/^zybayi-[0-9a-f]{4}$/);
    });

    it('normalizes Persian and Arabic-Indic digits to ASCII digits', () => {
      const slug = makeSlug('سالن ۱۲۳');
      expect(slug).toMatch(/^saln-123-[0-9a-f]{4}$/);
    });

    it('produces a stable, non-random base across calls for the same Persian name (only the suffix varies)', () => {
      const first = makeSlug('سالن زیبایی رز');
      const second = makeSlug('سالن زیبایی رز');
      const base = (s: string) => s.replace(/-[0-9a-f]{4}$/, '');
      expect(base(first)).toBe(base(second));
      expect(first).not.toBe(second);
    });

    it('still falls back to the hex-only slug for input with no translatable/latin/digit characters at all', () => {
      const slug = makeSlug('🎀🎀🎀');
      expect(slug).toMatch(/^salon-[0-9a-f]{8}$/);
    });

    it('uses a custom fallback prefix when the untranslatable-input fallback applies', () => {
      const slug = makeSlug('!!!', 'post');
      expect(slug).toMatch(/^post-[0-9a-f]{8}$/);
    });

    it('handles a mixed Persian + English + digits name in one pass', () => {
      const slug = makeSlug('سالن VIP 2026');
      expect(slug).toMatch(/^saln-vip-2026-[0-9a-f]{4}$/);
    });
  });
});
