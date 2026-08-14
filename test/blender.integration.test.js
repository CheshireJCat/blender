import assert from 'node:assert/strict'
import { mkdtemp, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { internals } from '../index.js'

const integrationTest = process.env.RUN_BLENDER_TESTS === '1' ? test : test.skip

function containsNegativeZero(value) {
  if (typeof value === 'number') return Object.is(value, -0)
  if (Array.isArray(value)) return value.some(containsNegativeZero)
  if (value !== null && typeof value === 'object') return Object.values(value).some(containsNegativeZero)
  return false
}

integrationTest('creates, inspects, renders, and exports a Blender scene', { timeout: 180000 }, async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'dsh-blender-integration-'))
  const controller = new AbortController()
  const exec = {
    signal: controller.signal,
    agent: { session: { header: { cwd: workspace } } },
  }
  const config = {
    blenderExecutable: process.env.BLENDER_BIN ?? 'blender',
    analysisPythonExecutable: '',
    timeoutMs: 120000,
    helperTimeoutMs: 120000,
    maxOutputChars: 20000,
    restrictToWorkspace: true,
    enablePython: true,
    enableHelpers: true,
    enableMaintenanceHelpers: false,
    registerSkill: true,
    registerModuleSkills: true,
  }
  const tools = new Map(internals.createTools(config).map((tool) => [tool.name, tool]))

  const status = await tools.get('blender_status').execute({}, exec)
  assert.equal(status.available, true, status.version)

  const created = await tools.get('blender_python').execute({
    save_path: 'artifacts/cube-v001.blend',
    script: `
import math
from mathutils import Vector

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)

bpy.ops.mesh.primitive_cube_add(location=(0, 0, 0))
cube = bpy.context.object
cube.name = 'GEO-TestCube'
cube.scale = (1.0, 1.0, 1.0)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

mat = bpy.data.materials.new('MAT-TestBlue')
mat.diffuse_color = (0.06, 0.22, 0.8, 1.0)
cube.data.materials.append(mat)

bpy.ops.object.camera_add(location=(4.5, -4.5, 3.5))
camera = bpy.context.object
camera.name = 'CAM-Test'
direction = Vector((0, 0, 0)) - camera.location
camera.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
bpy.context.scene.camera = camera

bpy.ops.object.light_add(type='AREA', location=(2.5, -2.5, 4.0))
light = bpy.context.object
light.name = 'LGT-Key'
light.data.energy = 900
light.data.shape = 'DISK'
light.data.size = 4.0

bpy.context.scene.render.engine = 'BLENDER_EEVEE'
dsh_result = {'created': ['GEO-TestCube', 'CAM-Test', 'LGT-Key'], 'negative_zero_probe': -0.0}
`,
  }, exec)
  assert.ok(created.bytes > 0)
  assert.equal(created.scene.objectCount, 3)
  assert.equal(containsNegativeZero(created), false)

  const inspected = await tools.get('blender_scene_info').execute({
    blend_path: 'artifacts/cube-v001.blend',
  }, exec)
  assert.equal(inspected.scene.objects.some((object) => object.name === 'GEO-TestCube'), true)

  const objectInfo = await tools.get('blender_object_info').execute({
    blend_path: 'artifacts/cube-v001.blend',
    object_names: ['GEO-TestCube'],
  }, exec)
  assert.equal(objectInfo.objects[0].name, 'GEO-TestCube')
  assert.deepEqual(objectInfo.missing, [])

  const validation = await tools.get('blender_validate_scene').execute({
    blend_path: 'artifacts/cube-v001.blend',
    profile: 'web',
  }, exec)
  assert.equal(validation.passed, true)

  const preview = await tools.get('blender_preview').execute({
    blend_path: 'artifacts/cube-v001.blend',
    output_path: 'artifacts/cube-isometric.png',
    view: 'isometric',
    width: 320,
    height: 320,
    samples: 8,
  }, exec)
  assert.ok(preview.bytes > 0)

  const rendered = await tools.get('blender_render').execute({
    blend_path: 'artifacts/cube-v001.blend',
    output_path: 'artifacts/cube-preview.png',
    width: 320,
    height: 320,
    samples: 16,
  }, exec)
  assert.ok(rendered.bytes > 0)
  assert.equal((await stat(rendered.imagePath)).isFile(), true)

  const frames = await tools.get('blender_render_frames').execute({
    blend_path: 'artifacts/cube-v001.blend',
    output_dir: 'artifacts/frames',
    frames: [1, 2],
    width: 160,
    height: 160,
    samples: 4,
  }, exec)
  assert.equal(frames.imagePaths.length, 2)
  assert.ok(frames.bytes > 0)

  const coverage = await tools.get('blender_helper_run').execute({
    helper: 'surface-texture-coverage-audit',
    blend_path: 'artifacts/cube-v001.blend',
    arguments: { objects: ['GEO-TestCube'], out: 'artifacts/surface-coverage.json' },
  }, exec)
  assert.equal(coverage.report.summary.objects, 1)

  const exported = await tools.get('blender_export').execute({
    blend_path: 'artifacts/cube-v001.blend',
    output_path: 'artifacts/cube.glb',
  }, exec)
  assert.ok(exported.bytes > 0)
  assert.equal(exported.format, 'glb')
  assert.equal((await stat(exported.modelPath)).isFile(), true)

  const exportValidation = await tools.get('blender_validate_export').execute({
    model_path: 'artifacts/cube.glb',
    profile: 'web',
  }, exec)
  assert.equal(exportValidation.validation.passed, true)
  assert.equal(exportValidation.importedObjects.includes('GEO-TestCube'), true)

  const imported = await tools.get('blender_import').execute({
    source_path: 'artifacts/cube.glb',
    save_path: 'artifacts/cube-reimported.blend',
  }, exec)
  assert.ok(imported.bytes > 0)
  assert.equal(imported.importedObjects.includes('GEO-TestCube'), true)
})
