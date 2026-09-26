# OP-067 资源详情验证

日期：2026-09-26

目标环境：Cocos Creator 3.8.8，`D:\AI\Game\arrow-puzzle`

工具：`inspect_asset`

## 范围

- 通过已安装扩展的正式 MCP `tools/list` 与 `tools/call` 验证，不以直接加载工作区模块代替运行验收。
- 验证紧凑 `details` 对目标、源资源、磁盘文件、importer、元数据和主/子资源关系的稳定表达。
- 保留并验证原有精确目标、原始有界快照、截断和错误边界。
- 调用前后比较工程 `assets` 全部文件，确认详情查询没有修改资源。

## 实现约束

- OP-067 复用 `inspect_asset`，不新增与 OP-064 重复的工具；core/full 数量保持 40/124。
- `details.target` 表示调用方请求的资源；`details.source` 表示拥有源文件的主资源。SpriteFrame 等子资源不会被误写成独立源文件。
- `details.import` 分别报告 target、source 和 metadata importer，并给出 ready、not_imported、invalid 或 unknown 状态。
- `details.metadata` 报告元数据查询状态、归属、UUID、版本与有界用户数据键，不复制无界 userData。
- 文件详情通过只读 `lstat` 取得查询时存在性、文件/目录类型、大小及工程相对路径。若 asset-db 报告的文件缺失或读取失败，详情和顶层 `complete` 均为 false。
- 原始 info/meta/data 仍受 maxDepth、maxItems、maxNodes、maxStringLength 和 maxCharacters 约束。

## 正式入口结果

- `/health` 返回 `Cocos MCP Kit - arrow-puzzle`，工程身份为 `758048aa923da9e57466f98a`。
- `tools/list` 返回 124 项；`inspect_asset` 新描述包含 source/import/file/main-subasset details，仍标记为只读、非破坏和幂等。
- `ArrowHammer.png` 主资源报告类型 `cc.ImageAsset`，target/source/metadata importer 均为 `image`；源文件为 `assets/McpKitValidation/ArrowHammer.png`，状态 available、类型 file、大小 23982 字节，包含 2 个子资源。
- SpriteFrame UUID `7222d7a1-b348-41ec-9f8a-4eea647d8774@f9941` 报告 kind=subasset、target importer=`sprite-frame`，源资源为同一图片主 UUID、source importer=`image`，源文件仍是 ArrowHammer.png；子资源键为 `f9941`。
- `IconPair.prefab` 报告 `cc.Prefab`/`prefab`，文件 `assets/McpKitValidation/IconPair.prefab` 大小 6244 字节。
- `GameController.ts` 报告 `cc.Script`/`typescript`，文件 `assets/scripts/game/GameController.ts` 大小 42292 字节。
- `assets/McpKitValidation` 报告 `cc.Asset`/`directory`，磁盘类型为 directory，文件大小为空而非伪造 0。
- 内置 `db://internal/default_prefab/2d/Camera.prefab` 的目标和源范围均为 internal，磁盘文件范围为 external、状态 available、importer 为 prefab；没有把它误报为工程资源。
- 默认限制下图片和 SpriteFrame 均 `details.complete=true`、顶层 `complete=true`。将 `maxItems` 人为降为 20 后，原始快照出现截断并使顶层 `complete=false`，但紧凑详情仍完整可用。
- 缺失 `.prefab`、无扩展名 `IconPair` 和工程外绝对路径均以正式 MCP 错误结果拒绝；工具没有猜扩展名或读取任意外部目标。

## 文件与回归验证

- 查询前后均为 3519 个 `assets` 文件，按相对路径和内容计算的合并 SHA-256 均为 `7F0879CD18828BC281B9713074E1A673C83415F5D03EE601A67CFE2D6CCA4417`。
- 新增 1 项缺失源文件测试，并扩展主资源、子资源、元数据错误和有界输出断言；相关定向回归 69 项通过。
- 全量 `node --test`：936 项通过，0 失败，0 跳过。
- 工具文档生成检查、改动 JavaScript 语法检查和 `git diff --check` 通过。

## 限制

- 文件存在性、大小和修改时间是调用瞬间的磁盘快照，不锁定后续变化。
- 内置资源的源文件可位于工程外；只读详情会如实标记 external，不表示允许写入。
- 用户数据只返回键名和数量；完整有界元数据仍在 `meta` 字段中。
- 查询不验证动态 bundle、运行时字符串路径、资源解码成功或最终视觉效果。
- 本次只在 Windows 上的 Cocos Creator 3.8.8 与当前验证工程中验收。
