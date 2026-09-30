# UI 结构与引用检查（FR-10）

`validate_ui` 是 `full` 配置下的只读工具。它检查明确指定的节点，不递归检查子节点，不创建组件、修复引用、触发按钮、保存或截图。当前实测环境为 Windows / Creator 3.8.8；其他版本未作运行承诺。

## 调用

先通过 `get_scene_info` / `find_nodes` 取得准确 UUID；构建后可使用 `build_ui.identities.nodes` 的值。要求当前场景 ready、general 编辑模式且非多场景编辑，场景身份必须一致。

```json
{
  "sceneUuid": "<当前场景 UUID>",
  "nodeUuids": ["<面板 UUID>", "<按钮 UUID>"],
  "exclude": [
    { "rule": "design_bounds", "nodeUuid": "<面板 UUID>" }
  ],
  "maxFindings": 50
}
```

- `nodeUuids`：1—128 个不重复的明确节点 UUID；传入父节点不会自动检查后代。
- `exclude`：可选，默认空数组，最多 32 项；仅允许下表规则，`nodeUuid` 必须在本次请求内。省略 `nodeUuid` 表示对全部请求节点排除此规则。排除项回显，不持久化配置；它们抑制问题输出及对应资产查询，但不保证跳过全部基础场景读取。
- `maxFindings`：1—100，默认 50。输出截断时仍返回完整问题总数，`complete` 和 `passed` 均为 false。
- 未知字段、未知规则和非法参数报错，不猜测或扩大检查范围。

## 首版规则

| 规则 | 检查内容 | 限制 |
| --- | --- | --- |
| `ui_transform` | 节点存在、不是编辑器临时内容，具有 UITransform；尺寸有限且为正，锚点有限 | 非 UI 节点可显式排除；不判断布局是否美观 |
| `design_bounds` | 将变换后的节点矩形四角与项目设计矩形比较；设计矩形在 Canvas 局部坐标中，以其锚点定位 | 不用相机裁剪代替设计范围；不是屏幕像素、Scene 观察窗口、Game View 或设备可见性 |
| `sprite_frame` | Sprite 的 SpriteFrame 存在有效对象；asset-db UUID、导入状态及类型有效 | 不加载资源，不核查图片像素内容或磁盘字节；动态无 UUID 资源标为未检查 |
| `label_font` | 非系统字体 Label 的 Font 引用及 asset-db 类型有效，接受 Font 子类 | 系统字体不要求资产；不验证字形覆盖、缓存、RichText、文本溢出或字体渲染 |
| `button_events` | Button.target（若指定）及序列化 clickEvents 的目标、已注册组件、声明的方法有效 | 复用现有绑定方法策略，拒绝访问器/生命周期等不支持方法；从不调用回调，不检查运行时监听器；最多检查前 32 个事件 |
| `widget_animation` | enabledInHierarchy 的 ALWAYS Widget，与自身或祖先 enabled Animation（具有 clips）的共存提示 | 只报告 `potential_animation_conflict` / `not_checked`，不声称轨道确实改写位置/尺寸；不分析 tween、脚本或动画轨道，不自动改成 ONCE |

可交互但无序列化事件的 Button 返回警告；运行时绑定若确为有意设计，可排除此节点的 `button_events`。禁用且无事件的按钮不因空列表报错，但已有的无效绑定仍检查。没有对应组件时不要求补齐该组件。

超出设计区域是 warning，不自动移动节点；有意移出屏幕的内容应显式排除。缺少 Canvas、无效几何或设计分辨率不可用时标记 `not_checked`，不是通过。资源数据库请求失败也标记未检查，不能当成缺失资源；明确返回不存在/未导入/类型不符才报告无效引用。

## 结果含义

工具执行成功只表示获得报告，业务结论读取 `data.passed` / `data.complete`：

```json
{
  "scope": "explicit_nodes_edit_structure",
  "nodeCount": 9,
  "complete": true,
  "passed": true,
  "visualValidation": "not_run",
  "checkedRules": 54,
  "excludedChecks": 0,
  "exclude": [],
  "totalFindings": 0,
  "truncated": false,
  "findings": []
}
```

此处省略了实际返回的 `sceneUuid` 与 `warnings`。`checkedRules` / `excludedChecks` 统计节点×规则的启用/排除槽位，不是已检查组件数量，也不是图形正确性分数。

每个 finding 包含 `nodeUuid`、节点名、`rule`、`code`、`severity`、`status`、说明和建议；适用时含 `componentUuid`、`assetUuid`、从 0 开始的 `eventIndex`。级别为 error / warning；状态为 failed / not_checked。

- `complete`：本次剩余规则没有未检查项，结果未截断，且至少启用一个规则槽位；可以 complete=true 同时存在明确错误。
- `passed`：complete=true 且没有任何未排除的问题（包括 warning）。全部规则都排除时不是通过。
- `visualValidation`：固定 `not_run`。未检查遮挡、遮罩、清晰度、字形、按钮禁用态样式或真实交互；结构通过不能替代视觉验收。
- 场景、几何快照或资产元数据在查询期间出现差异时拒绝稳定报告。不锁定编辑器，也不承诺跨进程原子快照；短暂变化后完全恢复不一定可检测。

## 建议流程与验证

修改完成后显式调用本工具读取结构问题，按需读取 `cocos://knowledge/topic/...` 获取一般知识。若需要修改，另行使用对应写入工具；保存和重新打开场景后再次核对引用。截图和客户端视觉判断单独记录，自动等待更新/结构检查/截图的 FR-11 组合流程尚未实现。

实现仅复用本项目的视口与事件解析；视口路径可能刷新公开的相机派生矩阵，不写入作者场景内容。[实测记录](https://github.com/abelsdf/cocos-mcp-kit/blob/main/docs/verification/UI_VALIDATION_2026-09-28.md)包含真实 MCP 调用、保存重开、原资源哈希和只读验证；不是对任意工程的完整资产审计。
