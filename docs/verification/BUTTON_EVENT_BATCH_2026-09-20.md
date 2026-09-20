# OP-050 批量 Button 点击事件验证（2026-09-20）

## 实现范围

`batch_bind_button_click_events` 接受 1—50 条有序绑定。每条须恰有一个非空 Button 选择器和一个非空目标节点选择器，并复用 `bind_button_click_event` 的组件、方法、自定义数据、去重及预制体覆盖校验。默认 `onError: stop`，也可设为 `continue`；结果含逐项状态、错误、耗时及汇总。失败项不撤销先前成功项，批量调用不是全事务。成功后需显式保存场景。

## 自动化检查

- 单元测试覆盖成功、重复、失败与后续继续执行，遇错停止时不执行剩余条目，以及容量、策略、选择器和非字符串数据拒绝。注册表测试核对 50 条上限、参数约束和到场景方法的转发。
- `node --test test/scene-button-events.test.js test/tool-registry.test.js`：50 通过、0 失败。全量测试结果见当轮开发记录。

## Creator 3.8.8 实测

- 工程 `D:\AI\Game\arrow-puzzle`；原场景 `ComplexRefs.scene`，测试前 `scene:query-dirty=false`，磁盘 SHA-256 为 `31FA83D7B39199765FF07F0434ABEE23F654FDE78F9B593449809FDB441CACF6`。
- 通过 asset-db 创建并打开隔离场景 `Op050BatchEvents.scene`，建立两个 Button 节点和挂有已导入 `GameController` 的目标节点。当前安装的正式工具目录尚无批量入口，因此通过正式 `execute_scene_script` 动态加载工作区 `scene.js`，执行新增批量方法。
- `continue` 的四项结果依次为 `bound`、`duplicate`、`failed`、`bound`；失败项尝试绑定保留方法 `start`，汇总为 `bound:2`、`duplicates:1`、`failed:1`、`attempted:4`。`stop` 在首项目标不存在时返回 `attempted:1`、`stoppedAtIndex:0`，后续项没有执行。没有调用 `share`，只保存其事件引用。
- 显式保存后，磁盘场景包含 `clickEvents`、`op050-a`、`op050-b`，不包含被停止的测试数据。切换原场景再重开临时场景，正式 `list_button_click_events` 返回两个 Button 各一条 `GameController.share` 绑定，数据分别为 `op050-a` 和 `op050-b`。
- 最后恢复 `ComplexRefs.scene`，经 asset-db 删除临时场景和 `.meta`；两文件均不存在，原场景 SHA-256 未变化。

## 正式 MCP 入口复核

Creator 关闭后，旧扩展备份至 `E:\AIWork\CocosMcp\.local-install-backups\arrow-puzzle-cocos-mcp-kit-20260920-195041`，随后同步 102 个安装文件。重开项目后 `tools/list` 返回 118 项，包含带 50 条上限和 `stop`/`continue` 参数的正式 `batch_bind_button_click_events`。在新隔离场景 `Op050FormalEvents.scene` 中，正式批量调用的四项结果为 `bound`、`failed`、`bound`、`duplicate`，汇总 `bound:2`、`duplicates:1`、`failed:1`、`attempted:4`；默认 `stop` 在首项失败后停止，`attempted:1`、`stoppedAtIndex:0`。保存切换重开后，正式列表确认两个 Button 各保留一条 `GameController.share` 事件。临时场景和 `.meta` 已经 asset-db 清理，原场景哈希未变化。

真实鼠标点击及普通链接预制体实例覆盖由既有[单条事件验收](BUTTON_PREVIEW_PREFAB_2026-09-19.md)覆盖，本次未重复触发，也未验证触摸或嵌套预制体实例。
