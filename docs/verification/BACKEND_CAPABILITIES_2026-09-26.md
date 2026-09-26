# FR-26 只读后端能力报告验证（2026-09-26）

## 范围

`get_backend_capabilities` 只报告当前 Cocos MCP Kit 扩展后端及实际开放的 MCP 工具。官方 CLI 适配器固定为 `not_configured`，不探测安装，也不调用 CLI。每项工具的只读/破坏性字段来自现有 MCP 注解，是风险提示，不是运行成功或保存持久化证据。默认最多返回 50 项，可分页查询；完整开放/禁用目录仍由 `get_tool_catalog` 提供。结构与选择边界见[设计记录](../BACKEND_CAPABILITY_DESIGN.md)。

## 当前检查

| 检查 | 结果 |
| --- | --- |
| 纯逻辑与工具注册 | 新增 5 项测试，覆盖公开项目信息、CLI 未配置、开放/禁用筛选、风险计数、分页与非法范围拒绝；全量 1045 项通过、0 失败、0 跳过。语法、生成文档与发布检查通过。 |
| Creator 3.8.8 动态方法 | 只读加载当前源码；实际项目名称 `arrow-puzzle-cocos`、UUID、Windows x64、扩展版本 0.1.0、Creator 3.8.8 均返回。`full` profile 有 137 个开放工具；只读提示 55、写入或有状态提示 82、破坏性提示 34；`limit=2` 返回两项及下一页偏移，官方 CLI 为 `not_configured`。首次动态加载受 Node 模块缓存影响返回旧字段；清除这两个源码模块缓存后复核新字段，未修改场景。 |
| 正式 MCP 入口 | 备份并安装 11 个文件，逐一确认与仓库源码 SHA-256 一致。重开 Creator 后 `tools/list` 返回 137 项，报告工具的 `readOnlyHint=true`。正式调用返回活动后端 `creator-extension`、项目 `arrow-puzzle-cocos` 与 UUID、Creator 3.8.8、`full` profile 下 137 项；默认前页 50 项、续页 87 项，合并后 137 个唯一工具，末页无下一偏移。官方 CLI 为 `not_configured`；`limit=201` 明确拒绝。 |

本报告不包含原始扩展配置、客户端配置、凭据或环境变量；`available` 仅说明当前扩展 MCP 后端正在响应，不表示每个开放工具都已通过独立验收。

动态加载仓库源码位于当前 Cocos 工程外，旧版 `execute_javascript` 默认安全检查会拒绝该绝对路径；已审核本次代码只读取公开 API 与工具目录，动态验证时仅对此调用显式设置 `safety_checks=false`。正式新工具不需要关闭安全检查。
