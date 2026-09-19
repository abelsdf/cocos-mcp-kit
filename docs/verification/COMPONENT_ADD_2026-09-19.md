# OP-043 组件添加验证（2026-09-19）

工程：`D:\AI\Game\arrow-puzzle`，Cocos Creator 3.8.8，服务 `http://127.0.0.1:21482/`。首次创建隔离场景 `__McpAddComponentProbe_20260919.scene` 和普通节点 `ComponentProbe`，通过 `execute_scene_script` 在场景进程加载工作树 `scene.js` 的 `addComponent` 方法。同步扩展并重开工程后，又通过正式 `add_component` MCP 入口复核。

向探针节点添加 `cc.Sprite` 返回 `added:true`、目标节点 UUID、Sprite 索引 1，以及本次新增列表：索引 0 的 `cc.UITransform`（依赖）和索引 1 的 `cc.Sprite`（请求组件）。随后再添加 `cc.UITransform`，Creator 报告节点已有同类组件；用 `cc.Node` 作为组件类型被入口拒绝。两次失败后节点仍只有 UITransform 和 Sprite。

保存场景、切到 `ComplexRefs.scene`、重新打开探针后，场景内存仍有 UITransform 与 Sprite，磁盘 `.scene` JSON 也含 `cc.UITransform` 和 `cc.Sprite`。最后切回原场景，通过 asset-db 删除探针；文件及 `.meta` 均不存在。

本地故障注入覆盖缺失类名、未注册类、非 Component 类、场景根、失效节点、关联预制体实例、重复添加，以及组件构造失败后只清理本次自动添加的依赖、不移除原有组件。尚未在实际项目验证复杂依赖链、可重复组件类或 Creator 返回后发生延迟失败的情况。

## 正式 MCP 入口复核

重开后 `tools/list` 为 116 项，包含新版 `add_component`。在第二个隔离场景 `__McpInstalledToolsProbe_20260919.scene` 的 `InstallProbeA` 上正式调用：添加 `cc.Sprite` 返回 `added:true`，新增列表为索引 0 的 `cc.UITransform` 和索引 1 的 `cc.Sprite`；再次添加 UITransform 返回重复组件错误，传入 `cc.Node` 返回非 Component 类型错误。保存场景、切换到 `ComplexRefs.scene` 并重开后，内存和磁盘均保留两组件。探针场景与 `.meta` 已通过 asset-db 删除；原 `ComplexRefs.scene` 文件哈希未变化。
