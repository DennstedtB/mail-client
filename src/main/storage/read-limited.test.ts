import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readLimited } from './read-limited'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'read-limited-'))
})
afterEach(() => rm(dir, { recursive: true, force: true }))

describe('readLimited', () => {
  it('reads a file that fits completely', async () => {
    await writeFile(join(dir, 'a.txt'), 'hello')
    expect((await readLimited(join(dir, 'a.txt'), 10)).toString()).toBe('hello')
    expect((await readLimited(join(dir, 'a.txt'), 5)).toString()).toBe('hello')
  })

  it('stops one byte past the limit', async () => {
    await writeFile(join(dir, 'b.txt'), 'x'.repeat(1000))
    expect((await readLimited(join(dir, 'b.txt'), 10)).length).toBe(11)
  })

  it('fails for a file that is gone', async () => {
    await expect(readLimited(join(dir, 'missing'), 10)).rejects.toThrow()
  })
})
