# OP-080 资源路径查询验证（2026-09-26）

## 范围与边界

新增 full-profile 只读 `query_asset_path`，接收精确 UUID、db URL、工程 `assets/` 相对路径或其中的绝对路径。它不猜测扩展名，不修改资源；先通过 `query-asset-info` 解析并用 UUID/URL 再查交叉核对，随后比较 `query-path` 对 UUID 与规范 URL 的映射。工程资源还要求返回的源路径与项目 `assets` 下的规范路径一致，并检查磁盘类型。缺失资源返回 `not_found`；未导入、身份不一致或源文件不可用返回 `incomplete`。

Creator 3.8.8 中，图片 Texture2D 子资源的 `query-path` 返回 `ArrowHint.png@6c48a`，而 `query-asset-info.url` 为 `db://assets/McpKitValidation/ArrowHint.png/texture`。前者是原生映射，不是磁盘上的图片文件。本工具将 `nativeMapping.isPhysicalSource` 标为 `false`，通过已登记的父子 UUID 关系查询主资源，把真实 `ArrowHint.png` 路径放在 `source.path`。调用方不得对原生映射路径执行文件写入。

## 当前检查

| 检查 | 结果 |
|---|---|
| 纯逻辑与模拟 asset-db | 6 项测试通过：主资源四种精确输入、子资源 UUID/URL/别名、缺失与非法路径、过期身份、缺失父资源、源文件缺失/越界、未导入及路径不一致。 |
| 全量回归 | 1026 项通过、0 失败、0 跳过；JS 语法、工具文档与发布检查通过。 |
| Creator 3.8.8 动态方法 | `ArrowHint.png` 主资源解析为真实图片路径；Texture2D `@6c48a` 子资源返回同一源图片且把 `@` 原生映射标为非物理；缺失目标为 `not_found`。 |
| 正式 MCP 入口 | 安装新版扩展并重开 Creator 后，`tools/list` 返回 134 项，包含标为只读的 `query_asset_path`。主资源的 URL、UUID、相对路径、绝对路径均解析到同一真实文件；Texture2D 子资源的 UUID、规范 URL 均返回主资源图片作为 `source.path`，`@6c48a` 原生映射标为非物理。不存在的 URL 返回 `not_found`，遍历路径及项目 `assets` 外的绝对路径被拒绝。 |
| 工程资源快照 | 正式入口调用前后，`assets` 均为 3519 个文件，排序路径与每文件 SHA-256 汇总值均为 `372A58284BC329BDB50E127717FE001956EEA2415370D181CE0EF1D810B609D5F`；真实 `source.path` 可由磁盘直接访问。 |

官方消息系统依据：[Cocos Creator 3.8 消息系统](https://docs.cocos.com/creator/3.8/manual/zh/editor/extension/messages.html)。`query-path` 对子资源的具体返回形态以上述 Creator 3.8.8 实测为准，不推断其他版本必然相同。
