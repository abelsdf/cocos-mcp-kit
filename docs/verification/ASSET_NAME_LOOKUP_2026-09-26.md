# OP-066 资源名称解析验证

日期：2026-09-26

目标环境：Cocos Creator 3.8.8，`D:\AI\Game\arrow-puzzle`

工具：`find_asset_by_name`

## 范围

- 通过正式 MCP `tools/list` 与 `tools/call` 验证已安装扩展，不以直接加载工作区模块代替运行验收。
- 验证精确名称的未找到、唯一和重名状态，以及类型、目录、大小写、主/子资源和内部资源范围过滤。
- 验证候选数量上限、稳定身份字段、只读工具标记和非法参数拒绝。
- 调用前后比较工程 `assets` 全部文件，确认查询没有修改资源。

## 实现约束

- 名称固定按 exact 匹配，可匹配文件名、显示名、URL 文件名及无扩展名文件名。
- 只有 `candidateCount === 1` 时返回 `selected`；重名时 `selected` 为 null，不按顺序猜选。
- 候选按 URL、UUID 稳定排序，默认最多 50、最高 200；截断通过 `candidatesTruncated` 明确报告。
- 默认只查询 `db://assets`；`scope: all` 才允许内置资源。`directory` 仍只接受工程资源目录。
- 模糊、前缀和包含搜索继续由 `list_assets` 提供。

## 正式入口结果

- `/health` 返回 `Cocos MCP Kit - arrow-puzzle`，工程身份为 `758048aa923da9e57466f98a`。
- `tools/list` 返回 124 项工具。`find_asset_by_name` 位于 core/full，schema 要求 `name`，暴露 `ccType`、`directory`、`caseSensitive`、`includeSubassets`、`scope` 和 `maxCandidates`；标记为只读、非破坏、幂等。
- `IconPair` + `cc.Prefab` + `assets/McpKitValidation` 返回 `unique`，UUID 为 `e6d4758d-3330-4f17-8fdb-58b4b180cb93`，URL 为 `db://assets/McpKitValidation/IconPair.prefab`；`selected` 和候选项均包含完整身份。
- `spriteFrame` + `cc.SpriteFrame` 命中 2 项；`maxCandidates: 1` 返回 `ambiguous`、`candidateCount: 2`、`returned: 1`、`candidatesTruncated: true`，且不提供 `selected`。
- `ArrowHammer` 在验证目录命中 ImageAsset、SpriteFrame、Texture2D 共 3 项并返回 `ambiguous`。设置 `includeSubassets: false` 后唯一解析到图片主资源；设置 `ccType: cc.SpriteFrame` 后唯一解析到 SpriteFrame 子资源 `7222d7a1-b348-41ec-9f8a-4eea647d8774@f9941`。
- 不存在名称返回 `not_found`、0 个候选和 null `selected`；对小写 `iconpair` 启用大小写区分后同样返回 `not_found`。
- `scope: all` 下 `Camera` + `cc.Prefab` 命中两个内置预制体并返回 `ambiguous`，没有任意选择。
- `maxCandidates: 201`、`directory: db://internal` 和空名称均由正式 MCP 调用以错误结果拒绝。

首次正式唯一查询中，`selected` 与 `candidates[0]` 共享同一对象，活动结果的有界序列化器把候选项显示为 `[Circular]`。实现改为复制唯一结果对象，并增加不共享引用的回归断言；重新安装后文本结果和结构化结果均返回完整候选对象，未再出现该标记。

## 文件与回归验证

- 查询前后均为 3519 个 `assets` 文件，按相对路径和内容计算的合并 SHA-256 均为 `7F0879CD18828BC281B9713074E1A673C83415F5D03EE601A67CFE2D6CCA4417`。
- 新增 6 项名称解析测试；资源查询、工具注册、项目指令和活动快照定向回归共 68 项通过。
- 全量 `node --test`：935 项通过，0 失败，0 跳过。
- 工具文档生成检查、改动 JavaScript 语法检查和 `git diff --check` 通过。

## 限制

- exact 名称可能同时匹配主资源和其导入子资源，调用方需指定 `ccType` 或关闭子资源。
- `maxCandidates` 只限制返回候选，不改变真实 `candidateCount`；截断时应继续缩小查询范围。
- 查询不验证运行时字符串拼接路径、动态 bundle 加载或资源视觉效果。
- 本次只在 Windows 上的 Cocos Creator 3.8.8 与当前验证工程中验收。
