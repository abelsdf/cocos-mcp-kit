# OP-053 预制体引用校验验证（2026-09-20）

## 实现范围

`validate_prefab_references` 在每个预制体中扫描显式资源 UUID 字段，而不复用 `inspect_prefab` 的 500 条展示列表。默认最多检查 2000 条，可设至 5000 条；超过上限、资产目录超过扫描上限或 asset-db 暂时无法查询时，`complete` 与 `ok` 均为 `false`。重复 UUID 只查询一次，逐项缺失数仍按引用位置统计；问题示例有界输出并标记截断。

另外检查节点 `_components` 指向的序列化组件条目是否存在、显式缺失组件占位符及组件归属；检查 `cc.PrefabInfo.asset.__uuid__` 声明的嵌套资源是否存在且为 `cc.Prefab`。这只是静态序列化检查：不会证明实际嵌套实例仍保持链接，也不会检测运行时动态加载资源或判定自定义组件类是否已注册。`componentTypeRegistrationChecked` 明确为 `false`。

## 验证

- 单元测试覆盖第 501 条引用缺失、扫描上限、暂时性 asset-db 错误、组件条目缺失/归属不匹配、嵌套资源类型错误及资产目录截断。
- 在运行中的 `D:\AI\Game\arrow-puzzle` Creator 3.8.8 中，通过正式 `execute_editor_script` 动态加载工作区 `lib/prefabs.js`。`IconPair.prefab` 检查 2/2 条显式资源引用、`NestedPair.prefab` 检查 4/4 条；两者均未发现缺失、查询错误或组件链接问题，`complete: true`。`NestedPair` 是扁平化历史样本，未发现外部嵌套资源声明，不能作为真实嵌套实例验证。
- 关闭 Creator 后已备份旧扩展并同步新版；重开后正式 MCP `tools/list` 返回 118 项工具，`validate_prefab_references` schema 包含 `maxReferences` 与 `maxIssues` 等界限。正式工具入口再次确认 `IconPair` 检查 2/2 条、`NestedPair` 检查 4/4 条，二者 `ok: true`、`complete: true`，无缺失、查询错误或组件链接问题。对 `IconPair` 设置 `maxReferences: 1` 时，返回 `referenceCount: 1`、`totalReferenceCount: 2`、`referencesTruncated: true`、`complete: false`、`ok: false`；设置 0 被拒绝。资产目录扫描 `limit: 1` 正确标记 `assetListTruncated: true`。测试前后 `ComplexRefs.scene` 的 SHA-256 均为 `31FA83D7B39199765FF07F0434ABEE23F654FDE78F9B593449809FDB441CACF6`。
