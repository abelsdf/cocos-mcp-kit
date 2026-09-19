# OP-041 节点类型识别验收（2026-09-19）

目标：在 Cocos Creator 3.8.8 的活动场景中，以组件身份识别节点用途，返回命中规则和歧义，不凭节点名称推断。

## 环境与方法

- 工程：`D:\AI\Game\arrow-puzzle`，活动场景：`ComplexRefs.scene`。
- 扩展服务：本机 `http://127.0.0.1:21482/`。先通过旧扩展的 `execute_scene_script` 在同一场景进程动态加载当前工作树的 `scene.js` 验证方法；随后关闭 Creator，将当前扩展文件同步到 `D:\AI\Game\arrow-puzzle\extensions\cocos-mcp-kit` 并重新打开工程，验证了正式 MCP 工具入口。
- `detect_node_type` 为只读工具。为了覆盖相机与混合组件分支，另在内存中短暂添加一个探针节点，依次挂载 Camera、UITransform，随后在 `finally` 中移出并销毁；未保存场景或创建测试资产，场景根子节点数量恢复到测试前。

## 结果

| 输入 | 实际结果 | 判定 |
|---|---|---|
| `McpValidationRoot`，无组件 | `type: plain`，命中 `no-recognized-camera-or-ui-component` | 通过 |
| `McpValidationRoot/HammerIcon`，UITransform + Sprite | `type: ui`，列出 UI 组件 | 通过 |
| `InstanceHolder/Canvas`，UITransform + Canvas + Widget | `type: ui`，列出 UI 组件 | 通过 |
| 仅按重名 `Canvas` 查询 | 拒绝，列出两个候选路径和 UUID | 通过 |
| 临时探针，仅 Camera | `type: camera`，命中 `camera-component` | 通过 |
| 同一探针，Camera + UITransform | `type: ambiguous`，候选 `camera`、`ui`，两条命中规则和歧义说明 | 通过 |

重新打开后，`get_project_info` 确认工程路径为 `D:\AI\Game\arrow-puzzle`、Creator 版本为 3.8.8、工具配置为 `full`；`tools/list` 返回 115 项且包含 `detect_node_type` 与 `reset_component_property_to_default`。通过正式 `tools/call` 对 `McpValidationRoot/HammerIcon` 调用 `detect_node_type`，返回 `ok: true`、`type: ui`，组件证据为 `UITransform` 和 `Sprite`。

定位参数沿用严格节点解析器；单元测试另覆盖“名字叫 Camera 却无相机组件”、无选择器、场景根和过期 UUID。`plain` 只表示未发现受支持的内置 Camera/UI 组件，不保证自定义脚本没有 UI 行为。这里没有修改需要保存重开的场景资产。
