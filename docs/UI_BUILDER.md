# JSON UI 构建器 v1

`build_ui`（仅 full）是阶段 2 的第一个可用增量：在**当前已导入场景的明确 UI 父节点下新建**声明式 UI。它把嵌套 JSON 编译为本项目[节点批次 DTO](NODE_BATCH_DTO.md)，复用预检、项目资源核验、新节点清理和 Creator 3.8.8 单次 Undo，不使用 Creator 私有序列化格式。

本增量不是完整 FR-06—FR-08：不新建场景、Canvas 或 Camera，不挂自定义脚本、不绑定点击事件、不提供模板或更新模式。FR-17 的设计分辨率、视口及越界计算另行实施；当前只核对 Canvas/相机/层关系，**不保证 UI 在画面内可见**。

## 调用示例

先查询当前场景和目标父节点的真实 UUID。图片填写经 `query_asset_uuid` 确认的已导入项目 **SpriteFrame** UUID 或其准确 `db://assets/...` 子资源 URL，不填写图片主资源 UUID，不猜子资源后缀。

```json
{
  "sceneUuid": "<当前场景资源 UUID>",
  "parentUuid": "<已有 Canvas 或其 UI 子节点 UUID>",
  "ui": {
    "schemaVersion": 1,
    "mode": "create",
    "failurePolicy": "cleanup_new_nodes",
    "events": [],
    "roots": [{
      "id": "panel",
      "name": "InfoPanel",
      "position": {"x": 0, "y": 0},
      "size": {"width": 480, "height": 300},
      "sprite": {
        "spriteFrame": "<已核实的项目 SpriteFrame UUID>",
        "color": {"r": 32, "g": 48, "b": 72, "a": 255}
      },
      "children": [{
        "id": "title",
        "name": "Title",
        "position": {"x": -200, "y": 120},
        "size": {"width": 400, "height": 64},
        "anchor": {"x": 0, "y": 1},
        "label": {"text": "准备完成", "fontSize": 28, "lineHeight": 36}
      }, {
        "id": "action",
        "name": "Action",
        "position": {"x": 0, "y": -70},
        "size": {"width": 200, "height": 64},
        "label": {"text": "继续", "fontSize": 24},
        "button": {"interactable": true, "target": "action"}
      }]
    }]
  }
}
```

示例的 Button 只有 target 与 interactable 配置，**没有点击业务逻辑**。`target` 是显示目标节点引用，不是事件接收者；省略时显式指向按钮自身。只能指向同次构建中已声明的局部节点 ID。图片和文字需要不同节点；Button 可以与任一组件同节点，也可以单独存在，不会自动生成背景或文字子节点。

## 字段与约束

顶层仅接受 `sceneUuid`、`parentUuid` 和 `ui`。`ui.schemaVersion:1`、`mode:"create"`、`failurePolicy:"cleanup_new_nodes"`、非空 `roots` 为必填；`events` 可省略或为 `[]`，非空事件配置明确报错，不静默跳过。未知字段、原型键、非 JSON 对象、缺失/重复局部 ID 和断链引用均拒绝。

| 节点字段 | 规则 |
| --- | --- |
| `id` / `name` | 必填。ID 在本次 UI 中唯一，沿用 DTO 的 1—64 位字母开头标识；name 为 1—128 字符非空名称。同级名称必须唯一。 |
| `size` | 必填 `{width,height}`，有限数 0.001—8192。每个节点自动声明一个 UITransform。 |
| `position` | 可选 `{x,y}`，默认 `{0,0}`，每轴有限数 −1000000—1000000；创建时 z 固定为 0。均为**直接父节点局部 UI 单位**，不是屏幕像素、世界坐标或自动居中指令。 |
| `anchor` | 可选 `{x,y}`，默认 `{0.5,0.5}`，每轴 0—1。改变锚点不会自动补偿 position。 |
| `label` | `{text,fontSize?,lineHeight?,color?}`；text 为字符串，fontSize 默认 20、范围 0.001—512，lineHeight 默认等于 fontSize、范围 0.001—1024。使用默认系统字体样式和 CLAMP 溢出模式，超出尺寸的文字可能裁切，不承诺自动适配。 |
| `sprite` | `{spriteFrame,color?}`；仅已导入项目 SpriteFrame，固定 SIMPLE 默认类型与 CUSTOM 尺寸模式，素材尺寸不覆盖作者指定的 UI 尺寸。 |
| `button` | `{interactable?,target?}`；interactable 默认 true，target 为本次局部节点 ID，默认自身。没有点击事件。 |
| `color` | label/sprite 可选 `{r,g,b,a}`，四个通道均为 0—255 整数；省略时使用引擎白色默认值。 |
| `children` | 可选节点数组，按声明顺序生成层级和同级顺序；支持多个 roots。 |

