# OP-048 组件类型目录验证（2026-09-19）

目标：在 Cocos Creator 3.8.8 的 `D:\AI\Game\arrow-puzzle` 中核对独立实现的只读组件类型目录。验证不修改场景、脚本或资源。

## 当前证据

- `asset-db:query-assets` 以 `cc.Script` 查询返回 9 个已导入脚本资源。
- 在 `ComplexRefs.scene` 中通过 `execute_scene_script` 调用当前工作区的 `scene.js` 动态方法，返回 103 个内置 Component 类型，未截断。
- 脚本 UUID 注册检查将 `ArrowView` 和 `GameController` 标为 `attachable`；其余 7 个脚本为 `no-component-registration`。该状态不区分正常非组件模块和编译问题，不作错误断言。
- `candidateNames` 中 `cc.Sprite`、`cc.UITransform`、`GameController`、`ArrowView` 为 `attachable`，`cc.Node` 为 `not-component`，`cc.NotAType` 为 `not-found`。
- 单元测试覆盖脚本状态、候选类去重、非法名称和重复 UUID；真实工程验证只读返回，未向节点挂载组件。
- 同步扩展并重开 Creator 后，正式 MCP `tools/list` 返回 117 项工具，包含 `list_available_component_types`，且标记为只读。
- 正式 `tools/call` 返回 103 个内置类型、9 个项目脚本；`ArrowView`、`GameController` 为 `attachable`，其他 7 个为 `no-component-registration`。上述 6 个候选类的状态与动态场景方法一致。
- 正式入口以 `maxProjectScripts: 1` 查询返回 9 个总数、1 条记录和 `projectScriptsTruncated: true`；`257` 被整数上限拒绝，非法类名 `bad name` 被拒绝。
- 扩展同步前备份位于 `E:\AIWork\CocosMcp\.local-install-backups\arrow-puzzle-cocos-mcp-kit-20260919-161127`，同步后 `scene.js`、工具注册表和中文描述文件 SHA-256 与工作区一致。

## 剩余边界

- 在脚本数量超过 256 的工程中仍需检查查询性能；`attachable` 仍须经具体节点的 `add_component` 或 `attach_script_component` 判断依赖和重复约束。
