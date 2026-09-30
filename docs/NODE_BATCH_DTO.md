# 节点批次 DTO、预检与受限创建 v1

范围：FR-29 的 P0 批次、恢复及受限跨场景传输。此 DTO 由 Cocos MCP Kit 独立定义，不包含 Creator 序列化 dump、原生剪贴板载荷或官方 CLI 的私有对象。`validate_node_batch`（core/full）仅对声明式批次做静态预检，**不读取、创建、删除、保存或撤销场景内容**。`create_node_batch`（仅 full）在 Creator 中核对实际目标、组件和资源后执行受限的新节点创建；`copy_nodes_between_scenes` 与 `finalize_cross_scene_cut`（仅 full）在更严格的干净场景和两阶段恢复边界内复用同一 DTO。面向用户的嵌套 JSON 由独立的 [UI 构建器](UI_BUILDER.md)编译，不与传输 DTO 混为一个 schema。

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

v1 向后兼容增加可选节点字段 `active`、`position:{x,y,z}`、`rotation:{x,y,z,w}` 和 `scale:{x,y,z}`，以及组件字段 `enabled`；数值均须有限，旋转使用局部四元数。顶层 `ui:true` 启用构建器的严格 UI 上下文检查（只能为 true 或省略）。严格模式要求每节点 UITransform，Label 显式 CLAMP、Sprite 显式 CUSTOM，目标父节点 active/UITransform、最近 Canvas 启用且关联同场景有效屏幕相机，visibility 覆盖继承层；预检/资源加载后/写入后均检查。返回 `uiContext` 的 Canvas/Camera 身份，不计算屏幕边界；不加 `ui` 的原有批次继续遵循原兼容路径。

## 写入口与预检

调用参数为 `{"sceneUuid":"<当前场景资源 UUID>","parentUuid":"<实际父节点 UUID>","batch":<上述 DTO>}`；不接受其他参数。

- 只接受一个已导入的项目场景及对应活动编辑页；拒绝 prefab 编辑、多场景、切换中的场景和不一致的 UUID/URL。允许已有未保存修改，但绝不自动保存或丢弃。
- 父节点必须属于该场景，不能位于预制体实例或编辑器临时节点中；拒绝启用 Layout 的父节点及直接子节点超过 2000 的父节点。仅创建新节点，不覆盖、更新或重命名旧节点。
- 同级名称冲突（包括批次内部和已有根目标）在写入前拒绝；重复调用也会冲突，不做自动后缀或更新。按下节声明的工程脚本及按钮事件也走同一批次，不在批次返回后进行第二轮附加写入。
- 无组件的普通节点不要求 Canvas。带组件的节点必须有已有 Canvas 祖先，且显式声明一个 `cc.UITransform`。同节点不允许重复组件类型或同时存在 Label 与 Sprite。
- 字面量先做类型校验；引用字段只能用 `references` 或字面量 `null`。内部节点/组件引用在创建后绑定真实对象；字段资源须是 asset-db 精确解析、类型匹配的已导入项目 SpriteFrame，保留真实子资源 UUID，不猜测后缀、不接受内置资源。脚本 UUID 另按 cc.Script 核验，不通过资源加载器执行脚本。加载失败发生在创建前。
- `externalPolicy: "clear"` 只对 Sprite.spriteFrame / ProgressBar.barSprite 设为 `null`，不读取外部目标。Button.target 在激活时会被 Creator 自动设为自身，因此显式 null / external clear 写前拒绝，须使用内部节点引用或保留默认行为。`resolve` 的静态计划仍可生成，但实际解析绑定未实现，包含该动作的写入被拒绝。
- 预检后再次核对编辑器、资源和父节点结构。节点先保持 inactive，依次创建组件、赋值、绑定，再恢复声明的 active/enabled 并等待回读。新节点继承目标父 layer；局部 position、quaternion rotation 与 scale 分别通过公开 Node API 设置并回读。严格 UI 模式在渲染属性和引用绑定后再应用声明尺寸。

| 组件 | 支持的属性/引用 |
| --- | --- |
| `cc.UITransform` | `contentSize: {width,height}`（非负有限数）、`anchorPoint: {x,y}`（有限数） |
| `cc.Label` | `string`（字符串）、`color`（`#RRGGBB[AA]` 或 RGBA 对象）、正有限 `fontSize`（≤512）、`lineHeight`（≤1024）、`overflow`（只支持 CLAMP 数值 1） |
| `cc.Sprite` | `color`、`spriteFrame`（项目 SpriteFrame 资源引用）、`sizeMode`（只支持 CUSTOM 数值 0） |
| `cc.Button` | `interactable`（布尔）、`target`（本批节点引用） |
| `cc.ProgressBar` | `progress`（0—1 有限数）、`barSprite`（本批 Sprite 组件引用） |

