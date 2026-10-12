import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const script = fileURLToPath(import.meta.url)
const profile = 'blender-smoke'

async function runtime(host, reportPath) {
  const require = createRequire(join(host, 'package.json'))
  const load = (name) => import(pathToFileURL(require.resolve(name)).href)
  const { runProfile } = await load('@deepseek-ai/dsh/profile-boot')
  const { createLaunchEnvironmentSnapshot } = await load('@deepseek-ai/dsh-launch-environment')
  const environment = createLaunchEnvironmentSnapshot([{
    source: 'process', values: { DSH_TELEMETRY_DISABLED: '1' },
  }])
  const { ctx } = await runProfile({ environment, profile, patchFiles: [], args: [] })
  try {
    const tools = ctx.tools.schemas().map((tool) => tool.name).filter((name) => name.startsWith('blender_'))
    assert.equal(tools.length, 13)
    const workspace = await mkdtemp(join(process.env.DSH_HOME, 'workspace-'))
    const skills = (await ctx.skills.list({ cwd: workspace })).filter((skill) => skill.provider === 'dsh-blender')
    assert.equal(skills.length, 30)
    const skill = await ctx.skills.get('create-3d-model', { cwd: workspace })
    assert.match(skill.content, /blender_status/u)
    const handle = await ctx.agents.create({ sessionId: randomUUID(), meta: { cwd: workspace } })
    try {
      const executed = []
      const run = async (name, args) => {
        const result = await ctx.tools.execute({
          callId: randomUUID(), name, arguments: args, agent: handle.agent,
          signal: new AbortController().signal,
        })
        assert.equal(result.isError, false, JSON.stringify(result))
        executed.push(name)
        return result.value
      }
      const status = await run('blender_status', {})
      assert.equal(status.available, true)
      assert.equal(status.analysis.available, true)
      const created = await run('blender_python', {
        save_path: 'cube.blend',
        script: `
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.ops.mesh.primitive_cube_add()
bpy.context.object.name = 'DSH-Smoke-Cube'
mat = bpy.data.materials.new('Smoke-Material')
bpy.context.object.data.materials.append(mat)
dsh_result = {'created': 'DSH-Smoke-Cube'}
`,
      })
      assert.ok(created.bytes > 0)
      const scene = await run('blender_scene_info', { blend_path: 'cube.blend' })
      assert.equal(scene.scene.objectCount, 1)
      const object = await run('blender_object_info', { blend_path: 'cube.blend', object_names: ['DSH-Smoke-Cube'] })
      assert.equal(object.objects[0].name, 'DSH-Smoke-Cube')
      const validation = await run('blender_validate_scene', { blend_path: 'cube.blend', profile: 'web' })
      assert.equal(validation.passed, true)
      const preview = await run('blender_preview', {
        blend_path: 'cube.blend', output_path: 'preview.png', width: 160, height: 160, samples: 4,
      })
      assert.ok(preview.bytes > 0)
      const exported = await run('blender_export', { blend_path: 'cube.blend', output_path: 'cube.glb' })
      assert.ok(exported.bytes > 0)
      const reimported = await run('blender_validate_export', { model_path: 'cube.glb', profile: 'web' })
      assert.equal(reimported.validation.passed, true)
      assert.equal(reimported.importedObjects.includes('DSH-Smoke-Cube'), true)
      const catalog = await run('blender_helper_catalog', {})
      assert.equal(catalog.helpers.length, 23)
      const pixels = Buffer.alloc(64 * 64, 255)
      for (let y = 12; y <= 51; y += 1) {
        for (let x = 12; x <= 51; x += 1) {
          if (x < 16 || x > 47 || y < 16 || y > 47) pixels[y * 64 + x] = 0
        }
      }
      await writeFile(join(workspace, 'square.pgm'), Buffer.concat([Buffer.from('P5\n64 64\n255\n'), pixels]))
      const wireframe = await run('blender_helper_run', {
        helper: 'wireframe-analyzer', arguments: { image: 'square.pgm', out: 'wireframe.json' },
      })
      assert.ok(wireframe.report.metadata.num_contours >= 1)
      const escaped = await ctx.tools.execute({
        callId: randomUUID(), name: 'blender_python',
        arguments: { save_path: '../escape.blend', script: 'pass' },
        agent: handle.agent, signal: new AbortController().signal,
      })
      assert.equal(escaped.isError, true)
      assert.match(escaped.error.message, /must stay inside/u)
      await writeFile(reportPath, JSON.stringify({
        tools: tools.length, skills: skills.length, enabledHelpers: catalog.helpers.length,
        executed, pathGuard: 'passed', blender: status.version, analysis: status.analysis.dependencies,
      }, null, 2) + '\n')
    } finally {
      await handle.dispose()
    }
  } finally {
    await ctx.fiber.dispose()
  }
}

