# 复杂工程脚本与预制体实例组件详情逐类验收（2026-09-19）

测试工程：`D:\AI\Game\arrow-puzzle`，Cocos Creator 3.8.8。仅检查已保存的 `Main.scene`、`McpKitValidation/ComplexRefs.scene` 和现有预制体；用于补齐类别的节点在编辑器内临时创建，随后删除。每次切换场景前使用 `serializeScene` 与磁盘内容逐字节比较，均相同。结束时恢复原活动场景 `ComplexRefs.scene`。测试前后场景 SHA-256 分别保持：`Main.scene` 为 `046487A78FFAE4DEBF08D2DE2B6A6DD29AE0B0FA076567B9335E396270B60DA8`，`ComplexRefs.scene` 为 `31FA83D7B39199765FF07F0434ABEE23F654FDE78F9B593449809FDB441CACF6`。

本轮先用已安装扩展的正式 `inspect_component` 读取现状；发现它将项目脚本的运行时私有字段一并列为“公开属性”。修正源码后，先通过正式 `execute_scene_script` 在真实 Creator 场景进程中加载新方法检查，再备份、同步扩展并重开 Creator，从正式 `inspect_component` 和 `list_components` 入口复核。工具目录包含布尔型 `includeRuntimeFields` 参数。重开后两个预制体类别的 Sprite 值仍与原资源一致。

| 类别 | 测试对象与入口 | 现场结果 | 结论 |
| --- | --- | --- | --- |
| `GameController` 项目脚本 | `Main.scene/Canvas/GameController`，组件索引 1 | 旧正式入口列出 41 项，包括 `board`、`views`、`state` 等运行时状态；新版正式 `inspect_component` 默认只列 4 个 CCClass 声明字段：`boardRoot` 指向 `BoardRoot`，`levelLabel`/`movesLabel` 为 `null`，`startingMoves` 为 3。`includeRuntimeFields: true` 才报告 41 项，`board` 标记为 `runtime-own`，共 37 个未声明实例字段。正式 `list_components` 默认也列 4 项。磁盘序列化与声明字段对应。 | 新版正式双入口通过。 |
| `ArrowView` 项目脚本 | `Main.scene` 临时普通节点上挂载已注册组件；另在 `ComplexRefs.scene` 临时节点调用 `setup(42, {Dx:1,Dy:0,X:0,Y:0,Indices:[0,1]}, 80, 2, 2)` | 此类没有 CCClass 声明字段。旧正式入口列出 12 个实例字段；新版正式 `inspect_component` 默认返回 0 项并报告 `runtimeFieldCount: 12`，显式启用后返回 12 项，可见 `id`、`data`、`cellSize`、`visual` 等并标记 `runtime-own`；未赋值字段保留 `{kind:'undefined'}`。动态场景探针调用 `setup` 无异常，产生 3 个组件，`id=42`、`cellSize=80`、`visual` 为 Graphics 组件引用，`data` 为有界对象摘要。 | 新版正式字段筛选通过；`setup` 仅在编辑器场景进程验证，不代表游戏预览运行路径已验证。临时节点已删除。 |
| `cc.UITransform` | `IconPair`、`ApplyProbe`、临时 `NestedPair` 实例的子节点 | 正式入口返回 4 项属性，HammerIcon 尺寸为 256×252；引用与磁盘资源一致。 | 通过正式入口。 |
| `cc.Sprite` | 上述实例的 HammerIcon 与 HintIcon | 正式入口返回 14 项属性。`IconPair` 的 HammerIcon 为白色，`ApplyProbe` 的 HammerIcon 为 RGBA (64,180,255,255)；Hammer SpriteFrame UUID 为 `7222d7a1-b348-41ec-9f8a-4eea647d8774@f9941`，Hint 为 `1b3c2630-2ff7-4455-a872-072e320c0d8c@f9941`，与保存资源匹配。 | 通过正式入口；颜色与资源引用可区分两个预制体类别。 |
| `cc.Canvas`、`cc.Widget`、`cc.Camera` | 临时 `NestedPair` 场景实例 | 正式入口分别返回 4、29、21 项；Canvas 的 `cameraComponent` 为组件引用。各项在 `maxProperties: 80` 范围内，未截断；无旧版原始内部 `data`。 | 通过正式入口的只读组件详情。 |

关联实例分类：`IconPair.prefab`（UUID `e6d4758d-3330-4f17-8fdb-58b4b180cb93`）的 `LinkedA`/`LinkedB`，以及 `ApplyProbe.prefab`（UUID `b15dfaad-43ca-46c3-bb9f-7941a4c1b6cc`）的 `ProbeA`/`ProbeB` 均由正式 `inspect_prefab_instance` 确认保持链接；根节点名称、变换覆盖与子节点组件值均能区分。`NestedPair.prefab`（UUID `3d858e2d-edac-43a4-8119-54e335283256`）是已有的**扁平化历史测试样本**：内层 `LinkedA`/`LinkedB` 在检查结果中同样指向 `NestedPair` UUID，不能作为嵌套 `IconPair` 链接保持的验收证据，也不建议用于生产嵌套预制体场景。参见[复杂资源与预制体验收](ARROW_COMPLEX_ASSET_PREFAB_2026-09-19.md)。

本次是读取已持久化场景及预制体实例的详情，**没有新写入的保存/重开验收**。当前看到的运行值与磁盘引用一致，并不证明任意组件修改都会持久化；创建或改动复杂引用时仍需保存、重开并逐项比对。正式入口验收结束后，`Main.scene` 临时节点不存在，场景序列化内容与磁盘逐字节相同；已恢复原活动场景 `ComplexRefs.scene`，其序列化内容也与磁盘逐字节相同。
