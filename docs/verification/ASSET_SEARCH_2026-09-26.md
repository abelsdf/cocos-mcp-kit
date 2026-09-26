# OP-065 资源搜索验证

日期：2026-09-26

目标环境：Cocos Creator 3.8.8，`D:\AI\Game\arrow-puzzle`
工具：`list_assets`

## 范围

本项把既有资产目录入口扩展为只读、有界且可消歧的搜索：

- 默认只查询 `db://assets/**`；`scope: "all"` 才允许返回编辑器内置资源。
- 名称支持不区分大小写的 `contains`、`prefix` 和 `exact`，同时匹配文件名、显示名、URL 末段及去扩展名末段。
- 可组合精确 `ccType`、工程目录、asset-db pattern 和是否包含导入子资源。
- 结果按规范 URL 和 UUID 稳定排序、去重并按 `offset`/`limit` 分页；默认 50、最多 200 项。
- 精确名称命中多个资源时返回有界 `selection.candidates`；带名称筛选结果中的同名组另列于 `ambiguities`，无名称分页不重复附带全工程同名目录。
- 返回精简身份，不执行打开、选择、刷新、导入或写入。

## 自动化验证

新增 `test/asset-search.test.js`，覆盖默认工程范围、稳定分页、重复记录去重、无扩展名精确名称、重名候选、目录/类型组合、大小写、子资源开关、内置资源显式范围、参数拒绝和 MCP schema。

定向回归：`node --test test/asset-search.test.js test/asset-inspection.test.js test/asset-resolution.test.js test/assets.test.js test/tool-registry.test.js`，102 项通过、0 失败、0 跳过。全量 `node --test` 共 929 项通过、0 失败、0 跳过。JavaScript 语法、生成工具文档和 `git diff --check` 同时通过。

## Creator 正式入口

最新版扩展同步后启动目标工程，健康检查返回 `Cocos MCP Kit - arrow-puzzle`；`tools/list` 保持 123 项，并为 `list_assets` 暴露 pattern、类型、名称/模式、大小写、目录、子资源、范围和分页参数。

正式 `tools/call` 结果：

| 场景 | 实际结果 |
|---|---|
| 默认工程范围，`limit=3` | 扫描并匹配 1821 条，返回 3 条、`nextOffset=3`；相同参数重复调用 URL 顺序完全一致。 |
| `offset=3, limit=3` | 返回下一组 3 条、`nextOffset=6`，与第一页无重叠。 |
| `assets/McpKitValidation` + `cc.Prefab` | 精确返回 ApplyProbe、IconPair、NestedPair 3 个预制体。 |
| 目录内 `Arrow` 前缀 + `cc.ImageAsset` | 精确返回 ArrowHammer、ArrowHint 2 张图片。 |
| `IconPair` exact + `cc.Prefab` | 无扩展名输入返回唯一 `IconPair.prefab`，候选数 1。 |
| `spriteFrame` exact + `cc.SpriteFrame` | 返回 ArrowHammer/ArrowHint 的 2 个子资源，`selection.ambiguous=true` 并给出两个 UUID、URL 和主资源 UUID。 |
| 同一查询 + `includeSubassets=false` | 返回 0 条，不把主图片误报为 SpriteFrame。 |
| `scope=all` + `Camera` exact + `cc.Prefab` | 仅在显式全范围下返回两个内置 Camera 预制体，并报告歧义。 |
| `limit=201` | 在 asset-db 查询前拒绝，明确允许范围为 1—200。 |
| 无名称默认分页 | `ambiguities` 为空，不重复附带全工程同名候选。 |

正式查询前后递归读取工程 `assets` 下 3519 个文件。排序后的逐文件 SHA-256 清单合并摘要均为 `0CE65BE54843CFE7159B42D8CB5C3DC0B5B32F152BEF951AFA79F27B2C91E68E`，差异行 0。

## 当前结论

OP-065 在 Cocos Creator 3.8.8 和目标复杂工程中通过正式 MCP 入口验收。结果顺序在同一 asset-db 集合上稳定；若两页调用之间发生导入、删除或移动，偏移分页可能随集合变化。本项不提供正则、模糊/语义搜索或跨调用快照令牌；OP-066 将继续收紧按名称查找的调用语义。
