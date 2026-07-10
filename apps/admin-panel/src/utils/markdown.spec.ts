// apps/admin-panel/src/utils/markdown.spec.ts
import { describe, expect, it } from 'vitest'
import { renderMarkdown } from './markdown'

describe('renderMarkdown', () => {
  // Invariant pinning the html:false config: raw HTML in the Markdown source must come
  // out as escaped text, never live markup. The editor preview binds this output with
  // v-html on the strength of these two tests -- do not weaken them.
  it('escapes a raw <script> tag instead of parsing it', () => {
    const out = renderMarkdown('<script>alert(1)</script>')
    expect(out).not.toContain('<script>')
    expect(out).toContain('&lt;script&gt;')
  })

  it('keeps a raw <img onerror> payload inert', () => {
    const out = renderMarkdown('<img src=x onerror=alert(1)>')
    expect(out).not.toContain('<img')
    expect(out).toContain('&lt;img')
  })

  it('still renders actual Markdown', () => {
    const out = renderMarkdown('# عنوان\n\nمتن **مهم**')
    expect(out).toContain('<h1>عنوان</h1>')
    expect(out).toContain('<strong>مهم</strong>')
  })

  it('linkifies bare URLs', () => {
    expect(renderMarkdown('آدرس: https://example.com')).toContain('<a href="https://example.com"')
  })

  it('adds rel="noopener noreferrer" to every rendered link', () => {
    expect(renderMarkdown('آدرس: https://example.com')).toContain('rel="noopener noreferrer"')
    expect(renderMarkdown('[پیوند](https://example.com)')).toContain('rel="noopener noreferrer"')
  })
})
