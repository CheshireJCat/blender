import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import test from 'node:test'

import { internals } from '../index.js'

const config = {
  blenderExecutable: 'blender',
  timeoutMs: 1000,
  maxOutputChars: 20000,
}

function trackTemporaryDirectory(t) {
  const originalMkdtemp = fs.mkdtemp
  let tempDir
  t.mock.method(fs, 'mkdtemp', async (...args) => {
    tempDir = await originalMkdtemp(...args)
    return tempDir
  })
  syncBuiltinESMExports()

  t.after(async () => {
    t.mock.restoreAll()
    syncBuiltinESMExports()
    // Keep failed regression tests from leaving their own temporary files.
    if (tempDir !== undefined) await fs.rm(tempDir, { recursive: true, force: true })
  })

  return async () => {
    assert.equal(typeof tempDir, 'string', 'runBlender must create a temporary directory')
    await assert.rejects(fs.stat(tempDir), { code: 'ENOENT' })
  }
}

test('runBlender removes its temporary directory when payload serialization fails', async (t) => {
  const assertRemoved = trackTemporaryDirectory(t)
  const payload = {}
  payload.circular = payload

  await assert.rejects(internals.runBlender(config, {}, 'inspect', payload), TypeError)
  await assertRemoved()
})

test('runBlender removes its temporary directory and partial payload when writing fails', async (t) => {
  const assertRemoved = trackTemporaryDirectory(t)
  const originalWriteFile = fs.writeFile
  const writeError = Object.assign(new Error('No space left on device'), { code: 'ENOSPC' })
  let payloadPath
  t.mock.method(fs, 'writeFile', async (path) => {
    payloadPath = path
    await originalWriteFile(path, '{', 'utf8')
    throw writeError
  })
  syncBuiltinESMExports()

  await assert.rejects(
    internals.runBlender(config, {}, 'inspect', {}),
    (error) => error === writeError,
  )
  assert.equal(typeof payloadPath, 'string', 'the payload write must be attempted')
  await assertRemoved()
  await assert.rejects(fs.stat(payloadPath), { code: 'ENOENT' })
})
