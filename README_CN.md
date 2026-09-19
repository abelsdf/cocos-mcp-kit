# Cocos MCP Kit

[English](./README.md) | **简体中文**

Cocos MCP Kit 是基于 [Funplay MCP for Cocos 0.6.3](https://github.com/FunplayAI/funplay-cocos-mcp) 开发的开源 Cocos Creator 编辑器扩展。它在编辑器中提供本地 MCP 服务，使兼容的开发助手能够查询并操作 Cocos 工程。

本分支已采用独立的扩展与包标识。当前代码以 Funplay 工具为底座；[需求文档](./docs/REQUIREMENTS.md)和[开发计划](./docs/PLAN.md)记录新增能力的实施状态。场景与资源的实际效果还需在独立测试工程中验证。

## 本地安装

1. 将本仓库复制到 Cocos Creator 工程的 `extensions/cocos-mcp-kit` 目录。
2. 用 Cocos Creator 3.8.x 打开或重启该工程。
3. 打开 **Cocos MCP Kit > MCP 服务**，按面板显示的地址配置 MCP 客户端。

面板还提供工具开放范围和客户端配置。需要本地 stdio 桥接时，运行 `node bin/cocos-mcp-kit.js --url <面板中的地址>`。工程配置文件名为 `cocos-mcp-kit.config.json`。本分支尚未配置自动发布更新和注册表发布渠道，目前请使用本地安装。

## 开发与验证

- `npm run check`：检查 JavaScript 语法。
- `npm test`：运行现有测试。
- [工具清单](./docs/TOOLS.md)：当前继承的工具接口。
- [开发计划](./docs/PLAN.md)：新增能力与验收状态。

节点查询遇到重名或重路径时会拒绝任选一个节点，并返回候选 UUID。同时提供多个定位条件时，它们必须指向同一节点；失效的 UUID 不会静默回退到名称。`get_scene_info` 与 `get_hierarchy` 默认最多返回 200 个节点并报告截断情况；`find_nodes` 同时报告匹配总数和实际返回数。

`detect_node_type` 根据节点上实际挂载的 Cocos 组件识别 `camera`（相机）、`ui`（具备 UI 组件）或 `plain`（普通节点）。相机与 UI 组件共存时返回 `ambiguous`，列出两个候选及命中的组件。节点名称不作为类型依据；若自定义 UI 组件未搭配可识别的内置 UI 组件，可能被归为 `plain`。

`batch_modify_nodes` 可按顺序修改 1—50 个普通场景节点的局部位置、缩放、欧拉旋转或激活状态。每项须用 UUID、路径或唯一名称定位，并给出至少一个完整字段；`onError` 可选 `"stop"`（默认）或 `"continue"`。返回值列出已尝试步骤、失败项及停止位置；失败项的 `rollbackStatus` 区分无需恢复、已恢复与恢复失败。失败步骤会尝试恢复自身原值，但此前成功的步骤保持修改；保存场景后才会持久化。不直接修改关联预制体实例，也不处理任意组件属性。

`add_component` 接受已注册的 Cocos 组件类名，为普通场景节点添加组件，并报告 Creator 自动补齐的依赖组件。无效类型和关联预制体层级会被拒绝；组件是否允许重复由 Creator 判断。保存场景后才会持久化。

`remove_component` 按类名或从零开始的索引从普通场景节点精确移除一个组件。同类组件有多个时必须提供索引；同时提供类名和索引时两者须匹配。被其他组件依赖或引用的组件会被拒绝，调用后等待 Creator 确认移除。关联预制体层级暂不支持；保存场景后才会持久化。

`list_components` 有界返回当前场景中组件属性的运行值快照，同时标明 CCClass 的直接序列化元数据与字段来源。项目脚本默认只列出 CCClass 声明的字段；`includeRuntimeFields: true` 可额外查看未声明的实例字段，其中可能包含 TypeScript 私有状态，不能据此推断公开性或持久化。标为不直接序列化的属性也可能经底层字段持久化；需要核对持久化效果时，应保存并重开后检查资源。可用 `maxComponents` 和 `maxProperties` 控制输出；不会调用项目自定义的 getter。

`inspect_component` 通过 `componentName` 或从零开始的 `index` 精确选择一个组件；同类多实例须用索引消歧，同时提供两个条件时必须一致。它采用与 `list_components` 相同的字段筛选和有界摘要，默认返回最多 32 项，可用 `maxProperties` 提高到 80 项；项目脚本未声明字段也须显式设置 `includeRuntimeFields: true`。不再返回旧版内部对象的原始 `data` 展开。持久化引用仍须在保存并重开后复查。

在 `full` 工具配置中，`move_node` 可用 `uuid`、`path` 或唯一 `name` 定位普通场景节点，并用 `parentUuid`、`parentPath` 或唯一 `parentName` 指定新父节点。默认保持世界变换；设置 `keepWorldTransform: false` 则保持局部变换。`parentPath: "/"` 指向场景根节点。关联预制体层级需使用单独的编辑器工作流。

`reorder_node` 按可保存的同级节点从零开始的 `index` 调整普通场景节点顺序。用 `uuid`、`path` 或唯一 `name` 定位节点；可选的 `parentUuid`、`parentPath` 或 `parentName` 用于核对预期父节点。越界索引和关联预制体层级会被拒绝。保存场景后顺序才会持久化。

`duplicate_node` 在原节点旁复制普通场景节点及其子节点。副本默认使用唯一名称 `<原名> Copy`，节点获得新标识，并保留由 Cocos 克隆的组件数据和引用。关联预制体层级、包含编辑器辅助节点的子树会被拒绝；外部引用及其他组件类型应在目标工程中核对。保存场景后副本才会持久化。

`attach_script_component` 可将已导入的 TypeScript 或 JavaScript 脚本资产挂载到普通场景节点。用节点的 `uuid`、`path` 或唯一 `name` 定位，并通过 `scriptTarget` 提供脚本资产路径或 UUID。工具检查资源类型，按脚本 UUID 查找已注册的 Component 类，短暂等待编译完成，并避免重复挂载。保存场景后组件才会持久化。

`detach_script_component` 使用同一 `scriptTarget` 精确移除普通场景节点上的脚本组件。若活动场景内的其他组件属性或 Button 点击事件仍引用它，工具会拒绝移除；应先清除引用。移除后保存场景。关联预制体实例和活动场景之外的引用需另行检查。

`reset_node_transform` 可将普通场景节点的局部位置重置为 `(0,0,0)`、旋转重置为单位四元数、缩放重置为 `(1,1,1)`；传入 `fields` 可只重置部分字段。节点的激活状态不变，关联预制体层级需使用单独的还原流程。`reset_component_property` 只清除字段，不会恢复 Cocos 类默认值。

`reset_component_property_to_default` 将单个公开、可写、可序列化的组件字段恢复为 CCClass 声明的默认值。用节点定位参数及组件类名或索引选择目标，再传入顶层字段名 `propertyName`。支持基本值、Cocos ValueType 和小型数组；未声明默认值、访问器及关联预制体实例会被拒绝。保存场景后生效持久化。旧的 `reset_component_property` 仍只执行字段清除。

`create_sprite` 新增 `spriteFrameTarget`，可传入已导入图片的路径（如 `assets/icons/arrow.png` 或 `db://assets/icons/arrow.png`）、ImageAsset 主 UUID 或 SpriteFrame 子 UUID。工具先解析并检查 SpriteFrame 子资源，再创建节点。原有 `spriteFrameUuid` 仍接受明确的 SpriteFrame 子 UUID；两个参数只能选一个。

修改已有 Sprite 的图片时，调用 `set_sprite_frame`，传入节点 `path`、`uuid` 或唯一 `name`，以及 `spriteFrameTarget`。工具返回修改前后的 SpriteFrame UUID；无效资源会在修改组件前报错。

解绑 Button 点击事件时，先调用 `list_button_click_events`；把目标事件返回的 `index` 作为 `eventIndex`，并将该事件对象作为 `expectedEvent` 传给 `unbind_button_click_event`。如果该位置的事件已变化，工具会拒绝删除。

对关联的预制体实例绑定或解绑 Button 点击事件时，工具会在场景中记录 `clickEvents` 实例覆盖，不修改预制体资源本体。保存并重开场景后，还需核对实例绑定及预览输入。

修改场景、预制体、脚本或资源引用后，须在真实 Creator 中保存并重新打开验证；MCP 返回成功不能单独证明修改已持久化。

## 致谢与许可

感谢 [Funplay MCP for Cocos](https://github.com/FunplayAI/funplay-cocos-mcp) 的作者与贡献者以 MIT 许可证开放底座代码。本项目在 [LICENSE](./LICENSE) 中保留 `Copyright (c) 2026 Funplay`、完整 MIT 条款及免责声明。本项目是独立分支，不代表 Funplay 官方版本；新增依赖和资源须分别核查许可。

开发约束与代码来源规则见 [CONTRIBUTING.md](./CONTRIBUTING.md)。
