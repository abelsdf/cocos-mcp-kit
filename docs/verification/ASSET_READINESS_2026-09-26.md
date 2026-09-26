# OP-079 资源就绪检查验证（2026-09-26）

## 范围与语义

新增 `full` 配置下的只读 `check_asset_ready`。无目标时，连续两次查询 `asset-db:query-ready` 为 `true` 才报告 `ready: true`；指定精确 UUID 或 `db://assets` / `db://internal` URL 时，还要求 `query-asset-info` 返回已导入且非无效的资源，输入身份、UUID 查询、URL 查询一致，并在等待后保持第二次稳定读取。`waitMs` 默认 1500、最多 10000，轮询间隔默认 150 毫秒；每次原生消息请求有 3000 毫秒上限。零等待仅作单次观察，不能报告稳定就绪。

返回的 `scope` 区分 `asset_db_query` 和 `asset_db_record`。忙、缺失、导入中、身份冲突、单次观察以及原生查询超时均返回 `ready: false`；其他原生 IPC 错误显式失败。该状态只证明当时的 asset-db 查询和可选记录身份，**不证明**导入任务队列已清空、源字节未变化、资源构建或 `library` 产物完成。若需要资源写入持久化证明，应调用相应的创建、导入、保存、刷新或重导入工具。

## 当前检查

| 检查 | 结果 |
|---|---|
| 目标规范化、连续稳定读取、忙转就绪、缺失、导入中、身份冲突、零等待、边界、原生错误及挂起查询超时 | 8 项定向测试通过。 |
| 项目全量测试 | 1020 项通过、0 失败、0 跳过。 |
| JS 语法与生成工具文档 | 已通过；工具清单为 `full` 133、`core` 40。 |
| Creator 3.8.8 正式 MCP 入口 | 已安装新版扩展，`/health` 指向 `arrow-puzzle`，`tools/list` 为 133 项且包含 `check_asset_ready`。全局、图片主资源 URL/UUID、纹理子资源均报告两次稳定且 `ready: true`；不存在目标报告 `missing`，零等待报告 `unconfirmed`，非法路径返回错误。 |
| 工程资源快照 | 验收后 `assets` 为 3519 个文件；相对路径排序后汇总“路径 + NUL + 单文件 SHA-256 + LF”的合并 SHA-256 为 `372A58284BC329BDB50E127717FE001956EEA2415370D181CE0EF1D810B609D5F`，与验收前基线一致。 |

正式入口实测：`db://assets/McpKitValidation/ArrowHint.png` 与主 UUID `1b3c2630-2ff7-4455-a872-072e320c0d8c` 均返回 `cc.ImageAsset/image`、两次稳定读取，耗时约 168 毫秒；`1b3c2630-2ff7-4455-a872-072e320c0d8c@6c48a` 返回 `cc.Texture2D/texture` 且两次稳定读取。全局查询返回 `asset_db_query`、约 164 毫秒。缺失的 `OP079_missing_9d7a.json` 在 300 毫秒等待后仍为 `missing`，`ready: false`；`waitMs: 0` 返回 `unconfirmed`。`db://assets/../invalid.png` 在原生查询前被拒绝。

数据库忙转就绪、尚未导入记录、身份冲突与原生 IPC 错误由单元故障注入验证，未在现场人为制造编辑器异常。挂起请求测试确认单次原生消息超时按 `query_timeout` 返回 `ready: false`；未在真实编辑器中故意挂起 IPC。资源主/子身份和工程快照已现场核对，但只读入口无需写盘或保存重开测试。

依据：[Cocos Creator 3.8 消息系统](https://docs.cocos.com/creator/3.8/manual/zh/editor/extension/messages.html)说明 `Editor.Message.request` 为异步进程通信，但没有给出 `query-ready` 代表所有导入任务完成的保证。具体就绪语义以 Creator 3.8.8 实测和本工具返回字段为准。
