import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, nativeTheme, session, shell, type IpcMainInvokeEvent } from 'electron'
import type { Api } from '@shared/ipc-contract'
import { createAppUrlCheck } from './app-url'
import { registerApi } from './ipc'
import { MockMailProvider } from './providers/mock/mock-mail-provider'
import { MailService } from './services/mail-service'

const MILESTONE = 'M0'
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

function createApi(): Api {
  return {
    app: {
      getInfo: async () => ({
        name: app.getName(),
        version: app.getVersion(),
        platform: process.platform,
        milestone: MILESTONE,
      }),
    },
    mail: new MailService([new MockMailProvider()]),
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
