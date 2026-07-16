import { describe, it, expect } from 'vitest'
import { markdownToPlainText, resolveBlogDescription } from '../../app/utils/markdown-excerpt'

describe('markdownToPlainText', () => {
  it('strips markdown syntax: headings, emphasis, links keep text, images and fences drop', () => {
    const src = [
      '## شستشوی درست',
      '',
      'متن **مهم** با *تاکید* و `کد` و [پیوند مفید](https://example.com).',
      '',
      '![توضیح تصویر](https://example.com/x.jpg)',
      '',
      '```js',
      'console.log("dropped")',
      '```',
      '',
      '> نقل قول',
      '- مورد اول',
      '1. مورد دوم',
      '---',
    ].join('\n')

    expect(markdownToPlainText(src)).toBe(
      'شستشوی درست متن مهم با تاکید و کد و پیوند مفید. نقل قول مورد اول مورد دوم',
    )
  })

  it('strips angle brackets so raw HTML in the source never reaches the meta tag', () => {
    expect(markdownToPlainText('قبل <script>alert(1)</script> بعد')).toBe(
      'قبل script alert(1) /script بعد',
    )
  })

  it('collapses newlines and repeated whitespace to single spaces', () => {
    expect(markdownToPlainText('سطر اول\n\n\nسطر   دوم\t\tادامه')).toBe('سطر اول سطر دوم ادامه')
  })

  it('returns an empty string for effectively-empty input', () => {
    expect(markdownToPlainText('')).toBe('')
    expect(markdownToPlainText('   \n\n\t ')).toBe('')
    expect(markdownToPlainText('```\nonly code\n```')).toBe('')
  })

  it('returns short input unchanged, with no ellipsis', () => {
    expect(markdownToPlainText('متن کوتاه', 160)).toBe('متن کوتاه')
  })

  it('truncates Persian text on a word boundary and appends an ellipsis', () => {
    // 15 code points; the 10-point window ends exactly after "دنیای", so points[10] is the
    // following space and the no-back-off branch (points[maxLength] === ' ') is exercised.
    expect(markdownToPlainText('سلام دنیای زیبا', 10)).toBe('سلام دنیای…')
  })

  it('counts code points, not UTF-16 units, so surrogate pairs never split', () => {
    // '𐍈' is an astral character (2 UTF-16 units each); a naive .slice(0, 3) would cut
    // through the middle of the second pair.
    expect(markdownToPlainText('𐍈𐍈𐍈𐍈𐍈', 3)).toBe('𐍈𐍈𐍈…')
  })

  it('drops tilde fences like backtick fences, leaving no stray tildes behind', () => {
    expect(markdownToPlainText('متن\n\n~~~\nconsole.log("x")\n~~~\n\nپایان')).toBe('متن پایان')
  })

  it('an unterminated fence drops to the end of the input, as the renderer treats it', () => {
    expect(markdownToPlainText('متن\n\n```\nconsole.log("x")')).toBe('متن')
    expect(markdownToPlainText('متن\n\n~~~\nconsole.log("x")')).toBe('متن')
  })

  it('still strips ~~strikethrough~~ markers, keeping the text between them', () => {
    expect(markdownToPlainText('متن ~~حذف‌شده~~ ادامه')).toBe('متن حذف‌شده ادامه')
  })

  it('drops indented code blocks (4 spaces or a tab)', () => {
    expect(markdownToPlainText('متن اول\n\n    secret_code_line\n\nمتن دوم')).toBe(
      'متن اول متن دوم',
    )
    expect(markdownToPlainText('متن اول\n\n\tsecret_code_line\n\nمتن دوم')).toBe(
      'متن اول متن دوم',
    )
  })

  it('reference-style links keep only their text and definition lines drop entirely', () => {
    expect(
      markdownToPlainText('این [متن پیوند][ref] است.\n\n[ref]: https://example.com/page'),
    ).toBe('این متن پیوند است.')
  })

  it('handles collapsed reference links ([text][])', () => {
    expect(
      markdownToPlainText('[پیوند مفید][] در متن\n\n[پیوند مفید]: https://example.com'),
    ).toBe('پیوند مفید در متن')
  })

  it('tables keep their cell text but drop delimiter rows and pipe characters', () => {
    const src = ['| ستون یک | ستون دو |', '|---|---|', '| الف | ب |'].join('\n')
    expect(markdownToPlainText(src)).toBe('ستون یک ستون دو الف ب')
  })

  it('drops setext heading underlines (=== / ---) but keeps the heading text', () => {
    expect(markdownToPlainText('عنوان اول\n===\n\nمتن\n\nعنوان دوم\n---\nادامه')).toBe(
      'عنوان اول متن عنوان دوم ادامه',
    )
  })

  it('decodes common HTML entities to match the text readers see in the article', () => {
    expect(markdownToPlainText('&laquo;ویژه&raquo; &amp; متن')).toBe('«ویژه» & متن')
    expect(markdownToPlainText('نیم&zwnj;فاصله و &quot;نقل&quot;')).toBe('نیم‌فاصله و "نقل"')
  })

  it('decodes numeric entities and strips unrecognized or invalid ones', () => {
    expect(markdownToPlainText('متن&#8230; و &#x62;')).toBe('متن… و b')
    expect(markdownToPlainText('قبل &nosuch; بعد')).toBe('قبل بعد')
  })

  it('sweeps entity-encoded angle brackets like literal ones', () => {
    expect(markdownToPlainText('قبل &lt;b&gt;تاکید&lt;/b&gt; بعد')).toBe('قبل b تاکید /b بعد')
  })
})

describe('resolveBlogDescription', () => {
  it('prefers the explicit SEO override over everything', () => {
    expect(resolveBlogDescription('توضیح سئو', 'خلاصه', '# بدنه')).toBe('توضیح سئو')
  })

  it('falls back to the excerpt when there is no override', () => {
    expect(resolveBlogDescription(null, 'خلاصه', '# بدنه')).toBe('خلاصه')
  })

  it('derives from the body when both override and excerpt are null', () => {
    expect(resolveBlogDescription(null, null, '## عنوان\n\nمتن **مقاله**')).toBe('عنوان متن مقاله')
  })

  it('returns undefined for an effectively-empty body so no empty tag is emitted', () => {
    expect(resolveBlogDescription(null, null, '')).toBeUndefined()
    expect(resolveBlogDescription(null, null, '```\ncode only\n```')).toBeUndefined()
  })
})
