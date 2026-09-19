# OP-046 组件详情验证（2026-09-19）

工程：`D:\AI\Game\arrow-puzzle`，Cocos Creator 3.8.8，活动场景为已保存的 `assets/McpKitValidation/ComplexRefs.scene`。先通过现有 `execute_scene_script` 只读加载工作树 `scene.js` 的新版 `inspectComponent` 方法；随后同步扩展并重开 Creator，通过正式 `inspect_component` MCP 入口复核。本项没有修改场景，文件 SHA-256 保持 `31FA83D7B39199765FF07F0434ABEE23F654FDE78F9B593449809FDB441CACF6`；使用 OP-045 已对照磁盘的同一组组件与资源引用。

旧正式入口对 `HammerIcon` 的 Sprite 返回内部 `data`，包含 `_renderData`、`_materials`、`_spriteFrame` 等大量内部字段，整体结果约 34 KB。新版动态方法用 `componentName: cc.Sprite` 和 `index: 1` 精确选中组件，返回 `valueSource: live-scene`、14 个公开属性、有界的运行值以及直接序列化标记；结果 JSON 约 1.9 KB，不包含原始 `data`。其中颜色为 RGBA (255, 255, 255, 255)，SpriteFrame UUID 为 `7222d7a1-b348-41ec-9f8a-4eea647d8774@f9941`，与 OP-045 正式列表和磁盘场景引用一致。`maxProperties: 2` 只返回 2 项并标记截断；将 Sprite 类名与索引 0 的 UITransform 同时提供时被拒绝。

本地单元测试覆盖同类多实例歧义、双条件错配、无选择条件、负数/小数/越界索引、场景根、无效属性上限和项目自定义 getter 不执行。工具 schema 将 `index` 约束为非负整数，`maxProperties` 为 1—80；默认最多返回 32 项。详情使用 OP-045 的属性摘要构造函数，保证两种入口的字段口径一致。

共享属性摘要函数重构后，重新读取 OP-045 的 `listComponents` 动态方法；UITransform 与 Sprite 仍分别列出 4、14 个属性，SpriteFrame UUID 未变化。

## 正式 MCP 入口复核

重开 Creator 后，`tools/list` 共 116 项，`inspect_component` 描述及 schema 均为新版；`index` 是非负整数，`maxProperties` 为 1—80。正式调用 `path: McpValidationRoot/HammerIcon, componentName: cc.Sprite, index: 1, maxProperties: 32` 返回 `valueSource: live-scene`、14 项属性、RGBA (255, 255, 255, 255) 以及 SpriteFrame UUID `7222d7a1-b348-41ec-9f8a-4eea647d8774@f9941`，不含旧版内部原始 `data`。仅用类名可选中 Sprite，仅用索引 0 可选中 UITransform；`maxProperties: 2` 返回 2 项并标记截断。类名与索引错配、缺少两种选择条件、`maxProperties: 0` 及负数索引均被明确拒绝。安装目录的 `scene.js` 和 `lib/tool-registry.js` SHA-256 与工作树一致，测试后的场景哈希仍与测试前相同。

复杂项目脚本与预制体实例已按类别现场检查，发现并修正未声明的运行时私有字段默认暴露问题；重开 Creator 后，两个项目脚本的默认及显式字段筛选均通过新版正式入口复核，详见[复杂工程组件逐类验收](COMPONENT_COMPLEX_CLASS_ACCEPTANCE_2026-09-19.md)。直接序列化标记不能单独证明持久化；新写入仍需保存、重开并核对磁盘。
