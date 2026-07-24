import { describe, expect, it } from 'vitest'
import { renderMarkdown } from '../../app/utils/markdown'

describe('renderMarkdown (html:false invariant)', () => {
  // The article page ([slug].vue) renders its own page-level <h1> (the post title) above
  // this markdown body, so every rendered heading is demoted by one level to avoid a
  // duplicate <h1> -- see the comment on the `demote_headings` core rule in markdown.ts.
  it('demotes a top-level heading so the body never emits its own <h1>', () => {
    expect(renderMarkdown('# عنوان')).toContain('<h2>عنوان</h2>')
  })

  it('demotes nested heading levels by one, each capped at h6', () => {
    expect(renderMarkdown('## دو')).toContain('<h3>دو</h3>')
    expect(renderMarkdown('###### شش')).toContain('<h6>شش</h6>')
  })

  it('escapes a raw <script> payload instead of parsing it', () => {
    const out = renderMarkdown('<script>alert(1)</script>')
    expect(out).not.toContain('<script>')
    expect(out).toContain('&lt;script&gt;')
  })

  it('escapes a raw <img onerror> payload instead of parsing it', () => {
    const out = renderMarkdown('<img src=x onerror=alert(1)>')
    expect(out).not.toContain('<img')
    expect(out).toContain('&lt;img')
  })

  // Carry-forward from Task 9's quality review: linkified URLs render into the article
  // body via v-html later, so external links must not be able to hijack the tab via
  // window.opener. Same-window navigation is kept (no target=_blank) -- only rel is added.
  it('adds rel="noopener noreferrer" to linkified URLs', () => {
    const out = renderMarkdown('آدرس: https://example.com')
    expect(out).toContain('<a href="https://example.com" rel="noopener noreferrer">')
  })
})
