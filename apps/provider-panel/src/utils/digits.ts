const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹'
const ARABIC_INDIC_DIGITS = '٠١٢٣٤٥٦٧٨٩'

// Iranian keyboards/IMEs commonly default to Persian (or Arabic-Indic) numerals -- a phone
// number typed that way reads correctly on screen but fails IRAN_MOBILE's /^09\d{9}$/ check
// both client- and server-side, since \d only matches ASCII 0-9. Normalizing at the point of
// entry means every downstream consumer (the API call, any echoed display) sees plain ASCII
// regardless of which numeral set the user actually typed.
export function toEnglishDigits(value: string): string {
  return value.replace(/[۰-۹٠-٩]/g, (ch) => {
    const persianIndex = PERSIAN_DIGITS.indexOf(ch)
    return String(persianIndex !== -1 ? persianIndex : ARABIC_INDIC_DIGITS.indexOf(ch))
  })
}
