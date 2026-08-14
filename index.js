import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineTool } from '@deepseek-ai/dsh-tools'
import Schema from '@deepseek-ai/schemastery'

export const name = 'blender-modeling'
export const inject = ['tools', 'skills']

export const Config = Schema.object({
  blenderExecutable: Schema.string().default('blender'),
  timeoutMs: Schema.number().default(180000),
  maxOutputChars: Schema.number().default(20000),
  restrictToWorkspace: Schema.boolean().default(true),
  enablePython: Schema.boolean().default(true),
  registerSkill: Schema.boolean().default(true),
})

const PACKAGE_ROOT = dirname(fileURLToPath(import.meta.url))
const DRIVER_PATH = join(PACKAGE_ROOT, 'scripts', 'dsh_blender_driver.py')
const SKILL_ROOT = join(PACKAGE_ROOT, 'skills', 'create-3d-model')
const SKILL_PATH = join(SKILL_ROOT, 'SKILL.md')
const SUPPORTED_EXPORTS = new Set(['.glb', '.gltf', '.fbx', '.obj', '.stl', '.usd', '.usda', '.usdc', '.ply'])
const SUPPORTED_RENDERS = new Set(['.png', '.jpg', '.jpeg'])

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
  if (!Number.isInteger(config.maxOutputChars) || config.maxOutputChars < 1000) {
    throw new Error('blender-modeling: maxOutputChars must be an integer of at least 1000')
  }
  if (config.blenderExecutable.trim() === '') {
    throw new Error('blender-modeling: blenderExecutable must not be empty')
  }
  if (!existsSync(DRIVER_PATH)) {
    throw new Error(`blender-modeling: bundled driver is missing at ${DRIVER_PATH}`)
  }
}

function readSkillBody() {
  const raw = readFileSync(SKILL_PATH, 'utf8')
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/u.exec(raw)
  if (match === null) throw new Error(`blender-modeling: invalid skill frontmatter at ${SKILL_PATH}`)
  return match[1].trim()
}

function registerSkill(ctx) {
  ctx.skills.register({
    name: 'create-3d-model',
    description: 'Create and refine portable 3D models with Blender from text, images, wireframes, multiview references, textures, or existing assets. Use for geometry, materials, UVs, lighting, animation, rendering, validation, and GLB/Blend delivery.',
    source: 'bundled',
    provider: 'dsh-blender',
    resourceBase: { kind: 'directory', path: SKILL_ROOT },
    content: readSkillBody(),
  })
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
          workspaceRoot: { type: 'string', required: true },
        },
      },
      render: (_args, value) => renderJson(value),
    },
    isConcurrencySafe: () => true,
    async execute(_args, exec) {
      try {
        const result = await runProcess(config.blenderExecutable, ['--version'], {
          signal: exec.signal,
          timeoutMs: Math.min(config.timeoutMs, 15000),
          maxOutputChars: config.maxOutputChars,
        })
        return {
          available: result.code === 0,
          executable: config.blenderExecutable,
          version: result.stdout.split(/\r?\n/u)[0]?.trim() ?? '',
          workspaceRoot: sessionWorkspace(exec),
        }
      } catch (error) {
        if (exec.signal.aborted) throw error
        return {
          available: false,
          executable: config.blenderExecutable,
          version: error instanceof Error ? error.message : String(error),
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
    name: 'blender_render',
    description: 'Render a Blender scene to PNG or JPEG for visual QA. After this succeeds, call read_image on imagePath and actually inspect the image before claiming visual completion.',
    parameters: {
      blend_path: { type: 'string', required: true, description: 'Existing .blend file inside the current dsh workspace.' },
      output_path: { type: 'string', required: true, description: 'New .png, .jpg, or .jpeg output inside the workspace.' },
      camera: { type: 'string', description: 'Optional camera object name; otherwise uses scene.camera.' },
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
      }, blendPath)
      const info = await assertRegularFile(outputPath, 'render output')
      return { imagePath: outputPath, bytes: info.size, width, height, log: result.log }
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

  return tools
}

export function apply(ctx, config) {
  assertConfig(config)
  if (config.registerSkill) registerSkill(ctx)
  for (const tool of createTools(config)) ctx.tools.register(tool)
}

export const internals = {
  createTools,
  isWithin,
  resolveWorkspacePath,
  runBlender,
  normalizeLosslessJson,
  sessionWorkspace,
}
