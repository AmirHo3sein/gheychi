// apps/admin-panel/src/utils/markdown.ts
// html:false is THE security boundary for the blog editor preview: raw HTML in the
// Markdown source is escaped, never parsed, so the preview may bind the output with
// v-html. Pinned by markdown.spec.ts -- never enable html here.
import MarkdownIt from 'markdown-it'

const md = new MarkdownIt({ html: false, linkify: true })

// Same hardening as the user-app's copy: every rendered link gains rel="noopener noreferrer"
// so a previewed link to an untrusted page can't repoint window.opener (reverse tabnabbing).
// Navigation stays same-window on purpose -- no target=_blank. Pinned by markdown.spec.ts.
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
