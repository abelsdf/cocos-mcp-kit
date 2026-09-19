# OP-045 组件列表验证（2026-09-19）

工程：`D:\AI\Game\arrow-puzzle`，Cocos Creator 3.8.8，活动场景为已保存的 `assets/McpKitValidation/ComplexRefs.scene`。先通过现有 `execute_scene_script` 只读加载工作树 `scene.js` 的 `listComponents` 方法；随后将最新版扩展安装到工程并重开 Creator，通过正式 `list_components` MCP 入口复核。测试没有修改场景，场景文件 SHA-256 保持 `31FA83D7B39199765FF07F0434ABEE23F654FDE78F9B593449809FDB441CACF6`。

以 `McpValidationRoot/HammerIcon` 为目标，运行值返回 2 个组件。`cc.UITransform` 的 `contentSize` 为 256×252，`anchorPoint` 为 (0.5, 0.5)；`cc.Sprite` 的 `color` 为 RGBA (255, 255, 255, 255)，`spriteFrame` 为 `ArrowHammer`，UUID `7222d7a1-b348-41ec-9f8a-4eea647d8774@f9941`。逐项读取磁盘 `.scene`，对应 `_contentSize`、`_anchorPoint`、`_color`、`_spriteFrame` 值一致。这证明这组已有保存数据在本次重开 Creator 后加载为预期运行值；未执行新的写入或保存。

Creator 的 `CCClass.attr` 将上述公开属性的 `serializable` 标为 false，但 `.scene` 通过带下划线的底层字段保存它们。工具因此把字段标为 `directSerialization: excluded`，并明确告知该标记不能断言属性值不会持久化。对于项目脚本，工具不会触发自定义 getter；其值报告为 `accessor-not-read`。列表有 `maxComponents`（默认 32，上限 128）及每组件 `maxProperties`（默认 12，上限 32）的限制；属性名枚举最多 80 个，超过时报告 `propertyEnumerationTruncated`。单元测试覆盖长字符串、数组、重复对象引用、节点引用、元数据、隐藏字段、无效限制、场景根与自定义 getter 不调用。

## 正式 MCP 入口复核

重开 Creator 后，`tools/list` 共 116 项，`list_components` 的描述和 schema 包含 `maxComponents`（1—128）与 `maxProperties`（1—32）。正式调用 `path: McpValidationRoot/HammerIcon, maxComponents: 4, maxProperties: 20` 返回 2 个组件、`valueSource: live-scene`；UITransform 尺寸与锚点、Sprite 颜色和 SpriteFrame UUID 均与前述动态探针及磁盘数据一致。以 UUID 定位并设置 `maxComponents: 1, maxProperties: 2` 后，结果只返回 1 个组件和 2 个属性，并分别报告组件及属性截断；`maxProperties: 0` 被拒绝，错误指出有效范围 1—32。安装目录中 `scene.js` 与 `lib/tool-registry.js` 的 SHA-256 均与工作树一致。

自定义脚本、复杂循环对象及预制体实例的运行值尚未逐类验收。直接序列化元数据依赖 Creator 3.8 的 `__props__` / `CCClass.attr` 内部机制，未来版本需重新验证。需要确认新写入是否持久化时，仍须保存并重开目标资源。
