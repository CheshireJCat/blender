import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const environment = join(root, '.venv')
const configuredPython = process.env.DSH_BLENDER_ANALYSIS_PYTHON?.trim()
const bootstrapPython = configuredPython || (process.platform === 'win32' ? 'python' : 'python3')
const environmentPython = process.platform === 'win32'
  ? join(environment, 'Scripts', 'python.exe')
  : join(environment, 'bin', 'python')

function run(command, args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit', windowsHide: true })
    child.once('error', rejectPromise)
    child.once('close', (code) => {
      if (code === 0) resolvePromise()
      else rejectPromise(new Error(`${command} exited with code ${code ?? 1}`))
    })
  })
}

if (!existsSync(environmentPython)) await run(bootstrapPython, ['-m', 'venv', environment])
await run(environmentPython, ['-m', 'pip', 'install', '--disable-pip-version-check', '-r', join(root, 'requirements-analysis.txt')])
await run(environmentPython, [
  '-c',
  'import cv2,numpy,PIL,scipy; print(f"analysis runtime ready: opencv={cv2.__version__} numpy={numpy.__version__} pillow={PIL.__version__} scipy={scipy.__version__}")',
])
