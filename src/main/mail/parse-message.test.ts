import { describe, expect, it } from 'vitest'
import { decodeMessageId, encodeMessageId, makePreview } from './message-ref'
import { extractAttachment, parseMessage } from './parse-message'

const PNG_1PX =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

function mime(lines: string[]): Buffer {
  return Buffer.from(lines.join('\r\n'))
}

const multipart = mime([
  'From: Bob Test <bob@mailclient.test>',
  'To: Alice <alice@mailclient.test>, carol@example.org',
  'Cc: Dave <dave@example.org>',
  'Subject: =?UTF-8?Q?Gr=C3=BC=C3=9Fe?=',
  'Message-ID: <m2@mailclient.test>',
  'In-Reply-To: <m1@mailclient.test>',
  'References: <m0@mailclient.test> <m1@mailclient.test>',
  'MIME-Version: 1.0',
  'Content-Type: multipart/mixed; boundary="outer"',
  '',
  '--outer',
  'Content-Type: multipart/related; boundary="rel"',
  '',
  '--rel',
  'Content-Type: multipart/alternative; boundary="alt"',
  '',
  '--alt',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'Hallo Alice,',
  '> quoted line from before',
  'here is the logo.',
  '--alt',
  'Content-Type: text/html; charset=utf-8',
  '',
  '<p>Hallo Alice,</p><img src="cid:logo@x">',
  '--alt--',
  '--rel',
  'Content-Type: image/png',
  'Content-ID: <logo@x>',
  'Content-Transfer-Encoding: base64',
  '',
  PNG_1PX,
  '--rel--',
  '--outer',
  'Content-Type: application/pdf; name="Report.pdf"',
  'Content-Disposition: attachment; filename="Report.pdf"',
  'Content-Transfer-Encoding: base64',
  '',
  Buffer.from('%PDF-1.4 test').toString('base64'),
  '--outer--',
  '',
])

describe('parseMessage', () => {
  it('reads text, HTML and headers', async () => {
    const message = await parseMessage(multipart)
    expect(message.text).toContain('Hallo Alice')
    expect(message.preview).toBe('Hallo Alice, here is the logo.')
    expect(message.messageId).toBe('<m2@mailclient.test>')
    expect(message.inReplyTo).toBe('<m1@mailclient.test>')
    expect(message.references).toEqual(['<m0@mailclient.test>', '<m1@mailclient.test>'])
    expect(message.to).toEqual([
      { name: 'Alice', email: 'alice@mailclient.test' },
      { email: 'carol@example.org' },
    ])
    expect(message.cc).toEqual([{ name: 'Dave', email: 'dave@example.org' }])
  })

  it('embeds inline images in the HTML instead of listing them', async () => {
    const message = await parseMessage(multipart)
    expect(message.html).toContain('src="data:image/png;base64,')
    expect(message.html).not.toContain('cid:')
    expect(message.attachments).toEqual([
      { id: '1', filename: 'Report.pdf', mimeType: 'application/pdf', size: 13 },
    ])
  })

  it('lists a related image that is explicitly an attachment', async () => {
    const source = mime([
      'From: bob@mailclient.test',
      'Subject: Photo',
      'MIME-Version: 1.0',
      'Content-Type: multipart/related; boundary="rel"',
      '',
      '--rel',
      'Content-Type: text/html; charset=utf-8',
      '',
      '<p>No image reference here.</p>',
      '--rel',
      'Content-Type: image/png; name="photo.png"',
      'Content-ID: <photo@x>',
      'Content-Disposition: attachment; filename="photo.png"',
      'Content-Transfer-Encoding: base64',
      '',
      PNG_1PX,
      '--rel--',
      '',
    ])
    const message = await parseMessage(source)
    expect(message.attachments.map((a) => a.filename)).toEqual(['photo.png'])
  })

  it('handles a plain text message without attachments', async () => {
    const message = await parseMessage(
      mime(['From: a@example.org', 'Subject: Hi', '', 'Just text.', '']),
    )
    expect(message.text).toBe('Just text.')
    expect(message.html).toBeUndefined()
    expect(message.attachments).toEqual([])
  })
})

describe('extractAttachment', () => {
  it('returns the content of an attachment by id', async () => {
    const attachment = await extractAttachment(multipart, '1')
    expect(attachment.filename).toBe('Report.pdf')
    expect(attachment.content.toString()).toBe('%PDF-1.4 test')
  })

  it('reports an unknown attachment', async () => {
    await expect(extractAttachment(multipart, '7')).rejects.toThrow('no longer exists')
  })
})

describe('message ids', () => {
  it('round-trips folder and UID, including unusual folder names', () => {
    const ref = { folderId: 'Projects/"Q4" ✓', uid: 42 }
    expect(decodeMessageId(encodeMessageId(ref))).toEqual(ref)
  })

  it('rejects ids it did not create', () => {
    for (const id of ['', 'nope', '[1,2]', '["INBOX",0]', '["INBOX",1.5]', '{}']) {
      expect(() => decodeMessageId(id), id).toThrow('Unknown message')
    }
  })
})

describe('makePreview', () => {
  it('drops quoted lines and collapses whitespace', () => {
    expect(makePreview('Thanks!\n\n> earlier text\n> more\nBob')).toBe('Thanks! Bob')
  })

  it('shortens long text', () => {
    const preview = makePreview('word '.repeat(100), 20)
    expect(preview.length).toBeLessThanOrEqual(20)
    expect(preview.endsWith('…')).toBe(true)
  })
})
