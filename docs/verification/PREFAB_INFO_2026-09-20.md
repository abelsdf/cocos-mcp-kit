# OP-052 预制体详情验证（2026-09-20）

## 实现范围

`inspect_prefab` 保留已有的 `info`、`meta`、`filePath`、`referenceCount` 和 `references` 字段，并增加：

- `metadata`：元信息可用状态、UUID、导入器及与资产 UUID 是否一致。
- `serializedSource` 与 `structure`：区分磁盘、asset-db 和不可用数据；有界汇总根节点、节点数、组件类型/数量、PrefabInfo 数量及其中的预制体 UUID。序列化信息只是静态描述，不证明嵌套实例链接仍有效。
- `totalReferenceCount`、`referencesTruncated`：明确现有最多 500 条引用列表是否覆盖全部发现项。`validate_prefab_references` 的完整性策略属于后续 OP-053。
- 可选 `includeSceneInstances` / `maxSceneInstances`：复用有界场景扫描，只返回匹配本预制体 UUID 的实例根节点，并标记扫描或返回列表截断。

## 代码与 Creator 3.8.8 检查

- 单元测试覆盖根节点/组件摘要、元信息 UUID、一项元信息读取失败、500 条引用上限、非预制体资源拒绝，以及场景实例关联与返回数量限制。
- 在运行中的 `D:\AI\Game\arrow-puzzle` Creator 中，通过正式 `execute_editor_script` 动态加载工作区 `lib/prefabs.js`。`IconPair.prefab`（UUID `e6d4758d-3330-4f17-8fdb-58b4b180cb93`）的元信息 UUID 匹配；磁盘序列化显示根节点 `IconPair` 有 2 个直接子节点，共 3 个节点、4 个组件（Sprite 2、UITransform 2）、2 条 UUID 类引用。首次动态读取发现 Creator 使用 `node.__id__` 保存组件节点引用，修正后再次读取与磁盘内容一致。
- `NestedPair.prefab` 读取为 9 个序列化节点；既有记录已说明它是扁平化历史样本，不能作为嵌套链接保持的证据。读取过程未修改项目资源。

新版扩展已在关闭 Creator 后同步到 `D:\AI\Game\arrow-puzzle\extensions\cocos-mcp-kit`，关键文件哈希一致，并保留了旧版备份。重开 Creator 后，正式 MCP `tools/list` 返回 118 项工具，`inspect_prefab` schema 包含两个新的可选参数。

正式 `inspect_prefab` 调用 `IconPair.prefab` 且设置 `includeSceneInstances: true`、`maxSceneInstances: 1` 后，返回元信息 UUID 匹配、3 个节点、4 个组件（Sprite 2、UITransform 2）、2 条资源引用且未截断；当前 `ComplexRefs` 场景扫描 21 个节点，发现 4 个关联实例根，其中匹配 `IconPair` 的 2 个，返回 1 个并标记 `sceneInstancesTruncated: true`，场景扫描自身未截断。默认调用不进行场景扫描；`maxSceneInstances: 0` 被拒绝。正式入口读取 `NestedPair.prefab` 返回 9 个节点和 12 个组件，但仍不能据此推断嵌套链接有效。测试前后 `ComplexRefs.scene` 的 SHA-256 均为 `31FA83D7B39199765FF07F0434ABEE23F654FDE78F9B593449809FDB441CACF6`。
