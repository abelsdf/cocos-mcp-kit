# 节点批次 DTO、预检与受限创建 v1

范围：FR-29 的 P0 批次与恢复基础，尚不是跨场景复制或通用 UI 构建器。此 DTO 由 Cocos MCP Kit 独立定义，不包含 Creator 序列化 dump 或官方 CLI 的私有对象。`validate_node_batch`（core/full）仅对声明式批次做静态预检，**不读取、创建、删除、保存或撤销场景内容**。`create_node_batch`（仅 full）在 Creator 中核对实际目标、组件和资源后，执行下述受限的新节点创建。

```json
{
  "schemaVersion": 1,
  "roots": ["panel"],
  "nodes": [
    {"id": "panel", "parentId": null, "name": "Panel", "components": [
      {"id": "panelUi", "type": "cc.UITransform", "properties": {"contentSize": {"width": 640, "height": 360}}},
      {"id": "button", "type": "cc.Button", "properties": {"interactable": false}}
    ]},
    {"id": "label", "parentId": "panel", "name": "Title", "components": [
      {"id": "labelUi", "type": "cc.UITransform"},
      {"id": "text", "type": "cc.Label", "properties": {"string": "Title"}}
    ]}
  ],
  "references": [
    {"from": {"nodeId": "panel", "componentId": "button", "property": "target"}, "to": {"kind": "node", "id": "label"}}
  ],
  "externalPolicy": "reject"
}
```

`id` 是本次批次的局部 ID，不是 Creator UUID。根列表须与 `parentId: null` 的节点完全一致，父节点必须在同一批次；预检拒绝重复 ID、缺失父节点、循环、不连通节点和内部引用断链。组件 ID 在全批次唯一；同一属性不能同时给出字面量和引用绑定。内部节点或组件引用在创建后用新身份映射；资源引用只列为待 asset-db 核验，不猜测 UUID 或子资源。外部引用有三种策略：`reject` 直接拒绝；`clear` 计划清空该字段；`resolve` 仅记录待解析，不能伪称已解析。

DTO 限制：最多 128 个节点、每节点 16 个组件、256 条引用、256 KiB JSON 和 16 层层级。返回父先子的创建顺序、引用处理计划、问题代码与定位路径；不返回原始大段属性正文。输入字段与属性对象必须是可安全传输的 JSON 值，原型污染键被拒绝。静态 `valid: true` 不保证某个组件或属性被写入口支持。

## 写入口与预检

调用参数为 `{"sceneUuid":"<当前场景资源 UUID>","parentUuid":"<实际父节点 UUID>","batch":<上述 DTO>}`；不接受其他参数。

- 只接受一个已导入的项目场景及对应活动编辑页；拒绝 prefab 编辑、多场景、切换中的场景和不一致的 UUID/URL。允许已有未保存修改，但绝不自动保存或丢弃。
- 父节点必须属于该场景，不能位于预制体实例或编辑器临时节点中；拒绝启用 Layout 的父节点及直接子节点超过 2000 的父节点。仅创建新节点，不覆盖、更新或重命名旧节点。
- 同级名称冲突（包括批次内部和已有根目标）在写入前拒绝；重复调用也会冲突，不做自动后缀或更新。
- 无组件的普通节点不要求 Canvas。带组件的节点必须有已有 Canvas 祖先，且显式声明一个 `cc.UITransform`。同节点不允许重复组件类型或同时存在 Label 与 Sprite。
- 字面量先做类型校验；引用字段只能用 `references` 或字面量 `null`。内部节点/组件引用在创建后绑定真实对象；资源须是 asset-db 精确解析、类型匹配的已导入项目 SpriteFrame，保留真实子资源 UUID，不猜测后缀、不接受内置资源。加载失败发生在创建前。
- `externalPolicy: "clear"` 只对 Sprite.spriteFrame / ProgressBar.barSprite 设为 `null`，不读取外部目标。Button.target 在激活时会被 Creator 自动设为自身，因此显式 null / external clear 写前拒绝，须使用内部节点引用或保留默认行为。`resolve` 的静态计划仍可生成，但实际解析绑定未实现，包含该动作的写入被拒绝。
- 预检后再次核对编辑器、资源和父节点结构。节点先保持 inactive，依次创建组件、赋值、绑定，再激活并等待回读。新节点继承父层级，使用默认变换；v1 不接收位置、旋转、缩放、active 或任意构造脚本。

| 组件 | 支持的属性/引用 |
| --- | --- |
| `cc.UITransform` | `contentSize: {width,height}`（非负有限数）、`anchorPoint: {x,y}`（有限数） |
| `cc.Label` | `string`（字符串）、`color`（`#RRGGBB[AA]` 或 RGBA 对象） |
| `cc.Sprite` | `color`、`spriteFrame`（项目 SpriteFrame 资源引用） |
| `cc.Button` | `interactable`（布尔）、`target`（本批节点引用） |
| `cc.ProgressBar` | `progress`（0—1 有限数）、`barSprite`（本批 Sprite 组件引用） |

