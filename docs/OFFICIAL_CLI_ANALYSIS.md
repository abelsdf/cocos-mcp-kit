# Cocos 官方 CLI 能力对照与接入边界

版本：0.1　日期：2026-09-22　分析对象：`https://github.com/cocos/cocos-cli`

## 1. 结论

Cocos 官方 CLI 为本项目提供了新的公开实现依据，但不改变 Cocos MCP Kit 首版范围。当前策略是：

1. 立即把官方 CLI 纳入需求和计划依据，记录固定提交、许可证与能力矩阵。
2. 首版继续完成 JSON UI 构建、失败清理、模板、验证和截图闭环。
3. 首版前只提前吸收会影响底层架构的两项能力：节点批次序列化/恢复，以及后端能力探测。
4. 构建任务、资源导入设置、独立 Simulator、材质、动画资源和 3D 烘焙按优先级在首版后实现。

目录、源码或测试存在只证明有设计和实现候选，不证明 Cocos MCP Kit 已实现，也不证明该能力已在 Creator 3.8.8、目标平台或真实项目中通过验收。

## 2. 来源与许可证

- 官方仓库：`https://github.com/cocos/cocos-cli`
- 本地只读分析副本：工作区 `../cocos-cli-main`
- 本地分析版本：`0.0.1-alpha.43`
- 根 `LICENSE` 与 README 声明 MIT，并包含 `Copyright (c) 2025 SUD`。
- 当前 `package.json` 的 `license` 字段为 `ISC`，与根许可证不一致。直接引入源码前须固定上游提交并确认许可证处理；分发任何复制或改编的源码时保留适用的版权和许可证声明。

本项目不得把官方 CLI 的品牌、发布状态或源码存在描述成 Cocos MCP Kit 自身能力。未固定提交前，不以随时间变化的 `main` 分支作为可复现实现依据。

## 3. 接入策略

官方 CLI 与当前 Creator 编辑器扩展不是同一运行后端。首版不把两者强行合并，后续采用能力协商：

- `creator-extension`：当前 Cocos MCP Kit 扩展后端，继续承担已验证的 Creator 3.8.8 场景、组件、资源和预制体操作。
- `official-cli`：可选官方 CLI 后端，只有安装、版本、项目兼容和具体能力通过探测后才调用。
- `hybrid`：两个后端同时可用时，按工具能力、风险和验证状态选择，不自动把一个后端的成功当成另一个后端的成功。

能力报告至少包含后端 ID、版本、项目路径、Creator/引擎版本、平台、可用操作、只读/写入级别、实验状态及不支持原因。工具 schema 应保持稳定；后端差异放入结构化 capability 和 result 字段。

## 4. 能力差距与排期

| 能力 | 官方 CLI 公开路线 | Cocos MCP Kit 当前状态 | 决策 | 优先级 |
| --- | --- | --- | --- | --- |
| 节点批次序列化与恢复 | `scene-serialize-nodes`、`scene-create-nodes-by-serialized-data`，支持内部引用、Prefab、单次 Undo 和失败回滚 | 计划只有后期自有剪贴板；JSON 构建失败恢复尚未闭环 | 提前设计统一 DTO；先用于 P0 构建失败恢复，再扩展跨场景复制 | P0 架构 |
| 后端能力探测 | CLI 自身 MCP 工具、资源和版本元数据 | 当前主要假定 Creator 扩展后端 | 增加 capability manifest；不在 P0 实际依赖 CLI | P0 架构 |
| 构建生命周期 | build、make、run、upload、publish 及默认配置/模板 | 有 Creator 构建/预览候选入口和截图计划，缺少统一任务生命周期 | 首版后实现 build/status/log/cancel/artifact；upload/publish 最后开放 | P1 |
| 资源导入设置 | importer property schema、userData、reimport、copy/move/rename | 已有查询、依赖和部分资产保存，缺少类型化导入设置 | 先做 schema 查询与有界 patch，再按资源类型验收 | P1 |
| 独立 Simulator | 构建、资源准备、会话、PID、日志、停止/重启、分辨率和方向 | 可驱动 Creator simulator 窗口，但无独立会话模型 | 作为 Creator 预览之外的独立运行来源 | P1 |
| 原生参考图片 | 图库、场景绑定、2D 可见性、位置、缩放、透明度与刷新 | FR-18 原计划优先自有参考面板 | 先验证目标环境原生路线；不可用时保留自有面板降级 | P1 |
| 材质与 Effect | Effect/Material 查询与保存，按 dump/schema 修改 | 尚无专门计划 | 新增高级资产子阶段，首批仅允许白名单字段 | P2 |
| AnimationMask | 查询、导入骨骼、批量启停、保存 | FR-14 未覆盖 | 纳入动画阶段，但不阻塞基础 AnimationClip | P2 |
| AnimationGraphVariant | 查询、修改 clip override、保存 | FR-14 未覆盖 | 纳入动画阶段独立子项 | P2 |
| 粒子预览 | 查询状态/数量/速度，播放、暂停、停止、重启 | 无专门计划 | 与真实预览、日志和截图一起验收 | P2 |
| PolygonCollider2D 轮廓 | 从 Sprite alpha 或 UITransform 生成点并记录 Undo | 无专门计划 | 纳入 2D 生产增强，限制点数并支持恢复 | P2 |
| LODGroup | 包围盒重算、层级增删、相对高度查询 | 无专门计划 | 进入 3D 专项，不影响 2D 首版 | P2 |
| Lightmap/Light Probe/Reflection Probe | 长任务启动、查询、取消、清理和生成资产 | 无专门计划 | 新增 3D 生产阶段；要求任务身份、进度、取消、资产与场景验证 | P2/P3 |
| MCP 按类型资源模板 | `cocos://assets/{ccType}` | 已有项目、场景、节点和资产模板，但没有按类型资源模板 | 可低风险补充；结果有界、分页并排除 internal 资产 | P1 |

## 5. 首版范围冻结

首版 P0 仍以 `REQUIREMENTS.md` 的八项验收场景为准。官方 CLI 新能力不得隐式扩大首版承诺。

首版前允许新增的工作只有：

- 设计并验证节点批次 DTO、内部引用策略、失败回滚和单次 Undo 边界；若目标 Creator 适配不可靠，P0 仍退回只清理本次新建节点。
- 增加只读后端能力探测和版本报告；不得因官方 CLI 不可用阻塞当前扩展后端。
- 在文档、测试夹具和接口设计中预留构建任务与独立 Simulator 的结构，不实现 upload/publish 等外部副作用。

其余能力进入首版后的增强阶段。不得以“官方 CLI 已有”为理由跳过 Cocos MCP Kit 自身的参数校验、项目路径边界、保存重开、引用检查、运行验证和失败清理。

## 6. 验收规则

每项官方 CLI 衍生能力须分别记录：

1. 固定的上游仓库地址、提交 SHA、版本和许可证文件。
2. 采用方式：直接依赖、适配公开接口、复制/改编 MIT 源码，或仅参考行为。
3. Cocos MCP Kit 的独立工具 schema、输入限制和风险级别。
4. 单元/故障注入结果，以及目标 Creator/CLI 环境中的实际运行结果。
5. 写操作后的资产数据库状态、磁盘内容、meta/UUID、场景内存、保存重开和引用持久化。
6. 预览、模拟器、构建产物等不同运行来源，不能互相替代验证证据。
7. upload、publish、删除生成资产等外部或破坏性操作必须显式授权，并过滤凭据和敏感日志。

只有上述证据完整时，才能把能力从“候选”调整为“已实现并已验收”。
