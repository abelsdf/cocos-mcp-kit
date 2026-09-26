# OP-083 工程信息验证（2026-09-26）

## 范围与依据

现有 core-profile 只读 `get_project_info` 原先返回扩展运行上下文，`projectName` 取自路径末段。在 `D:\AI\Game\arrow-puzzle` 中，该目录名是 `arrow-puzzle`，但项目 `package.json` 的原生名称是 `arrow-puzzle-cocos`。此次保留原有 MCP 上下文字段，并增加 `project` 与 `app` 两组有界公开字段；顶层项目名、路径和 Creator 版本优先取原生 API。API 不可用或字段类型不符时，仅相应原生字段为 `null`，不会将推断值伪装成原生结果。

依据：[Cocos Creator 3.8 Editor.Project](https://docs.cocos.com/creator/3.8/manual/zh/editor/extension/api/project.html)、[Editor.App](https://docs.cocos.com/creator/3.8/manual/zh/editor/extension/api/app.html)。只读取文档列明的字段，不调用 `Editor.App.quit`，不修改项目文件。

## 当前检查

| 检查 | 结果 |
| --- | --- |
| 单元和注册表 | 新增 4 项测试，覆盖原生字段、与目录名不同的项目名、API 缺失及异常字段、正式工具注册路由。全量 1040 项通过、0 失败、0 跳过；语法与发布检查通过。 |
| Creator 3.8.8 动态方法 | 从当前 MCP 编辑器上下文加载本地新版 `lib/project-info.js` 并只读调用，返回 `project.name=arrow-puzzle-cocos`、`project.path=D:\AI\Game\arrow-puzzle`、非空 UUID、`app.version=3.8.8`、`app.dev=false`；顶层 `projectName` 改为原生名称。 |
| 正式 MCP 入口 | 备份并同步 11 个扩展文件，逐一确认目标与源码 SHA-256 一致；重开 Creator 后 `tools/list` 返回 136 项，`get_project_info` 标记为只读。正式调用返回 `projectName=arrow-puzzle-cocos`、`project.path=D:\AI\Game\arrow-puzzle`、项目 UUID `0b994fc4-e69f-4b72-a983-b8297fca28cf`、`project.tmpDir=D:\AI\Game\arrow-puzzle\temp`、`cocosVersion=3.8.8`、`app.version=3.8.8`、`app.dev=false`，既有运行上下文字段仍在。 |
| 项目资源 | 只读操作；未写入或删除测试资源。 |

动态调用本地源码时，旧扩展的 `execute_javascript` 安全检查默认阻止工程外绝对路径。经检查代码只读取公开字段后，该次动态验证显式设置 `safety_checks=false`；正式工具不需要此设置。