最多 128 个节点、16 层，输入及编译后的 DTO 均不超过 256 KiB。旋转、缩放、active、任意组件属性、脚本、布局组件、预制体及外部节点引用不在 v1 范围。

## 执行与重复调用

1. 编译并静态校验全部 JSON，再进入批次预检。必须是单个当前已导入场景，不在 prefab 或多场景编辑中；已有未保存内容不会自动保存或丢弃。
2. 父节点必须 activeInHierarchy、已有 UITransform，并位于启用的 Canvas 下。使用最近 Canvas 的**已有关联相机**；须在同一场景、启用且非编辑器临时节点、没有 RenderTexture 目标，visibility 覆盖继承的父节点 layer。没有关联相机的合法高级渲染布置也会被这个受限入口拒绝；不会猜另一个相机或修改关联/层配置。
3. 继承批次对链接预制体、启用 Layout 父节点、同名冲突及项目资源的检查。加载 SpriteFrame 后再次核对上下文；以 inactive 创建节点，设置局部位置、组件与引用，最后应用 UI 尺寸并激活、回读。
4. **仅创建、不更新、不加名称后缀**。重复相同调用因根同名而在写前失败；只有明确换根名或换父节点才是另一次创建。同一父节点下已有同名内容不被覆盖或“收编”。

Canvas 的相机关联用于屏幕对齐，并不单独证明该相机会渲染子节点，故此处另查 layer/visibility；详见 [Canvas 官方说明](https://docs.cocos.com/creator/3.8/manual/en/ui-system/components/editor/canvas.html)。固定尺寸策略依据 [Label 官方说明](https://docs.cocos.com/creator/3.8/manual/en/ui-system/components/editor/label.html)与 [Sprite 官方说明](https://docs.cocos.com/creator/3.8/manual/en/ui-system/components/editor/sprite.html)。没有复制其他插件的 schema、代码或模板。

## 返回、保存与失败

- 成功：`created:true, verified:true, phase:"complete", needsSave:true`，以及 `identities.nodes`（局部 ID→真实节点 UUID）、`identities.components`（编译器局部组件 ID→组件 UUID）、`rootUuids`、节点/组件/引用计数。组件 ID 如 `c0` 只在本批有意义，不应跨调用保存为引擎身份。
- `uiContext` 返回实际 `canvasUuid`、`cameraUuid`（组件）、`cameraNodeUuid`、`cameraVisibility`；`coordinateSpace:"parent_local_ui"` 与 warnings 提醒没有做视口、遮挡、字体视觉或点击验收。
- 预检失败：MCP 外层 `ok:false`，`data.phase:"preflight"`、`created:false`、`needsSave:null`、`cleanup.status:"not_needed"` 和错误。不会自动尝试通用脚本后备路线。
- 写入、回读、Undo 录制与通信失败完整保留批次的 phase、identities、cleanup、undo 与 uncertain；`created:true` 但录制不确定时外层仍为失败，不能只检查 created。已知失败仅清理本批新节点；未知状态禁止自动重试，需按[批次恢复契约](NODE_BATCH_DTO.md#返回与恢复边界)人工核查。
- Creator 3.8.8 成功构建记录一个父范围 Undo，其他版本明确不承诺。构建器从不自动调用 Undo/redo、保存或关闭场景，也不恢复外部脚本的任意副作用。调用时应避免同范围并发编辑。

返回成功并不代表已写盘。调用方应显式保存，再重开核对属性/引用。真实验证结果、故障注入和未验证边界见[2026-09-28 验证记录](verification/UI_BUILDER_2026-09-28.md)。
