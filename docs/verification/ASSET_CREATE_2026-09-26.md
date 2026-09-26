# OP-068 安全资源创建验证

日期：2026-09-26

目标环境：Cocos Creator 3.8.8，`D:\AI\Game\arrow-puzzle`

工具：`create_asset`

## 范围

- 通过已安装扩展的正式 MCP `tools/list` 与 `tools/call` 验证，不以直接加载工作区模块代替运行验收。
- 首批只创建新的 UTF-8 `.json` 与 `.txt` 工程资源，并核对 Creator 导入类型、importer、UUID、源文件和 `.meta`。
- 验证覆盖、Cocos 序列化格式、无效 JSON、相对路径穿越和缺失父目录在写入前被拒绝。
- 成功样本放在 `assets/McpKitValidation/`，验收后通过正式 `delete_asset` 清理，并再次核对磁盘与 asset-db 均不存在。

## 实现约束

- `create_asset` 仅在 `full` profile 开放；`core` 不增加写入口。工具总数为 `full` 125、`core` 40。
- 目标必须位于工程 `assets/` 内，父目录必须已存在且路径中不能包含符号链接目录；源文件或 `.meta` 任一已存在时拒绝覆盖。
- 目前只允许 `.json` 和 `.txt`，内容必须是无 NUL 的 UTF-8 字符串且不超过 1 MiB；JSON 必须先解析成功。
- 创建前要求 asset-db ready 且精确 URL 不存在；只调用一次 `asset-db:create-asset`，原生调用抛错或结果不确定时不自动重试写入。
- 返回成功前两次核对源内容 SHA-256、磁盘 `.meta`、asset-db 元数据、UUID、URL、导入器、资源类型、imported/invalid/readonly/directory 状态及数据库就绪状态，中间等待 400 毫秒防止短暂成功随后回退。
- 场景、预制体、脚本、`.meta` 与二进制资源不走此通用入口，应使用对应的专用序列化、脚本或导入流程。

## 正式入口结果

- `/health` 返回 `Cocos MCP Kit - arrow-puzzle`，工程身份为 `758048aa923da9e57466f98a`；`get_project_info` 确认 Creator 3.8.8、`full` profile 和正确扩展路径。
- `tools/list` 返回 125 项并包含 `create_asset`；schema 要求 `target` 与 `content`，工具标记为非只读、非幂等。
- JSON 样本 `Op068CreateJson_20260926_1627.json` 创建成功，UUID 为 `3c7590fa-91f7-40a0-8466-656485fdc773`，类型/importer 为 `cc.JsonAsset`/`json`，84 字节，SHA-256 为 `ad882b57bd7251cf4d689c770c87dccd03e866618e9516fa72812dcce0de8c25`。
- 文本样本 `Op068CreateText_20260926_1627.txt` 创建成功，UUID 为 `0056959e-f7fc-4518-afa1-970e8108857a`，类型/importer 为 `cc.TextAsset`/`text`，46 字节，SHA-256 为 `26587c90e61ae28d91ec5d98b2ec59aefb9e3ecd34ff1d90414ffd1c06aa7e39`。
- 两次结果均报告 `sourceMatches`、`metadataMatches`、`imported`、`databaseReady` 和 `stableAfterSettle` 为 true；直接读取源文件与 `.meta` 得到相同字节数、哈希、UUID 和 importer。
- 正式 `inspect_asset(includeData:true)` 对两项均返回 `details.complete=true`、顶层 `complete=true`，资源可用、无截断，源路径、UUID、类型和三处 importer 一致。
- 对已有 JSON 再次创建被 `create_asset never overwrites` 拒绝；`.prefab`、无效 JSON、`../` 路径和不存在的父目录均返回 MCP 错误，相关源文件和 `.meta` 均未产生。

## 清理与回归验证

- 两个成功样本均经正式 `delete_asset` 返回删除成功；随后源文件与 `.meta` 均不存在，正式 `inspect_asset` 返回 `Asset not found`。
- `assets/McpKitValidation/` 中不存在任何 `Op068*` 残留；清理后工程 `assets` 共 3519 个文件。本次按相对路径、NUL 分隔和文件内容计算的清理后 SHA-256 快照为 `0F15184ACC2A50B083AC92D4542976B95ECE9759B8669A31D9D3425886EC8D26`。
- 新增 6 项资源创建测试并扩展文件工具和工具目录断言；相关定向回归 50 项通过。
- 全量 `node --test`：943 项通过，0 失败，0 跳过。
- 工具文档生成检查、改动 JavaScript 语法检查和 `git diff --check` 通过。

## 限制

- 首批不创建新目录；先由用户或后续目录工具建立并导入父目录，避免把文件系统目录出现误报为 asset-db 已就绪。
- 本工具不覆盖或更新资源；覆盖保存属于 OP-072，复制/移动属于 OP-069/070，批量导入与重导入属于 OP-073 至 OP-075。
- 成功只证明 Creator 3.8.8 已持久化并导入这两类小型文本资源，不证明资源在业务代码中已被引用或运行时加载成功。
- 不确定失败会保留可能已经出现的目标文件供检查，不自动删除、覆盖或重试。
- 本次只在 Windows 上的 Cocos Creator 3.8.8 与当前验证工程中验收。
