import { randomBytes } from 'crypto';

// Deterministic Perso-Arabic -> Latin character transliteration, used so a Persian salon/
// post name produces a readable slug ("arayeshgah-roz-talayi") instead of an opaque
// "salon-a81f29cd" fallback. This is a CHARACTER-level transliteration, not full phonetic
// grapheme-to-phoneme conversion: Persian orthography omits short vowels entirely, so a
// word whose pronunciation depends on an unwritten vowel (e.g. "رز" /roz/, a loanword
// written with no vowel letter at all) cannot be recovered from the text alone without a
// pronunciation dictionary, which is out of scope here. What IS handled: every standard
// Persian letter maps to its conventional Latin equivalent, Persian/Arabic-Indic digits
// become ASCII digits, and the extremely common word-final "یی" (double ye, the "-yi"/
// "-i" adjectival ending seen in e.g. "طلایی" -> "talayi", "زیبایی" -> "zibayi") is handled
// specially since a naive per-character map would otherwise render it "yy".
const PERSIAN_TO_LATIN: Record<string, string> = {
  'آ': 'a', 'أ': 'a', 'إ': 'a', 'ا': 'a',
  'ب': 'b', 'پ': 'p', 'ت': 't', 'ث': 's',
  'ج': 'j', 'چ': 'ch', 'ح': 'h', 'خ': 'kh',
  'د': 'd', 'ذ': 'z', 'ر': 'r', 'ز': 'z', 'ژ': 'zh',
  'س': 's', 'ش': 'sh', 'ص': 's', 'ض': 'z',
  'ط': 't', 'ظ': 'z', 'ع': 'a', 'غ': 'gh',
  'ف': 'f', 'ق': 'gh', 'ک': 'k', 'گ': 'g',
  'ل': 'l', 'م': 'm', 'ن': 'n', 'و': 'v',
  'ه': 'h', 'ة': 'h', 'ی': 'y', 'ي': 'y', 'ئ': 'y', 'ء': '',
  // Persian/Arabic-Indic digits -> ASCII digits (same normalization
  // apps/*/src/utils/digits.ts's toEnglishDigits() does for phone numbers).
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
};

// Arabic diacritics (tashkeel) and the tatweel elongation character carry no independent
// sound of their own and would otherwise transliterate to stray '?'/'-' noise -- stripped
// outright rather than mapped.
const DIACRITICS_PATTERN = /[ً-ٰٟـ]/g;

function transliteratePersian(input: string): string {
  const stripped = input.replace(DIACRITICS_PATTERN, '');
  let out = '';
  for (let i = 0; i < stripped.length; i++) {
    const ch = stripped[i]!;
    if ((ch === 'ی' || ch === 'ي') && (stripped[i + 1] === 'ی' || stripped[i + 1] === 'ي')) {
      // Word-final double-ye ("-یی"): the adjectival/nisba "-yi" ending, not two
      // consonantal "y" sounds -- render as "yi", consume both source characters.
      out += 'yi';
      i += 1;
      continue;
    }
    out += PERSIAN_TO_LATIN[ch] ?? ch;
  }
  return out;
}

/**
 * Slugifies `name` and appends a random hex suffix for uniqueness. Persian text is
 * transliterated to Latin first (see transliteratePersian above) so it contributes real,
 * readable words to the slug instead of being stripped to nothing; a name already in
 * English/Latin passes through this step unchanged. Falls back to `${fallbackPrefix}-
 * <8-hex>` only when the input has no translatable/latin/digit characters at all (e.g.
 * pure emoji or punctuation), since the stripped base would otherwise be too short
 * (<3 chars) to form a useful slug.
 */
export function makeSlug(name: string, fallbackPrefix = 'salon'): string {
  const base = transliteratePersian(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (base.length < 3) return `${fallbackPrefix}-${randomBytes(4).toString('hex')}`;
  return `${base}-${randomBytes(2).toString('hex')}`;
}
