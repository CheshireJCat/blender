# dsh-blender

[简体中文](README.zh-CN.md)

An installable [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin that gives dsh a real Blender-backed 3D modeling workflow. It adapts the `create-3d-model-skill` orchestration, 29 on-demand domain modules, and 26 analysis/validation helpers, then adds workspace-scoped Blender tools for inspection, Python modeling, rendering, and export.

## Tools

- `blender_status` checks Blender and the active dsh workspace.
- `blender_scene_info` inspects an existing `.blend` without mutating it.
- `blender_python` runs a small reviewed `bpy`/`bmesh` chunk and saves a versioned `.blend`.
- `blender_render` creates PNG/JPEG evidence for `read_image` visual QA.
- `blender_export` exports GLB/glTF, FBX, OBJ, STL, USD, or PLY.
- The bundled `create-3d-model` Skill coordinates blockout, refinement, materials, lighting, cameras, animation, validation, and artifact handoff.

No Blender add-on or control port is required: each operation launches a local Blender background process.

## Install

```bash
npx @deepseek-ai/dsh plugin --profile web add .
npx @deepseek-ai/dsh --profile web --dump-config
npx @deepseek-ai/dsh web
```

Open [http://127.0.0.1:3080](http://127.0.0.1:3080), create a session whose workspace is the modeling directory, and ask dsh to use `create-3d-model`.

See [README.zh-CN.md](README.zh-CN.md) for configuration, security boundaries, headless use, and validation commands.
