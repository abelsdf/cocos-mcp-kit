# Creator 3.8.8 预制体复制与 JSON 编辑验收（2026-09-19）

测试对象为 `D:\AI\Game\arrow-puzzle` 中的自有样本 `assets/McpKitValidation/IconPair.prefab`。运行中的扩展 `/health` 返回工程身份 `758048aa923da9e57466f98a`。通过 `execute_editor_script` 在 Creator 编辑器进程中加载本仓库当前的 `lib/prefabs.js`，并非依赖测试工程中已安装扩展的旧版文件。临时探针名称为 `DuplicateEditProbe_1789783395977.prefab`，写入与清理均通过 Creator asset-db。

| 检查 | 结果 |
| --- | --- |
| 复制与导入 | `duplicatePrefab` 返回 `asset-db:create-asset`，一次保存成功。新资产 UUID `225d1819-4073-4d74-a3c3-0fa714dcd9a7`，不同于源资产 `e6d4758d-3330-4f17-8fdb-58b4b180cb93`；查询状态 `imported:true`。 |
| JSON 编辑与持久化 | `editPrefabJson` 把根节点 `_active` 从 `true` 改为 `false`，返回 `asset-db:save-asset`，一次保存成功。编辑前后资产 UUID 与 `.meta` UUID 均为 `225d1819-4073-4d74-a3c3-0fa714dcd9a7`；再次读取磁盘仍为 `false`。 |
| 结构与引用 | 预制体资源及根节点名称均匹配目标文件名；子节点 `HammerIcon`、`HintIcon` 保留，2 条 SpriteFrame UUID 引用经 asset-db 查询有效，缺失数 0。 |
| 清理 | `asset-db:delete-asset` 后，临时 `.prefab` 与 `.meta` 均不存在。 |

首次测试时当前编辑器为未落盘的 `Untitled` 场景，虽然 `scene:query-dirty` 为 `false`，仍未切换该场景。随后用户明确要求切换打开临时预制体；再次检查 `Untitled` 只含默认 Main Light 和 Main Camera，且脏状态为 `false`，才进行了下面的重开测试。

## 切换、打开与重开补充验证

通过当前源码复制 `IconPair.prefab`，创建 `McpKitReopenProbe.prefab`，然后以 `editPrefabJson` 将根节点 `_active` 改为 `false`。创建与编辑后的资产 UUID 均为 `39a2d740-c656-49d9-b25e-02fefad4c9d8`，资源引用检查为 2 条、缺失 0。用 Creator `asset-db:open-asset` 打开该探针，编辑态场景为 `McpKitReopenProbe-scene`，层级含探针根节点、`HammerIcon` 和 `HintIcon`；根节点 `active:false`，两个子节点各有 `UITransform` 与 `Sprite`。

接着打开源 `IconPair.prefab`，确认编辑态场景切为 `IconPair-scene`，再重新打开临时探针。第二次打开后，根节点仍为 `active:false`，两个 Sprite 组件仍在。`HammerIcon` 的 SpriteFrame/Texture UUID 分别为 `7222d7a1-b348-41ec-9f8a-4eea647d8774@f9941` / `@6c48a`；`HintIcon` 分别为 `1b3c2630-2ff7-4455-a872-072e320c0d8c@f9941` / `@6c48a`。编辑态层级再次报告 5 个节点（包含 Creator 自动包装的 Canvas 和 Camera），未截断。

验证后切换到已保存的 `ComplexRefs.scene`，用 `asset-db:delete-asset` 删除探针，确认 `.prefab` 与 `.meta` 均不存在。编辑器当前停在 `ComplexRefs.scene`。本次证明该复杂样本的复制、JSON 编辑、切换重开与资源引用保持；没有进行视觉截图、脚本事件或其他复杂属性验收。

单元测试另覆盖导入调用拒绝时不回退磁盘直写、同一源/目标保护、保存前名称检查、缺失 JSON 路径、备份及 UUID 保持。阶段 0 与 FR-05 仍未整体验收完成。

本轮全量测试 273 项中 271 通过、0 失败、2 项因当前 Windows 会话没有文件符号链接权限而跳过；工具文档一致性检查、相关源码语法检查和 `git diff --check` 均通过。

随后用户在外部 PowerShell 定向运行原两项相关测试所在文件，23 项通过、0 失败、0 跳过；提交前在当前 Codex 会话全量复测为 273 项通过、0 失败、0 跳过。详见[Windows 测试基线补充验证](./WINDOWS_TEST_BASELINE_2026-09-19.md)。
