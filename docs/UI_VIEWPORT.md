# UI 视口上下文（FR-17 P0）

`get_ui_viewport`（core/full）只读查询指定 UI 节点的设计分辨率、最近 Canvas、关联场景相机与可计算边界。当前验证版本为 Creator 3.8.8；范围是 **`edit_scene_camera`，即编辑态关联场景相机的几何投影**，不是 Scene 观察窗口、Game View、浏览器或设备画面的可见性验收。

## 调用与自动附加

```json
{
  "sceneUuid": "<当前场景资源 UUID>",
  "nodeUuids": ["<目标 UI 节点 UUID>"]
}
```

只接受这两个字段；必须为当前就绪的普通场景，拒绝 prefab/多场景编辑。`nodeUuids` 为 1—128 个不同的精确 UUID，不按名称猜测，不自动扫描后代。缺失节点或非 UI 节点返回各自的不可用原因，不丢弃其他目标的结果。

成功且已核验的 `build_ui`，以及 `set_node_transform`、`reset_node_transform`、`batch_modify_nodes`、`set_component_property` 的正常返回，会附加同一 `viewport` 报告。批量修改对已确认的节点 UUID 去重；原有逐步失败仍保留。其他创建/修改工具可显式调用本查询。

附加查询与写入结果分离：`viewport.complete:false` 不会把已完成的写入改成失败，不重试、清理、Undo 或保存。没有目标身份、原写入不确定或查询失败时明确给出原因；构建失败继续沿用原批次恢复报告，不追加场景查询。

## 输出与坐标

| 字段 | 含义 |
| --- | --- |
| `projectDesignResolution` | 通过原生 `Editor.Profile.getProject` 读取项目 `width/height/fitWidth/fitHeight`，包含来源。查询前后不一致或缺失时 `available:false`，不猜默认值。它是配置，不是实际相机像素尺寸。 |
| `nodes[].canvas` | 最近 Canvas 的**节点 UUID**、`alignCanvasWithScreen`、Canvas 自身 UITransform 内容矩形，以及相机视口在 Canvas 局部 z=0 平面的交点。 |
| `nodes[].camera` | 关联相机的**组件 UUID**及 `nodeUuid`、投影类型、near/far、orthoHeight、visibility、归一化 rect、实际 renderSize 和 viewportPixels。不会猜另一个相机。 |
| `bounds.local` | 目标自身的锚点相对 UI 坐标；例如 200×80、锚点 0.5/0.5 对应 x=−100…100、y=−40…40。不是目标相对父节点的 position。 |
| `bounds.world` | 经完整父链变换后的场景世界坐标，考虑锚点、旋转及负缩放。 |
| `bounds.canvas` | 同一目标四角转换到最近 Canvas 的锚点相对局部坐标。 |
| `bounds.screen` | 相机 render buffer 像素，左下角为原点；**z 是相机空间深度，不是像素、世界 z 或归一化深度**。 |
| `canvas.viewport` | 视口四角射线与 Canvas 平面的交点，不是 Canvas 内容尺寸，也不是设计分辨率。平面平行、落在近远裁剪范围外等情况明确不可用。 |

每组边界包含四角 `corners` 和 x/y 轴对齐外包矩形 `aabb`。四角按节点局部左下、右下、右上、左上排列，经负缩放后绕序可能改变；z 保留于四角，不包含在二维 aabb 中。

`camera.viewportPixels` 由相机的归一化 `rect` 与实际 render buffer 尺寸计算。查询只刷新公开 `camera.camera.update(true)` 的派生矩阵缓存，不改作者参数、节点、工程配置或保存文件。编辑态相机可能没有渲染新帧，不能混用新相机属性与旧投影矩阵。

## 越界状态与降级

`nodes[].clipping.status` 对**节点自身 UITransform 四边形**与相机视口及近远裁剪面做判断，不只比较外包矩形：

- `inside`：整个矩形在相机范围内。
- `partial`：部分被裁剪，但仍有非零投影面积。
- `outside`：无有面积的交集；仅边/点接触也归为 outside。
- `unavailable`：无法可靠计算，检查节点 `reason` 或 `clipping.reason`。

缺少 UITransform、Canvas 或关联相机，目标/Canvas/相机未激活，层不可见，退化变换或投影，无有效相机像素尺寸，以及透视相机和 RenderTexture 均不推断可见范围。已有局部/世界边界可以保留，未算出的字段不伪造。查询不尝试修复或更换相机、尺寸、层或位置。

节点 `available:true` 仅说明该目标的投影及裁剪可计算。顶层 `complete:true` 还要求项目配置稳定可读、所有目标可计算、各 Canvas 平面视口可求交；即使全部节点都在 `outside`，报告仍可 complete。反之，不能把 `complete:false` 理解为节点必然在画面外。

这些状态不检查子节点合并边界、Mask、遮挡、透明度、文字字形、事件点击、自动布局下一帧或运行时脚本变化，也不证明像素真的绘制出来。Scene 观察窗口和实际运行预览的可见范围尚未接入；不要用本报告替代截图/运行验收。查询是当次编辑态快照，不与并发用户/脚本操作组成事务。

API 依据：[项目配置读取](https://docs.cocos.com/creator/3.8/manual/en/editor/extension/profile.html)、[多分辨率适配](https://docs.cocos.com/creator/3.8/manual/en/ui-system/components/engine/multi-resolution.html)、[Camera](https://docs.cocos.com/creator/3.8/api/en/class/Camera)，并核对本机 3.8.8 公开类型声明。实际数据与保存/重启证据见[验证记录](verification/UI_VIEWPORT_2026-09-28.md)。
