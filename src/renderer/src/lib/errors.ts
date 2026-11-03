/**
 * Readable message for an error from the backend. Electron wraps errors
 * thrown in IPC handlers as "Error invoking remote method 'x:y': Error: …";
 * only the part after that prefix is meant for people.
 */
export function errorMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text.replace(/^Error invoking remote method '[^']*': (?:\w*Error: )?/, '')
}
