# OP-081 资源 UUID 查询验证（2026-09-26）

## 范围与边界

新增 full-profile 只读 `query_asset_uuid`。输入为精确 UUID、db URL、工程 `assets/` 相对路径或项目资源目录中的绝对路径。工具先规范输入，再查询 asset-db 资源记录，按 UUID 和规范 URL 重查，并以原生 `query-uuid` 核对规范 URL；若输入是子资源别名 URL，还需核对该别名映射。导入子资源返回其自身 UUID，同时检查主资源 `subAssets` 登记及主资源 URL/UUID 映射。仅在这些身份检查通过且资源已导入时，顶层 `uuid` 才可供后续操作使用。缺失目标为 `not_found`；未导入、无效或映射冲突为 `incomplete`，顶层 `uuid: null`。该工具不读取或修改源文件，亦不凭文件名猜测资源。

Creator 3.8.8 实测：原生 `query-uuid` 对 `db://assets/McpKitValidation/ArrowHint.png` 及其绝对源路径返回主资源 UUID，对 `db://assets/McpKitValidation/ArrowHint.png/texture` 与 `@6c48a` 别名返回 Texture2D 子资源 UUID；对 `assets/McpKitValidation/ArrowHint.png` 相对路径和 UUID 本身返回空字符串。因此工具会先将相对路径转成 db URL，并对 UUID 输入通过资源记录的规范 URL 进行原生查询，不把原生空值解释为资源不存在。

## 当前检查

| 检查 | 结果 |
|---|---|
| 纯逻辑与模拟 asset-db | 新增 5 项测试，覆盖主资源四种输入、子资源规范 URL/别名/UUID、缺失与遍历拒绝、原生映射冲突、过期记录、未导入及父资源缺失。全量回归 1031 项通过、0 失败、0 跳过；JS 语法与发布检查通过。 |
| Creator 3.8.8 动态方法 | `ArrowHint.png` 主资源四种输入均返回 `1b3c2630-2ff7-4455-a872-072e320c0d8c`；Texture2D 的规范 URL、`@6c48a` 别名与 UUID 均返回 `1b3c2630-2ff7-4455-a872-072e320c0d8c@6c48a`，父资源身份一致；缺失目标为 `not_found`，相对遍历路径拒绝。 |
| 正式 MCP 入口 | 安装新版扩展并重开 Creator 后，`tools/list` 返回 135 项，包含标为只读的 `query_asset_uuid`。主资源的 db URL、相对路径、绝对路径和 UUID 均返回主资源 UUID；Texture2D 的规范 URL、`@6c48a` 别名和 UUID 均返回子资源 UUID 及正确父资源。缺失目标返回 `not_found` 和 `uuid: null`；相对路径遍历和项目 `assets` 外的绝对路径被拒绝。 |
| 工程资源快照 | 动态与正式入口只读查询后，`assets` 均为 3519 个文件，排序路径与每文件 SHA-256 汇总值仍为 `372A58284BC329BDB50E127717FE001956EEA2415370D181CE0EF1D810B609D5F`。 |

消息机制依据：[Cocos Creator 3.8 消息系统](https://docs.cocos.com/creator/3.8/manual/zh/editor/extension/messages.html)。该通用文档未给出 `query-uuid` 对别名、相对路径或 UUID 输入的具体返回承诺；上述细节以当前 Creator 3.8.8 现场查询为准。