除下述受限脚本/事件外，其他属性/组件、Widget/Layout、Canvas/Camera 创建和预制体实例化不在此写入口范围。Label/Sprite/ProgressBar 的自动尺寸行为仍由 Creator 决定；相互驱动的显式属性若无法通过回读，将返回失败和清理报告，不伪称已经生效。

### 项目脚本与按钮事件（v1 可选扩展）

组件可声明为 `{"id":"controller","type":"script","scriptUuid":"<标准工程脚本 UUID>"}`，不支持脚本 properties（仅可省略或空对象）。资产须是已导入的项目 cc.Script，且对应注册类是 Component、类名唯一。按已有挂载工具的 UUID 压缩及 getClassById 路线解析；不生成源码、不按名称猜类、不构造实例做预检。脚本在该节点所有内置组件之后添加；同节点拒绝重复/继承重叠类型，未声明的自动依赖会使创建失败并清理。

顶层可选 `events`（最多 50 条）：`[{"buttonComponentId":"button","targetComponentId":"controller","handler":"onContinue","customEventData":"resume"}]`。两端必须是同批已声明的 Button 与 script 组件 ID；有序绑定，完全重复拒绝，customEventData 默认空串且最多 1024 字符。复用原按钮事件方法校验，拒绝缺失方法、getter、实例箭头函数字段和引擎/生命周期方法。全部组件创建后使用公开 EventHandler 绑定，激活后核对 target、注册组件名、方法、字符串与顺序；构建器本身不调用事件，项目脚本自行调用不受此保证约束。

