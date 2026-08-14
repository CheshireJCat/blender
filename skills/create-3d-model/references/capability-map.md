# Capability map

## Contents

1. Loading rule
2. Orchestration and production
3. Core Blender domains
4. Reference-locked reconstruction
5. Motion and animation QA
6. Recommended pipelines

## Loading rule

Load a module through DSH's `skill` tool using the module name in the tables below. All 29 modules are registered as model-invocable bundled skills. Resolve each module's `references/...` resources from the resource directory reported by the loader. Run deterministic scripts through `blender_helper_catalog` and `blender_helper_run` instead of guessing package paths.

## Orchestration and production

| Module | Load it when |
| --- | --- |
| `blender-pro-workflow` | The request spans multiple stages or needs a complete scene, hero shot, critique loop, or production order. |
| `blender-skill-harmonizer` | Multiple modules must share source-of-truth, handoff, precedence, or repair decisions. |
| `quality-refinement-autoloop` | A result is repeatedly subpar and evidence must be converted into a repair plan. Do not perform its skill/release mutations without an explicit request. |
| `mascot-logo-reconstruction` | A brand mascot, logo, flat character, or emblem must be reconstructed through fail-gated source matching. |

The top-level `create-3d-model` orchestrator plus these four modules provide the control plane for the other domains.

## Core Blender domains

| Module | Capability |
| --- | --- |
| `blender-modeling` | Primitives, direct mesh work, hard-surface modeling, modifiers, `bmesh`, topology, axes, and structural validation. |
| `blender-materials` | Principled PBR, metal, glass, plastic, fabric, skin/wax, procedural wood/marble/weave, and Blender 5 socket compatibility. |
| `blender-lighting` | Subject-aware three-point, studio, cinematic, practical, HDRI, outdoor, color-temperature, and shadow setups. |
| `blender-cameras` | Focal length, composition, depth of field, tracking, orbit, dolly, push-in, and animated camera work. |
| `blender-rendering` | Cycles/EEVEE selection, samples, denoise, light paths, color management, stills, image sequences, and video output. |
| `blender-animation` | Keyframes, easing, F-curves, Blender 5 layered Actions, shape keys, drivers, NLA, and loops. |
| `blender-export` | glTF/GLB, FBX, OBJ, USD, STL, target axes, texture packaging, decimation, and export validation. |
| `blender-uv-texturing` | UV unwrap/projection, atlases, alpha decals, baking, lightmaps, and glTF-ready textures. |
| `wireframe-to-3d` | OpenCV line extraction, Bezier fitting, Blender curve/mesh construction, paired-part checks, and GLB delivery. |

## Reference-locked reconstruction

Load these only when source fidelity matters more than plausible freeform modeling.

| Module | Capability |
| --- | --- |
| `reference-to-3d` | Overall source/template/orthographic/texture-driven reconstruction workflow. |
| `reference-analysis-validator` | Source manifests, masks, connected components, overlays, IoU/SSIM, bboxes, centroids, and fail-before-export gates. |
| `source-part-segmentation` | Separate touching or overlapping source parts into structural masks. |
| `contour-to-mesh` | Turn masks/contours into filled mesh surfaces or shallow extrusions. |
| `orthographic-registration` | Register front/side/back/top views into a shared coordinate contract. |
| `multiview-constraint-solver` | Detect contradictory orthographic sources and choose a canonical policy before rebuilding. |
| `atlas-uv-fitting` | Detect atlas regions and map individual parts into their intended UV rectangles or projections. |
| `closed-surface-uv-coverage` | Gate texture coverage across front cap, back cap, and sidewalls of closed/extruded assets. |
| `texture-driven-mesh-fitting` | Fit mesh boundaries to a texture or source contour instead of stretching the texture over an approximate mesh. |
| `landmark-fit-repair` | Measure and repair named feature points beyond coarse bbox or silhouette metrics. |
| `multiview-fit-loop` | Render, compare, adjust, and repeat across registered views. |
| `fit-repair-optimizer` | Convert validation failures into dependency-aware repair queues. |
| `reference-look-calibration` | Match crop, extent, brightness, saturation, hue, glow, materials, lights, and render settings to source imagery. |

## Motion and animation QA

| Module | Capability |
| --- | --- |
| `texture-state-animation` | Registered, layered, export-aware transitions between texture/material states without whole-image popping or ugly crossfades. |
| `orbital-hud-motion` | Source-derived halo, orbit, dot, dash, scanner, parallax, and restrained HUD motion. |
| `animation-quality-gate` | Contact-sheet validation for flicker, silhouette stability, framing, subject dominance, layer separation, and export truth. |

## Recommended pipelines

### Text or image to a general 3D model or hero render

1. `blender-pro-workflow`
2. `blender-modeling`
3. `blender-cameras`
4. `blender-lighting`
5. `blender-materials`
6. `blender-rendering`
7. `blender-export` when requested

### Edit an existing scene

1. Inspect scene and object state.
2. Load only the affected core domain modules.
3. Preserve unrelated data and save a versioned checkpoint before destructive work.
4. Re-run structural and visual checks for the edited scope.

### Wireframe or technical drawing to 3D

1. `blender-skill-harmonizer`
2. `reference-analysis-validator`
3. `wireframe-to-3d`
4. `orthographic-registration` and `multiview-constraint-solver` when multiple views exist
5. `blender-modeling`
6. `multiview-fit-loop`
7. `blender-materials`, `blender-lighting`, `blender-cameras`, `blender-rendering`
8. `blender-export`

### Exact mascot, logo, template, or texture pack

1. `blender-skill-harmonizer`
2. `mascot-logo-reconstruction`
3. `reference-to-3d`
4. `reference-analysis-validator`
5. `source-part-segmentation`
6. `contour-to-mesh` and `orthographic-registration`
7. `multiview-constraint-solver` when views conflict
8. `texture-driven-mesh-fitting`, `blender-uv-texturing`, `atlas-uv-fitting`, `closed-surface-uv-coverage`
9. `landmark-fit-repair`, `multiview-fit-loop`, `fit-repair-optimizer`
10. `reference-look-calibration`
11. `blender-export`

### Animated brand or HUD asset

1. Complete the reference-locked geometry, UV, and look gates.
2. `blender-animation`
3. `texture-state-animation` when source texture states change
4. `orbital-hud-motion` for circular or aura elements
5. `animation-quality-gate`
6. `blender-rendering` and `blender-export`

These sequences are defaults, not mandatory module dumps. Skip modules whose gate is irrelevant.
