# OP-047 组件属性赋值验证（2026-09-19）

工程：`D:\AI\Game\arrow-puzzle`，Cocos Creator 3.8.8。先通过正式 `execute_scene_script` 在运行中的 Creator 加载本项目自行编写的 `scene.js` 新方法；随后备份并同步扩展、重开 Creator，从正式 `set_component_property` MCP 入口复核。测试前备份 `assets/McpKitValidation/ComplexRefs.scene`，SHA-256 为 `31FA83D7B39199765FF07F0434ABEE23F654FDE78F9B593449809FDB441CACF6`。

新版只接受单个顶层字段。项目脚本字段必须在 CCClass `__props__` 中声明、有可编辑元数据且为可写实例字段；内置属性限于 Sprite 的 `color`、`spriteFrame`，UITransform 的 `anchorPoint`、`contentSize`，以及 Label 的 `string`、`color`。属性赋值前按现值或 CCClass `ctor` 类型转换并验证 JSON，赋值后读取实际值核对，失败时尝试恢复原值。节点/组件引用在活动场景中解析；资产引用按 UUID 加载并验证类型。关联预制体层级、点路径、未声明脚本字段和任意复杂对象均拒绝。

在原 `ComplexRefs.scene` 创建临时普通节点 `__McpSetPropertyProbe_20260919`，挂载 UITransform、Sprite 和已注册的 `GameController`。新版方法逐项成功设置：

| 类别 | 输入与结果 | 保存、切换场景并重开后的结果 |
| --- | --- | --- |
| Size / Vec2 | `contentSize={width:128,height:64}`，`anchorPoint={x:0.3,y:0.7}` | 分别为 128×64、(0.3,0.7) |
| Color | `Sprite.color="#40B4FFFF"` | RGBA (64,180,255,255) |
| 资产引用 | `Sprite.spriteFrame={assetUuid:"7222d7a1-b348-41ec-9f8a-4eea647d8774@f9941"}` | ArrowHammer SpriteFrame UUID 保持一致 |
| 脚本数值 | `GameController.startingMoves=7` | 7 |
| 节点引用 | `GameController.boardRoot={uuid:"47bi5ZDE9J7IFt4WP0x8dG"}` | 指向同一 `McpValidationRoot` 节点 |

拒绝样例：`color.r` 点路径、无效颜色 `#GGGGGG`、未声明的脚本运行时字段 `views`、将 Prefab UUID 赋给 SpriteFrame。失败后已设置的颜色与引用没有变化。单元测试还覆盖标量/向量/节点/组件/资产转换、索引消歧、关联预制体拒绝、无效形状、幂等和失败回退。

另用临时 Label 节点验证白名单 `string` 和 `color`：新版动态方法分别设为 `OP-047` 与 RGBA (12,34,56,255)，现场读取一致；该节点已删除，未参与保存重开测试。清理后，活动场景序列化内容与磁盘逐字节相同。

**调用顺序边界：** 设置 SpriteFrame 后，Creator 将同节点 UITransform 尺寸从先前设置的 128×64 改为图片尺寸 256×252；在 SpriteFrame 赋值之后再次设置 `contentSize` 才得到持久的 128×64。工具仅保证本次目标字段赋值后的读取一致，不保证其他组件字段不受 Cocos setter 连带影响。

测试时通过正式 `save_current_scene` 保存，切至 `Main.scene` 再重开 `ComplexRefs.scene`，逐项读取上述值。随后按 UUID 删除临时节点并再次保存；最终场景 SHA-256 与备份完全一致，原场景已恢复。

重开并同步扩展后，`tools/list` 中 `set_component_property` 已显示新版描述、非负整数索引和长度上限 4096 的 `valueJson`。正式 MCP 入口在另一个临时普通节点上再次成功设置 SpriteFrame、Color、Size、Vec2、`GameController.startingMoves` 和 `boardRoot`，返回的类型和值均正确；上述 4 个无效输入及关联预制体实例写入被拒绝。正式探针删除后，活动场景序列化内容与磁盘逐字节相同。源码与安装目录的 `scene.js`、工具注册表及面板描述文件哈希一致。

此测试不覆盖关联预制体覆盖写入、任意脚本对象/数组、其他 Cocos 内置组件，也不代表游戏预览逻辑验收。
