import { spawn } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineTool } from '@deepseek-ai/dsh-tools'
import Schema from '@deepseek-ai/schemastery'

import { HELPER_BY_NAME, HELPER_CATALOG } from './lib/helper-catalog.js'

export const name = 'blender-modeling'
export const inject = ['tools', 'skills']

export const Config = Schema.object({
  blenderExecutable: Schema.string().default('blender'),
  analysisPythonExecutable: Schema.string().default(''),
  timeoutMs: Schema.number().default(180000),
  helperTimeoutMs: Schema.number().default(120000),
  maxOutputChars: Schema.number().default(20000),
  restrictToWorkspace: Schema.boolean().default(true),
  enablePython: Schema.boolean().default(true),
  enableHelpers: Schema.boolean().default(true),
  enableMaintenanceHelpers: Schema.boolean().default(false),
  registerSkill: Schema.boolean().default(true),
  registerModuleSkills: Schema.boolean().default(true),
})

const PACKAGE_ROOT = dirname(fileURLToPath(import.meta.url))
const DRIVER_PATH = join(PACKAGE_ROOT, 'scripts', 'dsh_blender_driver.py')
const HELPER_DRIVER_PATH = join(PACKAGE_ROOT, 'scripts', 'dsh_blender_helper_driver.py')
const SKILL_ROOT = join(PACKAGE_ROOT, 'skills', 'create-3d-model')
const SKILL_PATH = join(SKILL_ROOT, 'SKILL.md')
const MODULE_ROOT = join(SKILL_ROOT, 'references', 'modules')
const SUPPORTED_EXPORTS = new Set(['.glb', '.gltf', '.fbx', '.obj', '.stl', '.usd', '.usda', '.usdc', '.ply'])
const SUPPORTED_IMPORTS = new Set([...SUPPORTED_EXPORTS, '.dae'])
const SUPPORTED_RENDERS = new Set(['.png', '.jpg', '.jpeg'])
const MODULE_RUNTIME_PREAMBLE = `## DeepSeek Harness runtime mapping

This bundled domain skill executes through the dsh-blender plugin. Use \`blender_scene_info\` and \`blender_object_info\` for inspection, \`blender_import\` for non-Blend inputs, \`blender_python\` for controlled scene changes, \`blender_preview\`/\`blender_render\`/\`blender_render_frames\` for visual evidence, and \`blender_validate_scene\` plus \`blender_validate_export\` for acceptance gates. Discover this module's deterministic scripts with \`blender_helper_catalog({ module: "<this skill name>" })\` and execute them with \`blender_helper_run\`; do not guess package paths. This mapping overrides legacy MCP, Bash, or fixed tool-name instructions below.`

const sceneSchema = {
  type: 'object',
  additionalProperties: true,
  description: 'Structured Blender scene summary.',
}

const logSchema = {
  type: 'string',
  description: 'Bounded Blender stdout/stderr diagnostics.',
}

function assertConfig(config) {
  if (!Number.isFinite(config.timeoutMs) || config.timeoutMs <= 0) {
    throw new Error('blender-modeling: timeoutMs must be a positive finite number')
  }
  if (!Number.isFinite(config.helperTimeoutMs) || config.helperTimeoutMs <= 0) {
    throw new Error('blender-modeling: helperTimeoutMs must be a positive finite number')
  }
  if (!Number.isInteger(config.maxOutputChars) || config.maxOutputChars < 1000) {
    throw new Error('blender-modeling: maxOutputChars must be an integer of at least 1000')
  }
  if (config.blenderExecutable.trim() === '') {
    throw new Error('blender-modeling: blenderExecutable must not be empty')
  }
  if (typeof config.analysisPythonExecutable !== 'string') {
    throw new Error('blender-modeling: analysisPythonExecutable must be a string')
  }
  if (!existsSync(DRIVER_PATH)) {
    throw new Error(`blender-modeling: bundled driver is missing at ${DRIVER_PATH}`)
  }
  if (!existsSync(HELPER_DRIVER_PATH)) {
    throw new Error(`blender-modeling: bundled helper driver is missing at ${HELPER_DRIVER_PATH}`)
  }
}

function readSkillDefinition(path) {
  const raw = readFileSync(path, 'utf8')
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/u.exec(raw)
  if (match === null) throw new Error(`blender-modeling: invalid skill frontmatter at ${path}`)
  const nameMatch = /^name:\s*(.+)$/mu.exec(match[1])
  const descriptionMatch = /^description:\s*(.+)$/mu.exec(match[1])
  if (nameMatch === null || descriptionMatch === null) {
    throw new Error(`blender-modeling: skill requires name and description at ${path}`)
  }
  return {
    name: nameMatch[1].trim(),
    description: descriptionMatch[1].trim(),
    content: match[2].trim(),
  }
}

