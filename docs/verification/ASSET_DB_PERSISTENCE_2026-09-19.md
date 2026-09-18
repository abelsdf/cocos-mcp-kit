# Creator 3.8.8 场景与预制体保存验收（2026-09-19）

测试工程为 `D:\AI\Game\arrow-puzzle`，服务 `/health` 确认工程身份 `758048aa923da9e57466f98a`。在该工程正在运行的 Creator 编辑器进程中，用 `execute_editor_script` 直接加载本仓库当前源码的 `saveSceneContent` / `savePrefabContent`；测试未依赖已安装扩展的旧版工具实现。测试目标均在 `assets/McpKitValidation/`，没有修改游戏场景。

| 操作 | 运行证据 | 结果 |
| --- | --- | --- |
| 预制体新建 | 以 `IconPair.prefab` 为独立样本创建 `PersistenceProbe.prefab`；返回 `asset-db:create-asset`，导入 UUID `2b61c113-73bc-405f-b4f7-33ec8e7c413a`，文件与 `.meta` 存在。 | 通过 |
| 预制体覆盖 | 首轮修改内部名称后，曾在 `save-asset` 返回时读到新名称；后续延时检查发现 Creator 会将预制体资源及根节点名称恢复为目标文件名，首轮结果不能算稳定通过。改用根节点 `_active: true → false`，新建后立即覆盖，同一编辑器脚本内 3/3 次、独立 MCP 调用 5/5 次均在延时复查后保持更改，原 UUID 不变。 | 属性覆盖通过；内部改名不支持 |
| 场景新建 | 复制测试场景到 `ScenePersistenceProbe2.scene`；返回 `asset-db:create-asset`，资产 UUID `386689d0-a054-4846-aae0-7a798e2669f5`，磁盘根 `cc.Scene._id` 与该 UUID 一致，`.meta` 存在。 | 通过 |
| 场景覆盖 | 修改名称后执行 `overwrite: true`；返回 `asset-db:save-asset`，UUID 与根场景 ID 均保持不变，磁盘名称变为 `ScenePersistenceProbeUpdated`。 | 通过 |
| 失败处理 | 单元故障注入覆盖消息拒绝后仍留下部分文件、消息返回成功但磁盘未更新、文件存在但无导入 UUID；均明确报错，不再返回写入成功。 | 本地测试通过 |

首个场景探针 `ScenePersistenceProbe.scene` 在严格字节/JSON 对比时曾返回校验失败，但 Creator 实际已创建文件和 `.meta`。差异仅为导入时把根 `cc.Scene._id` 从源场景 UUID 替换为新资产 UUID；已将这一特定正常改写纳入校验，其余 JSON 差异仍报错。该探针未当作失败创建处理。

“新建后立即覆盖”压力探针进一步区分了两种现象。改变预制体或根节点内部 `_name` 时，原生 `asset-db:save-asset` 可返回资产信息，磁盘可能暂时出现请求值，随后又被 Creator 规范化为目标文件名；即使先等 250、750 或 1500 毫秒再请求保存，四组内部改名均未稳定保留。创建时传入与文件名不同的内部名称也会被规范化。修改根节点 `_active` 则在上述 3+5 组立即覆盖中稳定写入。现在预制体保存入口要求 `cc.Prefab._name` 和根 `cc.Node._name` 均等于目标文件名；`create_prefab_from_node` 默认采用文件名，显式传入不一致的名称会在写入前报错。确需改名时应使用资产重命名流程，而不是修改序列化内容的这两个字段。

保存器不再把原生返回或 `query-asset-info.imported: true` 当作本次写盘证明：它检查完整 JSON、资产 URL/类型/UUID/导入状态，并在首次匹配后等待 400 毫秒重新检查，已有资产的内容不一致时至多重试一次。故障注入覆盖“曾短暂匹配、随后恢复旧内容”，确认这种情况会报错。

另用 `ReopenProbe.prefab` 从含两张 SpriteFrame 子资源引用的测试预制体创建并立即覆盖 `_active=false`。磁盘与 `.meta`、导入 UUID `1e0a561c-eca9-4d5a-a977-a55aea1c1a3c` 均稳定；Creator `open_asset` 重开后，层级中根节点 `ReopenProbe` 为 `active:false`，两个子节点 `HammerIcon`、`HintIcon` 及各自 `Sprite` 组件仍在。`inspect_prefab` 检出两个 SpriteFrame 子资源 UUID 引用。随后切回原 `ComplexRefs.scene`，用 `asset-db:delete-asset` 删除探针，确认文件与 `.meta` 均不存在。

首轮三个临时探针 `PersistenceProbe.prefab`、`ScenePersistenceProbe.scene`、`ScenePersistenceProbe2.scene` 也已通过 `asset-db:delete-asset` 清理，文件和 `.meta` 均不存在。本轮的重开证明限于上述预制体根属性和层级；尚未验证并发写入、所有组件属性、`duplicate_prefab`、`edit_prefab_json` 等其他文件编辑入口，也不将本次结果扩展为 FR-05 全面完成。

静态检查与工具文档一致性检查通过；相关单元测试 38/38 通过。全量测试 268 项中 254 通过、10 个既有 Windows 路径/软链接/权限环境失败、4 跳过。运行中 Creator 的旧 `project.log` 属性读取与打开均报 `EPERM`；当前源码日志查询可列出该文件的 `readError`，同时继续返回可读的 `mcp-debug.log`。用户以管理员窗口尝试 `takeown` 和 `icacls /reset` 均被拒绝；关闭 Creator 后旧日志自动消失、MCP 端点停止，而 `mcp-debug.log` 仍在。重开 Creator 后新 `project.log` 重新生成，`icacls` 显示正常继承 ACL，普通进程和 Creator 进程均可打开，当前源码日志查询无 `readError`。未手动修改文件或目录权限；旧日志当时拒绝访问的具体原因仍未确认。

上述 268 项是本轮资产保存修改当时的全量基线；随后单独修复 Windows 测试环境假设，复测为 269 项中 267 通过、0 失败、2 项因文件符号链接权限跳过。详见[Windows 测试基线排查](./WINDOWS_TEST_BASELINE_2026-09-19.md)。
