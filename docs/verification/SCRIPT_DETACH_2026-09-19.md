# 按脚本资产移除组件验证（2026-09-19）

测试工程为 `D:\AI\Game\arrow-puzzle`，Cocos Creator 3.8.8；本地 MCP 端口 `21482`。运行中的扩展仍为旧版；本轮通过其 `execute_scene_script` 加载本工作区 `scene.js` 并调用 `detachScriptComponent`。新工具的注册及 asset-db 资产校验由本工作区测试覆盖，旧版扩展面板尚未暴露该工具。

| 步骤 | 结果 |
| --- | --- |
| 隔离样本 | asset-db 创建 `McpKitDetachProbe.ts`（UUID `8a281e01-5812-445e-9581-2839aacf7461`）及 `McpKitScriptDetachProbe.scene`（UUID `8779fbf0-f66b-49bf-a5bf-fe741333c378`）。脚本为已导入、有效的 `cc.Script`。 |
| 引用拦截 | 在 `ScriptTarget` 挂载脚本组件，并让 `ButtonNode` 的 Button 点击事件指向其 `onClick`。移除返回引用位置 `ButtonNode:Button.clickEvents[0]`，组件仍在节点上。 |
| 删除与幂等 | 清空事件后按脚本 UUID 移除。Creator 在调用后短暂保留组件，下一帧才将其从节点列表删除；工具等待约 50 ms 后返回 `removed:true`。重复调用返回 `removed:false, notPresent:true`。 |
| 持久化 | 保存场景，切至 `ComplexRefs.scene` 再重开探针；`ScriptTarget` 的组件列表和 Button 点击事件均为空，节点 UUID 未变。磁盘 `.scene` 文件不含脚本类 ID `8a2814BWBJEXpWBKDmqz3Rh`。 |
| 清理 | 切回 `ComplexRefs.scene` 后通过 asset-db 删除临时场景和脚本；两项资源及各自 `.meta` 均不存在。 |

实现按脚本 UUID 从 Cocos 类表解析准确的 Component 类，再按实例构造函数匹配目标节点。删除前扫描活动场景内其他组件的属性及 Button 点击事件；脚本不在节点上时不改动场景。官方 [Node API](https://docs.cocos.com/creator/3.8/api/en/class/Node) 说明 `removeComponent` 可按实例移除组件，同时将此 API 标为弃用、推荐 `component.destroy()`；当前项目已有该移除路径，本轮在 Creator 3.8.8 验证了延迟销毁并等待组件实际消失。跨场景、预制体资源以及动态运行时引用尚未检查，关联预制体层级由工具拒绝。
