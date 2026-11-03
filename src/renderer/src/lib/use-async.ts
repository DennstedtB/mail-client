import { useEffect, useState } from 'react'

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
export function useAsync<T>(key: string | null, load: () => Promise<T>): AsyncState<T> {
  const [result, setResult] = useState<{ key: string; state: AsyncState<T> } | null>(null)

  useEffect(() => {
    if (key === null) return
    let current = true
    load().then(
      (data) => current && setResult({ key, state: { status: 'ready', data } }),
      (error: unknown) =>
        current &&
        setResult({
          key,
          state: {
            status: 'error',
            message: error instanceof Error ? error.message : String(error),
          },
        }),
    )
    return () => {
      current = false
    }
    // `load` is recreated on every render; the key alone decides when to reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  if (key === null) return { status: 'idle' }
  if (!result || result.key !== key) return { status: 'loading' }
  return result.state
}
