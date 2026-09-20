# OP-049 Button 点击事件校验（2026-09-20）

目标：收紧 `bind_button_click_event` 的目标组件、方法和自定义数据校验，同时保留 Creator 3.8.8 的 EventHandler 保存格式。

## 代码与测试

- 组件类名、方法名限制为有效的短名称；`customEventData` 仅接受最长 1024 字符的原样字符串，`replace` 仅接受布尔值，不再将对象隐式转成 `[object Object]`。
- 目标节点上的同类组件必须恰好一个。方法须由目标组件或其自定义父类显式提供；不读取 getter，也不接受 Cocos Component 基类方法与生命周期方法。
- `test/scene-button-events.test.js` 覆盖有效绑定、重复绑定、序列化组件 ID、实例覆盖，以及引擎继承方法、生命周期方法、访问器、同类多实例和错误数据类型的拒绝。全量 `node --test` 为 342 通过、0 失败。

## Creator 3.8.8 实测

- 工程：`D:\AI\Game\arrow-puzzle`。原场景为 `ComplexRefs.scene`，测试前 `scene:query-dirty=false`，磁盘 SHA-256 为 `31FA83D7B39199765FF07F0434ABEE23F654FDE78F9B593449809FDB441CACF6`。
- 经 asset-db 创建隔离场景 `Op049EventGuard.scene`，创建 Button 节点与目标节点，并在目标节点挂载已导入的 `GameController` 脚本。通过正式 `execute_scene_script` 动态加载当前工作区的 `scene.js`，调用新版绑定方法。
- `start`（生命周期）、`destroy`（引擎继承）和对象型 `customEventData` 均在修改前被拒绝。`share` 方法与字符串数据 `op049` 成功绑定；再次提交相同绑定返回 `duplicate:true`，事件总数仍为 1。此轮没有触发 `share`，避免打开外部分享行为。
- 显式保存后，场景磁盘文件包含 `clickEvents`、`handler:share`、`customEventData:op049`；切至原场景再重开临时场景，正式 `list_button_click_events` 仍返回目标 UUID、组件名、方法与数据，事件数为 1。
- 最后切回 `ComplexRefs.scene` 并由 asset-db 删除临时场景及 `.meta`，两文件均不存在；原场景 SHA-256 未变化。

## 最新扩展的正式 MCP 入口复核

- 在 Creator 关闭后，先将旧扩展备份至 `E:\AIWork\CocosMcp\.local-install-backups\arrow-puzzle-cocos-mcp-kit-20260920-193121`，再同步当前工作区的 100 个文件。`scene.js`、`lib/tools/scene-events.js`、`panel/tool-description-i18n.js` 的源与安装目标 SHA-256 一致。用户重开项目后，正式 `tools/list` 返回 117 项，`bind_button_click_event` 的新描述、字符串长度限制与布尔 `replace` 参数均已暴露。
- 在新的隔离场景 `Op049FormalGuard.scene` 中，通过正式工具创建 Button 节点与挂有 `GameController` 的接收节点。正式 `bind_button_click_event` 拒绝 `start`、`destroy`、对象和 `null` 型 `customEventData`、字符串型 `replace`；失败后事件数为 0。绑定 `share` 与字面字符串 `op049-formal` 成功，重复绑定返回 `duplicate:true`，事件数保持 1。没有触发 `share` 方法。
- `save_current_scene` 后，磁盘场景包含 `clickEvents`、`share` 与 `op049-formal`。切换到原场景再打开临时场景，待编辑器完成加载后正式 `list_button_click_events` 返回目标 UUID、`GameController`、`share` 与原样自定义数据，事件数仍为 1。
- 最后恢复 `ComplexRefs.scene` 并由 asset-db 删除临时场景及 `.meta`。两文件均不存在，原场景 SHA-256 仍为 `31FA83D7B39199765FF07F0434ABEE23F654FDE78F9B593449809FDB441CACF6`。

已有[基础绑定与解绑验证](BUTTON_EVENT_UNBIND_2026-09-19.md)和[真实预览及预制体实例覆盖验证](BUTTON_PREVIEW_PREFAB_2026-09-19.md)证明先前事件格式的保存、鼠标点击和实例覆盖。本轮正式入口验证了新增校验与持久化；触摸和嵌套预制体实例仍未覆盖。