function registerSkills(ctx, config) {
  const top = readSkillDefinition(SKILL_PATH)
  ctx.skills.register({
    ...top,
    source: 'bundled',
    provider: 'dsh-blender',
    resourceBase: { kind: 'directory', path: SKILL_ROOT },
  })
  if (!config.registerModuleSkills) return
  const moduleDirectories = readdirSync(MODULE_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
  for (const moduleName of moduleDirectories) {
    const moduleDirectory = join(MODULE_ROOT, moduleName)
    const definition = readSkillDefinition(join(moduleDirectory, 'SKILL.md'))
    ctx.skills.register({
      ...definition,
      content: `${MODULE_RUNTIME_PREAMBLE.replace('<this skill name>', definition.name)}\n\n${definition.content}`,
      source: 'bundled',
      provider: 'dsh-blender',
      resourceBase: { kind: 'directory', path: moduleDirectory },
    })
  }
}

function sessionWorkspace(exec) {
  const cwd = exec?.agent?.session?.header?.cwd
  return resolve(typeof cwd === 'string' && cwd.trim() !== '' ? cwd : process.cwd())
}

function isWithin(root, target) {
  const rel = relative(root, target)
  return rel === '' || (!rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && rel !== '..' && !isAbsolute(rel))
}

async function nearestExistingAncestor(target) {
  let candidate = target
  while (true) {
    try {
      await stat(candidate)
      return candidate
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
      const parent = dirname(candidate)
      if (parent === candidate) return candidate
      candidate = parent
    }
  }
}

async function resolveWorkspacePath(rawPath, exec, config, { mustExist = false, kind = 'path' } = {}) {
  if (typeof rawPath !== 'string' || rawPath.trim() === '') throw new Error(`${kind} must be a non-empty string`)
  const workspace = sessionWorkspace(exec)
  const target = resolve(isAbsolute(rawPath) ? rawPath : join(workspace, rawPath))
  if (!config.restrictToWorkspace) return target

  if (!isWithin(workspace, target)) {
    throw new Error(`${kind} must stay inside the dsh session workspace: ${workspace}`)
  }

  const workspaceReal = await realpath(workspace)
  if (mustExist) {
    const targetReal = await realpath(target).catch((error) => {
      if (error?.code === 'ENOENT') throw new Error(`${kind} does not exist: ${target}`)
      throw error
    })
    if (!isWithin(workspaceReal, targetReal)) throw new Error(`${kind} resolves outside the dsh session workspace`)
    return target
  }

  const ancestor = await nearestExistingAncestor(target)
  const ancestorReal = await realpath(ancestor)
  if (!isWithin(workspaceReal, ancestorReal)) throw new Error(`${kind} resolves through a path outside the dsh session workspace`)
  return target
}

async function assertRegularFile(path, label) {
  const info = await stat(path).catch((error) => {
    if (error?.code === 'ENOENT') throw new Error(`${label} does not exist: ${path}`)
    throw error
  })
  if (!info.isFile()) throw new Error(`${label} is not a regular file: ${path}`)
  return info
}

async function assertDirectory(path, label) {
  const info = await stat(path).catch((error) => {
    if (error?.code === 'ENOENT') throw new Error(`${label} does not exist: ${path}`)
    throw error
  })
  if (!info.isDirectory()) throw new Error(`${label} is not a directory: ${path}`)
  return info
}

async function assertWritableTarget(path, allowOverwrite, label) {
  try {
    const info = await stat(path)
    if (!info.isFile()) throw new Error(`${label} exists and is not a regular file: ${path}`)
    if (!allowOverwrite) throw new Error(`${label} already exists; choose a versioned path or set allow_overwrite=true`)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  await mkdir(dirname(path), { recursive: true })
}

async function assertWritableDirectory(path, allowOverwrite, label) {
  try {
    const info = await stat(path)
    if (!info.isDirectory()) throw new Error(`${label} exists and is not a directory: ${path}`)
    if (!allowOverwrite) throw new Error(`${label} already exists; choose a versioned directory or set allow_overwrite=true`)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  await mkdir(path, { recursive: true })
}

function analysisPythonExecutable(config) {
  if (config.analysisPythonExecutable.trim() !== '') return config.analysisPythonExecutable
  const bundled = process.platform === 'win32'
    ? join(PACKAGE_ROOT, '.venv', 'Scripts', 'python.exe')
    : join(PACKAGE_ROOT, '.venv', 'bin', 'python')
  return existsSync(bundled) ? bundled : (process.platform === 'win32' ? 'python' : 'python3')
}

async function probeAnalysisRuntime(config, signal) {
  const executable = analysisPythonExecutable(config)
  try {
    const result = await runProcess(executable, [
      '-c',
      'import json,cv2,numpy,PIL,scipy; print(json.dumps({"opencv":cv2.__version__,"numpy":numpy.__version__,"pillow":PIL.__version__,"scipy":scipy.__version__}))',
    ], {
      signal,
      timeoutMs: Math.min(config.helperTimeoutMs, 15000),
      maxOutputChars: config.maxOutputChars,
    })
    if (result.code !== 0) {
      return { available: false, executable, version: '', dependencies: {}, error: clip(result.stderr || result.stdout, config.maxOutputChars) }
    }
    const dependencies = JSON.parse(result.stdout.trim())
    const versionResult = await runProcess(executable, ['--version'], {
      signal,
      timeoutMs: Math.min(config.helperTimeoutMs, 15000),
      maxOutputChars: config.maxOutputChars,
    })
    return { available: true, executable, version: (versionResult.stdout || versionResult.stderr).trim(), dependencies, error: '' }
  } catch (error) {
    if (signal?.aborted) throw error
    return { available: false, executable, version: '', dependencies: {}, error: error instanceof Error ? error.message : String(error) }
  }
}

function assertHelperValue(spec, value) {
  const fail = (message) => { throw new Error(`arguments.${spec.name} ${message}`) }
  if (['string', 'path'].includes(spec.type)) {
    if (typeof value !== 'string' || value.trim() === '') fail('must be a non-empty string')
  } else if (spec.type === 'integer') {
    if (!Number.isInteger(value)) fail('must be an integer')
  } else if (spec.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) fail('must be a finite number')
  } else if (spec.type === 'boolean') {
    if (typeof value !== 'boolean') fail('must be a boolean')
  } else if (['string-array', 'path-array', 'number-array'].includes(spec.type)) {
    if (!Array.isArray(value) || (spec.required && value.length === 0)) fail('must be a non-empty array')
    const expected = spec.type === 'number-array' ? 'number' : 'string'
    if (value.some((item) => typeof item !== expected || (expected === 'number' && !Number.isFinite(item)) || (expected === 'string' && item.trim() === ''))) {
      fail(`must contain only non-empty ${expected} values`)
    }
  } else {
    fail(`uses an unsupported catalog type: ${spec.type}`)
  }
  if (spec.choices && !spec.choices.includes(value)) fail(`must be one of: ${spec.choices.join(', ')}`)
}

async function resolveHelperPath(rawPath, spec, exec, config, allowOverwrite) {
  const input = spec.pathKind?.startsWith('input-')
  const path = await resolveWorkspacePath(rawPath, exec, config, {
    mustExist: input,
    kind: `arguments.${spec.name}`,
  })
  if (spec.pathKind === 'input-file') await assertRegularFile(path, `arguments.${spec.name}`)
  if (spec.pathKind === 'input-dir') await assertDirectory(path, `arguments.${spec.name}`)
  if (spec.pathKind === 'output-file') await assertWritableTarget(path, allowOverwrite, `arguments.${spec.name}`)
  if (spec.pathKind === 'output-dir') await assertWritableDirectory(path, allowOverwrite, `arguments.${spec.name}`)
  return path
}

async function buildHelperInvocation(helper, rawArguments, exec, config, allowOverwrite) {
  const argumentsObject = rawArguments ?? {}
  if (argumentsObject === null || typeof argumentsObject !== 'object' || Array.isArray(argumentsObject)) {
    throw new Error('arguments must be an object')
  }
  const known = new Set(helper.arguments.map((spec) => spec.name))
  const unknown = Object.keys(argumentsObject).filter((key) => !known.has(key))
  if (unknown.length) throw new Error(`Unknown helper arguments: ${unknown.join(', ')}`)

  const commandArguments = []
  const outputs = []
  for (const spec of helper.arguments) {
    let candidate = argumentsObject[spec.name]
    if (candidate === undefined) {
      if (spec.required) throw new Error(`arguments.${spec.name} is required`)
      continue
    }
    assertHelperValue(spec, candidate)
    if (spec.type === 'path') {
      candidate = await resolveHelperPath(candidate, spec, exec, config, allowOverwrite)
      if (spec.pathKind?.startsWith('output-')) outputs.push(candidate)
    } else if (spec.type === 'path-array') {
      const resolved = []
      for (const item of candidate) resolved.push(await resolveHelperPath(item, spec, exec, config, allowOverwrite))
      candidate = resolved
    }

    if (spec.type === 'boolean') {
      if (candidate) commandArguments.push(spec.flag)
      continue
    }
    const values = Array.isArray(candidate) ? candidate : [candidate]
    if (!spec.positional) commandArguments.push(spec.flag)
    commandArguments.push(...values.map(String))
  }
  return { commandArguments, outputs }
}

async function listGeneratedFiles(path, limit = 200) {
  const info = await stat(path)
  if (info.isFile()) return [{ path, bytes: info.size, kind: 'file' }]
  const files = []
  const queue = [path]
  while (queue.length && files.length < limit) {
    const directory = queue.shift()
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const child = join(directory, entry.name)
      if (entry.isDirectory()) queue.push(child)
      else if (entry.isFile()) {
        const childInfo = await stat(child)
        files.push({ path: child, bytes: childInfo.size, kind: 'file' })
        if (files.length >= limit) break
      }
    }
  }
  return [{ path, bytes: 0, kind: 'directory' }, ...files]
}

async function readHelperReport(outputs, stdout) {
  for (const output of outputs) {
    if (extname(output).toLowerCase() !== '.json') continue
    try {
      const info = await stat(output)
      if (info.isFile() && info.size <= 5_000_000) return normalizeLosslessJson(JSON.parse(await readFile(output, 'utf8')))
    } catch {
      // Some helpers use optional reports; fall through to stdout.
    }
  }
  try {
    return normalizeLosslessJson(JSON.parse(stdout.trim()))
  } catch {
    return null
  }
}

async function runHelper(config, exec, helper, rawArguments, inputBlend, allowOverwrite) {
  const { commandArguments, outputs } = await buildHelperInvocation(helper, rawArguments, exec, config, allowOverwrite)
  const script = join(SKILL_ROOT, helper.script)
  await assertRegularFile(script, `helper ${helper.name}`)
  let command
  let args
  if (helper.runtime === 'blender') {
    if (!inputBlend) throw new Error(`${helper.name} requires blend_path`)
    command = config.blenderExecutable
    args = [
      inputBlend,
      '--background',
      '--disable-autoexec',
      '--python-exit-code', '1',
      '--python', HELPER_DRIVER_PATH,
      '--',
      '--script', script,
      '--arguments-json', JSON.stringify(commandArguments),
    ]
  } else {
    command = analysisPythonExecutable(config)
    args = [script, ...commandArguments]
  }
  const result = await runProcess(command, args, {
    signal: exec.signal,
    timeoutMs: config.helperTimeoutMs,
    maxOutputChars: config.maxOutputChars,
  })
  if (result.code !== 0) {
    throw new Error(`${helper.name} failed with exit ${result.code}\n${clip(`${result.stdout}\n${result.stderr}`.trim(), config.maxOutputChars)}`)
  }
  const artifacts = []
  for (const output of outputs) artifacts.push(...await listGeneratedFiles(output))
  return {
    helper: helper.name,
    module: helper.module,
    runtime: helper.runtime,
    executable: command,
    stdout: result.stdout,
    stderr: result.stderr,
    outputs: artifacts,
    report: await readHelperReport(artifacts.map((artifact) => artifact.path), result.stdout),
  }
}

function clip(text, maxChars) {
  if (text.length <= maxChars) return text
  const head = Math.floor(maxChars * 0.7)
  const tail = maxChars - head
  return `${text.slice(0, head)}\n... <${text.length - maxChars} characters omitted> ...\n${text.slice(-tail)}`
}

function normalizeLosslessJson(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Blender driver returned a non-finite number')
    return Object.is(value, -0) ? 0 : value
  }
  if (Array.isArray(value)) return value.map(normalizeLosslessJson)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeLosslessJson(item)]))
  }
  return value
}

