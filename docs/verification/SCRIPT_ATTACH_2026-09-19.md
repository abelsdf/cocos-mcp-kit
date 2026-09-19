# 按脚本资产挂载组件验证（2026-09-19）

测试工程为 `D:\AI\Game\arrow-puzzle`，Cocos Creator 3.8.8；本地 MCP 工程身份 `758048aa923da9e57466f98a`，端口 `21482`。运行中的扩展仍为旧版；通过其 `execute_scene_script` 加载本工作区 `scene.js` 并调用 `attachScriptComponent`。工具注册和资产校验由本工作区测试覆盖，旧版扩展面板尚未暴露该工具。

| 步骤 | 结果 |
| --- | --- |
| 隔离样本 | asset-db 创建无游戏逻辑的 `McpKitAttachProbe.ts`，UUID `cbae3da4-cd12-41fc-aeae-61cf0e996d2f`，资源类型 `cc.Script`、已导入且有效；另创建并打开 `McpKitScriptAttachProbe.scene`，UUID `9a2cff30-71aa-47c4-a2de-33ddb3442458`。 |
| 挂载 | 在临时 `ScriptTarget` 节点上按脚本 UUID 找到注册类 `McpKitAttachProbe`，类 ID 为 `cbae32kzRJB/K6uYc8OmW0v`；`addComponent` 后组件属性 `marker=17`，节点仅有这一个组件。再次调用返回 `alreadyPresent:true`，没有重复添加。 |
| 持久化 | 执行 `scene:save-scene`，切至 `ComplexRefs.scene` 后重新打开探针。节点 UUID `a3tEMFGbZEjo2DH/fHAmlF`、组件类 ID、`marker=17` 以及组件数量均保持；磁盘场景 JSON 包含对应类 ID。 |
| 清理 | 切回 `ComplexRefs.scene`，通过 asset-db 先删除探针场景，再删除临时脚本；两项资产查询为空，`.scene`、`.ts` 及各自 `.meta` 均不存在。 |

工具先校验脚本资产类型及导入状态，再按压缩后的脚本 UUID 使用 Cocos 已注册类表定位组件；找不到类时最多等待 5 秒并提示检查编译诊断。官方 [Cocos `js` API](https://docs.cocos.com/creator/3.8/api/en/variable/js.js) 提供 `getClassById`，而 [Component API](https://docs.cocos.com/creator/3.8/api/en/class/Component) 说明 `Node.addComponent` 可挂载组件类。本轮只证明普通节点与该临时脚本；关联预制体层级由工具拒绝，其他自定义脚本仍需逐类验证。

本工作区最终 `node --test` 全量 298 项通过、0 失败、0 跳过；工具文档生成一致性检查通过。首次全量运行时，独立的 HTTP 端口回退测试遇到 Windows `listen EACCES`；该文件单独重跑 15/15 通过，随后全量重跑 298/298 通过，本轮未修改 HTTP 服务代码。
