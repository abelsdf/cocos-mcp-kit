# OP-054 预制体创建验证（2026-09-21）

## 实现范围

`create_prefab_from_node` 仍使用 Creator 场景进程的 `cce.Utils.serialize` 及 `asset-db:create-asset`/`save-asset`，不使用磁盘直写回退。新版在写入前要求场景进程证明源层级未改变，并验证：

- 预制体和根名称与目标文件名一致，全部节点归一到 UI_2D 层；
- 所有序列化节点从唯一根可达，父子指针一致，无循环、重复父节点或孤立场景节点；
- 每个组件只由一个节点引用，组件 owner 指回该节点，组件和节点 PrefabInfo 元信息及 fileId 完整且不重复；
- 全部 `__id__` 内部对象指针有效；最多 5000 条显式资源 UUID 在写入前经 asset-db 查询，扫描不完整、缺失、查询错误或声明的嵌套资源类型错误均拒绝写入；
- 拒绝场景根、关联的嵌套预制体实例和带 DontSave 节点的子树。

写入后通过资产 UUID 再次读取，核对已导入状态、db URL、`.meta` UUID 一致性、根名称、节点数和组件数。asset-db 已完成持久化与导入，因此不再追加面向外部文件编辑的 `refresh-asset` 调用。

## 验证结果

- 单元测试覆盖有效连通图、孤立节点、重复父节点、组件 owner 不匹配、失效内部指针、缺失资源和引用扫描上限；预检失败时未发生 asset-db 写入。
- 在 `D:\AI\Game\arrow-puzzle` 的 Creator 3.8.8 中，通过正式 `execute_scene_script` 动态加载工作区校验模块并克隆序列化 `McpValidationRoot/HammerIcon`。结果为 1 个节点、2 个组件、3 个 fileId、10 条有效内部对象指针；1/1 条 SpriteFrame 引用完整可解析，源节点名称、层、父节点、子节点数和组件数未变化。
- 安装新版扩展并重开 Creator 后，正式 `create_prefab_from_node` 将该节点创建为 `db://assets/McpKitValidation/Op054Probe.prefab`。asset-db 导入 UUID 为 `b0bd22f8-9c53-4741-b48d-5729569fe4cb`；返回结果确认 `sourceUnchanged:true`，结构仍为 1 个节点、2 个组件、3 个 fileId、10 条内部对象指针，资源预检为 1/1 完成且无缺失或查询错误。创建后回查的 db URL、资源 UUID、`.meta` UUID、根名称和节点/组件数量全部一致。
- 独立调用 `inspect_prefab` 和 `validate_prefab_references` 再次确认根名称为 `Op054Probe`、1 个节点、2 个组件、1 条有效资源引用且扫描完整。正式 `open_asset` 打开后，编辑器窗口标题为 `Op054Probe.prefab`，活动预制体场景包含对应的 `UITransform` 与 `Sprite`。
- 从 `InstanceHolder` 创建关联预制体的负例在写入前被拒绝，`Op054Rejected.prefab` 未生成。随后切回 `ComplexRefs.scene`，通过正式 `delete_asset` 删除成功；两个探针的 `.prefab`、`.meta` 及 asset-db 记录均不存在。
- 原场景在创建、打开、切回和删除全过程前后的 SHA-256 均为 `31FA83D7B39199765FF07F0434ABEE23F654FDE78F9B593449809FDB441CACF6`，源节点仍位于 `McpValidationRoot/HammerIcon`。本轮未覆盖把关联预制体作为嵌套实例保留到新资源；该输入当前明确拒绝，避免静默展平。
