import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { API_METHODS, channelName, type Api, type Namespace } from '@shared/ipc-contract'

type AnyMethod = (...args: unknown[]) => Promise<unknown>

/**
 * Registers one `ipcMain.handle` per method in the contract. Calls from any
 * frame that is not the app's own UI are rejected.
 */
export function registerApi(api: Api, isTrustedSender: (event: IpcMainInvokeEvent) => boolean) {
  for (const namespace of Object.keys(API_METHODS) as Namespace[]) {
    const target = api[namespace] as unknown as Record<string, AnyMethod>
    for (const method of API_METHODS[namespace]) {
      const channel = channelName(namespace, method)
      const implementation = target[method]
      if (typeof implementation !== 'function') {
        throw new Error(`Missing implementation for ${channel}`)
      }
      ipcMain.handle(channel, (event, ...args: unknown[]) => {
        if (!isTrustedSender(event)) {
          throw new Error(`Rejected ${channel} from untrusted sender`)
        }
        return implementation.apply(target, args)
      })
    }
  }
}
