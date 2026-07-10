import MarkdownIt from 'markdown-it'

// html:false is the entire XSS story for blog content: raw HTML in the markdown source is
// escaped as text and never parses, which is what makes binding the output with v-html safe.
// Pinned by test/unit/markdown.spec.ts -- do not enable html without revisiting every v-html
// call site. Kept as the user-app's own copy (identical config to the admin panel's) per the
// cross-app isolation convention.
const md = new MarkdownIt({ html: false, linkify: true })

// Linkified URLs render into the article body via v-html, so every link gains
// rel="noopener noreferrer" to prevent a reverse-tabnabbing window.opener handoff.
// Navigation stays same-window on purpose -- no target=_blank is added. The admin panel's
// copy carries the same rule. Pinned by test/unit/markdown.spec.ts.
const defaultLinkOpenRenderer =
  md.renderer.rules.link_open ??
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))

md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx]!
  token.attrSet('rel', 'noopener noreferrer')
  return defaultLinkOpenRenderer(tokens, idx, options, env, self)
}

export function renderMarkdown(src: string): string {
  return md.render(src)
}
