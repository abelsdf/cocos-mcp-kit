# 节点批次 DTO 与只读预检 v1

范围：FR-29 的首版架构基础。此 DTO 由 Cocos MCP Kit 独立定义，不包含 Creator 序列化 dump 或官方 CLI 的私有对象。`validate_node_batch` 仅对声明式批次做静态预检，**不读取、创建、删除、保存或撤销场景内容**。实际组件类型、资源导入状态、目标场景与父节点仍需构建器在 Creator 中另行核对。

```json
{
  "schemaVersion": 1,
  "roots": ["panel"],
  "nodes": [
    {"id": "panel", "parentId": null, "name": "Panel", "components": [{"id": "layout", "type": "cc.UITransform", "properties": {"width": 640}}]},
    {"id": "label", "parentId": "panel", "name": "Title", "components": [{"id": "text", "type": "cc.Label", "properties": {"string": "Title"}}]}
  ],
  "references": [
    {"from": {"nodeId": "panel", "componentId": "layout", "property": "target"}, "to": {"kind": "node", "id": "label"}}
  ],
  "externalPolicy": "reject"
}
```

`id` 是本次批次的局部 ID，不是 Creator UUID。根列表须与 `parentId: null` 的节点完全一致，父节点必须在同一批次；预检拒绝重复 ID、缺失父节点、循环、不连通节点和内部引用断链。组件 ID 在全批次唯一；同一属性不能同时给出字面量和引用绑定。内部节点或组件引用在创建后用新身份映射；资源引用只列为待 asset-db 核验，不猜测 UUID 或子资源。外部引用有三种策略：`reject` 直接拒绝；`clear` 计划清空该字段；`resolve` 仅记录待解析，不能伪称已解析。

首版限制：最多 128 个节点、每节点 16 个组件、256 条引用、256 KiB JSON 和 16 层层级。返回父先子的创建顺序、引用处理计划、问题代码与定位路径；不返回原始大段属性正文。输入字段与属性对象必须是可安全传输的 JSON 值，原型污染键被拒绝。初版不开放写入工具；未来 JSON UI 构建器须先核对目标场景、父节点、组件类与 asset-db，再创建并记录新身份。失败时只清理本次新建的节点，逐项报告清理成功/失败；修改旧节点、资源和跨场景操作不属于此恢复承诺。单次 Undo 只有经目标 Creator 适配验证后才能宣称支持。

有效/无效夹具及失败清理报告由 `test/node-batch-dto.test.js` 覆盖；正式 Creator 入口只检验工具只读行为和稳定输出，不把静态预检当成实际构建验收。
