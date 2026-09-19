# Button 点击事件解绑与重开验收（2026-09-19）

测试工程为 `D:\AI\Game\arrow-puzzle`，Creator 3.8.8；`/health` 工程身份 `758048aa923da9e57466f98a`。测试使用 `assets/McpKitValidation/` 下的独立场景 `ButtonEventProbe_20260919.scene`（UUID `cfa8941e-f946-448b-8ec8-fdcfe05ad2dd`）和临时 `McpKitEventProbe.ts`（UUID `5b678e39-e37d-4fe9-911a-f4afb0fa8822`）。脚本导入状态为 `cc.Script`、`imported:true`、`invalid:false`，场景进程可按注册类名取得组件。未修改游戏主场景。Cocos 3.8 的 [Button API](https://docs.cocos.com/creator/3.8/api/en/class/Button) 与 [EventHandler API](https://docs.cocos.com/creator/3.8/api/en/class/EventHandler) 是事件字段与触发方式的公开依据。

运行中的测试扩展尚未重新安装本轮代码。本轮通过其 `execute_editor_script` 在编辑器/场景进程加载本仓库当前 `scene.js` 和 `lib/tool-registry.js`，因此验证当前源码及 Creator 的实际保存重开行为，不代表旧版扩展面板已暴露新工具。

| 步骤 | 实际结果 |
| --- | --- |
| 绑定与触发 | `ButtonProbe` 的 `clickEvents` 绑定到 `EventReceiver/McpKitEventProbe.onClick`，数据 `event-ok`；重复绑定返回 `duplicate:true`，事件数仍为 1。模拟点击后脚本 `clicks=1`、`lastData=event-ok`。 |
| 保存重开 | 显式保存并切到 `Main.scene` 后重新打开测试场景；仍有 1 条绑定，模拟点击再次调用脚本，数据仍为 `event-ok`。 |
| 序列化兼容 | 重开后事件的公开 `component` 字段为空，但磁盘和运行对象有 `_componentId`；通过 Creator `cc.js.getClassById` 得到 `McpKitEventProbe`。修复后列表返回正确组件名，重复绑定仍检测为重复。该兼容路径仅在本次 Creator 3.8.8 验证。 |
| 安全解绑 | 将列表的 `customEventData` 改为过期值后尝试解绑，工具报“eventIndex has changed”，绑定仍为 1 条。传入原列表的索引和完整签名后，返回 `unbound:true`，事件数为 0。 |
| 解绑重开 | 再次保存、切场景并重开，运行列表和磁盘 Button 的 `clickEvents` 都为空；模拟点击前后脚本 `clicks` 均为 0。 |
| 清理 | 切回 `ComplexRefs.scene`，通过 `asset-db:delete-asset` 删除测试场景和脚本；两者及 `.meta` 均不存在，asset-db 查询为空。 |

本轮的“点击”来自场景进程的 `simulateButtonClick`，证明事件绑定调用目标方法；尚未验证预览窗口中的真实鼠标/触摸输入、预制体覆盖或其他 UI 事件类型。

后续已完成真实浏览器鼠标点击和普通链接预制体实例覆盖的验证，并修复实例事件保存丢失问题，见[后续验收](./BUTTON_PREVIEW_PREFAB_2026-09-19.md)。触摸和嵌套预制体实例仍未验证。
