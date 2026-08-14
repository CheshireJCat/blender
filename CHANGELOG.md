# Changelog

All notable changes to this project are documented in this file.

## 0.2.0 - 2026-08-14

- Register the complete 30-skill Blender capability stack in DeepSeek Harness.
- Expand the runtime to 13 workspace-scoped Blender tools for inspection, import, Python execution, preview, rendering, export, and validation.
- Expose all 26 upstream deterministic helpers through a strict catalog and runner; 23 modeling helpers are enabled by default and 3 maintenance helpers remain opt-in.
- Add an isolated Python analysis environment with OpenCV, NumPy, Pillow, and SciPy plus the `dsh-blender-setup` command.
- Add real Blender, helper, package, and dsh session integration validation.

## 0.1.0 - 2026-08-14

- Initial DeepSeek Harness Blender plugin with the top-level modeling skill and basic status, scene inspection, Python, render, and export tools.
