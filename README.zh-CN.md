# dsh-blender

[English](README.md)

一个可安装到 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的完整 Blender 3D 生产插件。它以 `create-3d-model-skill` 为蓝本，注册 1 个总编排 Skill、29 个可直接加载的领域 Skill、26 个受控分析/验证 Helper，以及 13 个可实际执行的 Blender 工具。

## 提供的能力

- `blender_status`：检查 Blender、图像分析 Python、30 个 Skill、Helper 和当前 workspace。
- `blender_scene_info` / `blender_object_info`：只读检查场景及对象级世界包围盒、求值后拓扑、UV、材质、约束、形态键和动画。
- `blender_import`：把 GLB/glTF、FBX、OBJ、STL、USD、PLY 或 DAE 导入干净场景并保存版本化 `.blend`。
- `blender_python`：执行小段 `bpy`/`bmesh` 建模代码并保存版本化 `.blend`。
- `blender_preview`：不依赖已有相机，以等距/前后左右/顶底视角生成临时灯光预览，不修改源文件。
- `blender_render` / `blender_render_frames`：生成单帧或动画代表帧的 PNG/JPEG 视觉证据。
- `blender_export`：导出 GLB/glTF、FBX、OBJ、STL、USD 或 PLY。
- `blender_validate_scene` / `blender_validate_export`：按通用、Web、3D 打印或动画目标审计场景，并通过干净进程回读导出物。
- `blender_helper_catalog` / `blender_helper_run`：发现并执行全部 26 个参考图、线框、轮廓、多视图、UV、贴图、外观、修复与动画 QA Helper。
- 30 个 Skill：`create-3d-model` 负责总编排，其余模块（例如 `blender-modeling`、`reference-to-3d`、`wireframe-to-3d`、`blender-animation`）可由 DSH 直接加载。

插件直接启动 Blender 后台进程，不要求安装 BlenderMCP 插件，也不会开放控制端口。

## 环境要求

- DeepSeek Harness `0.1.0-rc.6`
- Node.js 20+
- Blender 4.3+；当前实现已面向 Blender 5.x API 适配
- `blender` 在 `PATH` 中，或在 `cordis.patch.yml` 中配置绝对路径

参考图、线框和视觉度量 Helper 还需要 Python 3.10+。本仓库提供一次性安装命令：

```bash
pnpm setup:analysis
```

它只会在插件目录创建被 Git 忽略的 `.venv`，并安装 OpenCV、NumPy、Pillow 和 SciPy。也可以把 `analysisPythonExecutable` 指向已有环境。

## 从 npm 安装

```bash
npx @deepseek-ai/dsh plugin --profile web add dsh-blender
npx @deepseek-ai/dsh plugin --profile web exec dsh-blender-setup
npx @deepseek-ai/dsh --profile web --dump-config
npx @deepseek-ai/dsh web
```

`dsh-blender-setup` 会在已安装的插件目录创建私有 `.venv`，并安装 OpenCV、NumPy、Pillow 和 SciPy。只有在完全不需要参考图、线框、多视图、贴图或动画分析 Helper 时才建议跳过。

也可以固定安装 GitHub Release：

```bash
npx @deepseek-ai/dsh plugin --profile web add github:CheshireJCat/blender#v0.2.1
```

## 从源码开发

在本仓库根目录执行：

```bash
npx @deepseek-ai/dsh plugin --profile web add .
npx @deepseek-ai/dsh --profile web --dump-config
```

然后重启 Web UI：

```bash
npx @deepseek-ai/dsh web
```

打开 [http://127.0.0.1:3080](http://127.0.0.1:3080)。新建以本仓库或你的建模目录为 workspace 的会话，然后输入：

```text
使用 create-3d-model 创建一个低多边形台灯。
先调用 blender_status，粗模和最终版本分别保存并渲染验收，
最后导出 GLB，同时保留版本化 .blend 源文件。
```

## 一次性 headless 验证

```bash
npx @deepseek-ai/dsh plugin --profile headless add .
npx @deepseek-ai/dsh --profile headless \
  "使用 create-3d-model 在 artifacts 下创建一个低多边形蓝色立方体，渲染预览并导出 GLB。"
```

## 配置

组合包的默认配置位于 `cordis.patch.yml`：

```yaml
config:
  blenderExecutable: blender
  analysisPythonExecutable: ''
  timeoutMs: 180000
  helperTimeoutMs: 120000
  maxOutputChars: 20000
  restrictToWorkspace: true
  enablePython: true
  enableHelpers: true
  enableMaintenanceHelpers: false
  registerSkill: true
  registerModuleSkills: true
```

- `restrictToWorkspace: true`：默认要求所有输入和输出都位于当前 dsh 会话 workspace 内，并检查已有符号链接的真实目标。
- `enablePython: false`：可以关闭能力最强、风险也最高的 `blender_python`，保留检查、渲染和导出工具。
- `enableHelpers: false`：关闭 Helper 目录和执行工具；基础 Blender 生产工具不受影响。
- `enableMaintenanceHelpers: false`：默认禁止 Skill 发布/清理类维护脚本；建模和验收 Helper 仍然可用。
- `registerModuleSkills: false`：只注册总编排 Skill，不注册 29 个领域 Skill。
- `registerSkill: false`：只注册工具，不向 DSH Skill 目录贡献任何 Blender Skill。

## 安全边界

`blender_python` 与在 Blender 内运行本地 Python 具有相同权限。它仅应处理可信的建模代码；不要用它下载资源、访问凭据、安装包、启动无关进程或修改 Blender 全局偏好。插件默认：

- 禁用 `.blend` 内嵌脚本自动执行；
- 限制模型文件、渲染和导出路径到会话 workspace；
- 默认拒绝覆盖已有文件；
- 每次调用使用独立 Blender 后台进程；
- 完成后清理内部临时脚本和 JSON 文件。

## 开发验证

```bash
pnpm install
pnpm setup:analysis
pnpm validate
pnpm test
pnpm test:blender
```

`test:blender` 会真实启动 Blender，创建与导入 `.blend`、执行对象检查和场景审计、生成相机预览与正式渲染、导出 GLB，并在干净 Blender 进程中回读验证。

## 来源与许可

插件使用 MIT License。建模 Skill 来源、二次适配说明和上游许可保留在 `NOTICE`、`skills/create-3d-model/LICENSE`、`skills/create-3d-model/UPSTREAM_LICENSE` 与 `skills/create-3d-model/references/upstream.md`。
