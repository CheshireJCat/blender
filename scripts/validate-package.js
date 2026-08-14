import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const required = [
  'package.json',
  'cordis.patch.yml',
  'index.js',
  'scripts/dsh_blender_driver.py',
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

const patch = readFileSync(join(root, 'cordis.patch.yml'), 'utf8')
assert.match(patch, /name: dsh-blender/u)

console.log(`validated dsh-blender ${manifest.version}: ${modules.length} modules, required files present`)