async function smoke(host, packageTarget, evidenceRoot) {
  const require = createRequire(join(host, 'package.json'))
  const cli = require.resolve('@deepseek-ai/dsh/lib/bin.js')
  const version = JSON.parse(await readFile(require.resolve('@deepseek-ai/dsh/package.json'), 'utf8')).version
  await mkdir(evidenceRoot, { recursive: true })
  const dir = await mkdtemp(join(evidenceRoot, `dsh-${version}-`))
  const env = {
    ...process.env, DSH_HOME: join(dir, 'home'), DSH_AGENTS_HOME: join(dir, 'agents'),
    DSH_TELEMETRY_DISABLED: '1', npm_config_registry: 'https://registry.npmjs.org',
  }
  const run = async (label, args) => {
    const output = []
    let timer
    const code = await new Promise((resolvePromise, rejectPromise) => {
      const child = spawn(process.execPath, args, { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] })
      timer = setTimeout(() => child.kill('SIGTERM'), 300000)
      child.stdout.on('data', (chunk) => output.push(chunk))
      child.stderr.on('data', (chunk) => output.push(chunk))
      child.once('error', rejectPromise)
      child.once('close', resolvePromise)
    }).finally(() => clearTimeout(timer))
    const text = Buffer.concat(output).toString('utf8')
    await writeFile(join(dir, `${label}.log`), text)
    assert.equal(code, 0, `${label} failed; see ${join(dir, `${label}.log`)}\n${text}`)
    return text
  }
  const plugin = (args) => [cli, 'plugin', '--profile', profile, ...args]
  const profileDir = join(env.DSH_HOME, 'profiles', profile)
  const manifest = async () => JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8'))
  console.log(`DSH ${version}: evidence ${dir}`)
  await run('install', plugin(['add', packageTarget]))
  assert.ok((await manifest()).dsh.profile.bundles.includes('dsh-blender'))
  const dump = await run('config', [cli, '--profile', profile, '--dump-config'])
  assert.match(dump, /id: blender-modeling/u)
  await run('setup', plugin(['exec', 'dsh-blender-setup']))
  await run('runtime', [script, '--runtime', host, join(dir, 'runtime.json')])
  await run('uninstall', plugin(['remove', 'dsh-blender']))
  const removed = await manifest()
  assert.equal(removed.dsh.profile.bundles.includes('dsh-blender'), false)
  assert.equal(Object.hasOwn(removed.dependencies ?? {}, 'dsh-blender'), false)
  await assert.rejects(stat(join(profileDir, 'node_modules', 'dsh-blender')), { code: 'ENOENT' })
  const cleanDump = await run('config-after-uninstall', [cli, '--profile', profile, '--dump-config'])
  assert.doesNotMatch(cleanDump, /id: blender-modeling/u)
  const report = {
    dsh: version, node: process.version, system: `${process.platform}-${process.arch}`,
    checkedAt: new Date().toISOString(), install: 'passed', start: 'passed', uninstall: 'passed', rollback: 'unknown',
    runtime: JSON.parse(await readFile(join(dir, 'runtime.json'), 'utf8')),
  }
  await writeFile(join(dir, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
}

if (process.argv[2] === '--runtime') {
  await runtime(resolve(process.argv[3]), resolve(process.argv[4]))
} else {
  const [host, packageTarget, evidenceRoot] = process.argv.slice(2)
  assert.ok(host && packageTarget, 'Usage: pnpm test:dsh <DSH host directory> <package or tarball> [evidence directory]')
  await smoke(resolve(host), packageTarget, resolve(evidenceRoot ?? tmpdir()))
}
