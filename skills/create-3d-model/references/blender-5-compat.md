# Blender 5.x Compatibility Notes

## Contents

1. Probe the active version
2. Render engine names
3. Shading and normals
4. Shader inputs
5. Animation data
6. Operator and export compatibility

## Probe the active version

Never infer the runtime version from an installed package alone. Query the running Blender process:

```python
import bpy
print({
    "version": bpy.app.version_string,
    "version_tuple": bpy.app.version,
    "background": bpy.app.background,
})
```

This skill targets Blender 5.x and should use defensive checks for 4.x compatibility only when the task requires it.

## Render engine names

Blender engine identifiers have changed across releases. Set the requested engine with a guarded fallback and print the resolved value:

```python
import bpy

scene = bpy.context.scene
for candidate in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT"):
    try:
        scene.render.engine = candidate
        break
    except (TypeError, ValueError):
        continue
else:
    raise RuntimeError("No compatible Eevee engine identifier found")

print({"render_engine": scene.render.engine})
```

Use Cycles only when its quality or features are needed. Start previews with conservative resolution and samples, then increase quality after composition is accepted.

## Shading and normals

- `Mesh.use_auto_smooth` is absent in Blender 5.x. Do not assign it blindly.
- Use explicit smooth/flat shading and inspect the result. Add a suitable modifier or custom normals only when required.
- Recalculate normals and remove duplicate vertices after destructive mesh operations, then visually inspect for black faces and pinching.
- Do not call an operator unless its required selection, active object, mode, and view-layer context are established.

## Shader inputs

Some Principled BSDF inputs may not behave consistently with direct string lookup. Resolve by iterating inputs when needed:

```python
def set_input(node, name, value):
    socket = next((item for item in node.inputs if item.name == name), None)
    if socket is None:
        raise KeyError(f"Shader input not found: {name}")
    socket.default_value = value
```

Print the active socket names when a material recipe fails instead of guessing a version-specific name.

## Animation data

Blender 5.x uses layered Actions. Do not assume `action.fcurves` exists. Prefer feature detection:

```python
def iter_action_fcurves(action):
    if hasattr(action, "fcurves"):
        yield from action.fcurves
        return
    for layer in getattr(action, "layers", []):
        for strip in getattr(layer, "strips", []):
            for bag in getattr(strip, "channelbags", []):
                yield from getattr(bag, "fcurves", [])
```

Test animation behavior on representative frames and inspect a contact sheet or multiple rendered frames when animation is in scope.

## Operator and export compatibility

- Probe operator availability with `hasattr` before relying on version-sensitive import/export paths.
- Prefer current `bpy.ops.wm` import/export operators when available and fall back only after inspecting the running API.
- Use absolute output paths, verify the exported file, and reopen or inspect it when the target pipeline makes that practical.
- Keep modifiers unapplied until the target format or topology contract requires application.
- Never enable global Python auto-run as a compatibility workaround.
