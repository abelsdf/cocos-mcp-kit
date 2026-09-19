# OP-044 组件移除验证（2026-09-19）

工程：`D:\AI\Game\arrow-puzzle`，Cocos Creator 3.8.8，服务 `http://127.0.0.1:21482/`。首次在隔离场景 `__McpRemoveComponentProbe_20260919.scene` 验证：当时运行中的扩展还未同步此项源码，因此通过 `execute_scene_script` 加载工作树 `scene.js` 的 `removeComponent` 方法。同步扩展并重开工程后，又通过正式 `remove_component` MCP 入口复核。

`RemoveProbe` 节点先添加 `cc.Sprite`，Creator 自动补齐 `cc.UITransform`。尝试直接移除 UITransform，入口返回“被 cc.Sprite 依赖”，两个组件均保留。用 `componentName: cc.UITransform` 搭配 Sprite 的索引 1，被拒绝为选择条件不一致。随后按索引 1 移除 Sprite，再按名称移除 UITransform；两次都等待 Creator 实际从节点组件列表移除后返回，节点最终无组件。

另一个节点 `RemoveProbePartial` 同样先添加 Sprite，再只移除 Sprite，保留 UITransform。保存场景、切到 `ComplexRefs.scene` 并重新打开探针后，内存中两个节点分别为“无组件”和“只有 UITransform”；磁盘 `.scene` 中组件引用数分别为 0 和 1，只有 `cc.UITransform` 类型。测试后切回原场景，经 asset-db 删除探针场景及 `.meta`，原 `ComplexRefs.scene` 文件哈希未变化。

本地测试还覆盖无选择条件、无效索引、同类多实例歧义、双条件不一致、场景根、失效节点、关联预制体、同节点组件属性直接引用、延迟移除和引擎无操作后不误报成功。依赖预检读取 Creator 3.8 的 `_requireComponent` 元数据；这是引擎内部字段，未来版本若改变，最终仍通过移除后组件列表核对阻止虚假成功。跨场景与预制体资源引用尚未扫描，未在实际 Creator 工程逐类验证复杂依赖链和多实例组件。

## 正式 MCP 入口复核

重开后 `tools/list` 为 116 项，包含新版 `remove_component` 描述和非负整数索引 schema；安装目录的 `scene.js` 与 `lib/tool-registry.js` 哈希均与工作树相同。在第二个隔离场景 `__McpRemoveEntryProbe_20260919.scene` 中，正式工具对 `RemoveEntryA` 先拒绝移除仍被 Sprite 依赖的 UITransform，再拒绝类名和索引不匹配；随后按索引移除 Sprite、按名称移除 UITransform，返回实际移除结果。`RemoveEntryPartial` 只移除 Sprite，保留 UITransform。

另在场景中创建带 Button 的节点，令其点击事件指向 `RemoveEntryPartial` 的 Sprite。正式 `remove_component` 返回 `ReferenceButtonNode:Button.clickEvents[0]` 引用位置并拒绝移除；清空事件后才成功。保存前删除测试用 Button 节点。保存、切换到 `ComplexRefs.scene`、重开探针后，内存与磁盘分别显示 `RemoveEntryA` 无组件、`RemoveEntryPartial` 仅有 UITransform，且 Button 节点没有遗留。最后经 asset-db 删除探针和 `.meta`；原 `ComplexRefs.scene` 哈希仍为 `31FA83D7B39199765FF07F0434ABEE23F654FDE78F9B593449809FDB441CACF6`。
