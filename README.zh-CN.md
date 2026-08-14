# dsh-blender

[English](README.md)

一个可安装到 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的 Blender 3D 建模插件。它以 `create-3d-model-skill` 为蓝本，把完整的建模工作流、29 个按需领域模块和 26 个分析/验证脚本接入 dsh，并提供可实际执行的 Blender 工具。

## 提供的能力

- `blender_status`：检查 Blender 可执行文件和当前 dsh workspace。
- `blender_scene_info`：只读检查 `.blend` 场景、对象、尺寸、材质、修改器和拓扑。
- `blender_python`：执行小段 `bpy`/`bmesh` 建模代码并保存版本化 `.blend`。
- `blender_render`：生成 PNG/JPEG 视觉验收图。
- `blender_export`：导出 GLB/glTF、FBX、OBJ、STL、USD 或 PLY。
- `create-3d-model` Skill：从粗模、细化、材质、灯光、相机、动画到视觉验收和交付的完整编排。

插件直接启动 Blender 后台进程，不要求安装 BlenderMCP 插件，也不会开放控制端口。

## 环境要求

- DeepSeek Harness `0.1.0-rc.6`
- Node.js 20+
- Blender 4.3+；当前实现已面向 Blender 5.x API 适配
- `blender` 在 `PATH` 中，或在 `cordis.patch.yml` 中配置绝对路径

## 安装到本地 dsh Web profile

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
  timeoutMs: 180000
  maxOutputChars: 20000
  restrictToWorkspace: true
  enablePython: true
  registerSkill: true
```

- `restrictToWorkspace: true`：默认要求所有输入和输出都位于当前 dsh 会话 workspace 内，并检查已有符号链接的真实目标。
- `enablePython: false`：可以关闭能力最强、风险也最高的 `blender_python`，保留检查、渲染和导出工具。
- `registerSkill: false`：只注册工具，不向 dsh Skill 目录贡献 `create-3d-model`。

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
pnpm validate
pnpm test
pnpm test:blender
```

`test:blender` 会真实启动 Blender，创建 `.blend`、检查场景、渲染 PNG，并导出 GLB。

## 来源与许可

插件使用 MIT License。建模 Skill 来源、二次适配说明和上游许可保留在 `NOTICE`、`skills/create-3d-model/LICENSE`、`skills/create-3d-model/UPSTREAM_LICENSE` 与 `skills/create-3d-model/references/upstream.md`。
