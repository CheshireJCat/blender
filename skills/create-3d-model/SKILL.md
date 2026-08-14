---
name: create-3d-model
description: Create and refine portable 3D models from text prompts, one or more reference images, wireframes, orthographic views, templates, texture atlases, or existing 3D assets. Use whenever the dsh agent must model or reconstruct geometry, match visual references, create materials and UVs, rig or animate a model, validate shape or multiview fidelity, repair a subpar asset, edit an existing Blender scene, or export GLB, glTF, FBX, OBJ, USD, STL, or another requested 3D format. Uses the dsh-blender tools and Blender as the production backend while treating the transferable 3D model as the normal deliverable.
---

# Create 3D Model

Turn text, images, wireframes, multiview references, or existing assets into validated 3D models. Use Blender as the production backend and editable source environment, not as the definition of the product. Inspect the inputs and open scene, route the request to the smallest relevant module set, execute controlled `bpy` changes, inspect visual evidence, iterate, export the model, and preserve the engineering source.

This DeepSeek Harness skill keeps the complete 30-part upstream capability stack inside one discoverable skill. Treat this top-level skill as the orchestrator and load the other 29 modules on demand from `references/modules/`.

## Start here

1. Read [references/dsh-integration.md](references/dsh-integration.md) before the first Blender tool call in a task.
2. Read [references/capability-map.md](references/capability-map.md) and select only the modules needed for the request.
3. When a module says to load or chain-load another skill, read `references/modules/<skill-name>/SKILL.md`. Resolve that module's relative links and scripts from its own directory.
4. Treat this file and `dsh-integration.md` as higher priority than a vendored module when tool naming, scene safety, output paths, or runtime guidance differs.

Do not read every module preemptively. Load the orchestrator or domain module first, then follow a dependency only when its gate is reached.

## Discover Blender capabilities

- Call `blender_status` before the first modeling operation. Use `blender_scene_info` for inspection, `blender_python` for small controlled `bpy` changes, `blender_render` for visual evidence, and `blender_export` for portable deliverables.
- If `blender_status.available` is false, stop and report the executable/configuration error. Do not claim Blender work completed while the backend is unavailable.
- Every file path must stay inside the current dsh workspace unless the plugin was explicitly configured otherwise. Keep Poly Haven, Sketchfab, Hyper3D, Hunyuan3D, and other network asset or generation features disabled unless the user explicitly requests them.

## Follow the production workflow

### 1. Establish the target

- Classify the input as text-only, single-image, multiview or orthographic, wireframe or technical drawing, texture or template pack, or an existing 3D asset. Combine modalities when the user supplies more than one.
- Extract the subject, intended use, style, dimensions, reference priority, primary delivery format, target runtime, animation requirements, and quality bar.
- Inspect every provided image before modeling. Record views, landmarks, silhouettes, part counts, material regions, uncertainties, and contradictions.
- For a single image, state depth, scale, occlusion, and unseen-surface assumptions. For multiple images, register their view relationship before adding depth.
- Use reversible defaults when missing information does not materially change the result. Ask one focused question only when a choice changes geometry, topology, animation, source-of-truth policy, or delivery.
- Read [references/core/common-object-dimensions.md](references/core/common-object-dimensions.md) for common subjects; prefer user-provided or authoritative dimensions.

### 2. Inspect before mutating

- Inspect the scene before the first write. Inspect each object in scope and obtain a viewport screenshot when image capture is available.
- Treat existing objects, collections, materials, lights, cameras, worlds, actions, and files as user-owned.
- Do not clear the scene, reset the world, delete the default cube, or replace the camera merely because a recipe starts from a blank scene.
- Delete startup content only when the user requested a fresh scene and inspection proves it is unchanged startup content. Otherwise create a task-specific collection and leave unrelated data alone.
- Save a versioned checkpoint before broad or destructive work. Never overwrite the user's original `.blend` without explicit authorization.

### 3. Route and plan

- For a complete scene or multi-stage asset, load `blender-pro-workflow` first, then the required domain modules.
- For multi-module or source-locked work, load `blender-skill-harmonizer` so one module owns each decision and handoff.
- For exact reference work, establish a source manifest and validation gates before creating geometry. Do not mix plausible freeform modeling with 1:1 reconstruction after fitting begins.
- Define units, origin, up axis, long/broad/thin axes, object boundaries, stable names, collection ownership, modifier strategy, output paths, and validation views before executing code.
- Prefix newly created data with `GEO-`, `MAT-`, `LGT-`, `CAM-`, `ARM-`, `COL-`, or `WGT-`.

### 4. Build from blockout to detail

