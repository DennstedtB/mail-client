import type { MessageStructureObject } from 'imapflow'
import { describe, expect, it } from 'vitest'
import { attachmentNames, hasAttachmentParts } from './folder-sync'

function leaf(
  type: string,
  options: { disposition?: string; name?: string } = {},
): MessageStructureObject {
  return {
    part: '1',
    type,
    ...(options.disposition ? { disposition: options.disposition } : {}),
    ...(options.name ? { parameters: { name: options.name } } : {}),
  } as MessageStructureObject
}

const mixed = (...childNodes: MessageStructureObject[]) =>
  ({ type: 'multipart/mixed', childNodes }) as MessageStructureObject

describe('hasAttachmentParts', () => {
  it('sees parts marked as attachments', () => {
    expect(
      hasAttachmentParts(
        mixed(leaf('text/plain'), leaf('text/plain', { disposition: 'attachment' })),
      ),
    ).toBe(true)
  })

  it('sees named files without a disposition, text/csv included', () => {
    expect(
      hasAttachmentParts(mixed(leaf('text/plain'), leaf('application/pdf', { name: 'a.pdf' }))),
    ).toBe(true)
    expect(
      hasAttachmentParts(mixed(leaf('text/plain'), leaf('text/csv', { name: 'data.csv' }))),
    ).toBe(true)
  })

  it('ignores message text and inline images', () => {
    expect(
      hasAttachmentParts(mixed(leaf('text/plain', { name: 'body.txt' }), leaf('text/html'))),
    ).toBe(false)
    expect(
      hasAttachmentParts(mixed(leaf('image/png', { name: 'logo.png', disposition: 'inline' }))),
    ).toBe(false)
    expect(hasAttachmentParts(undefined)).toBe(false)
  })
})

describe('attachmentNames', () => {
  it('lists the names of attachments, nested parts included', () => {
    const named = (name: string) =>
      ({
        part: '2',
        type: 'application/pdf',
        disposition: 'attachment',
        dispositionParameters: { filename: ` ${name} ` },
      }) as MessageStructureObject
    expect(
      attachmentNames(
        mixed(
          leaf('text/plain', { name: 'body.txt' }),
          mixed(named('Rechnung März.pdf'), leaf('text/csv', { name: 'data.csv' })),
          leaf('image/png', { name: 'logo.png', disposition: 'inline' }),
        ),
      ),
    ).toEqual(['Rechnung März.pdf', 'data.csv'])
  })

  it('skips attachments without a name', () => {
    expect(attachmentNames(mixed(leaf('application/pdf', { disposition: 'attachment' })))).toEqual(
      [],
    )
    expect(attachmentNames(undefined)).toEqual([])
  })
})
