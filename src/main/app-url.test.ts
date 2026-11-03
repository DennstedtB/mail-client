import { describe, expect, it } from 'vitest'
import { createAppUrlCheck } from './app-url'

const INDEX =
  'file:///Applications/MailClient.app/Contents/Resources/app.asar/out/renderer/index.html'

describe('createAppUrlCheck in the built app', () => {
  const isAppUrl = createAppUrlCheck({ rendererIndexUrl: INDEX })

  it('accepts the bundled index document, with or without query and hash', () => {
    expect(isAppUrl(INDEX)).toBe(true)
    expect(isAppUrl(`${INDEX}?view=calendar`)).toBe(true)
    expect(isAppUrl(`${INDEX}#/inbox`)).toBe(true)
  })

  it('rejects sibling files that share the prefix', () => {
    expect(isAppUrl(`${INDEX}2`)).toBe(false)
    expect(isAppUrl(INDEX.replace('index.html', 'other.html'))).toBe(false)
  })

  it('rejects file URLs with a host', () => {
    expect(isAppUrl(INDEX.replace('file:///', 'file://evil.example/'))).toBe(false)
  })

  it('rejects web pages, including the dev server address', () => {
    expect(isAppUrl('https://example.com/')).toBe(false)
    expect(isAppUrl('http://localhost:5173/')).toBe(false)
  })

  it('rejects empty and malformed input', () => {
    expect(isAppUrl('')).toBe(false)
    expect(isAppUrl('not a url')).toBe(false)
    expect(isAppUrl('about:blank')).toBe(false)
  })

  it('handles paths with spaces the same way Chromium reports them', () => {
    const withSpace = 'file:///Users/me/Claude%20Projects/mail-client/out/renderer/index.html'
    const check = createAppUrlCheck({ rendererIndexUrl: withSpace })
    expect(check(withSpace)).toBe(true)
  })
})

describe('createAppUrlCheck in development', () => {
  const isAppUrl = createAppUrlCheck({
    rendererIndexUrl: INDEX,
    devServerUrl: 'http://localhost:5173',
  })

  it('accepts any page on the dev server origin', () => {
    expect(isAppUrl('http://localhost:5173/')).toBe(true)
    expect(isAppUrl('http://localhost:5173/src/main.tsx?t=1')).toBe(true)
  })

  it('rejects a port that shares the string prefix', () => {
    expect(isAppUrl('http://localhost:51730/')).toBe(false)
  })

  it('rejects other hosts and schemes', () => {
    expect(isAppUrl('http://localhost.evil.example:5173/')).toBe(false)
    expect(isAppUrl('https://localhost:5173/')).toBe(false)
  })
})

describe('createAppUrlCheck configuration', () => {
  it('refuses a renderer index that is not a file URL', () => {
    expect(() =>
      createAppUrlCheck({ rendererIndexUrl: 'https://example.com/index.html' }),
    ).toThrow()
  })

  it('refuses a dev server URL that is not http(s)', () => {
    expect(() =>
      createAppUrlCheck({ rendererIndexUrl: INDEX, devServerUrl: 'file:///tmp/index.html' }),
    ).toThrow()
  })
})
