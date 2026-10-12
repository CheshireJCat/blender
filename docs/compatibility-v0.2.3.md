# dsh-blender 0.2.3 compatibility verification

Verification date: 2026-10-12 (Asia/Shanghai).

## Results

| Exact DSH release | Compatibility | Install | Start and tool dispatch | Uninstall | Rollback |
| --- | --- | --- | --- | --- | --- |
| 0.2.0-rc.2 | compatible | passed | passed | passed | unknown |
| 0.2.1-alpha.1 | compatible | passed | passed | passed | unknown |
| 0.2.1-alpha.2 | compatible | passed | passed | passed | unknown |

All three Profiles register 13 Blender tools, 30 skills, and 23 enabled helpers. The separately invoked package checks also pass: package validation, 8 unit/regression tests, the analysis-helper integration test, and the real Blender integration test. The default unit-test command skips the two opt-in integration tests; both are executed explicitly in this acceptance run.

## Scope

Author-run acceptance on macOS arm64, Node.js 25.1.0, Python 3.12, and Blender 5.2.0 LTS. Each DSH version is installed separately at its exact npm version. Each run creates a fresh `DSH_HOME` and `DSH_AGENTS_HOME`, installs the packed plugin through the public DSH CLI, and uses the real base-backed Profile launcher and tool execution pipeline. No existing user Profile is modified.

Node.js 22.12+ is required by the current DSH CLI's Commander dependency. This run uses Node.js 25.1.0; it is not a separate acceptance run for each supported Node.js version.

## Reproduce

```bash
pnpm install --frozen-lockfile
pnpm validate
pnpm test
pnpm test:helpers
pnpm test:blender

release_dir=$(mktemp -d)
npm pack --pack-destination "$release_dir"
for dsh_version in 0.2.0-rc.2 0.2.1-alpha.1 0.2.1-alpha.2; do
  host_dir="$release_dir/$dsh_version/host"
  npm install --prefix "$host_dir" --registry=https://registry.npmjs.org \
    --no-audit --no-fund "@deepseek-ai/dsh@$dsh_version"
  pnpm test:dsh "$host_dir" "$release_dir/dsh-blender-0.2.3.tgz" "$release_dir/evidence"
done
```

`test:dsh` writes command logs, a runtime summary, and `report.json` into a uniquely named evidence directory. It checks:

- `dsh plugin --profile blender-smoke add <tarball>` succeeds and activates only the plugin-owned `blender-modeling` entry.
- `--dump-config` includes the Blender Bundle Patch.
- `dsh plugin --profile blender-smoke exec dsh-blender-setup` initializes the installed package's private analysis environment.
- The actual `runProfile` launcher starts, registers 13 Blender tools and 30 skills, and loads `create-3d-model`.
- A real DSH agent with an isolated workspace executes tools through `ctx.tools.execute`: Blender status, cube creation, scene/object inspection, scene validation, camera-free preview, GLB export, clean-process export re-import validation, helper discovery, and OpenCV wireframe analysis.
- The DSH tool pipeline rejects an output path outside that agent's workspace.
- The Profile shuts down cleanly before `dsh plugin ... remove dsh-blender` runs. The dependency, bundle activation, installed package, and composed entry are all absent after removal.

## Evidence limits

These are author-run install/start/uninstall and targeted tool acceptance results. They do not constitute an independent security audit, full acceptance of every Blender operation, a live LLM-driven modeling conversation, acceptance of every UI Profile, or testing on Linux/Windows. Rollback is not exercised and remains `unknown`. DSH STORE approval and automatic re-listing are separate downstream results.

The Bundle Patch only inserts `blender-modeling`; it does not replace or disable official components. Host DSH packages remain optional peer dependencies. No plugin install/prepare lifecycle script is introduced.
