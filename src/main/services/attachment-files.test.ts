import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { canOpenSafely, createAttachmentFiles, safeFilename } from './attachment-files'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mailclient-files-'))
})
afterEach(() => rm(dir, { recursive: true, force: true }))

const pdf = { filename: 'Report.pdf', mimeType: 'application/pdf', content: Buffer.from('%PDF') }

describe('canOpenSafely', () => {
  it.each(['Report.pdf', 'photo.JPG', 'notes.txt', 'budget.xlsx', 'invite.ics'])(
    'opens %s',
    (name) => expect(canOpenSafely(name)).toBe(true),
  )

  it.each([
    'Installer.app',
    'run.command',
    'setup.pkg',
    'script.SH',
    'page.html',
    'link.webloc',
    'tool.exe',
    'noextension',
  ])('refuses %s', (name) => expect(canOpenSafely(name)).toBe(false))
})

describe('safeFilename', () => {
  it('removes paths, control characters and leading dots', () => {
    expect(safeFilename('../../etc/passwd')).toBe('_.._etc_passwd')
    expect(safeFilename('.hidden')).toBe('hidden')
    expect(safeFilename('a\u0000b\nc.pdf')).toBe('abc.pdf')
    expect(safeFilename('   ')).toBe('attachment')
  })
})

describe('createAttachmentFiles', () => {
  function files(overrides: { saveTo?: string; openProblem?: string } = {}) {
    const openPath = vi.fn(async () => overrides.openProblem ?? '')
    const showSaveDialog = vi.fn(async () => overrides.saveTo)
    return {
      openPath,
      showSaveDialog,
      files: createAttachmentFiles({
        tempDir: join(dir, 'tmp'),
        downloadsDir: '/Downloads',
        openPath,
        showSaveDialog,
      }),
    }
  }

  it('writes an opened attachment to its own private folder and opens it', async () => {
    const { files: f, openPath } = files()
    await f.open(pdf)
    const [sub] = await readdir(join(dir, 'tmp'))
    const path = join(dir, 'tmp', sub!, 'Report.pdf')
    expect(openPath).toHaveBeenCalledWith(path)
    expect(await readFile(path, 'utf8')).toBe('%PDF')
    expect((await stat(path)).mode & 0o777).toBe(0o600)
  })

  it('refuses to open files that can run code', async () => {
    const { files: f, openPath } = files()
    await expect(f.open({ ...pdf, filename: 'Invoice.pdf.app' })).rejects.toThrow("doesn't open")
    expect(openPath).not.toHaveBeenCalled()
  })

  it('reports when the system cannot open a file', async () => {
    const { files: f } = files({ openProblem: 'No application knows how to open this file.' })
    await expect(f.open(pdf)).rejects.toThrow('No application')
  })

  it('saves where the user chose, suggesting Downloads', async () => {
    const target = join(dir, 'saved.pdf')
    const { files: f, showSaveDialog } = files({ saveTo: target })
    await expect(f.save(pdf)).resolves.toBe(true)
    expect(showSaveDialog).toHaveBeenCalledWith('/Downloads/Report.pdf')
    expect(await readFile(target, 'utf8')).toBe('%PDF')
  })

  it('does nothing when the user cancels saving', async () => {
    const { files: f } = files()
    await expect(f.save(pdf)).resolves.toBe(false)
  })
})
