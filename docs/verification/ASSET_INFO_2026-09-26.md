# OP-064 资源信息查询验证

日期：2026-09-26

目标环境：Cocos Creator 3.8.8，`D:\AI\Game\arrow-puzzle`
工具：`inspect_asset`

## 范围

本项把既有资源详情入口收紧为只读、精确和有界的查询：

- 接受精确 UUID、`db://` URL、`assets/...` 路径和工程 `assets` 内绝对路径；不补猜 `.scene`、`.prefab` 或 `.ts`。
- 返回规范身份、导入器状态、主资源/子资源关系和稳定排序的子资源摘要。
- 区分当前资源元数据与回退查询到的主资源元数据；缺失、原生查询错误和未请求分别报告。
- `includeData` 默认关闭；信息、元数据和可选数据均受深度、条目、节点、字符串及字符预算约束。
- 不执行资源打开、刷新、导入、写入或选择操作。

## 自动化验证

新增 `test/asset-inspection.test.js`，覆盖精确路径规范化、禁止扩展名猜测、图片主资源、SpriteFrame 子资源、直接返回主资源元数据的子资源、错误状态、有界快照、敏感字段遮蔽、访问器不求值和工具 schema。

定向回归：`node --test test/asset-inspection.test.js test/asset-resolution.test.js test/assets.test.js test/tool-registry.test.js`，96 项通过、0 失败、0 跳过。

## Creator 正式入口

最新版扩展同步后启动目标工程，健康检查返回 `Cocos MCP Kit - arrow-puzzle`。`tools/list` 返回 123 项工具；`inspect_asset` 已暴露 `includeData` 和 5 个有界参数，标注为只读、非破坏和幂等。

正式 `tools/call` 结果：

| 样本 | 定位方式 | 实际结果 |
|---|---|---|
| `ArrowHammer.png` | `assets/...` 工程路径 | `cc.ImageAsset` / `image`，主资源，2 个子资源；信息、元数据、数据均 available，完整且未截断。 |
| `ArrowHammer.png/spriteFrame` | 子资源 UUID | `cc.SpriteFrame` / `sprite-frame`，正确回溯主资源 UUID；子资源元数据 UUID 与自身匹配。 |
| `IconPair.prefab` | 精确 db URL | `cc.Prefab` / `prefab`，序列化数据 available，完整且未截断。 |
| `Main.scene` | UUID | `cc.SceneAsset` / `scene`，序列化数据 available，完整且未截断。 |
| `ArrowView.ts` | 精确 db URL | `cc.Script` / `typescript`，序列化数据 available，完整且未截断。 |
| `assets/icons` | 精确 db URL | `cc.Asset` / `directory`，元数据 available，未请求数据。 |
| 图片主资源 | 极小合法上限 | 信息、元数据和子资源目录均报告 `maxItems` 截断，`truncated=true`、`complete=false`。 |
| `db://assets/Main` | 缺扩展名 db URL | 返回 `Asset not found`，没有回退到 `Main.scene`。 |
| 场景资源 | `maxDepth=0` | 在查询前拒绝，范围错误明确为 1—12。 |

正式查询前后递归读取工程 `assets` 下 3519 个文件。排序后的逐文件 SHA-256 清单合并摘要均为 `0CE65BE54843CFE7159B42D8CB5C3DC0B5B32F152BEF951AFA79F27B2C91E68E`，差异行 0。

## 当前结论

OP-064 在 Cocos Creator 3.8.8 和目标复杂工程中通过正式 MCP 入口验收。该结论只覆盖上述 importer 与只读查询：其他 Creator 版本、其他 importer、动态字符串资源引用和运行/视觉正确性仍须分别验证。资源名称/目录搜索与重名候选属于 OP-065，不由本项声明完成。
