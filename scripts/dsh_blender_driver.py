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
    parser.add_argument("--operation", required=True, choices=("inspect", "execute", "render", "export"))
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

    output = Path(payload["output_path"])
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
    bpy.ops.render.render(write_still=True)
    return {"image_path": str(output)}


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
        elif args.operation == "execute":
            data = _execute(payload)
        elif args.operation == "render":
            data = _render(payload)
        else:
            data = _export(payload)
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
