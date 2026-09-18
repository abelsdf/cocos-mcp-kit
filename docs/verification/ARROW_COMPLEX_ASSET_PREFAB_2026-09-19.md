# Creator 3.8.8 复杂资源引用与预制体验收（2026-09-19）

## 范围与环境

- 测试工程：`D:\AI\Game\arrow-puzzle`；`package.json` 名称为 `arrow-puzzle-cocos`。原先误报的 `D:\AI\Game\arrow-puzzle-cocos` 路径不存在。
- Creator 3.8.8；从当前工作树安装 `extensions/cocos-mcp-kit`；`cocos-mcp-kit.config.json` 设置 `toolProfile: full`、按工程路径选择端口。
- `/health`：`Cocos MCP Kit - arrow-puzzle`，工程身份 `758048aa923da9e57466f98a`，端口 `127.0.0.1:21482`。编辑器日志证实扩展加载和服务监听。重启时曾存在重复的隐藏编辑器进程；清除目标工程旧监听器后，修复版才真正生效。
- 所有新资产均在 `assets/McpKitValidation/`，未改游戏的 `assets/Main.scene` 或现有图片。测试工程原有未提交的脚本改动和其他扩展状态未处理；本轮没有提交或推送测试工程。

## 资产与持久化证据

| 检查 | 运行时与磁盘证据 | 结论 |
| --- | --- | --- |
| 图片子资源 | 将工程现有 `hammer-button-v2.png`、`hint-button-v2.png` 复制成 `ArrowHammer.png`、`ArrowHint.png`，给测试副本指定 `sprite-frame` 导入类型并刷新 `asset-db`。两张图片分别产生 `ImageAsset` 主 UUID、`Texture2D` `@6c48a` 和 `SpriteFrame` `@f9941`；`.meta` 均为 imported。 | 通过 |
| Sprite 赋值 | `create_sprite` 在 `ComplexRefs.scene` 的 `McpValidationRoot` 下创建 `HammerIcon`、`HintIcon`。场景对象检查显示各自 `cc.Sprite.spriteFrame.uuid` 与对应的 `@f9941` 一致，texture UUID 与 `@6c48a` 一致。 | 通过 |
| 普通预制体 | `create_prefab_from_node` 通过 `asset-db:create-asset` 创建 `IconPair.prefab`，UUID `e6d4758d-3330-4f17-8fdb-58b4b180cb93`；`.prefab` 和 `.meta` 均存在且已导入。文件有两条 SpriteFrame 引用；`validate_prefab_references` 缺失数 0。 | 通过 |
| 两个链接实例 | `create_prefab_instance` 创建 LinkedA/B，`inspect_prefab_instance` 显示相同预制体 asset UUID、不同 instance ID。位置分别设为 -140/140；保存场景、切换到 Main、重新打开后，链接、坐标与每个子节点的 SpriteFrame 均恢复。重开时运行态节点 UUID 会重新生成，不能将它作为跨次打开的稳定标识。 | 通过 |
| revert | 只将 LinkedA 的 HammerIcon 染红，保存重开后 B 与源预制体仍为白色。`revert_prefab_instance` 使用 Creator `restore-prefab`，A 恢复白色，名称、位置 -140 和链接保留；再次保存重开仍成立。 | 通过 |
| apply | 独立 `ApplyProbe.prefab`（UUID `b15dfaad-43ca-46c3-bb9f-7941a4c1b6cc`）和 ProbeA/B。只将 ProbeA 的 HammerIcon 染蓝后执行 `apply_prefab_instance`，预制体文件实际改变并包含蓝色，ProbeB 随即显示蓝色；保存重开后两者仍链接且同色。原生消息的原始 `result` 是 `false`，但文件与实例回查证明本次写入有效；不能只根据工具的 `applied: true` 判定。 | 通过（以回查为准） |
| 依赖检查 | 修复后 `inspect_asset_dependencies` 对 `IconPair.prefab` 得到 2 条真实子资源引用、缺失 0；对测试场景和 `NestedPair.prefab` 也为缺失 0。`validate_prefab_references` 扫描 3 个测试预制体，缺失 0。 | 通过（仅引用有效性） |
| 错误输入 | 修复前，无效 `spriteFrameUuid` 报错但留下半创建节点，已清理。修复后重试不存在的 UUID、误传 ImageAsset 主 UUID，均报错且未生成节点。 | 通过 |

图片主 UUID 为 `7222d7a1-b348-41ec-9f8a-4eea647d8774` 与 `1b3c2630-2ff7-4455-a872-072e320c0d8c`，对应 SpriteFrame UUID 分别追加 `@f9941`。场景 UUID 为 `efc91ab5-d6db-438e-8b11-7c39463a6b87`。Creator 的[精灵帧文档](https://docs.cocos.com/creator/3.8/manual/zh/asset/sprite-frame.html)也区分 ImageAsset、Texture2D 和 SpriteFrame 子资源。

## 未通过、边界与修复

- 原始 `create_prefab_from_node(InstanceHolder)` 创建 `NestedPair.prefab`（UUID `3d858e2d-edac-43a4-8119-54e335283256`）时，预制体包含两个实例展开后的节点和四条 SpriteFrame 引用，却**没有**内层 `IconPair.prefab` UUID。它不是保持嵌套链接的预制体；引用检查的 0 缺失不能证明嵌套结构正确。现已在序列化前检测链接子实例，新请求明确报错 `nested linked prefab instances would be flattened`，并确认没有生成 `RejectedNested.prefab`。旧 `NestedPair.prefab` 只留作失败样本，不用于生产。
- `create_prefab_instance` 在父节点 `InstanceHolder`、`ApplyProbeHolder` 下由 Creator 原生消息自动插入 `Canvas`（含 Camera），实际路径是 `InstanceHolder/Canvas/LinkedA` 等。调用方需以返回的真实路径为准；精确父节点语义与其他 Canvas 配置尚待另测。
- 浏览器预览实际展示的是项目 `profiles/v2/packages/preview.json` 中固定的 `Main.scene`，并非测试场景。没有测试场景的视觉截图，不声称运行画面已验收。Creator [预览文档](https://docs.cocos.com/creator/3.8/manual/zh/editor/preview/index.html)说明工具栏可选择预览场景。
- `lib/scenes.js`、`lib/prefabs.js` 的既有文件直写回退及覆盖已有预制体路径未在本轮故障注入；脚本事件、按钮、构建器、跨版本和完整 FR-05 仍待验证。

本轮修复 `scene.js` 的 SpriteFrame 加载和类型检查顺序，避免失败后的半节点；`lib/tools/assets-advanced.js` 在合法 JSON 中只识别明确的资源引用字段，避免把 Cocos 节点 ID 和普通字段当资源 UUID；`lib/prefab-metadata.js` 为不支持的嵌套链接增加前置拒绝。相关测试 31/31 通过，变更文件 `node --check` 与 `git diff --check` 通过。本机 `npm` 启动脚本缺失 `npm-cli.js`，故未用 `npm run check`；本轮未重跑全量测试。所有结论限定于本工程的 Creator 3.8.8 和上述路径。
