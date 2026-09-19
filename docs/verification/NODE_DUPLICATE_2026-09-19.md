# 普通场景节点复制验证（2026-09-19）

测试工程为 `D:\AI\Game\arrow-puzzle`，Cocos Creator 3.8.8；本地 MCP 工程身份 `758048aa923da9e57466f98a`，端口 `21482`。运行中的扩展尚未安装本轮源码；通过其 `execute_scene_script` 加载当前工作区的 `scene.js` 并调用 `duplicateNode`。工具注册由本工作区测试覆盖，旧版扩展面板尚未暴露该工具。

| 步骤 | 结果 |
| --- | --- |
| 隔离样本 | 通过 asset-db 创建并打开 `McpKitDuplicateProbe.scene`，资产 UUID `7165eb80-0988-477f-a149-8f3ce0f6f97a`。普通节点 `CloneSource` 下有 `InternalTarget`、`ButtonNode`；Button 的两个点击事件目标分别指向内部节点和场景根下的 `OutsideTarget`。 |
| 复制 | 第一次副本名为 `CloneSource Copy`，第二次为 `CloneSource Copy 2`，两者均紧邻源节点插入；每棵子树有 3 个节点，根与子节点 UUID 均不同于源节点及其他副本，根节点位置 x=40 保持。 |
| 引用 | 两个副本的 Button 内部事件目标均指向**各自副本**的 `InternalTarget`；外部事件目标均继续指向原 `OutsideTarget`。 |
| 持久化 | 执行 `scene:save-scene`，切到 `ComplexRefs.scene` 再重开探针。上述层级、3 组不同 UUID、内部与外部事件目标及根节点位置均保持；场景文件及 `.meta` 均已写入。 |
| 清理 | 切回 `ComplexRefs.scene`，通过 `asset-db:delete-asset` 删除探针；资产查询为空，`.scene` 与 `.meta` 均不存在。 |

本轮覆盖普通节点子树和 `cc.Button.clickEvents` 的节点目标引用。Cocos [创建和销毁节点文档](https://docs.cocos.com/creator/3.8/manual/zh/scripting/create-destroy.html)说明可用 `instantiate` 克隆已有场景节点；[层级管理器文档](https://docs.cocos.com/creator/3.8/manual/zh/editor/hierarchy/index.html)将原节点同级复制列为编辑器操作。其他组件、资产引用和复杂外部引用未逐类验收；关联预制体层级及含编辑器辅助节点的子树由工具主动拒绝。

本工作区 `node --test` 全量 295 项通过、0 失败、0 跳过；工具文档生成一致性检查通过。
