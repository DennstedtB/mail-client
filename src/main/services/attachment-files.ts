import { randomBytes } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import type { AttachmentContent } from '../mail/parse-message'

/**
 * File types that run code, install software, or open as a web page when
 * double-clicked. These are never opened directly from a message; the user
 * can save them and decide.
 */
const UNSAFE_EXTENSIONS = new Set(
  (
    'app command tool sh bash zsh csh ksh fish pkg mpkg dmg iso img exe msi bat cmd com scr ' +
    'ps1 vbs vbe js jse mjs jar py pyc rb pl php scpt scptd applescript workflow action terminal ' +
    'webloc inetloc fileloc url desktop html htm xhtml shtml svg hta lnk reg msc cpl dll so dylib ' +
    'kext prefpane plugin bundle framework mobileconfig configprofile appimage deb rpm'
  ).split(' '),
)

export function canOpenSafely(filename: string): boolean {
  const extension = extname(filename).slice(1).toLowerCase()
  return extension !== '' && !UNSAFE_EXTENSIONS.has(extension)
}

/** A file name that can't escape its folder or hide: no paths, control characters or leading dots. */
export function safeFilename(name: string): string {
  const base = name
    .replace(/[/\\:]/g, '_')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 200)
  return base || 'attachment'
}

export interface AttachmentFiles {
  open(attachment: AttachmentContent): Promise<void>
  save(attachment: AttachmentContent): Promise<boolean>
}

export interface AttachmentFilesDeps {
  /** Folder for opened attachments; each gets its own random subfolder. */
  tempDir: string
  downloadsDir: string
  openPath(path: string): Promise<string>
  showSaveDialog(defaultPath: string): Promise<string | undefined>
}

export function createAttachmentFiles(deps: AttachmentFilesDeps): AttachmentFiles {
  return {
    async open(attachment) {
      const name = safeFilename(attachment.filename)
      if (!canOpenSafely(name)) {
        throw new Error(
          `For safety, MailClient doesn't open "${name}" directly. Save it, and open it yourself if you trust the sender.`,
        )
      }
      const dir = join(deps.tempDir, randomBytes(8).toString('hex'))
      await mkdir(dir, { recursive: true, mode: 0o700 })
      const path = join(dir, name)
      await writeFile(path, attachment.content, { mode: 0o600 })
      const problem = await deps.openPath(path)
      if (problem) throw new Error(`"${name}" couldn't be opened: ${problem}`)
    },

    async save(attachment) {
      const target = await deps.showSaveDialog(
        join(deps.downloadsDir, safeFilename(attachment.filename)),
      )
      if (!target) return false
      await writeFile(target, attachment.content)
      return true
    },
  }
}
