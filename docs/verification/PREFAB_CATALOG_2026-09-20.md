# OP-051 预制体列表验证（2026-09-20）

## 实现范围

`list_prefabs` 继续使用 Creator asset-db 查询 `cc.Prefab`，按 URL/UUID 稳定排序，默认返回 50 项，最多 100 项，支持 `offset` 分页。返回资源名、UUID、URL、导入状态与总数/截断。可选 `includeMetadata` 时，每个返回项只查询精简 `.meta` 状态；单项查询失败在该项标记，不中断列表。可选 `includeSceneInstances` 时，由场景进程遍历可保存节点，只计有资产 UUID、`_prefab.instance` 且 `_prefab.root` 指向自身的实例根节点；最多扫描 5000 个节点、返回 200 个根节点，资源项最多附 20 个实例，并显式标记截断。Creator 的普通预制体子节点也可能保留资产 UUID，仅凭 UUID 不能判定它是独立实例。

## 自动化检查

- `test/tool-registry.test.js` 覆盖乱序资源分页、非预制体过滤、元信息成功与单项失败、当前场景关联映射，以及非法分页和选项类型拒绝。
- `test/scene-node-queries.test.js` 覆盖普通根实例、嵌套根实例、仅含 `fileId` 的子节点、不可保存节点过滤，以及节点与实例数量上限。

## Creator 验收状态

扩展同步、重开 `D:\AI\Game\arrow-puzzle` 后，正式 `tools/list` 为 118 项。正式 `list_prefabs` 在 `McpKitValidation/**` 下返回 3 个资源；`limit:2` 的第一页是 `ApplyProbe.prefab` 和 `IconPair.prefab`，两项 `.meta` UUID 与资源 UUID 一致，`offset:2` 的第二页是 `NestedPair.prefab`；`limit:0` 被拒绝。

真实 `ComplexRefs.scene` 暴露了第一版场景扫描的误计数：正式入口把 `ApplyProbe` 与 `IconPair` 的两个实例各计成 6 个，因为每个实例的两个子节点也带相同资产 UUID。现场读取 `_prefab` 确认只有实例根节点具有 `instance` 且 `root` 指向自身。修正后的工作区 `scene.js` 通过正式 `execute_scene_script` 动态加载运行，扫描 21 个节点，返回 4 个实例根：`LinkedA`、`LinkedB`、`ProbeA`、`ProbeB`，无截断。

再次关闭 Creator、备份当前安装版到 `E:\AIWork\CocosMcp\.local-install-backups\arrow-puzzle-cocos-mcp-kit-20260920-195518` 后，同步修正的 `scene.js` 及验收文档，关键文件 SHA-256 一致。项目重开后的正式 `list_prefabs` 返回 `sceneInstanceScan.scannedNodes:21`、`linkedCount:4`、`truncated:false`；`ApplyProbe.prefab` 精确关联 `ProbeA`、`ProbeB`，`IconPair.prefab` 关联 `LinkedA`、`LinkedB`，`NestedPair.prefab` 当前场景为 0 个实例。三项元信息均可用且 UUID 与资源相同。原 `ComplexRefs.scene` SHA-256 仍为 `31FA83D7B39199765FF07F0434ABEE23F654FDE78F9B593449809FDB441CACF6`。这验证了当前场景中的普通链接实例；真正的嵌套链接、超大场景截断和导入失败资产仍需另行验收。
