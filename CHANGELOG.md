# Changelog

All notable changes to this project are documented in this file.

## 0.2.4 - 2026-10-24

- Fix Unicode workspace/input/output paths in all OpenCV-based helpers by reading and writing image bytes through NumPy instead of OpenCV's filename APIs (#12).
- Run Python helpers in UTF-8 mode and explicitly encode their stdout/stderr as UTF-8 so Windows locale settings do not corrupt diagnostics.
- Exercise Chinese, accented, and emoji workspace paths, template analysis, mask output/re-read, and existing helper families; add Windows and Linux CI coverage.

## 0.2.3 - 2026-10-12

- Declare exact compatibility with DSH `0.2.0-rc.2`, `0.2.1-alpha.1`, and `0.2.1-alpha.2`, with disposable-Profile install/start/uninstall evidence; rollback remains unverified.
- Accept the current DSH Tools and Schemastery prerelease peer versions while continuing to reuse the host runtime as optional peers.
- Align the Node.js requirement with the current DSH CLI (`>=22.12.0`) and update both installation guides.
- Add a reproducible DSH Profile smoke check covering real tool dispatch, skills, analysis setup, modeling, preview, export/re-import, workspace path guards, and uninstall cleanup.

## 0.2.2 - 2026-09-16

- Clean up temporary directories and partially written payloads when Blender call preparation fails, including JSON serialization and file write errors (#7, #8).
- Add regression coverage for payload serialization and partial-write failures.

## 0.2.1 - 2026-08-14

- Declare DeepSeek Harness runtime packages as peer dependencies so profile installs reuse the host runtime without duplicate dependency trees or peer warnings.
- Normalize the published `dsh-blender-setup` binary path and polish public package metadata.

## 0.2.0 - 2026-08-14

- Register the complete 30-skill Blender capability stack in DeepSeek Harness.
- Expand the runtime to 13 workspace-scoped Blender tools for inspection, import, Python execution, preview, rendering, export, and validation.
- Expose all 26 upstream deterministic helpers through a strict catalog and runner; 23 modeling helpers are enabled by default and 3 maintenance helpers remain opt-in.
- Add an isolated Python analysis environment with OpenCV, NumPy, Pillow, and SciPy plus the `dsh-blender-setup` command.
- Add real Blender, helper, package, and dsh session integration validation.

## 0.1.0 - 2026-08-14

- Initial DeepSeek Harness Blender plugin with the top-level modeling skill and basic status, scene inspection, Python, render, and export tools.
