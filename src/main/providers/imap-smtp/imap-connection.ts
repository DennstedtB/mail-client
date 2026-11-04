import { ImapFlow, type ImapFlowOptions } from 'imapflow'

/**
 * One long-lived IMAP connection for commands (sync, downloads, and later
 * flag changes). Connects on first use and again after the server or the
 * network dropped it. ImapFlow queues commands on a connection, and mailbox
 * locks keep folder switches in order.
 */
export class ImapConnection {
  private client: ImapFlow | null = null
  private connecting: Promise<ImapFlow> | null = null
  private closed = false

  constructor(private readonly options: () => Promise<ImapFlowOptions>) {}

  async use<T>(work: (client: ImapFlow) => Promise<T>): Promise<T> {
    const client = await this.get()
    try {
      return await work(client)
    } finally {
      if (!client.usable && this.client === client) this.client = null
    }
  }

  private get(): Promise<ImapFlow> {
    if (this.closed) return Promise.reject(new Error('The account was removed.'))
    if (this.client?.usable) return Promise.resolve(this.client)
    this.connecting ??= (async () => {
      const client = new ImapFlow(await this.options())
      // Without a listener, a late socket error would crash the main process.
      client.on('error', () => {})
      client.on('close', () => {
        if (this.client === client) this.client = null
      })
      await client.connect()
      // Closed while connecting (account removed): don't keep the connection around.
      if (this.closed) {
        await client.logout().catch(() => client.close())
        throw new Error('The account was removed.')
      }
      this.client = client
      return client
    })().finally(() => {
      this.connecting = null
    })
    return this.connecting
  }

  async close() {
    this.closed = true
    const client = this.client
    this.client = null
    await client?.logout().catch(() => client.close())
  }
}

export interface WatcherOptions {
  options: () => Promise<ImapFlowOptions>
  folder: string
  onChange: () => void
  /** Delays between reconnect attempts; the last one repeats. */
  backoff?: number[]
}

/**
 * Keeps a second connection idling (IMAP IDLE) on one folder, usually the
 * inbox, and reports new, removed and changed messages as they happen.
 * Reconnects with growing delays when the connection drops.
 */
export class FolderWatcher {
  private client: ImapFlow | null = null
  private timer: NodeJS.Timeout | null = null
  private debounce: NodeJS.Timeout | null = null
  private attempt = 0
  private stopped = false

  constructor(private readonly config: WatcherOptions) {}

  start() {
    void this.connect()
  }

  private async connect() {
    if (this.stopped) return
    try {
      const client = new ImapFlow({
        ...(await this.config.options()),
        disableAutoIdle: false,
        // This connection does nothing but wait, so IDLE starts right away (default: after 15 s).
        autoIdleDelay: 1000,
        // IDLE is quiet by design; the library re-issues it before this runs out.
        socketTimeout: 30 * 60_000,
        maxIdleTime: 10 * 60_000,
      })
      client.on('error', () => {})
      client.on('close', () => this.scheduleReconnect())
      for (const event of ['exists', 'expunge', 'flags'] as const) {
        client.on(event, () => this.changed())
      }
      await client.connect()
      if (this.stopped) {
        await client.logout().catch(() => client.close())
        return
      }
      await client.mailboxOpen(this.config.folder, { readOnly: true })
      if (this.stopped) {
        await client.logout().catch(() => client.close())
        return
      }
      this.client = client
      this.attempt = 0
      // Catch up on anything that arrived while disconnected.
      this.changed()
    } catch {
      this.scheduleReconnect()
    }
  }

  private changed() {
    if (this.debounce) clearTimeout(this.debounce)
    this.debounce = setTimeout(() => this.config.onChange(), 400)
  }

  private scheduleReconnect() {
    this.client = null
    if (this.stopped || this.timer) return
    const backoff = this.config.backoff ?? [5_000, 15_000, 60_000, 300_000]
    const delay = backoff[Math.min(this.attempt, backoff.length - 1)] ?? 300_000
    this.attempt++
    this.timer = setTimeout(() => {
      this.timer = null
      void this.connect()
    }, delay)
  }

  async stop() {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    if (this.debounce) clearTimeout(this.debounce)
    const client = this.client
    this.client = null
    await client?.logout().catch(() => client.close())
  }
}
