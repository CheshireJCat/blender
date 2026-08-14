import { readdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function clean(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory() && entry.name === '__pycache__') {
      rmSync(path, { recursive: true, force: true })
    } else if (entry.isDirectory() && entry.name !== '.venv' && entry.name !== 'node_modules' && entry.name !== '.git') {
      clean(path)
    } else if (entry.isFile() && entry.name.endsWith('.pyc')) {
      rmSync(path, { force: true })
    }
  }
}

clean(root)