其他属性、组件、自定义脚本、Button 点击事件、Widget/Layout、Canvas/Camera 创建和预制体实例化不在此写入口范围。Label/Sprite/ProgressBar 的自动尺寸行为仍由 Creator 决定；相互驱动的显式属性若无法通过回读，将返回失败和清理报告，不伪称已经生效。

## 返回与恢复边界

成功返回 `created:true`、`verified:true`、局部 ID 到新 UUID 的 `identities`、`rootUuids` 及计数。`needsSave:true` 要求调用方另行保存和重开；不依赖 Creator dirty 标志代表已写盘。

### 单次 Undo（仅 Creator 3.8.8）

在编辑器进程确认 `Editor.App.version === "3.8.8"` 时，预检完成后通过公开 `scene:begin-recording(parentUuid)` 获取录制 ID；批次创建/回读成功后调用一次 `end-recording(id)`。返回 `undo:{supported:true,recorded:true,scope:"target_parent",recordingId:"…",cancelled:false}`。下一次正常 Undo 可以撤销本批，Redo 恢复相同节点/组件身份和引用。工具自身从不调用 Undo/redo、snapshot、自动保存或自动重试。`recordingId` 是当次原生录制句柄，不是跨会话凭据，也不提供任意跳过历史步骤的选择性撤销。

其他 Creator 版本（包括版本未知）沿用已有创建/清理路径，返回 `supported:false, recorded:false, reason:"unverified_creator_version"`，不尝试未验证的录制 API。普通失败的节点清理结束后，仅取消本次已知句柄；成功取消返回 `recorded:false, cancelled:true`。取消历史记录不代替节点清理，也不能把部分清理解释为恢复完成。

开始/结束/取消录制回复异常、写入回复丢失，或写完后活动场景不再匹配时，不猜测录制状态，不自动取消仍可能执行中的写入，不用原生 Undo 兜底。返回 `uncertain:true`、`undo.recorded:null`、`undo.requiresManualReview:true` 和已知的 `recordingId`，并在本扩展进程内阻止该项目继续批次写入。若节点已创建且回读成功，结束录制异常仍保留 `created:true, verified:true, needsSave:true` 的证据，但 MCP 外层为 `ok:false`；不会因历史状态不明而删除已创建节点。检查场景和未保存内容后安全重启 Creator；**只重载扩展可能清除本地阻止标记，但不能证明原生未决录制已关闭**。

录制范围是目标父节点。调用期间应避免用户或其他工具/监听脚本同时修改该范围；既有 Layout、Label、Sprite 等自动计算也不能视为静止的手工属性。单次 Undo 不等于修改任意已有内容的全事务，Undo 栈持久化不在重启验收承诺中。

写入或回读失败时，MCP 外层 `ok:false`，`data` 保留 `phase`、错误、新身份和 `cleanup`。清理逆序处理本批记录的节点，并等待销毁生效；只在父级仍匹配且无残留子节点时删除。节点被重新挂接或收养了已有子树时拒绝递归删除，保留 UUID、错误和 `requiresManualReview:true`。`cleanup.status` 为 `not_needed`、`complete` 或 `partial`，逐项结果可由 `cleanupOrder` 与 `remainingNodeIds` 核对。

场景写调用丢失响应时返回 `uncertain:true`、`cleanup.status:"not_attempted"`，不重试、不猜测应删节点；空残留列表此时代表身份未知，**不是零残留证明**。先检查现场再决定后续操作。失败时 `needsSave:null`，不能将清理完成解释为原场景没有未保存内容。同一扩展进程的同项目并发批次请求会被拒绝。

这不是跨资源全事务：失败清理不恢复旧节点/资源、场景切换、用户并发编辑或项目监听脚本造成的外部副作用。只承诺已记录新节点的限定清理范围；剪切/跨场景粘贴和外部引用解析仍待实现与适配验证。

纯逻辑、场景模拟和编辑器入口测试分别见 `test/node-batch-dto.test.js`、`test/node-batch-scene.test.js`、`test/node-batch-create.test.js`。Creator 3.8.8 的正式创建、故障注入、保存/重开和完整重启证据见[批次创建验证](verification/NODE_BATCH_CREATE_2026-09-28.md)；后续原生分组与不确定历史边界见[单次 Undo 验证](verification/NODE_BATCH_UNDO_2026-09-28.md)。场景脚本采用[官方扩展 IPC](https://docs.cocos.com/creator/3.8/manual/en/editor/extension/scene-script.html)传输 JSON 参数和结果，不跨进程传递 Cocos 原生对象；具体录制消息取自 Creator 消息管理器的公开说明和示例，并另行实测，不从通用 IPC API 推断支持。
