// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { linkify, prepareHtml, splitQuotes } from './sanitize-html'

function prepare(html: string, allowRemoteImages = false) {
  return prepareHtml(html, { allowRemoteImages })
}

function bodyOf(srcdoc: string): Document {
  return new DOMParser().parseFromString(srcdoc, 'text/html')
}

describe('prepareHtml', () => {
  it('removes scripts, event handlers, forms and frames', () => {
    const { srcdoc } = prepare(`
      <p onclick="steal()">Hello</p>
      <script>alert(1)</script>
      <img src="data:image/png;base64,AAAA" onerror="steal()">
      <form action="https://evil.example"><input name="password"></form>
      <iframe src="https://evil.example"></iframe>
      <a href="javascript:steal()">click</a>
      <object data="x.swf"></object>
    `)
    const doc = bodyOf(srcdoc)
    expect(srcdoc).not.toMatch(
      /<script>alert|onclick|onerror|<form|<input|evil\.example|javascript:|<object/i,
    )
    expect(doc.querySelector('p')?.textContent).toBe('Hello')
    expect(doc.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,AAAA')
  })

  it('keeps the message styles, from head and body', () => {
    const { srcdoc } = prepare(
      '<html><head><style>.brand { color: red }</style></head><body><style>p { margin: 0 }</style><p class="brand">Hi</p></body></html>',
    )
    expect(srcdoc).toContain('.brand { color: red }')
    expect(srcdoc).toContain('p { margin: 0 }')
  })

  it('makes links open outside the app', () => {
    const doc = bodyOf(prepare('<a href="https://example.org/page">Read more</a>').srcdoc)
    const link = doc.querySelector('body a')!
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('blocks remote content by default and says so', () => {
    const prepared = prepare('<p>Hi</p><img src="https://tracker.example/pixel.gif" width="1">')
    expect(prepared.hasRemoteContent).toBe(true)
    const csp = bodyOf(prepared.srcdoc).querySelector('meta[http-equiv="Content-Security-Policy"]')!
    expect(csp.getAttribute('content')).toContain("default-src 'none'")
    expect(csp.getAttribute('content')).toContain('img-src data:;')
  })

  it('allows remote images only when asked to', () => {
    const csp = bodyOf(prepare('<img src="https://example.org/logo.png">', true).srcdoc)
      .querySelector('meta[http-equiv="Content-Security-Policy"]')!
      .getAttribute('content')
    expect(csp).toContain('img-src data: https: http:')
    expect(csp).toContain("default-src 'none'")
  })

  it('finds remote content in CSS and srcset, and none in a self-contained message', () => {
    expect(
      prepare('<div style="background:url(https://x.example/bg.png)">x</div>').hasRemoteContent,
    ).toBe(true)
    expect(
      prepare('<style>body{background:url("//x.example/a.png")}</style>').hasRemoteContent,
    ).toBe(true)
    expect(prepare('<img srcset="a.png 1x, https://x.example/b.png 2x">').hasRemoteContent).toBe(
      true,
    )
    expect(
      prepare('<p>Plain <b>HTML</b></p><img src="data:image/png;base64,AAAA">').hasRemoteContent,
    ).toBe(false)
  })
})

describe('linkify', () => {
  it('turns web addresses into links and leaves the rest as text', () => {
    expect(linkify('See https://example.org/a?b=1. Thanks')).toEqual([
      { type: 'text', value: 'See ' },
      { type: 'link', value: 'https://example.org/a?b=1' },
      { type: 'text', value: '. Thanks' },
    ])
  })

  it('handles text without links and links in parentheses', () => {
    expect(linkify('No links here')).toEqual([{ type: 'text', value: 'No links here' }])
    expect(linkify('(http://example.org)')).toEqual([
      { type: 'text', value: '(' },
      { type: 'link', value: 'http://example.org' },
      { type: 'text', value: ')' },
    ])
  })
})

describe('splitQuotes', () => {
  it('groups quoted lines and removes the markers', () => {
    expect(splitQuotes('Thanks!\n> Can we meet?\n>> Earlier\nYes.')).toEqual([
      { quoted: false, text: 'Thanks!' },
      { quoted: true, text: 'Can we meet?\n> Earlier' },
      { quoted: false, text: 'Yes.' },
    ])
  })
})
