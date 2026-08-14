# Blender Modeling Patterns

## Contents

1. Coordinate and naming contract
2. Geometry strategy
3. Blockout and assembly order
4. Blender Python execution pattern
5. Hard-surface and modifier strategy
6. Axes, joints, and pointed forms
7. Structural validation
8. Common failure modes

## Coordinate and naming contract

- Use meters unless the user or target pipeline specifies another unit.
- Keep `Z` as up. State which local axis is long, broad, and thin for asymmetric subjects.
- Place the origin deliberately: ground contact for props, hinge for doors, center of rotation for wheels, and a documented assembly origin for multi-part assets.
- Prefix newly created datablocks: `GEO-`, `MAT-`, `LGT-`, `CAM-`, `COL-`, `ARM-`.
- Use stable semantic names such as `GEO-chair_seat` instead of generated names such as `Cube.027`.

## Geometry strategy

| Subject | Start with | Preferred technique |
| --- | --- | --- |
| Hard-surface prop or architecture | Cube or plane | Non-destructive modifiers, booleans, bevels |
| Cylindrical object | Cylinder or curve | Profile control, screw/lathe, or curve bevel |
| Repeated structure | One clean module | Array, linked duplicates, Geometry Nodes when justified |
| Thin shell or panel | Plane | Solidify, controlled bevel, explicit normals |
| Symmetric object | Half mesh | Mirror with clipping and merge |
| Organic form | Icosphere or simple primitives | Blockout only unless a sculpt/base-mesh workflow is authorized |
| Precise custom topology | Minimal mesh | Direct data API or `bmesh` |

Prefer the simplest representation that preserves the requested silhouette and downstream use. Do not add subdivision or dense topology merely to make a model appear sophisticated.

## Blockout and assembly order

Use this sequence for a new asset or hero scene:

1. Record target dimensions and visual references.
2. Create a primitive blockout at correct scale.
3. Establish an inspection view or camera and validate the thumbnail silhouette.
4. Refine primary forms.
5. Add secondary forms and functional joints.
6. Add bevels, support geometry, and cleanup.
7. Add simple presentation materials and lighting sufficient to reveal form.
8. Render or capture a final inspection image.
9. Save and export.

For an existing scene, change only affected stages and preserve unrelated objects.

## Blender Python execution pattern

Use small, idempotent chunks and print machine-readable evidence:

```python
import bpy
import json

name = "GEO-target"
obj = bpy.data.objects.get(name)
created = obj is None

if created:
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0.0, 0.0, 0.5))
    obj = bpy.context.active_object
    obj.name = name

# Make only the requested changes here.

result = {
    "object": obj.name,
    "created": created,
    "location": list(obj.location),
    "dimensions": list(obj.dimensions),
    "vertices": len(obj.data.vertices) if obj.type == "MESH" else None,
}
print(json.dumps(result))
```

For edit-mode operations:

```python
import bpy

obj = bpy.data.objects["GEO-target"]
if bpy.context.object and bpy.context.object.mode != "OBJECT":
    bpy.ops.object.mode_set(mode="OBJECT")
bpy.ops.object.select_all(action="DESELECT")
obj.select_set(True)
bpy.context.view_layer.objects.active = obj
bpy.ops.object.mode_set(mode="EDIT")
try:
    # Perform the scoped mesh operation.
    pass
finally:
    bpy.ops.object.mode_set(mode="OBJECT")
```

Use the data API or `bmesh` when selection context would be fragile.

## Hard-surface and modifier strategy

There is no universal modifier order. Start with this common intent-based pattern and inspect the result after each stage:

```text
Mirror / Array → Boolean or Solidify → Bevel → Subdivision → export-only cleanup
```

- Put Mirror early so later operations preserve symmetry.
- Put Array before curve deformation when repeating along a path.
- Run booleans on simple, closed cutter geometry. Keep cutters in a dedicated collection until the result is accepted.
- Place Bevel after scale is suitable for the intended width. Use a physically plausible width instead of a fixed magic value.
- Put Subdivision late for smooth forms; do not add it to every hard-surface object.
- Apply modifiers only when downstream topology requires it. Keeping them non-destructive makes iteration safer.
- Inspect shading and topology after booleans. N-gons may be acceptable on static planar regions but can pinch under subdivision or deformation.

For realism, most manufactured edges need a small bevel. The bevel width should relate to object scale and reference, not a universal default.

## Axes, joints, and pointed forms

### Long, broad, and thin axes

For blades, boards, tools, and other elongated subjects, define:

- long axis: total length;
- broad axis: the main readable face;
- thin axis: the narrow cross-section.

Orient the model and camera so the broad face is visible in validation images. A structurally correct object viewed down its thin axis can look like a pole.

### Multi-part joints

- Avoid exact coplanar contact between separate parts; it produces seams and z-fighting.
- Use a small scale-appropriate overlap for hidden mechanical assembly when separate parts are acceptable.
- Use Boolean Union or deliberate topology when the surface must be truly continuous.
- Check intersections from more than one angle before accepting them.

### True pointed tips

Scaling a ring of vertices close to zero can leave a flat or degenerate tip. Collapse the terminal vertices to a common coordinate and merge by distance, then inspect normals and silhouette.

## Structural validation

Check every significant mesh for:

- expected object and datablock names;
- dimensions, rotation, scale, and origin;
- hierarchy and collection membership;
- accidental duplicates or hidden cutters rendering unexpectedly;
- non-manifold edges when a watertight asset is required;
- degenerate or zero-area faces;
- inverted normals and black shading;
- modifier order and unapplied scale assumptions;
- polygon count appropriate to the target;
- animation, deformation, UV, or export requirements specified by the user.

Use `bmesh` for precise checks when necessary. Report metrics, but treat them as structural evidence rather than visual evidence.

## Common failure modes

| Symptom | Likely cause | Correction |
| --- | --- | --- |
| Default-cube appearance | Perfectly sharp manufactured edges | Add scale-appropriate bevels and improve proportions |
| Soft blob after subdivision | No support topology or unsuitable stack | Add support loops/creases or remove unnecessary subdivision |
| Boolean shading artifacts | Dirty cutter, coplanar faces, or poor topology | Simplify cutter, avoid coplanar contact, clean result |
| Broken symmetry | Manual duplicate/flip drift | Use Mirror with clipping and merge |
| Black faces | Inverted normals or overlapping surfaces | Recalculate normals and remove duplicates/interior faces |
| Visible seams at joints | Coplanar or barely touching parts | Add deliberate overlap or create continuous topology |
| Pointed form has a flat cap | Terminal vertices were only scaled | Collapse and merge terminal vertices |
| Model reads as a thin pole | Camera faces the thin axis | Rotate model or camera toward the broad face |
| Repeated retries create duplicates | Non-idempotent creation code | Retrieve by stable name before creating |
