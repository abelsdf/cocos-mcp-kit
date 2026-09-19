# 普通场景节点排序验证（2026-09-19）

测试工程为 `D:\AI\Game\arrow-puzzle`，Cocos Creator 3.8.8；本地 MCP 工程身份 `758048aa923da9e57466f98a`，端口 `21482`。运行中的扩展仍为旧版；通过其 `execute_scene_script` 在场景进程加载当前工作区的 `scene.js` 并调用 `reorderNode`。工具注册由本工作区测试覆盖，旧扩展面板尚未暴露新工具。

| 步骤 | 结果 |
| --- | --- |
| 隔离样本 | `asset-db:create-asset` 创建并打开 `McpKitReorderProbe.scene`，UUID `f631e923-a144-41fd-b7d9-6f92f29a255e`。场景根原有两个标记 `DontSave` 的编辑器辅助节点；新增普通节点 `OrderA`、`OrderB`、`OrderC`。 |
| 排序 | 将 C 从可保存节点索引 2 移到 0，得到 C/A/B；再移到 2，恢复 A/B/C；最后将 B 从 1 移到 0，得到 B/A/C。每次都检查返回顺序与实际父节点的子节点顺序。 |
| 错误输入 | 指定错误的预期父节点和越界索引 3 均被拒绝，顺序保持 A/B/C。单元测试另覆盖重名定位、非法索引、场景根节点、关联预制体层级、幂等调用及辅助节点夹在普通节点之间的情况。 |
| 持久化 | 执行 `scene:save-scene`，切至 `ComplexRefs.scene` 后重新打开探针。运行中的场景顺序和磁盘 `.scene` 的 `_children` 顺序均为 `OrderB`、`OrderA`、`OrderC`；三个普通节点 UUID 均保留。 |
| 清理 | 切回 `ComplexRefs.scene`，通过 `asset-db:delete-asset` 删除探针；资产查询为空，`.scene` 与 `.meta` 均不存在。 |

本轮证明普通场景节点的同级顺序可在 Creator 3.8.8 编辑态保存并重开。官方[渲染排序说明](https://docs.cocos.com/creator/3.8/manual/zh/ui-system/components/engine/priority.html)也指出，在**运行时**脚本修改的节点顺序不会序列化；本工具针对编辑态场景，调用后仍须保存。关联预制体实例排序未验收，工具主动拒绝。

本工作区 `node --test` 全量 292 项通过、0 失败、0 跳过；工具文档生成一致性检查通过。
