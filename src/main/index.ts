import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  app,
  BrowserWindow,
  nativeTheme,
  safeStorage,
  session,
  shell,
  type IpcMainInvokeEvent,
} from 'electron'
import type { Api } from '@shared/ipc-contract'
import { AccountService, toAccount } from './accounts/account-service'
import { AccountStore } from './accounts/account-store'
import { EncryptedSecretStore, type Cipher } from './accounts/secret-store'
import { createAppUrlCheck } from './app-url'
import { registerApi } from './ipc'
import { connectionChecker } from './providers/imap-smtp/check-connection'
import { ImapSmtpMailProvider } from './providers/imap-smtp/imap-smtp-mail-provider'
import { MockMailProvider } from './providers/mock/mock-mail-provider'
import { MailService } from './services/mail-service'

const MILESTONE = 'M1'
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

function createApi(): Api {
  // ~/Library/Application Support/MailClient on macOS
  const dataDir = app.getPath('userData')
  const accounts = new AccountService({
    store: new AccountStore(join(dataDir, 'accounts.json')),
    secrets: new EncryptedSecretStore(join(dataDir, 'credentials.json'), keychainCipher),
    checker: connectionChecker,
    createProvider: (account, getPassword) =>
      new ImapSmtpMailProvider(toAccount(account), account.settings, getPassword),
    sampleProvider: new MockMailProvider(),
    newId: randomUUID,
    now: () => new Date(),
  })

  return {
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
    mail: new MailService(accounts),
  }
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

  // The UI never opens windows itself. Web links go to the default browser.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
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

  registerApi(createApi(), isTrustedSender)
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
