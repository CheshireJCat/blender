# DeepSeek Harness integration

This file owns the runtime mapping between the reusable modeling workflow and the `dsh-blender` plugin. When a vendored module mentions BlenderMCP, a fixed MCP tool name, Codex, Claude, or an external control port, translate it to the tools and rules below.

## Runtime shape

DeepSeek Harness discovers one runtime skill named `create-3d-model`. The remaining modules under `references/modules/` are reference documents, not separately registered skills. Load only the modules selected by `references/capability-map.md`.

The plugin exposes these model-facing tools:

| Tool | Purpose | Mutation |
| --- | --- | --- |
| `blender_status` | Verify the Blender executable and current workspace | none |
| `blender_scene_info` | Inspect an existing `.blend` scene | none |
| `blender_python` | Run a reviewed `bpy`/`bmesh` chunk and save a versioned `.blend` | yes |
| `blender_render` | Render PNG/JPEG evidence from a saved `.blend` | creates an image |
| `blender_export` | Export GLB/glTF, FBX, OBJ, STL, USD, or PLY | creates a model file |

The ordinary dsh `read`, `read_image`, file-search, and shell tools remain available for reference analysis and helper scripts. Use `read_image` after every significant render; the existence of a render file is not visual evidence by itself.

## Workspace and path contract

Tool paths resolve against `exec.agent.session.header.cwd`, the workspace attached to the current dsh session. With the default plugin configuration, both relative and absolute paths must remain inside that workspace, including after existing symlinks are resolved.

- Put durable outputs under a clear workspace directory such as `artifacts/<task-name>/`.
- Use a new versioned `.blend` path for each broad phase, for example `lamp-blockout-v001.blend` and `lamp-final-v002.blend`.
- Do not set `allow_overwrite` unless the user explicitly wants the named existing file replaced.
- Do not use `/tmp` for deliverables. Internal payload files are private implementation details and are removed after each tool call.

## Tool sequence

1. Call `blender_status`.
2. If editing an existing file, call `blender_scene_info` before the first write.
3. Read the smallest relevant modules and plan names, units, axes, collection ownership, save paths, and validation views.
4. Use `blender_python` for one small, deterministic phase at a time. The script namespace already provides `bpy`, `bmesh`, `mathutils`, `workspace`, `input_path`, and `output_path`. Set `dsh_result` to a JSON-safe dictionary when compact phase evidence is useful.
5. Call `blender_scene_info` on the saved checkpoint when structural confirmation is needed.
6. Call `blender_render`, then `read_image` on its `imagePath`. Correct the largest visible mismatch before continuing.
7. Call `blender_export` for the portable model. Default to `.glb` when the user does not specify a format.
8. Verify every returned path exists and every artifact has a non-zero byte count. Re-open or inspect the exported model when practical.

## Controlled Python rules

`blender_python` is intentionally powerful and has the same trust implications as running Python inside Blender. Use it only for Blender scene work.

- Do not use it for networking, downloads, package installation, subprocesses, credential access, unrelated filesystem work, or Blender preference changes.
- Keep each call self-contained. Re-import any additional standard modules and retrieve persistent Blender data by stable names.
- Prefer the Blender data API or `bmesh`. If `bpy.ops` is necessary, establish mode, active object, and selection explicitly.
- Make creation idempotent where practical. Update a stable named object or task collection instead of blindly duplicating it.
- A failed call does not produce an accepted checkpoint. Diagnose the reported traceback and retry only the failed phase.
- Factory startup may contain Cube, Camera, and Light. A fresh-scene request may remove confirmed startup objects, but an existing user file must be preserved outside the declared scope.

## Render and image inspection

`blender_render` uses the active scene camera unless a camera name is supplied. Modeling scripts should therefore create or select a purposeful camera and light setup before visual QA.

After rendering:

1. call `read_image` with the returned `imagePath`;
2. inspect silhouette, proportion, framing, visible seams, intersections, z-fighting, bevel readability, shading, materials, and lighting;
3. name the largest visible mismatch;
4. change the smallest upstream cause through a new versioned `.blend` checkpoint;
5. render the same view again and compare.

If the current model route cannot accept image input, say `structurally verified, visually unverified`; do not silently downgrade the acceptance bar.

## Export mapping

The exporter selects format by `output_path` extension:

- `.glb` or `.gltf`: glTF exporter;
- `.fbx`: Blender FBX exporter;
- `.obj`: Wavefront OBJ;
- `.stl`: STL;
- `.usd`, `.usda`, or `.usdc`: Universal Scene Description;
- `.ply`: Stanford PLY.

Prefer a single-file `.glb` for ordinary portable delivery. Keep the latest `.blend` beside it as the editable engineering source. A preview image is QA evidence, not a substitute for the model.

## Module and helper loading

Resolve a routed module at `references/modules/<module-name>/SKILL.md`. Resolve any relative `references/...` or `scripts/...` path from that module directory. Inspect a helper's source or `--help` before running it, pass absolute workspace paths, and keep generated reports inside the workspace.

Vendored module frontmatter and legacy tool names are provenance only. They do not grant permissions or override this integration contract.

## Handoff

Report the created or changed objects, important dimensions/topology, modules used, structural evidence, renders actually inspected, exports verified, and remaining limitations. End with one `Artifacts` section ordered as:

1. primary portable model;
2. latest versioned `.blend` source;
3. final preview;
4. optional reports or extra formats.
