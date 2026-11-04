import { useEffect, useState } from 'react'
import { errorMessage } from './errors'

export type AsyncState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'error'; message: string }

/**
 * Loads data for a key and reloads when the key changes. A `null` key means
 * "nothing to load yet". Results for an outdated key are dropped, so a slow
 * response can never overwrite a newer one.
 */
export function useAsync<T>(
  key: string | null,
  load: () => Promise<T>,
  /**
   * Results of the same group stay visible while a newer key loads, e.g. the
   * message list of one folder while it refreshes after new mail. Without a
   * group, a new key shows "loading" first.
   */
  group?: string,
): AsyncState<T> {
  const [result, setResult] = useState<{
    key: string
    group?: string
    state: AsyncState<T>
  } | null>(null)

  useEffect(() => {
    if (key === null) return
    let current = true
    load().then(
      (data) => current && setResult({ key, group, state: { status: 'ready', data } }),
      (error: unknown) =>
        current &&
        setResult({
          key,
          group,
          state: { status: 'error', message: errorMessage(error) },
        }),
    )
    return () => {
      current = false
    }
    // `load` is recreated on every render; the key alone decides when to reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  if (key === null) return { status: 'idle' }
  if (result && result.key === key) return result.state
  if (result && group !== undefined && result.group === group) return result.state
  return { status: 'loading' }
}
