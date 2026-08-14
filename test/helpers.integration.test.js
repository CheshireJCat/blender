import assert from 'node:assert/strict'
import { mkdtemp, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { internals } from '../index.js'

const integrationTest = process.env.RUN_HELPER_TESTS === '1' ? test : test.skip
const pixels = Buffer.alloc(64 * 64, 255)
for (let y = 12; y <= 51; y += 1) {
  for (let x = 12; x <= 51; x += 1) {
    if (x < 16 || x > 47 || y < 16 || y > 47) pixels[y * 64 + x] = 0
  }
}
const squarePgm = Buffer.concat([Buffer.from('P5\n64 64\n255\n'), pixels])

integrationTest('runs stdlib, OpenCV, SciPy, and Pillow helper families', { timeout: 120000 }, async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'dsh-blender-helper-test-'))
  await writeFile(join(workspace, 'front.pgm'), squarePgm)
  await writeFile(join(workspace, 'back.pgm'), squarePgm)
  const controller = new AbortController()
  const exec = { signal: controller.signal, agent: { session: { header: { cwd: workspace } } } }
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

  const catalog = await tools.get('blender_helper_catalog').execute({}, exec)
  assert.equal(catalog.analysis.available, true, catalog.analysis.error)
  assert.equal(catalog.helpers.length, 23)
  assert.equal(catalog.helpers.some((helper) => helper.name === 'release-readiness-check'), false)

  const orbit = await tools.get('blender_helper_run').execute({
    helper: 'orbit-layout-manifest',
    arguments: { out: 'reports/orbit.json', radii: [0.8, 0.95], markers: [0, 90] },
  }, exec)
  assert.equal(orbit.report.arcs.length, 4)

  const manifest = await tools.get('blender_helper_run').execute({
    helper: 'reference-manifest-compiler',
    arguments: { inputs: ['front.pgm', 'back.pgm'], out: 'reports/reference-manifest.json' },
  }, exec)
  assert.equal(manifest.report.source_files.length, 2)

  const wireframe = await tools.get('blender_helper_run').execute({
    helper: 'wireframe-analyzer',
    arguments: { image: 'front.pgm', out: 'reports/wireframe.json' },
  }, exec)
  assert.ok(wireframe.report.metadata.num_contours >= 1)

  const contactSheet = await tools.get('blender_helper_run').execute({
    helper: 'animation-contact-sheet',
    arguments: {
      frames: ['front.pgm', 'back.pgm'],
      out_image: 'reports/contact-sheet.png',
      out_report: 'reports/contact-sheet.json',
      cols: 2,
    },
  }, exec)
  assert.equal(contactSheet.report.frames.length, 2)
  assert.equal((await stat(join(workspace, 'reports/contact-sheet.png'))).isFile(), true)
})
