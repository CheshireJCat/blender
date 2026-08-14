# dsh-blender

[简体中文](README.zh-CN.md)

An installable [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin that gives dsh a complete Blender-backed 3D production workflow. It registers one orchestrator plus 29 directly loadable domain skills, all 26 upstream analysis/validation helpers, and 13 workspace-scoped Blender tools.

## Tools

- `blender_status` checks Blender, analysis Python, skills, helpers, and the active workspace.
- `blender_scene_info` and `blender_object_info` inspect scenes and object-level geometry, materials, UVs, constraints, shape keys, and animation.
- `blender_import` converts supported portable assets into versioned `.blend` sources.
- `blender_python` runs a small reviewed `bpy`/`bmesh` chunk and saves a versioned `.blend`.
- `blender_preview`, `blender_render`, and `blender_render_frames` create blockout, look-dev, and animation evidence for `read_image` QA.
- `blender_export` exports GLB/glTF, FBX, OBJ, STL, USD, or PLY.
- `blender_validate_scene` and `blender_validate_export` perform target-aware audits and clean-process re-import checks.
- `blender_helper_catalog` and `blender_helper_run` expose all 26 deterministic reference, wireframe, contour, multiview, UV, texture, look, repair, and animation-QA helpers.
- The bundled 30-skill stack coordinates blockout, refinement, materials, lighting, cameras, animation, reconstruction, validation, and artifact handoff.

No Blender add-on or control port is required: each operation launches a local Blender background process.

## Requirements

- DeepSeek Harness `0.1.0-rc.6`
- Node.js 20+
- Blender 4.3+ available as `blender` on `PATH`, or configured with an absolute path
- Python 3.10+ for the optional reference-analysis helpers

## Install from npm

```bash
npx @deepseek-ai/dsh plugin --profile web add dsh-blender
npx @deepseek-ai/dsh plugin --profile web exec dsh-blender-setup
npx @deepseek-ai/dsh --profile web --dump-config
npx @deepseek-ai/dsh web
```

The setup command creates a private `.venv` inside the installed package and installs OpenCV, NumPy, Pillow, and SciPy. Skip it only if you do not need reference, wireframe, multiview, texture, or animation-analysis helpers.

To install a pinned GitHub release instead:

```bash
npx @deepseek-ai/dsh plugin --profile web add github:CheshireJCat/blender#v0.2.1
```

## Develop from source

```bash
pnpm install
pnpm setup:analysis
npx @deepseek-ai/dsh plugin --profile web add .
```

Open [http://127.0.0.1:3080](http://127.0.0.1:3080), create a session whose workspace is the modeling directory, and ask dsh to use `create-3d-model`.

See [README.zh-CN.md](README.zh-CN.md) for configuration, security boundaries, headless use, and validation commands.
