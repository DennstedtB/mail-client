import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { rm, stat } from 'node:fs/promises'
import {
  app,
  BrowserWindow,
  dialog,
  nativeTheme,
  safeStorage,
  session,
  shell,
  type IpcMainInvokeEvent,
  type OpenDialogOptions,
} from 'electron'
import { EVENT_CHANNELS, type Api } from '@shared/ipc-contract'
import type { MailChange } from '@shared/types/mail'
import { AccountService, toAccount } from './accounts/account-service'
import { AccountStore } from './accounts/account-store'
import { EncryptedSecretStore, type Cipher } from './accounts/secret-store'
import { createAppUrlCheck } from './app-url'
import { MailCache } from './cache/mail-cache'
import { ComposeService } from './compose/compose-service'
import { registerApi } from './ipc'
import { connectionChecker } from './providers/imap-smtp/check-connection'
import { ImapSmtpMailProvider } from './providers/imap-smtp/imap-smtp-mail-provider'
import { MockMailProvider } from './providers/mock/mock-mail-provider'
import { readLimited } from './storage/read-limited'
import { createAttachmentFiles } from './services/attachment-files'
import { MailService } from './services/mail-service'

const MILESTONE = 'M3'
const RENDERER_INDEX = join(__dirname, '../renderer/index.html')
const DEV_SERVER_URL = app.isPackaged ? undefined : process.env['ELECTRON_RENDERER_URL']

app.setName('MailClient')

/** True for the app's own UI, in development and in the built app. */
const isAppUrl = createAppUrlCheck({
  rendererIndexUrl: pathToFileURL(RENDERER_INDEX).href,
  devServerUrl: DEV_SERVER_URL,
})

function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  return isAppUrl(event.senderFrame?.url ?? '')
}

/** Only for headless tests on Linux in development; never in the packaged app. */
const allowWeakSecretStore =
  !app.isPackaged && process.env['MAILCLIENT_ALLOW_WEAK_SECRET_STORE'] === '1'

/**
 * Electron's safeStorage: on macOS the key lives in the Keychain. On Linux
 * without a keyring it would fall back to a fixed key ("basic_text"), which
 * is not real protection, so that counts as unavailable unless explicitly
 * allowed for tests.
 */
const keychainCipher: Cipher = {
  async isAvailable() {
    if (!(await safeStorage.isAsyncEncryptionAvailable())) return false
    const weak =
      process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text'
    return !weak || allowWeakSecretStore
  },
  encrypt: (plainText) => safeStorage.encryptStringAsync(plainText),
  async decrypt(encrypted) {
    const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(encrypted)
    return { plainText: result, reEncrypt: shouldReEncrypt }
  },
}

/** Tells every window that cached mail changed. */
function emitMailChange(change: MailChange) {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(EVENT_CHANNELS.mailChanged, change)
  }
}

function createServices() {
  // ~/Library/Application Support/MailClient on macOS
  const dataDir = app.getPath('userData')
  // Opened attachments from earlier sessions are no longer needed.
  const attachmentDir = join(app.getPath('temp'), 'MailClient-attachments')
  void rm(attachmentDir, { recursive: true, force: true })

  const cache = new MailCache(join(dataDir, 'cache.sqlite'))
  const files = createAttachmentFiles({
    tempDir: attachmentDir,
    downloadsDir: app.getPath('downloads'),
    openPath: (path) => shell.openPath(path),
    async showSaveDialog(defaultPath) {
      const window = BrowserWindow.getFocusedWindow()
      const result = window
        ? await dialog.showSaveDialog(window, { defaultPath })
        : await dialog.showSaveDialog({ defaultPath })
      return result.canceled ? undefined : result.filePath
    },
  })

  // The account service tells the mail service about added and removed accounts.
  const late: { mail?: MailService } = {}
  const accounts = new AccountService({
    store: new AccountStore(join(dataDir, 'accounts.json')),
    secrets: new EncryptedSecretStore(join(dataDir, 'credentials.json'), keychainCipher),
    checker: connectionChecker,
    createProvider: (account, getPassword) =>
      new ImapSmtpMailProvider(toAccount(account), account.settings, getPassword),
    sampleProvider: new MockMailProvider(),
    newId: randomUUID,
    now: () => new Date(),
    onChange(change) {
      if (change.type === 'added') void late.mail?.watchAll()
      else late.mail?.forget(change.accountId)
    },
  })
  const mail = new MailService({ source: accounts, cache, emit: emitMailChange, files })
  late.mail = mail
  const compose = new ComposeService({
    source: accounts,
    mail,
    async pickFiles() {
      const options: OpenDialogOptions = {
        title: 'Attach files',
        properties: ['openFile', 'multiSelections'],
      }
      const window = BrowserWindow.getFocusedWindow()
      const result = window
        ? await dialog.showOpenDialog(window, options)
        : await dialog.showOpenDialog(options)
      return result.canceled ? [] : result.filePaths
    },
    async fileSize(path) {
      const info = await stat(path).catch(() => null)
      return info?.isFile() ? info.size : null
    },
    readFile: readLimited,
    locale: app.getLocale(),
  })

  const api: Api = {
    app: {
      getInfo: async () => ({
        name: app.getName(),
        version: app.getVersion(),
        platform: process.platform,
        milestone: MILESTONE,
        isDevelopment: !app.isPackaged,
      }),
    },
    accounts,
    mail,
    compose,
  }
  return { api, mail, cache }
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'MailClient',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 18 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#151719' : '#eceeef',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: true,
    },
  })

  window.once('ready-to-show', () => window.show())

  // The UI never opens windows itself. Web links, e.g. from a message, go to the default browser.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  // The window may only ever show the app's own UI.
  window.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) event.preventDefault()
  })

  if (DEV_SERVER_URL) {
    void window.loadURL(DEV_SERVER_URL)
  } else {
    void window.loadFile(RENDERER_INDEX)
  }

  return window
}

void app.whenReady().then(() => {
  if (allowWeakSecretStore) safeStorage.setUsePlainTextEncryption(true)
  // No camera, microphone, notifications, geolocation etc. until a feature needs it.
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) =>
    callback(false),
  )

  const services = createServices()
  registerApi(services.api, isTrustedSender)
  createWindow()
  // New mail arrives by push (IMAP IDLE) for every account.
  void services.mail.watchAll()
  app.on('will-quit', () => services.cache.close())

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
