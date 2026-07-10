// apps/admin-panel/src/utils/markdown.ts
// html:false is THE security boundary for the blog editor preview: raw HTML in the
// Markdown source is escaped, never parsed, so the preview may bind the output with
// v-html. Pinned by markdown.spec.ts -- never enable html here.
import MarkdownIt from 'markdown-it'

const md = new MarkdownIt({ html: false, linkify: true })

export function renderMarkdown(src: string): string {
  return md.render(src)
}
