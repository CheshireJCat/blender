# Visual Validation for Blender Work

## Contents

1. Evidence requirements
2. Stage gates
3. Inspection checklist
4. Correction loop
5. Completion report

## Evidence requirements

Visual work is complete only after the dsh agent inspects an actual image of the result.

Use at least these two checkpoints:

1. Blockout checkpoint: capture a viewport screenshot before detail work.
2. Final checkpoint: capture a material-preview/rendered viewport or render a still and inspect it.

Use `blender_render` to save a stable PNG/JPEG and then call `read_image` on that path. A successful render command, non-zero file size, or correct object count does not prove visual quality.

If no image can be inspected, label the result `structurally verified, visually unverified` and explain why.

## Stage gates

| Stage | Do not advance until |
| --- | --- |
| Blockout | Scale, silhouette, orientation, and major proportions read clearly at thumbnail size |
| Primary forms | Parts relate correctly and the subject is recognizable from at least two useful angles |
| Secondary forms | Joints, thickness, bevel language, and symmetry are coherent |
| Presentation | Camera, light, and material contrast reveal the geometry instead of hiding it |
| Final | No obvious clipping, black faces, z-fighting, accidental objects, or reference-breaking proportions remain |

## Inspection checklist

Compare the image to the user's request and references. Check:

- subject visibility and recognizability;
- overall silhouette and landmark placement;
- width, height, depth, and part-to-part proportions;
- long/broad/thin axis orientation;
- camera framing, focal length, clipping, and horizon;
- symmetry where intended and controlled asymmetry where requested;
- attachment seams, penetrations, floating parts, and z-fighting;
- bevel readability and edge consistency;
- normals, black faces, faceting, pinching, and smoothing artifacts;
- material separation and sufficient surface variation to reveal form;
- lighting contrast without crushed shadows or blown highlights;
- unexpected magenta, missing textures, hidden cutters, guides, or helper objects;
- fidelity at both thumbnail size and a closer crop.

For reference matching, inspect side-by-side at comparable framing. When exact matching matters and the sources allow it, use overlays or landmark measurements instead of intuition alone.

## Correction loop

1. Observe the screenshot or render without editing.
2. Name the largest visible mismatch in one sentence.
3. Classify it as geometry, proportion, topology, camera, lighting, material, or technical state.
4. Change only the smallest set of variables that can correct that mismatch.
5. Re-capture the same view under the same conditions.
6. Compare before and after, then repeat if the mismatch remains material.

Do not compensate for geometry errors with camera tricks or hide shading errors with darkness. Fix upstream causes before downstream presentation.

When iteration stalls, report the evidence, attempted corrections, and the remaining limitation rather than claiming completion.

## Completion report

Report concise, checkable evidence:

- Created or changed: object names and roles.
- Dimensions/topology: important bounds, counts, modifiers, and known assumptions.
- Visual QA: screenshot or render inspected and the view used.
- Saved output: versioned `.blend` path and requested exports.
- Caveats: unresolved reference ambiguity, organic-detail limits, or unverified target-engine behavior.

Avoid subjective superlatives. Say what was inspected and what visibly matches.
