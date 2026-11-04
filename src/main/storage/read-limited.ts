import { open } from 'node:fs/promises'

/**
 * Reads a file, but at most maxBytes + 1 bytes: enough for the caller to see
 * that the file is larger than allowed, without loading all of it.
 */
export async function readLimited(path: string, maxBytes: number): Promise<Buffer> {
  const file = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(Math.max(0, maxBytes) + 1)
    let length = 0
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, length)
      if (bytesRead === 0) break
      length += bytesRead
    }
    return buffer.subarray(0, length)
  } finally {
    await file.close()
  }
}
