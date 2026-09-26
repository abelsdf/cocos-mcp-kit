# 首版只读后端能力报告设计

范围：FR-26 的 P0 架构部分。当前只报告运行中的 Cocos MCP Kit 扩展及其 MCP 工具开放状态；官方 CLI 适配器尚未配置，不探测可执行文件、不调用 CLI，也不把公开仓库中的候选能力列为本扩展已实现。来源与首版边界见 [官方 CLI 能力对照](./OFFICIAL_CLI_ANALYSIS.md)。

新增 core-profile 只读 `get_backend_capabilities`，不接收项目路径。返回固定 schema 版本、活动后端、项目与平台身份、后端状态，以及当前 profile 下实际开放的工具分页。工具项只提供 ID、分类、只读和破坏性注解提示；注解是风险线索，不是调用成功或 Creator 持久化证明。`get_tool_catalog` 仍提供完整工具目录与禁用状态。

| 字段 | 语义 |
| --- | --- |
| `schemaVersion` | 独立于扩展版本的报告结构版本。 |
| `activeBackend` | 当前为 `creator-extension`；后续 CLI 适配不得改变现有工具 schema。 |
| `project` | 优先取公开 `Editor.Project` 名称、路径、UUID；不可用时仅项目路径退回现有运行上下文，并标明来源。 |
| `platform` | 当前扩展进程的 Node 平台与架构。 |
| `backends.creatorExtension` | 扩展版本、Creator 版本、引擎版本未知值、工具 profile、开放工具计数和分页；`available` 只表示此 MCP 后端正在响应。 |
| `backends.officialCli` | 首版固定为 `not_configured`，版本和可用操作为空；不把“未配置”说成“未安装”。 |
| `operationPage` | `offset` 和 `limit` 控制当前已开放工具列表，默认 50、最大 200；返回总数及下一页偏移，避免大 profile 一次展开全部定义。 |
| `verification` | 明确本报告只检查工具开放状态，具体功能仍需相应 Creator/CLI 运行证据。 |

后端选择规则：当前扩展始终独立工作。首版不自动切换到官方 CLI、不执行混合路由，也不因 CLI 未配置而阻断当前扩展；未来适配器只有在安装、版本、项目兼容和具体能力都通过探测后才能进入选择。首版输出不得含原始扩展配置、客户端配置、凭据或进程环境。
