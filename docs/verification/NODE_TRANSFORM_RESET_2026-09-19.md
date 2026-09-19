# 节点局部变换重置验证（2026-09-19）

测试工程为 `D:\AI\Game\arrow-puzzle`，Cocos Creator 3.8.8；本地 MCP 端口 `21482`。运行中的扩展仍为旧版；本轮通过其 `execute_scene_script` 加载本工作区 `scene.js` 并调用 `resetNodeTransform`。新工具注册由本工作区测试覆盖，旧版扩展面板尚未暴露该工具。

| 步骤 | 结果 |
| --- | --- |
| 隔离样本 | 创建并打开 `McpKitTransformResetProbe.scene`（UUID `272bee54-d603-41e3-ae52-588ebb089efe`），在其中创建 `ResetTarget`（节点 UUID `c1UkE8AsZLJZk3YBHRQX9D`）。初始局部位置 `(25,-8,3)`、旋转四元数约 `(0,0,0.382683,0.923880)`、缩放 `(1.5,2,1)`，`active=false`。 |
| 按字段重置 | 使用 `fields:['position']` 后，位置为 `(0,0,0)`；旋转、缩放及 `active` 均未变化，结果报告仅 `position` 发生改变。 |
| 全部重置 | 不传 `fields` 后，旋转为 `(0,0,0,1)`，缩放为 `(1,1,1)`，位置保持 `(0,0,0)`，`active` 仍为 `false`。 |
| 持久化 | 保存场景，切至 `ComplexRefs.scene` 再重开；节点 UUID 不变，三个局部变换仍为单位值，`active=false`。磁盘 `.scene` 的 `_lpos`、`_lrot`、`_lscale` 与重开结果一致。 |
| 清理 | 切回 `ComplexRefs.scene` 后通过 asset-db 删除临时场景；`.scene` 和 `.meta` 均不存在。 |

工具仅重置普通场景节点的局部变换，不改变激活状态，也不处理组件属性或预制体覆盖。字段输入在更改前校验；设置器出错时尝试恢复原始变换。官方 [Cocos Creator 3.8 Node API](https://docs.cocos.com/creator/3.8/api/en/class/Node) 提供局部位置、旋转和缩放设置器。关联预制体层级使用独立的还原流程，类默认值属性重置仍待实现。
