"""Internal Blender-side driver for the dsh-blender plugin.

The Node plugin writes the JSON payload and controls all accepted workspace paths.
This file runs inside Blender's Python interpreter and returns one JSON result.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
import traceback
from pathlib import Path
from typing import Any

import bmesh
import bpy
import mathutils


def _args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--operation",
        required=True,
        choices=(
            "inspect",
            "inspect_object",
            "execute",
            "preview",
            "render",
            "render_frames",
            "import",
            "export",
            "validate_scene",
            "validate_asset",
        ),
    )
    parser.add_argument("--payload", required=True)
    parser.add_argument("--result", required=True)
    return parser.parse_args(argv)


def _round(value: float) -> float:
    value = float(value)
    if not math.isfinite(value):
        return 0.0
    rounded = round(value, 6)
    # dsh's lossless-JSON boundary deliberately rejects IEEE-754 negative zero.
    return 0.0 if rounded == 0.0 else rounded


def _vector(value: Any) -> list[float]:
    return [_round(component) for component in value]


def _json_safe(value: Any) -> Any:
    if value is None or isinstance(value, (str, bool)):
        return value
    if isinstance(value, int):
        # JavaScript cannot losslessly represent larger JSON integers.
        return value if abs(value) <= 9_007_199_254_740_991 else str(value)
    if isinstance(value, float):
        if not math.isfinite(value):
            return repr(value)
        return 0.0 if value == 0.0 else value
    if isinstance(value, (list, tuple)):
        return [_json_safe(item) for item in value]
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    return {"repr": repr(value)}


def _object_summary(obj: bpy.types.Object) -> dict[str, Any]:
    summary: dict[str, Any] = {
        "name": obj.name,
        "type": obj.type,
        "location": _vector(obj.location),
        "rotationEuler": _vector(obj.rotation_euler),
        "scale": _vector(obj.scale),
        "dimensions": _vector(obj.dimensions),
        "hiddenViewport": bool(obj.hide_viewport),
        "hiddenRender": bool(obj.hide_render),
        "parent": obj.parent.name if obj.parent else "",
        "materials": [slot.material.name for slot in obj.material_slots if slot.material],
        "modifiers": [{"name": modifier.name, "type": modifier.type} for modifier in obj.modifiers],
    }
    data = obj.data
    if obj.type == "MESH" and data is not None:
        summary["mesh"] = {
            "vertices": len(data.vertices),
            "edges": len(data.edges),
            "polygons": len(data.polygons),
            "uvLayers": [layer.name for layer in data.uv_layers],
        }
    return summary


def _world_bbox(obj: bpy.types.Object) -> list[list[float]]:
    if not getattr(obj, "bound_box", None):
        return []
    return [_vector(obj.matrix_world @ mathutils.Vector(corner)) for corner in obj.bound_box]


def _object_detail(obj: bpy.types.Object, evaluated: bool = True) -> dict[str, Any]:
    summary = _object_summary(obj)
    summary.update(
        {
            "matrixWorld": [[_round(value) for value in row] for row in obj.matrix_world],
            "boundBoxWorld": _world_bbox(obj),
            "constraints": [
                {
                    "name": constraint.name,
                    "type": constraint.type,
                    "target": getattr(getattr(constraint, "target", None), "name", ""),
                }
                for constraint in obj.constraints
            ],
            "vertexGroups": [group.name for group in obj.vertex_groups],
            "animation": {
                "action": (
                    getattr(getattr(obj.animation_data, "action", None), "name", "")
                    if obj.animation_data
                    else ""
                ),
                "nlaTracks": len(obj.animation_data.nla_tracks) if obj.animation_data else 0,
            },
        }
    )
    if obj.type == "MESH" and obj.data is not None:
        mesh = obj.data
        summary["mesh"].update(
            {
                "colorAttributes": [attribute.name for attribute in mesh.color_attributes],
                "shapeKeys": (
                    [block.name for block in mesh.shape_keys.key_blocks]
                    if mesh.shape_keys is not None
                    else []
                ),
            }
        )
        if evaluated:
            evaluated_object = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
            evaluated_mesh = evaluated_object.to_mesh()
            try:
                summary["evaluatedMesh"] = {
                    "vertices": len(evaluated_mesh.vertices),
                    "edges": len(evaluated_mesh.edges),
                    "polygons": len(evaluated_mesh.polygons),
                }
            finally:
                evaluated_object.to_mesh_clear()
    return summary


def _scene_summary(max_objects: int = 200) -> dict[str, Any]:
    scene = bpy.context.scene
    objects = sorted(scene.objects, key=lambda item: item.name)
    return {
        "blenderVersion": bpy.app.version_string,
        "filePath": bpy.data.filepath,
        "sceneName": scene.name,
        "unitSystem": scene.unit_settings.system,
        "unitScale": _round(scene.unit_settings.scale_length),
        "frameStart": int(scene.frame_start),
        "frameEnd": int(scene.frame_end),
        "frameCurrent": int(scene.frame_current),
        "renderEngine": scene.render.engine,
        "activeCamera": scene.camera.name if scene.camera else "",
        "world": scene.world.name if scene.world else "",
        "collections": sorted(collection.name for collection in bpy.data.collections),
        "materials": sorted(material.name for material in bpy.data.materials),
        "objectCount": len(objects),
        "objectsTruncated": len(objects) > max_objects,
        "objects": [_object_summary(obj) for obj in objects[:max_objects]],
    }


def _inspect_objects(payload: dict[str, Any]) -> dict[str, Any]:
    names = payload.get("object_names") or []
    if not names:
        active = bpy.context.view_layer.objects.active
        names = [active.name] if active is not None else []
    missing = [name for name in names if bpy.data.objects.get(name) is None]
    objects = [bpy.data.objects[name] for name in names if bpy.data.objects.get(name) is not None]
    return {
        "objects": [_object_detail(obj, bool(payload.get("evaluated", True))) for obj in objects],
        "missing": missing,
    }


def _execute(payload: dict[str, Any]) -> dict[str, Any]:
    namespace: dict[str, Any] = {
        "__name__": "__dsh_blender_script__",
        "bpy": bpy,
        "bmesh": bmesh,
        "mathutils": mathutils,
        "workspace": payload["workspace"],
        "input_path": payload.get("input_path", ""),
        "output_path": payload["output_path"],
        "dsh_result": {},
    }
    code = compile(payload["script"], "<dsh-blender-python>", "exec")
    exec(code, namespace, namespace)
    output = Path(payload["output_path"])
    output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(output), check_existing=False)
    return {
        "scene": _scene_summary(),
        "script_result": _json_safe(namespace.get("dsh_result", {})),
    }


def _configure_render(scene: bpy.types.Scene, payload: dict[str, Any], output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    scene.render.filepath = str(output)
    scene.render.resolution_x = int(payload["width"])
    scene.render.resolution_y = int(payload["height"])
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = bool(payload.get("transparent", False))
    suffix = output.suffix.lower()
    scene.render.image_settings.file_format = "PNG" if suffix == ".png" else "JPEG"
    if hasattr(scene, "cycles"):
        scene.cycles.samples = int(payload["samples"])
    if hasattr(scene, "eevee"):
        scene.eevee.taa_render_samples = int(payload["samples"])


def _render(payload: dict[str, Any]) -> dict[str, Any]:
    scene = bpy.context.scene
    camera_name = payload.get("camera", "")
    if camera_name:
        camera = bpy.data.objects.get(camera_name)
        if camera is None or camera.type != "CAMERA":
            raise ValueError(f'Camera "{camera_name}" was not found')
        scene.camera = camera
    if scene.camera is None:
        raise ValueError("Scene has no active camera")

    frame = payload.get("frame")
    if frame is not None:
        scene.frame_set(int(frame))
    output = Path(payload["output_path"])
    _configure_render(scene, payload, output)
    bpy.ops.render.render(write_still=True)
    return {"image_path": str(output), "frame": int(scene.frame_current)}


def _scene_bounds(object_names: list[str] | None = None) -> tuple[mathutils.Vector, mathutils.Vector]:
    requested = set(object_names or [])
    objects = [
        obj
        for obj in bpy.context.scene.objects
        if obj.type in {"MESH", "CURVE", "SURFACE", "META", "FONT"}
        and not obj.hide_render
        and (not requested or obj.name in requested)
    ]
    if not objects:
        raise ValueError("No visible renderable objects were found for preview")
    corners = [obj.matrix_world @ mathutils.Vector(corner) for obj in objects for corner in obj.bound_box]
    minimum = mathutils.Vector(tuple(min(point[index] for point in corners) for index in range(3)))
    maximum = mathutils.Vector(tuple(max(point[index] for point in corners) for index in range(3)))
    return minimum, maximum


def _look_at(obj: bpy.types.Object, target: mathutils.Vector) -> None:
    obj.rotation_euler = (target - obj.location).to_track_quat("-Z", "Y").to_euler()


def _preview(payload: dict[str, Any]) -> dict[str, Any]:
    scene = bpy.context.scene
    minimum, maximum = _scene_bounds(payload.get("object_names"))
    center = (minimum + maximum) * 0.5
    size = maximum - minimum
    radius = max(size.length * 0.5, 0.5)
    view = payload.get("view", "isometric")
    directions = {
        "front": mathutils.Vector((0.0, -1.0, 0.0)),
        "back": mathutils.Vector((0.0, 1.0, 0.0)),
        "left": mathutils.Vector((-1.0, 0.0, 0.0)),
        "right": mathutils.Vector((1.0, 0.0, 0.0)),
        "top": mathutils.Vector((0.0, 0.0, 1.0)),
        "bottom": mathutils.Vector((0.0, 0.0, -1.0)),
        "isometric": mathutils.Vector((1.0, -1.0, 0.8)),
    }
    direction = directions.get(view)
    if direction is None:
        raise ValueError(f"Unsupported preview view: {view}")
    direction.normalize()

    camera_data = bpy.data.cameras.new("DSH_PREVIEW_CAMERA_DATA")
    camera = bpy.data.objects.new("DSH_PREVIEW_CAMERA", camera_data)
    scene.collection.objects.link(camera)
    camera.location = center + direction * radius * 3.2
    _look_at(camera, center)
    if bool(payload.get("orthographic", view != "isometric")):
        camera_data.type = "ORTHO"
        camera_data.ortho_scale = max(size.x, size.y, size.z, 0.5) * 1.35
    else:
        camera_data.type = "PERSP"
        camera_data.lens = float(payload.get("focal_length", 50.0))
    scene.camera = camera

    for name, offset, energy, area_size in (
        ("DSH_PREVIEW_KEY", (1.5, -2.0, 2.5), 1200.0, 4.0),
        ("DSH_PREVIEW_FILL", (-2.0, -0.5, 1.0), 600.0, 3.0),
        ("DSH_PREVIEW_RIM", (0.5, 2.0, 2.0), 900.0, 3.0),
    ):
        light_data = bpy.data.lights.new(f"{name}_DATA", "AREA")
        light_data.energy = energy * max(radius, 0.5)
        light_data.shape = "DISK"
        light_data.size = area_size * max(radius, 0.5)
        light = bpy.data.objects.new(name, light_data)
        scene.collection.objects.link(light)
        light.location = center + mathutils.Vector(offset) * radius
        _look_at(light, center)

    if scene.world is None:
        scene.world = bpy.data.worlds.new("DSH_PREVIEW_WORLD")
    scene.world.use_nodes = True
    background = scene.world.node_tree.nodes.get("Background")
    if background is not None:
        background.inputs["Color"].default_value = (0.025, 0.025, 0.035, 1.0)
        background.inputs["Strength"].default_value = 0.35

    output = Path(payload["output_path"])
    _configure_render(scene, payload, output)
    bpy.ops.render.render(write_still=True)
    return {
        "image_path": str(output),
        "view": view,
        "bounds": {"min": _vector(minimum), "max": _vector(maximum), "center": _vector(center)},
    }


def _render_frames(payload: dict[str, Any]) -> dict[str, Any]:
    scene = bpy.context.scene
    camera_name = payload.get("camera", "")
    if camera_name:
        camera = bpy.data.objects.get(camera_name)
        if camera is None or camera.type != "CAMERA":
            raise ValueError(f'Camera "{camera_name}" was not found')
        scene.camera = camera
    if scene.camera is None:
        raise ValueError("Scene has no active camera")
    frames = [int(frame) for frame in payload["frames"]]
    output_dir = Path(payload["output_dir"])
    output_dir.mkdir(parents=True, exist_ok=True)
    suffix = payload.get("format", "png").lower()
    prefix = payload.get("prefix", "frame")
    paths = []
    for frame in frames:
        scene.frame_set(frame)
        output = output_dir / f"{prefix}-{frame:06d}.{suffix}"
        _configure_render(scene, payload, output)
        bpy.ops.render.render(write_still=True)
        paths.append(str(output))
    return {"frames": frames, "image_paths": paths}


def _import_asset_file(path: Path) -> None:
    suffix = path.suffix.lower()
    if suffix in {".glb", ".gltf"}:
        bpy.ops.import_scene.gltf(filepath=str(path))
    elif suffix == ".fbx":
        if hasattr(bpy.ops.wm, "fbx_import"):
            bpy.ops.wm.fbx_import(filepath=str(path))
        else:
            bpy.ops.import_scene.fbx(filepath=str(path))
    elif suffix == ".obj":
        bpy.ops.wm.obj_import(filepath=str(path))
    elif suffix == ".stl":
        bpy.ops.wm.stl_import(filepath=str(path))
    elif suffix in {".usd", ".usda", ".usdc"}:
        bpy.ops.wm.usd_import(filepath=str(path))
    elif suffix == ".ply":
        bpy.ops.wm.ply_import(filepath=str(path))
    elif suffix == ".dae":
        bpy.ops.wm.collada_import(filepath=str(path))
    else:
        raise ValueError(f"Unsupported import extension: {suffix}")


def _import_asset(payload: dict[str, Any], save: bool) -> dict[str, Any]:
    source = Path(payload["source_path"])
    before = set(bpy.data.objects.keys())
    _import_asset_file(source)
    imported = sorted(name for name in bpy.data.objects.keys() if name not in before)
    if save:
        output = Path(payload["output_path"])
        output.parent.mkdir(parents=True, exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=str(output), check_existing=False)
    return {"source_path": str(source), "imported_objects": imported, "scene": _scene_summary()}


def _mesh_validation(obj: bpy.types.Object) -> dict[str, Any]:
    mesh = obj.data
    bm = bmesh.new()
    try:
        bm.from_mesh(mesh)
        boundary = sum(1 for edge in bm.edges if len(edge.link_faces) == 1)
        non_manifold = sum(1 for edge in bm.edges if len(edge.link_faces) != 2)
        loose_vertices = sum(1 for vertex in bm.verts if not vertex.link_edges)
    finally:
        bm.free()
    return {
        "vertices": len(mesh.vertices),
        "edges": len(mesh.edges),
        "polygons": len(mesh.polygons),
        "ngons": sum(1 for polygon in mesh.polygons if len(polygon.vertices) > 4),
        "boundaryEdges": boundary,
        "nonManifoldEdges": non_manifold,
        "looseVertices": loose_vertices,
        "uvLayers": [layer.name for layer in mesh.uv_layers],
        "materialSlots": len(obj.material_slots),
    }


def _validate_scene(payload: dict[str, Any]) -> dict[str, Any]:
    profile = payload.get("profile", "general")
    requested = set(payload.get("object_names") or [])
    objects = [obj for obj in bpy.context.scene.objects if not requested or obj.name in requested]
    missing = sorted(requested - {obj.name for obj in objects})
    warnings: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    rows = []
    for obj in sorted(objects, key=lambda item: item.name):
        row = _object_summary(obj)
        if any(component < 0 for component in obj.scale):
            warnings.append({"object": obj.name, "code": "negative-scale"})
        if obj.type == "MESH" and obj.data is not None:
            mesh = _mesh_validation(obj)
            row["validation"] = mesh
            if mesh["looseVertices"]:
                warnings.append({"object": obj.name, "code": "loose-vertices", "count": mesh["looseVertices"]})
            if profile == "3d-print" and mesh["nonManifoldEdges"]:
                errors.append({"object": obj.name, "code": "non-manifold", "count": mesh["nonManifoldEdges"]})
            if profile == "web" and not mesh["uvLayers"]:
                warnings.append({"object": obj.name, "code": "missing-uv"})
            if profile in {"general", "web"} and mesh["materialSlots"] == 0:
                warnings.append({"object": obj.name, "code": "missing-material"})
        rows.append(row)
    if missing:
        errors.append({"code": "missing-objects", "objects": missing})
    if not any(obj.type == "MESH" for obj in objects):
        errors.append({"code": "no-mesh-objects"})
    if profile == "animation":
        animated = any(
            obj.animation_data and (obj.animation_data.action or obj.animation_data.nla_tracks)
            for obj in objects
        )
        if not animated:
            errors.append({"code": "no-object-animation"})
    return {
        "profile": profile,
        "passed": not errors,
        "errors": errors,
        "warnings": warnings,
        "objects": rows,
        "scene": _scene_summary(),
    }


def _export(payload: dict[str, Any]) -> dict[str, Any]:
    output = Path(payload["output_path"])
    output.parent.mkdir(parents=True, exist_ok=True)
    suffix = output.suffix.lower()
    selected = bool(payload.get("selection_only", False))

    if suffix in {".glb", ".gltf"}:
        bpy.ops.export_scene.gltf(
            filepath=str(output),
            export_format="GLB" if suffix == ".glb" else "GLTF_SEPARATE",
            use_selection=selected,
        )
    elif suffix == ".fbx":
        if hasattr(bpy.ops.wm, "fbx_export"):
            bpy.ops.wm.fbx_export(filepath=str(output), export_selected_objects=selected)
        else:
            bpy.ops.export_scene.fbx(filepath=str(output), use_selection=selected)
    elif suffix == ".obj":
        bpy.ops.wm.obj_export(filepath=str(output), export_selected_objects=selected)
    elif suffix == ".stl":
        bpy.ops.wm.stl_export(filepath=str(output), export_selected_objects=selected)
    elif suffix in {".usd", ".usda", ".usdc"}:
        bpy.ops.wm.usd_export(filepath=str(output), selected_objects_only=selected)
    elif suffix == ".ply":
        bpy.ops.wm.ply_export(filepath=str(output), export_selected_objects=selected)
    else:
        raise ValueError(f"Unsupported export extension: {suffix}")
    return {"model_path": str(output), "format": suffix.lstrip(".")}


def main() -> int:
    args = _args()
    result_path = Path(args.result)
    result: dict[str, Any]
    try:
        with open(args.payload, "r", encoding="utf-8") as handle:
            payload = json.load(handle)
        if args.operation == "inspect":
            data = {"scene": _scene_summary(int(payload.get("max_objects", 200)))}
        elif args.operation == "inspect_object":
            data = _inspect_objects(payload)
        elif args.operation == "execute":
            data = _execute(payload)
        elif args.operation == "preview":
            data = _preview(payload)
        elif args.operation == "render":
            data = _render(payload)
        elif args.operation == "render_frames":
            data = _render_frames(payload)
        elif args.operation == "import":
            data = _import_asset(payload, True)
        elif args.operation == "export":
            data = _export(payload)
        elif args.operation == "validate_scene":
            data = _validate_scene(payload)
        else:
            imported = _import_asset(payload, False)
            data = {**imported, "validation": _validate_scene(payload)}
        result = {"ok": True, **data}
    except Exception as error:  # Blender must return diagnostics across the process boundary.
        result = {
            "ok": False,
            "error": f"{type(error).__name__}: {error}",
            "traceback": traceback.format_exc(),
        }
    result_path.parent.mkdir(parents=True, exist_ok=True)
    with open(result_path, "w", encoding="utf-8") as handle:
        json.dump(result, handle, ensure_ascii=False)
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
