# OP-042 节点批量修改验证（2026-09-19）

工程：`D:\AI\Game\arrow-puzzle`，Cocos Creator 3.8.8，扩展服务 `http://127.0.0.1:21482/`。测试在隔离的 `__McpBatchModifyProbe_20260919.scene` 进行，不修改原有 `ComplexRefs.scene`。当前安装扩展尚未包含这次新增的工具注册表，因此通过已有 `execute_scene_script` 在场景进程加载工作树 `scene.js` 的 `batchModifyNodes` 方法；正式 MCP 工具暴露需待扩展同步后另验。

## 运行结果

1. 创建 `BatchA` 和 `BatchB`。`onError: continue` 的三步依次为：修改 `BatchA` 的位置 `(12,-5,0)`、缩放 `(0,2,1)`、激活状态 `false`；对不存在的 UUID 修改；修改 `BatchB` 的位置 `(-7,4,0)`、欧拉旋转 `(0,0,90)`。结果 `attempted:3`、`succeeded:2`、`failed:1`，最后一步实际执行。零缩放未被误写为 1，`BatchB` 的四元数 z/w 均约为 `0.70710678`。
2. `onError: stop` 的三步依次为：将 `BatchA` 设为激活、访问不存在的 UUID、将 `BatchB` 设为未激活。结果 `attempted:2`、`succeeded:1`、`failed:1`、`stoppedAtIndex:1`；第三步未执行，`BatchB` 保持激活。前序成功步骤未被误称为全局回滚。
3. 再将 `BatchA` 设为未激活，保存场景、切到 `ComplexRefs.scene`、重新打开探针。重开后的场景内存与磁盘 JSON 一致：`BatchA` 为 `active:false`、位置 `(12,-5,0)`、缩放 `(0,2,1)`；`BatchB` 为 `active:true`、位置 `(-7,4,0)`、绕 Z 轴 90 度旋转。
4. 切回 `ComplexRefs.scene`，通过 asset-db 删除探针场景；场景文件及 `.meta` 均不存在。

本地故障注入测试覆盖不完整向量、重名、场景根、关联预制体、未知字段、单步 setter 失败后的原值恢复、恢复再次失败的显式报告，以及两种遇错策略。失败项的 `rollbackStatus` 分别为 `not-needed`、`restored` 或 `failed`。回滚只针对失败步骤中已改变的节点字段；组件生命周期副作用、此前成功的步骤和跨资源写入不在恢复范围内。
