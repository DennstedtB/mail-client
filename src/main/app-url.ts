/**
 * Decides whether a URL belongs to the app's own UI.
 *
 * This check gates both the IPC sender check and the navigation guard, so it
 * compares parsed URL parts, never string prefixes. It has no Electron imports
 * so it can be unit-tested.
 */

export interface AppUrlConfig {
  /** file:// URL of the built renderer's index.html. */
  rendererIndexUrl: string
  /** Vite dev server URL (ELECTRON_RENDERER_URL) in development, otherwise undefined. */
  devServerUrl?: string
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

export function createAppUrlCheck({
  rendererIndexUrl,
  devServerUrl,
}: AppUrlConfig): (url: string) => boolean {
  const index = parseUrl(rendererIndexUrl)
  if (!index || index.protocol !== 'file:') {
    throw new Error(`Renderer index must be a file: URL, got "${rendererIndexUrl}"`)
  }

  const dev = devServerUrl ? parseUrl(devServerUrl) : null
  if (devServerUrl && (!dev || (dev.protocol !== 'http:' && dev.protocol !== 'https:'))) {
    throw new Error(`Dev server must be an http(s) URL, got "${devServerUrl}"`)
  }

  return (candidate) => {
    const url = parseUrl(candidate)
    if (!url) return false

    // Built app: exactly the bundled index.html on the local disk. Query and hash may vary.
    if (url.protocol === 'file:') {
      return url.host === '' && url.pathname === index.pathname
    }

    // Development: any page served by the dev server (scheme, host and port must all match).
    return dev !== null && url.origin === dev.origin
  }
}
