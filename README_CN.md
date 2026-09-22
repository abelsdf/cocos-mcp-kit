# Cocos MCP Kit

[English](./README.md) | **简体中文**

Cocos MCP Kit 是运行在 Cocos Creator 内的开源 MCP 扩展，方便兼容的客户端查询工程、操作场景与资源，并在编辑器中核对结果。项目基于 [Funplay MCP for Cocos 0.6.3](https://github.com/FunplayAI/funplay-cocos-mcp)，使用独立的包名、扩展名和配置标识。

当前面向 Cocos Creator 3.8.x；下文引用的实际编辑器验收使用 **3.8.8**。工具已开放不代表所有工作流或 Creator 版本都通过验收。准确范围见[工具清单](./docs/TOOLS.md)、[开发计划](./docs/PLAN.md)和[需求文档](./docs/REQUIREMENTS.md)。

## 快速开始

1. 将本仓库内容复制到 `<Cocos 工程>/extensions/cocos-mcp-kit`，确保 `package.json` 和 `scene.js` 直接位于该目录下。
2. 用 Cocos Creator 3.8.x 打开工程；若已安装过扩展，请重启 Creator。
3. 打开 **Cocos MCP Kit > MCP 服务**，确认状态为 **运行中**，复制面板显示的地址。服务默认只监听本机 `127.0.0.1`；端口根据工程路径生成，请以面板地址为准。
4. 在面板中选择客户端并点击 **配置**，写入其 MCP 连接信息。**配置 + Skills** 还会安装可选的工程 Skills。如果客户端需要 stdio 而非直接连接 HTTP MCP 地址，可在 Cocos 工程根目录运行随附桥接程序：

   ```sh
   node extensions/cocos-mcp-kit/bin/cocos-mcp-kit.js --url http://127.0.0.1:PORT/
   ```

请将 `PORT` 换成面板显示的端口。桥接程序需要 Node.js 18 或更高版本。通过 **Cocos MCP Kit > 工具开放范围** 选择 `core`、`full` 或自定义工具集。默认是 `core`；`full` 包含场景编辑和 `list_available_component_types` 等组件工具。执行下文的编辑流程前，请切换到 `full`。[工具清单](./docs/TOOLS.md)标明每项工具所属配置和操作类型。工程设置保存在工程根目录的 `cocos-mcp-kit.config.json`。

## 当前能力

| 领域 | 已提供的能力 | 示例工具 |
|---|---|---|
| 工程与资源 | 查询编辑器、场景、资源元数据、引用、日志和脚本诊断。 | `get_project_info`、`get_scene_info`、`list_assets`、`validate_asset_dependencies` |
| 场景层级 | 创建与检查节点；移动、排序、复制、变换或批量修改普通场景节点。 | `find_nodes`、`move_node`、`reorder_node`、`batch_modify_nodes` |
| 组件与脚本 | 查询已注册类型；挂载、移除、列出、检查组件并修改支持的字段。 | `list_available_component_types`、`attach_script_component`、`list_components`、`set_component_property` |
| UI 与事件 | 创建 Canvas、Label、Button、Sprite；解析 SpriteFrame 并管理 Button 点击事件。 | `create_sprite`、`set_sprite_frame`、`list_button_click_events`、`bind_button_click_event` |
| 预制体 | 查询与创建预制体资源、检查引用，并在支持时通过编辑器消息处理关联实例。 | `create_prefab_from_node`、`inspect_prefab_instance`、`apply_prefab_instance` |
| 预览与证据 | 控制受支持的预览模式、获取编辑器或预览图像、检查运行和构建状态。 | `run_project_preview`、`capture_preview_screenshot`、`validate_scene` |

上表仅列举主要能力，完整接口见[工具清单](./docs/TOOLS.md)。部分工具来自 Funplay 底座；新增功能的 Creator 实测记录位于 [docs/verification](./docs/verification)。工具配置决定客户端可见范围，工具清单也区分只读、修改和有状态操作。

## 推荐操作流程

1. 先用 `get_scene_info`、`find_nodes` 或 `list_components` 检查目标。优先使用节点 UUID 或唯一层级路径；重名会报歧义，同时提供多个定位条件时必须指向同一节点。
2. 修改组件前，用 `list_available_component_types` 或 `inspect_component` 核对类型和字段。类型目录会标记缺失类和非组件类；`attachable` 只表示找到已注册的 Component 子类，不保证任意节点都能挂载。
3. 使用 `set_component_property`、`move_node` 或 `set_sprite_frame` 等工具做一次有界修改。以下参数将 Label 的顶层 `string` 字段设为文字；`valueJson` 是经过 JSON 编码的字符串：

   ```json
   {
     "uuid": "<节点 UUID>",
     "componentName": "cc.Label",
     "propertyPath": "string",
     "valueJson": "\"你好，Cocos\""
   }
   ```

4. 保存并在 Creator 中重新打开场景，再检查节点或资源。涉及画面或交互时，还要检查运行中的预览。仅有 MCP 成功返回不能证明持久化或视觉效果正确。

`set_component_property` 目前每次只接受一个受支持的顶层字段：CCClass 声明的项目脚本字段及少量 Cocos UI 字段。工具会转换兼容的 Color、向量、节点/组件和资源引用，但拒绝点路径、未声明的脚本状态、不兼容值与关联预制体实例。设置 SpriteFrame 可能使 UITransform 自动改变尺寸；如需自定义尺寸，可随后设置 `contentSize`。`reset_component_property_to_default` 恢复 CCClass 声明默认值；`reset_component_property` 只清除字段。

组件类型目录单次最多检查 256 个项目脚本和 32 个指定类名。脚本显示 `no-component-registration` 时，也可能只是正常的工具模块，不能直接认定为编译失败。`list_components` 默认只展示项目脚本的 CCClass 声明字段；设置 `includeRuntimeFields: true` 可额外查看运行字段，但不能据此断定它们公开或持久化。

关联预制体实例的修改规则因工具而异。普通节点移动、复制、组件增删及属性赋值会拒绝关联预制体层级；预制体实例应用/还原和 Button 点击事件覆盖使用单独的编辑器流程。依赖持久化结果前，请核对相应[工具说明](./docs/TOOLS.md)和[验收记录](./docs/verification)。

使用 `bind_button_click_event` 时，目标节点必须恰好有一个匹配组件，处理方法须由该组件提供，不能是引擎生命周期方法。`customEventData` 是最长 1024 字符的原样字符串。绑定或解绑前先列出已有事件；重复绑定会报告重复，不会再增加一条。`batch_bind_button_click_events` 一次按顺序处理最多 50 条绑定，可选择遇错停止或继续并逐项返回结果；后续失败不会整体撤销先前成功项。

`list_prefabs` 按稳定顺序分页列出预制体资源（默认每页 50 项，最多 100 项）。设置 `includeMetadata` 可查询精简的 `.meta` 状态，设置 `includeSceneInstances` 可关联当前场景中的实例根节点；若场景扫描被截断，实例数量只是部分结果。

`inspect_prefab` 会报告资源与元信息身份、序列化根节点/节点/组件概况，以及带明确截断标记的 UUID 类引用。设置 `includeSceneInstances` 可查询当前场景中的匹配实例根；序列化文件里出现预制体引用，不等于嵌套实例仍保持链接。

`validate_prefab_references` 会检查超出详情展示上限的显式序列化资源引用、组件条目链接和声明的嵌套预制体资源，并分别报告扫描未完成及资源库查询错误；它不能证明运行时动态加载的资源或自定义组件类已注册。

`create_prefab_from_node` 会克隆普通场景层级，拒绝关联的嵌套实例和编辑器专用节点；写入 asset-db 前检查单一连通节点树、组件归属、PrefabInfo 元信息和显式资源引用，随后回查导入 UUID、元信息、根名称及节点/组件数量。源场景层级不会被修改。

`create_prefab_instance` 与 `instantiate_prefab` 现在使用同一原生编辑器流程：只创建一次，核对实例根、资源与实例身份，再赋值并校验父节点本地 `position`。可用 `parentUuid` 精确指定父节点；同时提供 `parentPath` 时二者必须一致。省略名称/位置时使用预制体根节点默认值。活动场景须已保存并导入；调用后仍需显式 `save_current_scene`，`needsSave: true` 不代表已持久化。

UI 预制体要求父节点已有 Canvas 祖先；关联父层级、Canvas 根、启用的根 Widget 或父 Layout 暂不支持，避免不受支持的嵌套和自动布局覆盖。原生创建结果不明时不会回退到运行态重复创建；验证失败只尝试清理能确认属于本次创建范围的节点，结果不明须先检查层级再重试。详见 [Creator 3.8.8 实例化验收与限制](./docs/verification/PREFAB_INSTANTIATE_2026-09-22.md)。

`unlink_prefab_instance` 通过原生编辑器消息解除已保存场景中明确选中的独立实例根关联，核对节点/组件身份、层级、变换和关联元信息清除，不修改源预制体；调用后须显式保存场景。关联祖先与含嵌套预制体的子树被拒绝：Creator 3.8.8 对照实验中，解除外层关联并保存后，有效的跨实例组件引用会丢失。`verified: true` 仅表示结构校验通过，不是全部组件属性审计；结果不明时不自动重试或重新关联。详见[解除关联验收与限制](./docs/verification/PREFAB_UNLINK_2026-09-22.md)。

`apply_prefab_instance` 会立即将属性修改写回源预制体并影响同源实例；丢弃场景不会撤销这次资源写入。要求明确选择已保存场景中的非嵌套实例根，节点/组件结构不变，且没有指向实例外部场景节点/组件的引用。工具比对原生序列化预览与导入后的源文件，再核对实例身份；之后仍须显式保存场景。原生 `result` 即使写入成功也可能为 `false`，不能将它当作最终状态。结果不明不自动重试或回滚。详见[应用实例修改验收与限制](./docs/verification/PREFAB_APPLY_2026-09-22.md)。

`revert_prefab_instance` 通过一次原生 `restore-prefab` 丢弃已保存场景中明确选中的非嵌套实例属性覆盖。根名称、位置和旋转保留，缩放、其他节点属性及组件数据还原为源值；两次核对序列化数据、运行身份和源文件/元信息未变，之后仍须显式保存场景。拒绝结构变更、指向实例外部场景节点/组件的引用及不可核验序列化。结果不明不自动重试或回滚。详见[还原实例修改验收与限制](./docs/verification/PREFAB_REVERT_2026-09-22.md)。

`enter_prefab_edit_mode`（`full` 配置）从单个干净且已保存的场景进入明确指定的非嵌套工程预制体原生编辑模式。即使脏标记为 false，也会比较实时序列化与磁盘；核验实际编辑模式、预制体根身份和源资源/原场景文件未变，并返回供受保护保存使用的 `sourceHash`。同一干净预制体重复调用只核验、不重载；拒绝脏状态、多场景及正在编辑其他预制体，不自动保存、丢弃或退出。通用 `open_asset` 不具备这些专项保护。详见[进入编辑模式验收与限制](./docs/verification/PREFAB_EDIT_ENTER_2026-09-22.md)。

`save_prefab_edit_mode`（`full` 配置）使用明确的当前 `prefabUuid`，并将进入/上次核验保存返回的 `sourceHash` 作为 `expectedSourceHash` 传入，保存非嵌套预制体的纯属性修改。拒绝源文件冲突、结构变更、向外场景引用及未保存的原场景。保存会立即写回资源并影响同源实例，丢弃场景不能撤销资源写入；即使 dirty 为 false 也比较内容，并有界等待目标资源重新导入，两次核对源文件、编辑现场与原场景。后续保存须使用新返回的哈希；干净且内容不变的重复调用不请求原生保存。冲突或结果不明时先检查并协调修改，不应直接换哈希重试。不会自动退出、重试写入、回滚或保存原场景，`needsSave: false` 仅指预制体。专项退出仍待 OP-062；通用 `save_current_scene` 不具备这些专项保护。详见[保存编辑验收与限制](./docs/verification/PREFAB_EDIT_SAVE_2026-09-22.md)。

`delete_asset` 只接受精确 UUID、db URL 或文件路径，不猜测扩展名。删除工程内 `.prefab` 前核对身份、导入状态、源文件/元信息路径，并通过原生接口检查资源/脚本及当前场景引用；被引用或正在编辑的预制体会被拒绝，不提供强制/级联选项。只向 asset-db 请求一次删除，数据库映射与源文件/`.meta` 均消失才报告成功。回查失败时删除可能已经发生，应先检查现场再重试。这些预制体专项保护不覆盖目录删除、运行时字符串加载或原生查询之外的引用；恢复依赖工程自身备份/版本控制。详见 [Creator 3.8.8 验收](./docs/verification/PREFAB_DELETE_2026-09-22.md)。

## 开发与文档

运行 `npm run check` 检查 JavaScript 语法，`npm test` 运行现有测试，`npm run docs:check` 核对生成的工具清单。[开发计划](./docs/PLAN.md)区分已实现工具与仍在推进的整体需求；[验收记录](./docs/verification)列出 Creator 实测范围。本分支尚未配置发布更新渠道或包注册表发布，目前采用本地安装。

## 致谢与许可

感谢 [Funplay MCP for Cocos](https://github.com/FunplayAI/funplay-cocos-mcp) 的作者和贡献者以 MIT 许可证开放底座代码。[LICENSE](./LICENSE) 保留了 `Copyright (c) 2026 Funplay`、完整 MIT 条款及免责声明。Cocos MCP Kit 是独立分支，并非 Funplay 官方版本。贡献及代码来源约束见 [CONTRIBUTING.md](./CONTRIBUTING.md)。
