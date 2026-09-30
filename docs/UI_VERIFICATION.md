# UI 结构检查与截图流程（FR-11）

`verify_ui` 属于 full 配置，复用 [FR-10 结构检查](UI_VALIDATION.md) 和既有截图入口：等待一段有界时间，读取结构，按需返回 PNG。默认不截图，不自动修改、保存、启动/停止预览、切换标签页或触发输入。截图会在工程 `temp/mcp-captures` 新增文件，因此工具不是只读/幂等操作；结构检查本身不写入作者数据。

## 使用顺序

1. 显式完成目标修改。在 Creator 的 **Scene / general 编辑模式** 调用 `verify_ui`，检查 `structure`；需要画面时指定 `screenshot: "scene"`。
2. 涉及资产持久化时，另行显式保存、重新打开并核对引用。本工具不替代保存验证。
3. 如需运行画面，由用户/客户端另行启动 Game View，调用 `capture_preview_screenshot`，或使用 `verify_ui` 的 `screenshot: "game"`。
4. 将 MCP 图片交给具备视觉能力的客户端/人工检查。分别记录结构结论、截图来源与视觉发现；图片返回成功不是视觉通过。

```json
{
  "sceneUuid": "<明确的当前场景 UUID>",
  "nodeUuids": ["<面板 UUID>", "<按钮 UUID>"],
  "waitMs": 300,
  "screenshot": "scene"
}
```

`sceneUuid`、`nodeUuids`、`exclude`、`maxFindings` 与 `validate_ui` 相同；只检查请求节点，不递归验证后代。附加参数：

| 参数 | 首版范围 |
| --- | --- |
| `waitMs` | 整数 0—2000，默认 300；仅延迟，不是引擎帧、资源导入或渲染完成信号 |
| `screenshot` | `none`（默认）、`scene`、`game`；不截图时没有图片/文件写入 |
| `windowId` | 可选正整数，使用 `list_editor_windows` 返回的 Electron ID，不是操作系统窗口句柄 |
| `titleContains` | 可选 1—256 字符的严格窗口标题过滤；无匹配就报错，不回退到别的窗口 |

只有请求截图时才能指定窗口筛选。未知字段和参数越界直接报错。

### 编辑态与预览态必须分开

Creator 3.8.8 启动 Game View 后原生 `query-scene-mode` 为 `preview`。FR-10 仍只接受 `general`；本功能**不放宽这一保护**。

- general：运行真实 `validate_ui`；Scene 截图要求可见编辑视图。请求尚未运行的 Game View 会返回截图错误，并保留已获得的结构报告。
- preview：仅允许显式 `screenshot: "game"`。返回图片，但 `structure` 为 `status: "not_checked"`、`reason: "preview_mode"`、`complete: false`、`passed: false`。提示停止 Game View 后独立检查编辑态；不会拼接缓存的“通过”结果。
- prefab、多场景、身份不匹配、未就绪状态拒绝调用。预览状态不证明运行中的场景等于当前编辑内容，也不证明未保存修改已进入运行画面。

## 严格截图入口

`capture_editor_screenshot`、`capture_scene_screenshot`、`capture_game_screenshot`、`capture_preview_screenshot` 现在返回 **MCP 图片 + 来源元数据**。原始 `dataUri` 不写入结构 JSON 或交互日志。独立 `capture_desktop_screenshot` 不属于本次 FR-11 路线，未改变其实现。

窗口仅从当前 Creator 进程中选择可见、未最小化、唯一的 main.html 主窗口；不按聚焦窗口回退。`windowId` 与标题过滤必须同时满足。`windowKind` 只接受 `editor` 或历史别名 `focused`（仍不依赖聚焦）。外部浏览器、独立 Simulator 和未知浮动面板不在首版支持范围；传入 `preview` / `simulator` 明确报错。`capture_preview_screenshot` 默认指内嵌 Game View。

Scene 与 Game View 在 Creator 3.8.8 共用 `panel-frame[name="scene"]`；适配器同时核对内部 webview 的 `preload.js` / `preview.js` 来源。未知布局、隐藏标签、多个候选、来源不匹配均拒绝，绝不按文本包含或任意 canvas 猜测。Game View 另核对运行、非忙碌、工具栏同步状态，前后变化则丢弃结果。

裁剪取可见 webview、面板、可滚动/裁剪祖先及窗口视口的交集，向内取整；CSS 坐标按 Electron 页面缩放因子转换为 capturePage 的 DIP。返回：

- `source`：`creator_scene_view` / `creator_game_view` / `creator_editor_window`。
- `windowId`、标题、`capturedAt`、PNG `pixelSize`、字节数和临时文件路径。
- `region`：CSS 范围、适配器、完整视图尺寸及 `clipped`；`bounds` / `cropUnits` 为实际 DIP 裁剪范围，`zoomFactor` 单独列出。
- Game View 的 `runtime` 只表示已知工具栏/运行状态；`runtimeSceneIdentity: "not_verified"`，不伪造加载场景身份。

`region.clipped: true` 表示只截取了部分视图，**不是完整游戏渲染图**。例如 100% 缩放的 1280×720 预览放在较小面板中时，图片可能只见面板一角。客户端应提示用户调整显示缩放/滚动/布局后重新拍摄；本工具不自动改变这些状态。Scene 图片可包含网格/Gizmo，Game View 可包含可见滚动条；没有宣称裁掉所有编辑器装饰、检测遮挡或自动判断空白画面。

每次查询/捕获阶段限时 5 秒；PNG 最大 20 MiB。目标/裁剪/运行状态变化、空图像或非 PNG 报错，不写入成功文件。可选 `fileName` 仅允许普通 `.png` 文件名，拒绝路径、保留设备名和已有文件；省略时生成唯一名称，使用排他写入，不覆盖截图。工程路径按现有路径安全规则核对。

## 输出与失败

MCP `structuredContent.data` 保存报告，`content` 中另有 PNG image block。`verify_ui` 返回：

```json
{
  "completed": true,
  "sceneMode": "general",
  "structure": { "complete": true, "passed": false },
  "screenshot": { "status": "captured", "source": "creator_scene_view" },
  "visualValidation": "not_run"
}
```

示例省略了详情。`completed` 仅表示流程执行完毕，**不是问题检查通过**；结构有问题仍可附图。`screenshot.status` 为 `not_requested`、`captured`、`failed`。截图失败时返回 MCP `isError: true` / `ok: false`、`completed: false`，但保留本次结构结果；不会返回替代图片。

流程记录开始/结束时间、实际等待参数、场景模式及原生序列化 SHA-256。在检查/截图前后检测到序列化或场景身份/模式变化时拒绝组合结果；已经写出的临时图只作丢弃的诊断文件，不自动删除或当作有效证据。不提供编辑锁，不承诺跨进程原子快照、短暂变化完全可检出，或运行/作者数据等价。

视觉模型和 API 凭据由客户端提供，本扩展不调用云端视觉服务，也不上传截图；所有返回的 `visualValidation` 都为 `not_run`。客户端应将其自行观察的结果另写为文字或独立报告，不改写工具的结构结论。

实测及已知限制见 [FR-11 验证记录](https://github.com/abelsdf/cocos-mcp-kit/blob/main/docs/verification/UI_VERIFICATION_2026-09-28.md)。