- Follow [references/core/assembly-order.md](references/core/assembly-order.md) for multi-phase work.
- Establish dimensions, silhouette, camera framing, and part connectivity with the fewest primitives or contours needed.
- Capture and inspect a blockout screenshot before adding secondary detail. Fix scale, orientation, silhouette, framing, disconnected parts, and source registration first.
- Prefer Blender's data API or `bmesh` for deterministic edits. Use `bpy.ops` only with explicit active object, selection, mode, and context.
- Treat every code-execution call as a fresh Python namespace. Re-import modules and retrieve persistent Blender data by stable name.
- Split work into small, purposeful, retryable chunks. Prefer idempotent creation and update code; print compact structured evidence after each chunk.
- On timeout or error, diagnose and retry only the failed chunk. Do not replay an entire scene build blindly.

### 5. Validate structure and appearance

- After each significant phase, verify names, transforms, dimensions, origins, hierarchy, modifiers, topology counts, normals, UVs, materials, actions, accidental duplicates, and file paths relevant to the task.
- Inspect a viewport image after blockout and final refinement. For look development, camera, lighting, render, texture, or animation work, inspect rendered evidence as well.
- After `blender_render`, call `read_image` on the saved PNG/JPEG and inspect the returned image. A successful tool call or non-empty image file is not visual validation.
- For animation, render representative frames or a contact sheet and load `animation-quality-gate`.
- For reference-locked work, use measurable masks, landmarks, overlays, bboxes, centroids, IoU/SSIM where appropriate, and multiview gates. A front-view match alone does not prove a 3D match.
- If no image can be inspected, report `structurally verified, visually unverified`.
- Identify the largest visible mismatch, change the smallest upstream cause, re-capture the same view, and compare before and after. Do not hide geometry errors with camera, lighting, or crop tricks.

### 6. Save and hand off

- Treat the transferable 3D model as the primary artifact. Use the user's requested format; when none is specified, export a single-file `.glb` and save a versioned `.blend` engineering source.
- Treat `.blend` as the editable project file, not the only proof that a 3D model was delivered. A preview is visual QA, not a substitute for the exported model.
- Let explicit 3D-printing, engine, CAD-interchange, render-only, animation-only, or existing-project targets override the default `.glb` contract.
- Write final artifacts to absolute paths in the active dsh workspace or another explicitly configured durable directory, never `/tmp` or an internal driver path.
- Verify every deliverable exists, is non-empty, and matches its requested format. Re-import or inspect the export when practical to catch missing geometry, textures, materials, axes, scale, or animation.
- Report created or changed objects, important dimensions and topology, modules used, validation evidence, and remaining limitations.
- End with an `Artifacts` section. Link each verified output with a descriptive Markdown label and its absolute local path. List the primary model first, the versioned `.blend` source second, and previews or additional exports after them. List each path once and never fabricate an artifact link.

## Run bundled helpers carefully

The upstream analysis and validation scripts remain beside their modules under `references/modules/<module>/scripts/`. Before running one:

1. Read the module's `SKILL.md` and inspect the script's `--help` or source.
2. Resolve the script from the installed skill directory and pass absolute input and output paths.
3. Keep outputs in the active workspace unless the user approved another location.
4. Use an existing environment with Pillow, OpenCV, NumPy, and SciPy, or run ephemerally with `uv` and only the dependencies the script imports.
5. Treat generated reports and Blender recipes as evidence or plans. Review generated Python before sending it to Blender.

Do not run release, documentation, commit, or push steps from `quality-refinement-autoloop` unless the user explicitly asks to develop or publish the skill itself. For normal modeling, use that module only to diagnose the artifact and plan a scoped repair.

## Enforce safety boundaries

- Review downloaded, generated, or user-supplied Python before execution.
- Do not enable global script auto-execution, install add-ons, download assets, call paid services, or change Blender preferences unless explicitly requested.
- Do not perform scene-wide deletion, destructive remeshing, modifier application across unrelated objects, mass relinking, or overwrite saves without authorization.
- Do not claim production human anatomy from primitive recipes. Use an authorized base mesh, sculpt workflow, or specialist when required.
- Redirect engineering-grade CAD tolerances, simulation validity, and manufacturing certification to appropriate CAD or CAE workflows.

## References

- [capability-map.md](references/capability-map.md): all 29 routed modules and recommended pipelines.
- [dsh-integration.md](references/dsh-integration.md): dsh tool mapping, module loading, workspace boundaries, and artifact handoff.
- [modeling-patterns.md](references/modeling-patterns.md): compact agent-oriented modeling and topology patterns.
- [visual-validation.md](references/visual-validation.md): image inspection gates and correction loop.
- [blender-5-compat.md](references/blender-5-compat.md): Blender 5.x API compatibility notes.
- [upstream.md](references/upstream.md): provenance, retained capabilities, adaptations, and license notice.
