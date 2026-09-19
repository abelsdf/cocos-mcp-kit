# 组件属性类默认值重置验证（2026-09-19）

测试工程为 `D:\AI\Game\arrow-puzzle`，Cocos Creator 3.8.8；本地 MCP 端口 `21482`。运行中的扩展仍为旧版；本轮通过其 `execute_scene_script` 加载本工作区 `scene.js` 并调用 `resetComponentPropertyToDefault`。新工具注册由本工作区测试覆盖，旧版扩展面板尚未暴露该工具。

| 步骤 | 结果 |
| --- | --- |
| 隔离样本 | asset-db 创建 `McpKitClassDefaultProbe.ts`（UUID `67139fbf-57cf-46c0-9629-0517488c55ed`）及 `McpKitClassDefaultProbe.scene`（UUID `4049918e-5bc2-4138-80e3-033ab07620a4`）；将脚本组件挂载到 `DefaultTarget`（UUID `08PF5jBxlF1qEgF+U7UVVY`）。 |
| 元数据 | `CCClass.attr` 可读出 `count=17`、`title='ready'`、`offset=Vec3(3,4,5)`、`target=null` 的 `default`；`CCClass.getDefault` 对 Vec3 多次调用生成不同实例。`enabled` 无该属性默认元数据。 |
| 重置 | 将四项分别改为 `99`、`changed`、`Vec3(9,8,7)`、目标节点，再调用新方法；返回值与实际组件值均回到声明默认。重复重置 `count` 返回 `alreadyDefault:true`；对 `enabled` 请求被拒绝。 |
| 持久化 | 保存，切至 `ComplexRefs.scene` 再重开；组件类 ID `67139+/V89GwJYpBRdIjFXt`、节点 UUID、四项默认值均保留。磁盘 `.scene` 中的脚本条目为 `count:17`、`title:'ready'`、`offset:(3,4,5)`、`target:null`。 |
| 清理 | 切回 `ComplexRefs.scene` 后通过 asset-db 删除探针场景和脚本；两项资产及各自 `.meta` 均不存在。 |

新工具只处理有明确默认值元数据的顶层数据字段，支持基本值、Cocos ValueType 和有界数组；拒绝访问器、隐藏/非序列化属性、复杂默认对象及关联预制体层级。它不同于旧 `reset_component_property` 的字段清除，也不调用可能改变其他字段的整组件 Reset 回调。官方 [CCClass API](https://docs.cocos.com/creator/3.8/api/zh/namespace/CCClass) 提供 `attr` 和 `getDefault`；[属性参数文档](https://docs.cocos.com/creator/3.8/manual/zh/scripting/reference/attributes.html) 说明序列化与检查器可见性元数据。此轮仅证明临时脚本上述字段，其他内置组件类型和预制体实例还原仍需逐类验收。
