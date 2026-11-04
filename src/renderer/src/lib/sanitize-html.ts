import DOMPurify from 'dompurify'

/**
 * Prepares an HTML message for display. Defence in depth:
 * 1. DOMPurify removes scripts, event handlers, forms, frames and the like.
 * 2. The result goes into an iframe with `sandbox` (no scripts, no same-origin access).
 * 3. A Content-Security-Policy inside that frame blocks every remote request,
 *    so tracking pixels and remote images stay off until the user allows them.
 */

const FORBID_TAGS = [
  'script',
  'noscript',
  'form',
  'input',
  'button',
  'select',
  'option',
  'textarea',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'base',
  'meta',
  'link',
  'audio',
  'video',
  'source',
  'track',
  'portal',
  'svg',
  'math',
  'template',
  'dialog',
]

const REMOTE_URL = /^\s*(https?:)?\/\//i
const REMOTE_IN_CSS = /(url\(|@import)\s*['"]?\s*(https?:)?\/\//i
const CSS_ESCAPE = /\\([0-9a-f]{1,6})\s?|\\([^\n])/gi
const CSS_COMMENT = /\/\*[\s\S]*?\*\//g

/** CSS as the browser reads it: escapes like `h\74 tps` decoded, comments removed. */
export function normalizeCss(css: string): string {
  return css
    .replace(CSS_ESCAPE, (_, hex: string | undefined, char: string | undefined) => {
      if (char !== undefined) return char
      const code = parseInt(hex ?? '', 16)
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '\ufffd'
    })
    .replace(CSS_COMMENT, '')
}

const cssIsRemote = (css: string) => REMOTE_IN_CSS.test(normalizeCss(css))
const URL_ATTRIBUTES = ['src', 'srcset', 'background', 'poster']

/** Neutral defaults, white like paper: most HTML mail is designed for a white background. */
const BASE_CSS = `
:root { color-scheme: light; }
html, body { margin: 0; background: #fff; color: #1b1e22; }
body { padding: 20px 28px 32px; font: 15px/1.55 -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif; overflow-wrap: anywhere; }
img { max-width: 100%; height: auto; }
table { max-width: 100%; }
a { color: #1e6b73; }
blockquote { margin: 0 0 0 0.4em; padding-left: 0.9em; border-left: 2px solid #d5dadd; color: #4a5158; }
`

export interface PreparedHtml {
  /** A complete document for the iframe's srcdoc. */
  srcdoc: string
  /** True if the message refers to remote images or styles that are currently blocked. */
  hasRemoteContent: boolean
}

function contentSecurityPolicy(allowRemoteImages: boolean): string {
  return [
    "default-src 'none'",
    `img-src data:${allowRemoteImages ? ' https: http:' : ''}`,
    "style-src 'unsafe-inline'",
    'font-src data:',
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ')
}

function refersToRemoteContent(root: Element): boolean {
  for (const element of root.querySelectorAll('*')) {
    for (const name of URL_ATTRIBUTES) {
      const value = element.getAttribute(name)
      if (value && value.split(',').some((part) => REMOTE_URL.test(part))) return true
    }
    if (cssIsRemote(element.getAttribute('style') ?? '')) return true
    if (element.tagName === 'STYLE' && cssIsRemote(element.textContent ?? '')) return true
  }
  return false
}

export function prepareHtml(
  html: string,
  options: { allowRemoteImages: boolean; window?: Window & typeof globalThis },
): PreparedHtml {
  const purify = DOMPurify(options.window ?? window)
  purify.addHook('afterSanitizeAttributes', (node) => {
    // Links open in the default browser (via the main process), never inside the app.
    if (node.tagName === 'A' && node.hasAttribute('href')) {
      node.setAttribute('target', '_blank')
      node.setAttribute('rel', 'noopener noreferrer')
    }
  })
  // With WHOLE_DOCUMENT and RETURN_DOM, DOMPurify returns the <html> element.
  const root = purify.sanitize(html, {
    WHOLE_DOCUMENT: true,
    RETURN_DOM: true,
    FORBID_TAGS,
    FORBID_ATTR: ['autofocus', 'formaction', 'ping'],
  }) as unknown as HTMLElement

  const head = root.querySelector('head')
  const body = root.querySelector('body') ?? root
  const headStyles = head
    ? [...head.querySelectorAll('style')].map((s) => s.outerHTML).join('\n')
    : ''
  const hasRemoteContent = refersToRemoteContent(root)

  const srcdoc = `<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy(options.allowRemoteImages)}">
<base target="_blank">
<style>${BASE_CSS}</style>
${headStyles}
</head><body>${body.innerHTML}</body></html>`

  return { srcdoc, hasRemoteContent }
}

export interface TextSegment {
  type: 'text' | 'link'
  value: string
}

const URL_IN_TEXT = /\bhttps?:\/\/[^\s<>"')\]]+[^\s<>"')\].,;:!?]/gi

/** Splits plain text into text and link segments, so web addresses become clickable. */
export function linkify(text: string): TextSegment[] {
  const segments: TextSegment[] = []
  let last = 0
  for (const match of text.matchAll(URL_IN_TEXT)) {
    const start = match.index ?? 0
    if (start > last) segments.push({ type: 'text', value: text.slice(last, start) })
    segments.push({ type: 'link', value: match[0] })
    last = start + match[0].length
  }
  if (last < text.length) segments.push({ type: 'text', value: text.slice(last) })
  return segments
}

export interface TextBlock {
  quoted: boolean
  text: string
}

/** Groups plain text into runs of normal and quoted ("> ") lines; quote markers are removed. */
export function splitQuotes(text: string): TextBlock[] {
  const blocks: TextBlock[] = []
  for (const line of text.split('\n')) {
    const quoted = /^\s*>/.test(line)
    const content = quoted ? line.replace(/^\s*>\s?/, '') : line
    const last = blocks.at(-1)
    if (last && last.quoted === quoted) last.text += `\n${content}`
    else blocks.push({ quoted, text: content })
  }
  return blocks
}