function runProcess(command, args, { signal, timeoutMs, maxOutputChars }) {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new Error('Blender call aborted'))
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let stdout = ''
    let stderr = ''
    let settled = false
    let timedOut = false
    let aborted = false
    let hardKillTimer

    const terminate = () => {
      if (child.exitCode !== null || child.killed) return
      child.kill('SIGTERM')
      hardKillTimer = setTimeout(() => {
        if (child.exitCode === null) child.kill('SIGKILL')
      }, 2000)
      hardKillTimer.unref()
    }

    const timer = setTimeout(() => {
      timedOut = true
      terminate()
    }, timeoutMs)
    timer.unref()

    const onAbort = () => {
      aborted = true
      terminate()
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    child.stdout.on('data', (chunk) => {
      stdout = clip(stdout + chunk.toString('utf8'), maxOutputChars)
    })
    child.stderr.on('data', (chunk) => {
      stderr = clip(stderr + chunk.toString('utf8'), maxOutputChars)
    })
    child.once('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (hardKillTimer !== undefined) clearTimeout(hardKillTimer)
      signal?.removeEventListener('abort', onAbort)
      rejectPromise(error)
    })
    child.once('close', (code, closeSignal) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (hardKillTimer !== undefined) clearTimeout(hardKillTimer)
      signal?.removeEventListener('abort', onAbort)
      if (aborted) {
        rejectPromise(signal?.reason ?? new Error('Blender call aborted'))
        return
      }
      if (timedOut) {
        rejectPromise(new Error(`Blender timed out after ${timeoutMs} ms`))
        return
      }
      resolvePromise({ code: code ?? 1, signal: closeSignal, stdout, stderr })
    })
  })
}