返回 `eventCount`；含脚本的场景执行报告同时标记 `scriptEffects:"not_audited"`。脚本构造、编辑态生命周期及销毁回调不在全事务保证内，可能影响旧内容或外部状态。清理完成只证明本批节点清除，未知影响需人工审查；工具风险注解为 destructiveHint=true。原无脚本/无事件 DTO 调用保持兼容。实测见[脚本与事件验证](https://github.com/abelsdf/cocos-mcp-kit/blob/main/docs/verification/UI_BUILDER_EVENTS_2026-09-28.md)。

## 返回与恢复边界

成功返回 `created:true`、`verified:true`、局部 ID 到新 UUID 的 `identities`、`rootUuids` 及计数。`needsSave:true` 要求调用方另行保存和重开；不依赖 Creator dirty 标志代表已写盘。

### 单次 Undo（仅 Creator 3.8.8）

在编辑器进程确认 `Editor.App.version === "3.8.8"` 时，预检完成后通过公开 `scene:begin-recording(parentUuid)` 获取录制 ID；批次创建/回读成功后调用一次 `end-recording(id)`。返回 `undo:{supported:true,recorded:true,scope:"target_parent",recordingId:"…",cancelled:false}`。下一次正常 Undo 可以撤销本批，Redo 恢复相同节点/组件身份和引用。工具自身从不调用 Undo/redo、snapshot、自动保存或自动重试。`recordingId` 是当次原生录制句柄，不是跨会话凭据，也不提供任意跳过历史步骤的选择性撤销。

其他 Creator 版本（包括版本未知）沿用已有创建/清理路径，返回 `supported:false, recorded:false, reason:"unverified_creator_version"`，不尝试未验证的录制 API。普通失败的节点清理结束后，仅取消本次已知句柄；成功取消返回 `recorded:false, cancelled:true`。取消历史记录不代替节点清理，也不能把部分清理解释为恢复完成。

开始/结束/取消录制回复异常、写入回复丢失，或写完后活动场景不再匹配时，不猜测录制状态，不自动取消仍可能执行中的写入，不用原生 Undo 兜底。返回 `uncertain:true`、`undo.recorded:null`、`undo.requiresManualReview:true` 和已知的 `recordingId`，并在本扩展进程内阻止该项目继续批次写入。若节点已创建且回读成功，结束录制异常仍保留 `created:true, verified:true, needsSave:true` 的证据，但 MCP 外层为 `ok:false`；不会因历史状态不明而删除已创建节点。检查场景和未保存内容后安全重启 Creator；**只重载扩展可能清除本地阻止标记，但不能证明原生未决录制已关闭**。

录制范围是目标父节点。调用期间应避免用户或其他工具/监听脚本同时修改该范围；既有 Layout、Label、Sprite 等自动计算也不能视为静止的手工属性。单次 Undo 不等于修改任意已有内容的全事务，Undo 栈持久化不在重启验收承诺中。

写入或回读失败时，MCP 外层 `ok:false`，`data` 保留 `phase`、错误、新身份和 `cleanup`。清理逆序处理本批记录的节点，并等待销毁生效；只在父级仍匹配且无残留子节点时删除。节点被重新挂接或收养了已有子树时拒绝递归删除，保留 UUID、错误和 `requiresManualReview:true`。`cleanup.status` 为 `not_needed`、`complete` 或 `partial`，逐项结果可由 `cleanupOrder` 与 `remainingNodeIds` 核对。

场景写调用丢失响应时返回 `uncertain:true`、`cleanup.status:"not_attempted"`，不重试、不猜测应删节点；空残留列表此时代表身份未知，**不是零残留证明**。先检查现场再决定后续操作。失败时 `needsSave:null`，不能将清理完成解释为原场景没有未保存内容。同一扩展进程的同项目并发批次请求会被拒绝。

这不是跨资源全事务：失败清理不恢复旧节点/资源、用户并发编辑或项目监听脚本造成的外部副作用。只承诺已记录新节点的限定清理范围；外部引用 `resolve` 仍未实现。

## 跨场景复制与两阶段剪切

`copy_nodes_between_scenes` 只接受当前已保存、干净、单标签 general 场景中的 1—128 个同父根节点。它通过公开运行时对象读取普通节点子树，生成 DTO v1，使用安全场景切换进入另一个已导入可写场景，再调用同一 `create_node_batch` 创建和回读新身份。成功后目标保持 `needsSave:true`，源场景文件和节点均不修改；不读取 Creator 私有序列化格式，不操作系统或原生剪贴板，不自动保存、回滚或重试。

首版导出范围严格等于 DTO 可声明子集：普通节点的 active/局部变换、受支持内置组件的 enabled 和上表字段，以及内部 Node/Component 与项目 SpriteFrame 引用。根按源同级顺序传输，子节点按原顺序创建；目标节点继承目标父 layer。关联预制体、DontSave 节点、项目脚本、Button clickEvents、未列出的组件/字段和外部 Button.target 均写前拒绝。`externalPolicy:"clear"` 只允许可空的受支持外部字段，并会明确丢弃该引用；默认 `reject`。返回 `fidelity:"node_batch_dto_v1_declared_fields"`，不能解释为任意组件的完整克隆。

设置 `prepareCut:true` 仍只复制，并返回当前扩展进程内最多 32 个的 `transferId`。随后必须由调用方显式保存目标，再调用 `finalize_cross_scene_cut`：工具重新导出目标并逐项比对 DTO/父节点，安全切回源，确认源内容、根 UUID、父节点和外部反向引用均未变化，才在 Creator 3.8.8 通过 `begin-recording(sourceParentUuid)` 建立录制并删除源根，成功后 `end-recording`。源场景仍保持未保存，磁盘上的原源场景在用户显式保存前就是恢复副本，并同时返回一次原生 Undo。目标未保存、任一内容漂移、反向引用、新旧版本不符或录制建立失败时均不删除源。

删除响应丢失或录制结束异常时，不自动取消、重试或猜测完成状态；同项目后续传输在本进程内隔离，要求检查源场景并安全重启 Creator。收到明确删除失败结果时才取消已知录制。`transferId` 不跨扩展重载或 Creator 重启持久化，也不是恢复凭据；原生剪贴板互通不在本实现范围。

纯逻辑、场景模拟和编辑器入口测试分别见 `test/node-batch-dto.test.js`、`test/node-batch-scene.test.js`、`test/node-batch-create.test.js`。Creator 3.8.8 的正式创建、故障注入、保存/重开和完整重启证据见[批次创建验证](https://github.com/abelsdf/cocos-mcp-kit/blob/main/docs/verification/NODE_BATCH_CREATE_2026-09-28.md)；后续原生分组与不确定历史边界见[单次 Undo 验证](https://github.com/abelsdf/cocos-mcp-kit/blob/main/docs/verification/NODE_BATCH_UNDO_2026-09-28.md)。场景脚本采用[官方扩展 IPC](https://docs.cocos.com/creator/3.8/manual/en/editor/extension/scene-script.html)传输 JSON 参数和结果，不跨进程传递 Cocos 原生对象；具体录制消息取自 Creator 消息管理器的公开说明和示例，并另行实测，不从通用 IPC API 推断支持。
