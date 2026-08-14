# Upstream provenance

## Primary skill source

- Repository: https://github.com/RobLe3/cc-blender-skill
- Reviewed commit: `11016c9a5847897491dde935c346571bd7548e3d`
- Release: `1.3.0`
- Commit date: `2026-05-01`
- License: MIT; see `../UPSTREAM_LICENSE` from the skill root.

The upstream release contains 30 chain-loadable Claude Code skills led by `text-to-blender`. The intermediate Codex adaptation exposed the output-oriented `create-3d-model` orchestrator. This DeepSeek Harness adaptation keeps that orchestrator and retains the other 29 skills as English reference modules, all 26 Python helpers, and the three orchestrator references for assembly order, Blender version compatibility, and common object dimensions.

Validation render assets, trigger-eval datasets, development journals, changelogs, and repository-only documentation were not copied because they do not provide runtime capability. Module recipes, domain references, and executable helpers were retained.

## DeepSeek Harness adaptations

- Replace Claude/Codex-specific tool assumptions and the external BlenderMCP transport with the packaged `blender_status`, `blender_scene_info`, `blender_python`, `blender_render`, and `blender_export` tools.
- Replace top-level multi-skill registration with one skill plus on-demand module reads.
- Rename the entry point around the normal deliverable rather than one input modality or the Blender implementation detail; support text, image, wireframe, multiview, texture/template, and existing-asset inputs.
- Treat a portable 3D model as the default primary artifact and `.blend` as its editable engineering source.
- Add explicit existing-scene protections, workspace-scoped paths, overwrite denial, versioned saves, durable artifacts, and `read_image` visual-evidence gates.
- Keep external asset and AI generation services disabled unless explicitly authorized.
- Prevent the quality-refinement module from editing skills, documentation, Git state, or remotes during ordinary Blender work.
- Preserve upstream English recipes and helper scripts instead of translating or condensing away domain behavior.

## Blender runtime dependency

- Runtime: Blender command-line executable (`blender` by default).
- Role: local background production backend launched by the `dsh-blender` plugin.
- Transport: one fresh Blender process per tool call, with temporary JSON payload/result files removed after completion.

No Blender add-on or control port is required. Configure `blenderExecutable` in the bundle patch when Blender is not on `PATH`.

## MIT license notice

Copyright (c) 2026 RobLe3

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files, to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, subject to inclusion of the upstream copyright and permission notice.

The software is provided without warranty. See the bundled `UPSTREAM_LICENSE` for the full upstream license text.
