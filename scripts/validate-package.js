import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { HELPER_CATALOG } from '../lib/helper-catalog.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const required = [
  'package.json',
  '.npmignore',
  'cordis.patch.yml',
  'index.js',
  'scripts/dsh_blender_driver.py',
  'scripts/dsh_blender_helper_driver.py',
  'scripts/clean-package.js',
  'scripts/setup-analysis.js',
  'lib/helper-catalog.js',
  'requirements-analysis.txt',
  'skills/create-3d-model/SKILL.md',
  'skills/create-3d-model/references/dsh-integration.md',
  'skills/create-3d-model/references/capability-map.md',
  'LICENSE',
  'NOTICE',
]

for (const path of required) assert.equal(existsSync(join(root, path)), true, `missing ${path}`)

const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
assert.equal(manifest.name, 'dsh-blender')
assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
assert.equal(manifest.type, 'module')

const skill = readFileSync(join(root, 'skills/create-3d-model/SKILL.md'), 'utf8')
assert.match(skill, /^---\nname: create-3d-model\n/u)
assert.match(skill, /references\/dsh-integration\.md/u)
assert.doesNotMatch(skill, /references\/codex-integration\.md/u)

const moduleRoot = join(root, 'skills/create-3d-model/references/modules')
const modules = readdirSync(moduleRoot).filter((name) => statSync(join(moduleRoot, name)).isDirectory())
assert.equal(modules.length, 29, `expected 29 reference modules, found ${modules.length}`)
for (const module of modules) {
  assert.equal(existsSync(join(moduleRoot, module, 'SKILL.md')), true, `module ${module} lacks SKILL.md`)
}

const helperRoot = join(moduleRoot)
const helperScripts = modules.flatMap((module) => {
  const scripts = join(helperRoot, module, 'scripts')
  if (!existsSync(scripts)) return []
  return readdirSync(scripts)
    .filter((file) => file.endsWith('.py'))
    .map((file) => join('references/modules', module, 'scripts', file))
})
assert.equal(helperScripts.length, 26, `expected 26 helper scripts, found ${helperScripts.length}`)
assert.equal(HELPER_CATALOG.length, 26, `expected 26 catalog helpers, found ${HELPER_CATALOG.length}`)
assert.equal(new Set(HELPER_CATALOG.map((helper) => helper.name)).size, HELPER_CATALOG.length, 'helper names must be unique')
for (const helper of HELPER_CATALOG) {
  assert.equal(helperScripts.includes(helper.script), true, `helper catalog points at unknown script ${helper.script}`)
  assert.equal(existsSync(join(root, 'skills/create-3d-model', helper.script)), true, `helper script missing: ${helper.script}`)
  assert.equal(['python', 'blender'].includes(helper.runtime), true, `invalid helper runtime: ${helper.name}`)
}

const patch = readFileSync(join(root, 'cordis.patch.yml'), 'utf8')
assert.match(patch, /name: dsh-blender/u)

console.log(`validated dsh-blender ${manifest.version}: ${modules.length + 1} skills, ${helperScripts.length} helpers, required files present`)