async function runBlender(config, exec, operation, payload, inputBlend) {
  const tempDir = await mkdtemp(join(tmpdir(), 'dsh-blender-'))
  const payloadPath = join(tempDir, 'payload.json')
  const resultPath = join(tempDir, 'result.json')
  await writeFile(payloadPath, JSON.stringify(payload), 'utf8')
  const args = inputBlend === undefined
    ? ['--background', '--factory-startup']
    : [inputBlend, '--background']
  args.push(
    '--disable-autoexec',
    '--python-exit-code', '1',
    '--python', DRIVER_PATH,
    '--',
    '--operation', operation,
    '--payload', payloadPath,
    '--result', resultPath,
  )

  try {
    const processResult = await runProcess(config.blenderExecutable, args, {
      signal: exec?.signal,
      timeoutMs: config.timeoutMs,
      maxOutputChars: config.maxOutputChars,
    })
    let driverResult
    try {
      driverResult = normalizeLosslessJson(JSON.parse(await readFile(resultPath, 'utf8')))
    } catch (error) {
      const diagnostics = clip(`${processResult.stdout}\n${processResult.stderr}`.trim(), config.maxOutputChars)
      throw new Error(`Blender produced no valid driver result (exit ${processResult.code}).\n${diagnostics}`, { cause: error })
    }
    if (processResult.code !== 0 || driverResult.ok !== true) {
      const message = driverResult.error ?? `Blender exited with code ${processResult.code}`
      const diagnostics = clip(`${driverResult.traceback ?? ''}\n${processResult.stdout}\n${processResult.stderr}`.trim(), config.maxOutputChars)
      throw new Error(`${message}${diagnostics === '' ? '' : `\n${diagnostics}`}`)
    }
    return {
      ...driverResult,
      log: clip(`${processResult.stdout}\n${processResult.stderr}`.trim(), config.maxOutputChars),
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

function renderJson(value) {
  return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
}

function createTools(config) {
  const tools = []

  tools.push(defineTool({
    name: 'blender_status',
    description: 'Check whether Blender is available and report its version plus the current dsh workspace root. Call this before the first modeling operation.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          available: { type: 'boolean', required: true },
          executable: { type: 'string', required: true },
          version: { type: 'string', required: true },
          analysis: { type: 'object', additionalProperties: true, required: true },
          registeredSkills: { type: 'integer', required: true },
          helperCount: { type: 'integer', required: true },
          capabilities: { type: 'array', items: { type: 'string' }, required: true },
          workspaceRoot: { type: 'string', required: true },
        },
      },
      render: (_args, value) => renderJson(value),
    },
    isConcurrencySafe: () => true,
    async execute(_args, exec) {
      const analysisPromise = config.enableHelpers
        ? probeAnalysisRuntime(config, exec.signal)
        : Promise.resolve({ available: false, executable: analysisPythonExecutable(config), version: '', dependencies: {}, error: 'helpers disabled by configuration' })
      try {
        const [result, analysis] = await Promise.all([
          runProcess(config.blenderExecutable, ['--version'], {
            signal: exec.signal,
            timeoutMs: Math.min(config.timeoutMs, 15000),
            maxOutputChars: config.maxOutputChars,
          }),
          analysisPromise,
        ])
        return {
          available: result.code === 0,
          executable: config.blenderExecutable,
          version: result.stdout.split(/\r?\n/u)[0]?.trim() ?? '',
          analysis,
          registeredSkills: config.registerSkill ? (config.registerModuleSkills ? 30 : 1) : 0,
          helperCount: config.enableHelpers ? HELPER_CATALOG.filter((helper) => config.enableMaintenanceHelpers || !helper.maintenance).length : 0,
          capabilities: [
            'scene-inspection', 'object-inspection', 'model-import', 'blender-python', 'camera-free-preview',
            'still-render', 'animation-frame-render', 'model-export', 'scene-validation', 'export-reimport-validation',
            ...(config.enableHelpers ? ['reference-analysis', 'wireframe-analysis', 'multiview-fit', 'texture-and-animation-qa'] : []),
          ],
          workspaceRoot: sessionWorkspace(exec),
        }
      } catch (error) {
        if (exec.signal.aborted) throw error
        const analysis = await analysisPromise
        return {
          available: false,
          executable: config.blenderExecutable,
          version: error instanceof Error ? error.message : String(error),
          analysis,
          registeredSkills: config.registerSkill ? (config.registerModuleSkills ? 30 : 1) : 0,
          helperCount: config.enableHelpers ? HELPER_CATALOG.filter((helper) => config.enableMaintenanceHelpers || !helper.maintenance).length : 0,
          capabilities: [],
          workspaceRoot: sessionWorkspace(exec),
        }
      }
    },
  }))

  tools.push(defineTool({
    name: 'blender_scene_info',
    description: 'Inspect a Blender .blend file without modifying it. Returns scene, object, transform, dimension, material, topology, camera, frame, and unit summaries.',
    parameters: {
      blend_path: { type: 'string', required: true, description: 'Workspace-relative or absolute .blend path inside the current dsh workspace.' },
      max_objects: { type: 'integer', description: 'Maximum objects to return; defaults to 200.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          blendPath: { type: 'string', required: true },
          scene: { ...sceneSchema, required: true },
          log: { ...logSchema, required: true },
        },
      },
      render: (_args, value) => renderJson(value),
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const blendPath = await resolveWorkspacePath(args.blend_path, exec, config, { mustExist: true, kind: 'blend_path' })
      await assertRegularFile(blendPath, 'blend_path')
      if (extname(blendPath).toLowerCase() !== '.blend') throw new Error('blend_path must end in .blend')
      const maxObjects = args.max_objects ?? 200
      if (!Number.isInteger(maxObjects) || maxObjects < 1 || maxObjects > 5000) throw new Error('max_objects must be an integer between 1 and 5000')
      const result = await runBlender(config, exec, 'inspect', { max_objects: maxObjects }, blendPath)
      return { blendPath, scene: result.scene, log: result.log }
    },
  }))

  tools.push(defineTool({
    name: 'blender_object_info',
    description: 'Inspect named Blender objects without modifying the .blend. Returns world bounds, transforms, evaluated topology, materials, UV/color layers, modifiers, constraints, vertex groups, shape keys, and animation state. Omit object_names to inspect the active object.',
    parameters: {
      blend_path: { type: 'string', required: true, description: 'Existing .blend file inside the current dsh workspace.' },
      object_names: { type: 'array', items: { type: 'string' }, description: 'Object names to inspect. Omit to use the active object.' },
      evaluated: { type: 'boolean', description: 'Include evaluated post-modifier mesh counts; defaults to true.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          blendPath: { type: 'string', required: true },
          objects: { type: 'array', items: { type: 'object', additionalProperties: true }, required: true },
          missing: { type: 'array', items: { type: 'string' }, required: true },
          log: { ...logSchema, required: true },
        },
      },
      render: (_args, value) => renderJson(value),
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const blendPath = await resolveWorkspacePath(args.blend_path, exec, config, { mustExist: true, kind: 'blend_path' })
      await assertRegularFile(blendPath, 'blend_path')
      if (extname(blendPath).toLowerCase() !== '.blend') throw new Error('blend_path must end in .blend')
      const objectNames = args.object_names ?? []
      if (objectNames.some((item) => typeof item !== 'string' || item.trim() === '')) throw new Error('object_names must contain non-empty strings')
      const result = await runBlender(config, exec, 'inspect_object', {
        object_names: objectNames,
        evaluated: args.evaluated !== false,
      }, blendPath)
      return { blendPath, objects: result.objects, missing: result.missing, log: result.log }
    },
  }))

  tools.push(defineTool({
    name: 'blender_import',
    description: 'Import an existing GLB/glTF, FBX, OBJ, STL, USD, PLY, or Collada asset into a clean Blender scene and save a versioned .blend engineering source. Use before editing portable assets that are not already .blend files.',
    parameters: {
      source_path: { type: 'string', required: true, description: 'Existing portable model path inside the workspace.' },
      save_path: { type: 'string', required: true, description: 'New .blend output path inside the workspace.' },
      allow_overwrite: { type: 'boolean', description: 'Allow replacing save_path; defaults to false.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          sourcePath: { type: 'string', required: true },
          blendPath: { type: 'string', required: true },
          bytes: { type: 'integer', required: true },
          importedObjects: { type: 'array', items: { type: 'string' }, required: true },
          scene: { ...sceneSchema, required: true },
          log: { ...logSchema, required: true },
        },
      },
      render: (_args, value) => renderJson(value),
    },
    async execute(args, exec) {
      const sourcePath = await resolveWorkspacePath(args.source_path, exec, config, { mustExist: true, kind: 'source_path' })
      await assertRegularFile(sourcePath, 'source_path')
      const sourceFormat = extname(sourcePath).toLowerCase()
      if (!SUPPORTED_IMPORTS.has(sourceFormat)) throw new Error(`Unsupported import extension: ${sourceFormat || '(none)'}`)
      const savePath = await resolveWorkspacePath(args.save_path, exec, config, { kind: 'save_path' })
      if (extname(savePath).toLowerCase() !== '.blend') throw new Error('save_path must end in .blend')
      await assertWritableTarget(savePath, args.allow_overwrite === true, 'save_path')
      const result = await runBlender(config, exec, 'import', {
        source_path: sourcePath,
        output_path: savePath,
      })
      const info = await assertRegularFile(savePath, 'Blender import output')
      return {
        sourcePath,
        blendPath: savePath,
        bytes: info.size,
        importedObjects: result.imported_objects,
        scene: result.scene,
        log: result.log,
      }
    },
  }))

  if (config.enablePython) {
    tools.push(defineTool({
      name: 'blender_python',
      description: 'Execute reviewed bpy/bmesh Python in Blender background mode and save a versioned .blend result. The script receives bpy, bmesh, mathutils, workspace, input_path, output_path, and may set dsh_result to JSON-safe evidence. Use small idempotent chunks; never use this for filesystem, network, package-install, or unrelated process work.',
      parameters: {
        script: { type: 'string', required: true, description: 'Blender Python modeling code. Keep it scoped, deterministic, and retryable.' },
        save_path: { type: 'string', required: true, description: 'New versioned .blend output path inside the current dsh workspace.' },
        blend_path: { type: 'string', description: 'Optional existing .blend input inside the current dsh workspace. Omit to start from factory startup.' },
        allow_overwrite: { type: 'boolean', description: 'Allow replacing save_path. Defaults to false and should be used only with explicit user intent.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            blendPath: { type: 'string', required: true },
            bytes: { type: 'integer', required: true },
            scene: { ...sceneSchema, required: true },
            scriptResult: { type: 'json', required: true },
            log: { ...logSchema, required: true },
          },
        },
        render: (_args, value) => renderJson(value),
      },
      async execute(args, exec) {
        if (args.script.trim() === '') throw new Error('script must not be empty')
        const savePath = await resolveWorkspacePath(args.save_path, exec, config, { kind: 'save_path' })
        if (extname(savePath).toLowerCase() !== '.blend') throw new Error('save_path must end in .blend')
        await assertWritableTarget(savePath, args.allow_overwrite === true, 'save_path')
        let inputBlend
        if (args.blend_path !== undefined) {
          inputBlend = await resolveWorkspacePath(args.blend_path, exec, config, { mustExist: true, kind: 'blend_path' })
          await assertRegularFile(inputBlend, 'blend_path')
          if (extname(inputBlend).toLowerCase() !== '.blend') throw new Error('blend_path must end in .blend')
          if (inputBlend === savePath && args.allow_overwrite !== true) throw new Error('Refusing to overwrite the input .blend; choose a versioned save_path')
        }
        const result = await runBlender(config, exec, 'execute', {
          script: args.script,
          workspace: sessionWorkspace(exec),
          input_path: inputBlend ?? '',
          output_path: savePath,
        }, inputBlend)
        const info = await assertRegularFile(savePath, 'Blender save output')
        return {
          blendPath: savePath,
          bytes: info.size,
          scene: result.scene,
          scriptResult: result.script_result ?? {},
          log: result.log,
        }
      },
    }))
  }

  tools.push(defineTool({
    name: 'blender_preview',
    description: 'Create a temporary camera-and-light preview from a .blend without modifying the saved scene. Supports isometric, front, back, left, right, top, and bottom views and can frame named objects. Call read_image on imagePath after success.',
    parameters: {
      blend_path: { type: 'string', required: true, description: 'Existing .blend file inside the workspace.' },
      output_path: { type: 'string', required: true, description: 'New PNG or JPEG preview path inside the workspace.' },
      view: { type: 'string', description: 'isometric, front, back, left, right, top, or bottom; defaults to isometric.' },
      object_names: { type: 'array', items: { type: 'string' }, description: 'Optional objects to frame; defaults to all visible renderable objects.' },
      orthographic: { type: 'boolean', description: 'Force orthographic/perspective projection. Axis views default to orthographic.' },
      focal_length: { type: 'number', description: 'Perspective focal length in millimeters; defaults to 50.' },
      width: { type: 'integer', description: 'Preview width; defaults to 768.' },
      height: { type: 'integer', description: 'Preview height; defaults to 768.' },
      samples: { type: 'integer', description: 'Render samples; defaults to 32.' },
      transparent: { type: 'boolean', description: 'Enable transparent film; defaults to false.' },
      allow_overwrite: { type: 'boolean', description: 'Allow replacing output_path; defaults to false.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          imagePath: { type: 'string', required: true },
          bytes: { type: 'integer', required: true },
          view: { type: 'string', required: true },
          bounds: { type: 'object', additionalProperties: true, required: true },
          width: { type: 'integer', required: true },
          height: { type: 'integer', required: true },
          log: { ...logSchema, required: true },
        },
      },
      render: (_args, value) => renderJson(value),
    },
    async execute(args, exec) {
      const blendPath = await resolveWorkspacePath(args.blend_path, exec, config, { mustExist: true, kind: 'blend_path' })
      await assertRegularFile(blendPath, 'blend_path')
      if (extname(blendPath).toLowerCase() !== '.blend') throw new Error('blend_path must end in .blend')
      const outputPath = await resolveWorkspacePath(args.output_path, exec, config, { kind: 'output_path' })
      if (!SUPPORTED_RENDERS.has(extname(outputPath).toLowerCase())) throw new Error('output_path must end in .png, .jpg, or .jpeg')
      await assertWritableTarget(outputPath, args.allow_overwrite === true, 'output_path')
      const view = args.view ?? 'isometric'
      if (!['isometric', 'front', 'back', 'left', 'right', 'top', 'bottom'].includes(view)) throw new Error('view must be isometric, front, back, left, right, top, or bottom')
      const width = args.width ?? 768
      const height = args.height ?? 768
      const samples = args.samples ?? 32
      for (const [label, candidate, max] of [['width', width, 8192], ['height', height, 8192], ['samples', samples, 4096]]) {
        if (!Number.isInteger(candidate) || candidate < 1 || candidate > max) throw new Error(`${label} must be an integer between 1 and ${max}`)
      }
      const focalLength = args.focal_length ?? 50
      if (!Number.isFinite(focalLength) || focalLength < 1 || focalLength > 500) throw new Error('focal_length must be between 1 and 500')
      const result = await runBlender(config, exec, 'preview', {
        output_path: outputPath,
        view,
        object_names: args.object_names ?? [],
        orthographic: args.orthographic,
        focal_length: focalLength,
        width,
        height,
        samples,
        transparent: args.transparent === true,
      }, blendPath)
      const info = await assertRegularFile(outputPath, 'preview output')
      return { imagePath: outputPath, bytes: info.size, view, bounds: result.bounds, width, height, log: result.log }
    },
  }))

  tools.push(defineTool({
    name: 'blender_render',
    description: 'Render a Blender scene to PNG or JPEG for visual QA. After this succeeds, call read_image on imagePath and actually inspect the image before claiming visual completion.',
    parameters: {
      blend_path: { type: 'string', required: true, description: 'Existing .blend file inside the current dsh workspace.' },
      output_path: { type: 'string', required: true, description: 'New .png, .jpg, or .jpeg output inside the workspace.' },
      camera: { type: 'string', description: 'Optional camera object name; otherwise uses scene.camera.' },
      frame: { type: 'integer', description: 'Optional frame to render; otherwise uses the scene current frame.' },
      width: { type: 'integer', description: 'Render width; defaults to 768.' },
      height: { type: 'integer', description: 'Render height; defaults to 768.' },
      samples: { type: 'integer', description: 'Render samples; defaults to 64.' },
      transparent: { type: 'boolean', description: 'Enable transparent film; defaults to false.' },
      allow_overwrite: { type: 'boolean', description: 'Allow replacing output_path; defaults to false.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          imagePath: { type: 'string', required: true },
          bytes: { type: 'integer', required: true },
          width: { type: 'integer', required: true },
          height: { type: 'integer', required: true },
          log: { ...logSchema, required: true },
        },
      },
      render: (_args, value) => renderJson(value),
    },
    async execute(args, exec) {
      const blendPath = await resolveWorkspacePath(args.blend_path, exec, config, { mustExist: true, kind: 'blend_path' })
      await assertRegularFile(blendPath, 'blend_path')
      if (extname(blendPath).toLowerCase() !== '.blend') throw new Error('blend_path must end in .blend')
      const outputPath = await resolveWorkspacePath(args.output_path, exec, config, { kind: 'output_path' })
      if (!SUPPORTED_RENDERS.has(extname(outputPath).toLowerCase())) throw new Error('output_path must end in .png, .jpg, or .jpeg')
      await assertWritableTarget(outputPath, args.allow_overwrite === true, 'output_path')
      const width = args.width ?? 768
      const height = args.height ?? 768
      const samples = args.samples ?? 64
      for (const [label, value, max] of [['width', width, 8192], ['height', height, 8192], ['samples', samples, 4096]]) {
        if (!Number.isInteger(value) || value < 1 || value > max) throw new Error(`${label} must be an integer between 1 and ${max}`)
      }
      const result = await runBlender(config, exec, 'render', {
        output_path: outputPath,
        camera: args.camera ?? '',
        width,
        height,
        samples,
        transparent: args.transparent === true,
        frame: args.frame,
      }, blendPath)
      const info = await assertRegularFile(outputPath, 'render output')
      return { imagePath: outputPath, bytes: info.size, width, height, log: result.log }
    },
  }))

  tools.push(defineTool({
    name: 'blender_render_frames',
    description: 'Render selected animation frames from a Blender scene to a versioned PNG/JPEG sequence. Use representative frames for animation QA, then create a contact sheet with blender_helper_run(animation-contact-sheet).',
    parameters: {
      blend_path: { type: 'string', required: true, description: 'Existing .blend file inside the workspace.' },
      output_dir: { type: 'string', required: true, description: 'New output directory inside the workspace.' },
      frames: { type: 'array', items: { type: 'integer' }, description: 'Explicit frame numbers. Use this or start/end/step.' },
      start: { type: 'integer', description: 'First frame when frames is omitted.' },
      end: { type: 'integer', description: 'Last frame when frames is omitted.' },
      step: { type: 'integer', description: 'Frame step; defaults to 1.' },
      camera: { type: 'string', description: 'Optional camera object name.' },
      prefix: { type: 'string', description: 'Output basename prefix; defaults to frame.' },
      format: { type: 'string', description: 'png, jpg, or jpeg; defaults to png.' },
      width: { type: 'integer', description: 'Render width; defaults to 768.' },
      height: { type: 'integer', description: 'Render height; defaults to 768.' },
      samples: { type: 'integer', description: 'Render samples; defaults to 32.' },
      transparent: { type: 'boolean', description: 'Enable transparent film; defaults to false.' },
      allow_overwrite: { type: 'boolean', description: 'Allow using an existing output directory; defaults to false.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          outputDir: { type: 'string', required: true },
          frames: { type: 'array', items: { type: 'integer' }, required: true },
          imagePaths: { type: 'array', items: { type: 'string' }, required: true },
          bytes: { type: 'integer', required: true },
          width: { type: 'integer', required: true },
          height: { type: 'integer', required: true },
          log: { ...logSchema, required: true },
        },
      },
      render: (_args, value) => renderJson(value),
    },
    async execute(args, exec) {
      const blendPath = await resolveWorkspacePath(args.blend_path, exec, config, { mustExist: true, kind: 'blend_path' })
      await assertRegularFile(blendPath, 'blend_path')
      if (extname(blendPath).toLowerCase() !== '.blend') throw new Error('blend_path must end in .blend')
      const outputDir = await resolveWorkspacePath(args.output_dir, exec, config, { kind: 'output_dir' })
      await assertWritableDirectory(outputDir, args.allow_overwrite === true, 'output_dir')
      let frames = args.frames
      if (frames === undefined) {
        if (!Number.isInteger(args.start) || !Number.isInteger(args.end)) throw new Error('Provide frames or integer start and end values')
        const step = args.step ?? 1
        if (!Number.isInteger(step) || step < 1) throw new Error('step must be a positive integer')
        if (args.end < args.start) throw new Error('end must be greater than or equal to start')
        frames = []
        for (let frame = args.start; frame <= args.end; frame += step) frames.push(frame)
      }
      if (!Array.isArray(frames) || frames.length === 0 || frames.length > 1000 || frames.some((frame) => !Number.isInteger(frame))) {
        throw new Error('frames must contain 1 to 1000 integers')
      }
      const width = args.width ?? 768
      const height = args.height ?? 768
      const samples = args.samples ?? 32
      for (const [label, candidate, max] of [['width', width, 8192], ['height', height, 8192], ['samples', samples, 4096]]) {
        if (!Number.isInteger(candidate) || candidate < 1 || candidate > max) throw new Error(`${label} must be an integer between 1 and ${max}`)
      }
      const format = args.format ?? 'png'
      if (!['png', 'jpg', 'jpeg'].includes(format)) throw new Error('format must be png, jpg, or jpeg')
      const prefix = args.prefix ?? 'frame'
      if (!/^[A-Za-z0-9._-]+$/u.test(prefix)) throw new Error('prefix may contain only letters, digits, dot, underscore, and hyphen')
      const result = await runBlender(config, exec, 'render_frames', {
        output_dir: outputDir,
        frames,
        camera: args.camera ?? '',
        prefix,
        format,
        width,
        height,
        samples,
        transparent: args.transparent === true,
      }, blendPath)
      let bytes = 0
      for (const imagePath of result.image_paths) bytes += (await assertRegularFile(imagePath, 'render frame')).size
      return { outputDir, frames: result.frames, imagePaths: result.image_paths, bytes, width, height, log: result.log }
    },
  }))

  tools.push(defineTool({
    name: 'blender_export',
    description: 'Export a .blend scene to a portable 3D file. Supports GLB/glTF, FBX, OBJ, STL, USD/USDA/USDC, and PLY. Prefer GLB when the user does not specify a format, then verify the non-empty export.',
    parameters: {
      blend_path: { type: 'string', required: true, description: 'Existing .blend file inside the current dsh workspace.' },
      output_path: { type: 'string', required: true, description: 'New portable model path inside the workspace; extension selects format.' },
      selection_only: { type: 'boolean', description: 'Export selected objects only; defaults to false.' },
      allow_overwrite: { type: 'boolean', description: 'Allow replacing output_path; defaults to false.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          modelPath: { type: 'string', required: true },
          format: { type: 'string', required: true },
          bytes: { type: 'integer', required: true },
          log: { ...logSchema, required: true },
        },
      },
      render: (_args, value) => renderJson(value),
    },
    async execute(args, exec) {
      const blendPath = await resolveWorkspacePath(args.blend_path, exec, config, { mustExist: true, kind: 'blend_path' })
      await assertRegularFile(blendPath, 'blend_path')
      if (extname(blendPath).toLowerCase() !== '.blend') throw new Error('blend_path must end in .blend')
      const outputPath = await resolveWorkspacePath(args.output_path, exec, config, { kind: 'output_path' })
      const format = extname(outputPath).toLowerCase()
      if (!SUPPORTED_EXPORTS.has(format)) throw new Error(`Unsupported export extension: ${format || '(none)'}`)
      await assertWritableTarget(outputPath, args.allow_overwrite === true, 'output_path')
      const result = await runBlender(config, exec, 'export', {
        output_path: outputPath,
        selection_only: args.selection_only === true,
      }, blendPath)
      const info = await assertRegularFile(outputPath, 'export output')
      return { modelPath: outputPath, format: format.slice(1), bytes: info.size, log: result.log }
    },
  }))

  tools.push(defineTool({
    name: 'blender_validate_scene',
    description: 'Run a non-mutating structural audit of a .blend scene or named objects. Profiles: general, web, 3d-print, and animation. Reports mesh topology, non-manifold/loose geometry, UVs, materials, transforms, animation presence, warnings, and hard failures.',
    parameters: {
      blend_path: { type: 'string', required: true, description: 'Existing .blend file inside the workspace.' },
      profile: { type: 'string', description: 'general, web, 3d-print, or animation; defaults to general.' },
      object_names: { type: 'array', items: { type: 'string' }, description: 'Optional scope. Omit to audit the full scene.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          blendPath: { type: 'string', required: true },
          profile: { type: 'string', required: true },
          passed: { type: 'boolean', required: true },
          errors: { type: 'array', items: { type: 'object', additionalProperties: true }, required: true },
          warnings: { type: 'array', items: { type: 'object', additionalProperties: true }, required: true },
          objects: { type: 'array', items: { type: 'object', additionalProperties: true }, required: true },
          scene: { ...sceneSchema, required: true },
          log: { ...logSchema, required: true },
        },
      },
      render: (_args, value) => renderJson(value),
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const blendPath = await resolveWorkspacePath(args.blend_path, exec, config, { mustExist: true, kind: 'blend_path' })
      await assertRegularFile(blendPath, 'blend_path')
      if (extname(blendPath).toLowerCase() !== '.blend') throw new Error('blend_path must end in .blend')
      const profile = args.profile ?? 'general'
      if (!['general', 'web', '3d-print', 'animation'].includes(profile)) throw new Error('profile must be general, web, 3d-print, or animation')
      const result = await runBlender(config, exec, 'validate_scene', {
        profile,
        object_names: args.object_names ?? [],
      }, blendPath)
      return {
        blendPath,
        profile,
        passed: result.passed,
        errors: result.errors,
        warnings: result.warnings,
        objects: result.objects,
        scene: result.scene,
        log: result.log,
      }
    },
  }))

  tools.push(defineTool({
    name: 'blender_validate_export',
    description: 'Re-import a portable 3D asset into a clean Blender process, inspect the imported scene, and run target-specific structural validation. Use after blender_export to catch empty geometry, broken formats, missing UV/material state, non-manifold print meshes, or missing animation.',
    parameters: {
      model_path: { type: 'string', required: true, description: 'Existing GLB/glTF, FBX, OBJ, STL, USD, PLY, or DAE asset inside the workspace.' },
      profile: { type: 'string', description: 'general, web, 3d-print, or animation; defaults by extension.' },
      object_names: { type: 'array', items: { type: 'string' }, description: 'Optional imported-object scope.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          modelPath: { type: 'string', required: true },
          format: { type: 'string', required: true },
          importedObjects: { type: 'array', items: { type: 'string' }, required: true },
          scene: { ...sceneSchema, required: true },
          validation: { type: 'object', additionalProperties: true, required: true },
          log: { ...logSchema, required: true },
        },
      },
      render: (_args, value) => renderJson(value),
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const modelPath = await resolveWorkspacePath(args.model_path, exec, config, { mustExist: true, kind: 'model_path' })
      await assertRegularFile(modelPath, 'model_path')
      const format = extname(modelPath).toLowerCase()
      if (!SUPPORTED_IMPORTS.has(format)) throw new Error(`Unsupported validation extension: ${format || '(none)'}`)
      const profile = args.profile ?? (format === '.stl' ? '3d-print' : 'web')
      if (!['general', 'web', '3d-print', 'animation'].includes(profile)) throw new Error('profile must be general, web, 3d-print, or animation')
      const result = await runBlender(config, exec, 'validate_asset', {
        source_path: modelPath,
        profile,
        object_names: args.object_names ?? [],
      })
      return {
        modelPath,
        format: format.slice(1),
        importedObjects: result.imported_objects,
        scene: result.scene,
        validation: result.validation,
        log: result.log,
      }
    },
  }))

  if (config.enableHelpers) {
    tools.push(defineTool({
      name: 'blender_helper_catalog',
      description: 'List the bundled deterministic reference-analysis, wireframe, contour, multiview, UV, texture, look, repair, and animation-QA helpers with their exact arguments and dependency availability. Call before blender_helper_run when the needed helper or fields are uncertain.',
      parameters: {
        module: { type: 'string', description: 'Optional module name filter.' },
        include_maintenance: { type: 'boolean', description: 'Show maintenance-only helpers when enabled by plugin configuration.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            analysis: { type: 'object', additionalProperties: true, required: true },
            helpers: { type: 'array', items: { type: 'object', additionalProperties: true }, required: true },
          },
        },
        render: (_args, value) => renderJson(value),
      },
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const analysis = await probeAnalysisRuntime(config, exec.signal)
        const helpers = HELPER_CATALOG
          .filter((helper) => !args.module || helper.module === args.module)
          .filter((helper) => !helper.maintenance || (config.enableMaintenanceHelpers && args.include_maintenance === true))
          .map((helper) => ({
            name: helper.name,
            module: helper.module,
            description: helper.description,
            runtime: helper.runtime,
            dependencies: helper.dependencies,
            available: helper.runtime === 'blender' || helper.dependencies.length === 0 || analysis.available,
            requiresBlend: helper.requiresBlend === true,
            arguments: helper.arguments.map(({ name, type, pathKind, required, choices, positional }) => ({
              name,
              type,
              pathKind: pathKind ?? '',
              required: required === true,
              choices: choices ?? [],
              positional: positional === true,
            })),
          }))
        return { analysis, helpers }
      },
    }))

    tools.push(defineTool({
      name: 'blender_helper_run',
      description: 'Run one whitelisted bundled helper by catalog name with structured arguments. All input and output paths remain inside the dsh workspace. Covers all 26 upstream analysis/validation helpers; maintenance helpers stay blocked unless explicitly enabled in plugin configuration.',
      parameters: {
        helper: { type: 'string', required: true, description: 'Exact helper name from blender_helper_catalog.' },
        arguments: { type: 'json', required: true, description: 'Object keyed by the helper argument names returned by blender_helper_catalog.' },
        blend_path: { type: 'string', description: 'Required only for helpers whose runtime is Blender.' },
        allow_overwrite: { type: 'boolean', description: 'Allow replacing declared outputs; defaults to false.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            helper: { type: 'string', required: true },
            module: { type: 'string', required: true },
            runtime: { type: 'string', required: true },
            executable: { type: 'string', required: true },
            stdout: { type: 'string', required: true },
            stderr: { type: 'string', required: true },
            outputs: { type: 'array', items: { type: 'object', additionalProperties: true }, required: true },
            report: { type: 'json', required: true },
          },
        },
        render: (_args, value) => renderJson(value),
      },
      async execute(args, exec) {
        const helper = HELPER_BY_NAME.get(args.helper)
        if (!helper) throw new Error(`Unknown helper: ${args.helper}`)
        if (helper.maintenance && !config.enableMaintenanceHelpers) {
          throw new Error(`${helper.name} is a maintenance helper and is disabled by configuration`)
        }
        let inputBlend
        if (helper.requiresBlend) {
          if (args.blend_path === undefined) throw new Error(`${helper.name} requires blend_path`)
          inputBlend = await resolveWorkspacePath(args.blend_path, exec, config, { mustExist: true, kind: 'blend_path' })
          await assertRegularFile(inputBlend, 'blend_path')
          if (extname(inputBlend).toLowerCase() !== '.blend') throw new Error('blend_path must end in .blend')
        }
        return runHelper(config, exec, helper, args.arguments, inputBlend, args.allow_overwrite === true)
      },
    }))
  }

  return tools
}

export function apply(ctx, config) {
  assertConfig(config)
  if (config.registerSkill) registerSkills(ctx, config)
  for (const tool of createTools(config)) ctx.tools.register(tool)
}

export const internals = {
  createTools,
  isWithin,
  resolveWorkspacePath,
  runBlender,
  normalizeLosslessJson,
  sessionWorkspace,
  buildHelperInvocation,
  analysisPythonExecutable,
  readSkillDefinition,
}
