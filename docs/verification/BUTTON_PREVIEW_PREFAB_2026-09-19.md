# Button 真实预览点击与预制体实例覆盖（2026-09-19）

测试工程：`D:\AI\Game\arrow-puzzle`，Cocos Creator 3.8.8，MCP `/health` 工程身份 `758048aa923da9e57466f98a`。测试资产均建在 `assets/McpKitValidation/`：独立场景 `ButtonPreviewPrefabProbe_20260919.scene`、预制体 `ButtonPreviewPrefabProbe_20260919.prefab`、脚本 `McpPreviewClickProbe.ts`。场景从 `Main.scene` 复制后只保留 Canvas 和 Camera，不运行游戏控制器。预览使用 `http://localhost:7456/?scene=<测试场景 UUID>`；先核对页面 `settings.js?scene=` 指向测试场景，再观察画面和鼠标点击结果。

| 验证 | 实际结果 |
| --- | --- |
| 基础绑定的真实输入 | 浏览器画面显示 `CLICK TO VERIFY` 与 `base=0 override=0`；鼠标点击按钮后显示 `base=1 override=0 data=base`。这次输入来自预览画面中的鼠标点击，并非 `simulateButtonClick`。 |
| 问题复现 | 在链接预制体实例中直接更改 `Button.clickEvents` 后，场景进程列出 2 条事件；保存的 `.scene` 中预制体实例 `propertyOverrides` 仍只有名称和变换，没有 `clickEvents`。直接赋值无法保证实例事件持久化。 |
| 修复后的绑定 | 从当前工作区加载 `scene.js`，调用 `bindButtonClickEvent` 后，实例增加 `clickEvents` 属性覆盖。保存的场景包含 1 条该覆盖、其中 2 个事件引用；源 `.prefab` 仍只有 1 条 `cc.ClickEvent`。切换到 `Main.scene` 再打开测试场景，列表仍为基础与实例事件各 1 条，实例保持与源预制体关联。浏览器刷新后鼠标点击显示 `base=1 override=1 data=instance`。 |
| 修复后的解绑 | 从当前工作区调用 `unbindButtonClickEvent` 移除索引 1 的实例新增事件，覆盖值变为 1 条。保存、切场景并重开后只剩基础事件；浏览器刷新并点击显示 `base=1 override=0 data=base`。源预制体始终为 1 条事件。 |
| 清理 | 关闭临时预览标签，编辑器切回 `ComplexRefs.scene`；通过 Creator asset-db 删除上述 3 个测试资产，磁盘上对应文件和 `.meta` 均不存在。 |

测试工程中安装的扩展仍是旧版本；测试通过其 `execute_scene_script` 加载本工作区当前 `scene.js`，因此上述修复验证的是当前源码，不代表旧版扩展面板已经更新。浏览器预览验证了鼠标输入；未覆盖触摸、嵌套预制体实例或其他 UI 事件组件。Creator 的[预制体文档](https://docs.cocos.com/creator/3.8/manual/zh/asset/prefab.html)说明实例属性修改应保存在实例中且不影响源资源；[消息系统文档](https://docs.cocos.com/creator/3.8/manual/zh/editor/extension/messages.html)说明扩展通过编辑器消息访问场景能力。
