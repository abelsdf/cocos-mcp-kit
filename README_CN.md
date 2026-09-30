# Cocos MCP Kit

[English](./README.md) | **简体中文**

Cocos MCP Kit 是运行在 Cocos Creator 内的开源 MCP 扩展，方便兼容的客户端查询工程、操作场景与资源，并在编辑器中核对结果。项目基于 [Funplay MCP for Cocos 0.6.3](https://github.com/FunplayAI/funplay-cocos-mcp)，使用独立的包名、扩展名和配置标识。

当前面向 Cocos Creator 3.8.x；下文引用的实际编辑器验收使用 **3.8.8**。工具已开放不代表所有工作流或 Creator 版本都通过验收。准确范围见[工具清单](./docs/TOOLS.md)、[开发计划](https://github.com/abelsdf/cocos-mcp-kit/blob/main/docs/PLAN.md)、[需求文档](https://github.com/abelsdf/cocos-mcp-kit/blob/main/docs/REQUIREMENTS.md)和[官方 Cocos CLI 能力对照](https://github.com/abelsdf/cocos-mcp-kit/blob/main/docs/OFFICIAL_CLI_ANALYSIS.md)。

## 快速开始

### 安装前确认

- 本仓库是 Creator 扩展，不是游戏工程。需要已有的 Cocos 工程；建议先使用可丢弃的测试工程，编辑前备份场景和资源。
- 现有编辑器验收环境为 **Windows / Creator 3.8.8**，其他 3.8.x 版本和操作系统需要另行验证。本地 stdio 桥接需要 **Node.js 18+**；没有需要额外安装的 npm 运行依赖。
- **0.1.0 以 GitHub 预发布版（Pre-release）分发**，不是稳定正式版。请从[本项目 Release](https://github.com/abelsdf/cocos-mcp-kit/releases/tag/v0.1.0)下载 `CocosMcpKit.v0.1.0.zip` 和 `SHA256SUMS.txt`，核对校验和后安装。手动安装证据限于 Windows / Creator 3.8.8，扩展管理器安装仍未验收。npm/Registry 发布及默认自动更新保持关闭；不要用上游安装器或 `npx` 下载包代替。

### 安装到一个工程

1. 准备 `<Cocos 工程>/extensions/cocos-mcp-kit`。从干净源码副本复制 `package.json`、`browser.js`、`scene.js`、`bin/`、`lib/`、`panel/`、`i18n/`，以及 `package.json.files` 明确列出的文档（包括 `LICENSE`）。不要复制整个工作目录，不带入 `.git`、`AGENTS.md`、本地配置、缓存、测试和测试工程。使用本地 ZIP 候选时取解压后的 `cocos-mcp-kit` 目录；使用 npm TGZ 候选时，将解压后的 `package` 内容放入同一扩展目录。这里说明的是手动文件布局，不表示 Creator 扩展管理器安装已获验收。
2. 确认 `package.json`、`browser.js`、`scene.js` 和 `LICENSE` 直接位于 `extensions/cocos-mcp-kit`，没有额外嵌套一层 `package/` 或 `cocos-mcp-kit/`。替换旧安装前，先保存工作、关闭目标 Creator 工程，将旧扩展备份到 `extensions/` 之外，避免新旧文件混合，再打开工程。同一工程不要同时加载本扩展的工程级和全局副本。
3. 打开 **Cocos MCP Kit > MCP 服务**，确认状态为 **运行中**，复制面板显示的地址。服务默认只监听本机 `127.0.0.1`；端口根据工程路径生成，请以面板地址为准。
4. 在面板中选择客户端并点击 **配置**，写入其 MCP 连接信息。**配置 + Skills** 还会安装可选的工程 Skills。如果客户端需要 stdio 而非直接连接 HTTP MCP 地址，可在 Cocos 工程根目录运行随附桥接程序：

   ```sh
   node extensions/cocos-mcp-kit/bin/cocos-mcp-kit.js --url http://127.0.0.1:PORT/
   ```

请将 `PORT` 换成面板显示的端口。桥接程序需要 Node.js 18 或更高版本。通过 **Cocos MCP Kit > 工具开放范围** 选择 `core`、`full` 或自定义工具集。默认是 `core`；`full` 包含场景编辑和 `list_available_component_types` 等组件工具。执行下文的编辑流程前，请切换到 `full`。[工具清单](./docs/TOOLS.md)标明每项工具所属配置和操作类型。工程设置保存在工程根目录的 `cocos-mcp-kit.config.json`。

### 确认连接正确

写入配置或切换工具配置后，重新连接 MCP 客户端。任何修改前，先调用 `get_project_info`，核对返回的工程路径、名称和 Creator 版本是否属于目标工程。`get_tool_catalog` 用于检查工具开放状态；当前默认目录为 **core 43 / full 144** 项，自定义过滤会改变实际可见数量。进程启动或健康检查成功，不代表客户端已经连接到正确场景。

手动配置 stdio 客户端时，命令填 `node`，参数包含 `bin/cocos-mcp-kit.js` 的**绝对路径**、`--url` 和面板地址。上面的相对路径命令仅适用于工作目录为 Cocos 工程根目录的情况。桥接程序不会启动 Creator，也不会自动发现工程端口；省略地址会退回 8765，可能连错服务。`node extensions/cocos-mcp-kit/bin/cocos-mcp-kit.js --help` 只检查命令是否可用，不验证 MCP 连接。桥接进程等待客户端输入时没有持续输出是正常现象。

项目独立端口和客户端条目名均与工程路径有关。移动/复制工程或更改服务地址后，应重新配置该工程的客户端条目并核对身份。旧配置没有 `portMode` 时可能保留固定端口；出现临时备用端口提示时，先解决端口状态，再写入客户端配置。配置冲突应先检查，不要删除其他工程的条目来绕过。**配置 + Skills** 会写入可选的工程文件；普通**配置**不安装 Skills。详见[工程工作流](./docs/PROJECT_WORKFLOWS.md)。

保持服务仅供本机可信客户端使用。**`core` 不是只读配置**，其中也有有状态和脚本执行工具；工具过滤与 JavaScript 安全检查不是操作系统沙箱或授权隔离，不要将编辑器服务暴露到不可信网络。

## 当前能力

`full` 配置新增 `verify_ui`：有界等待、编辑态结构检查、按需返回严格定位的 Scene/Game View PNG 与独立元数据。preview 模式明确结构“未检查”，截图成功不等于视觉通过；目标缺失或歧义时报错，不回退到其他窗口，Game View 仅截可见区域时标记裁剪。详见[流程与截图边界](./docs/UI_VERIFICATION.md)。

`full` 配置新增只读 `validate_ui`，检查明确 UI 节点的 UITransform、设计范围越界、Sprite/Label 资源及序列化 Button 事件，支持按规则或节点排除。数据不可用或结果截断时明确报告未完成；不自动修复、保存、触发回调或证明视觉正确，Widget/Animation 共存只提示潜在冲突。详见[规则契约](./docs/UI_VALIDATION.md)与 [Creator 3.8.8 验证](https://github.com/abelsdf/cocos-mcp-kit/blob/main/docs/verification/UI_VALIDATION_2026-09-28.md)。

| 领域 | 已提供的能力 | 示例工具 |
|---|---|---|
| 后端能力报告 | 只读查询当前 Creator 扩展、工程与平台、工具开放状态及风险提示。可选官方 CLI 适配器明确标为未配置；工具开放不代表运行验收通过。 | `get_backend_capabilities`、`get_tool_catalog` |
| 节点批次 | DTO 只读预检，以及 full 配置下受限创建、引用核对和失败清理。Creator 3.8.8 成功批次记录一次父节点范围的 Undo，其他版本不承诺；不自动保存或执行撤销/重做，见[写入契约](./docs/NODE_BATCH_DTO.md)。 | `validate_node_batch`, `create_node_batch` |
| JSON UI 构建 | 在明确 Canvas/UI 父节点下构建含脚本及有序按钮事件的 UI；`create_scene(mode="ui")` 提供独立 Canvas/Camera 场景入口与切换保护，不自动保存或丢弃未保存内容。节点清理/Undo 不回滚场景资产及脚本外部副作用，不承诺画面可见，见[格式与示例](./docs/UI_BUILDER.md)。 | `build_ui`、`create_scene`、`open_scene` |
| 游戏 UI 模板 | 只读生成暂停/设置/结果界面的可编辑 JSON，支持文案、尺寸、颜色和工程脚本事件参数，交由 `build_ui` 构建。未绑定按钮初始为禁用、灰底浅灰文字，不附带素材、游戏逻辑或自动保存，见[模板契约](./docs/UI_TEMPLATES.md)。 | `get_ui_template` |
| UI 视口上下文 | 只读返回项目设计分辨率、最近 Canvas/关联相机、局部/世界/Canvas 边界及正交相机编辑态像素裁剪。构建与常用修改自动附加报告，无法计算时明确降级；不代表 Scene 观察窗口、Game View 或设备可见性，见[范围与坐标](./docs/UI_VIEWPORT.md)。 | `get_ui_viewport` |
| 工程与资源 | 读取当前工程的公开名称、UUID、路径及 Creator 版本；查询场景、精确资源元数据/数据、资源 UUID、规范 URL、真实源路径及 asset-db 就绪状态；安全创建或保存 JSON/文本资源、导入有界的外部文件或目录、复制、移动、刷新或重导入受支持资源，并检查引用、日志和脚本诊断。 | `get_project_info`、`inspect_asset`、`query_asset_uuid`、`query_asset_url`、`query_asset_path`、`check_asset_ready`、`create_asset`、`save_asset`、`import_asset`、`import_folder`、`copy_asset`、`move_asset`、`refresh_asset`、`reimport_asset`、`list_assets` |
| 场景层级 | 创建与检查节点；移动、排序、复制、变换或批量修改普通场景节点。 | `find_nodes`、`move_node`、`reorder_node`、`batch_modify_nodes` |
| 组件与脚本 | 查询已注册类型；挂载、移除、列出、检查组件并修改支持的字段。 | `list_available_component_types`、`attach_script_component`、`list_components`、`set_component_property` |
| UI 与事件 | 创建 Canvas、Label、Button、Sprite；解析 SpriteFrame 并管理 Button 点击事件。 | `create_sprite`、`set_sprite_frame`、`list_button_click_events`、`bind_button_click_event` |
| 预制体 | 查询与创建预制体资源、检查引用，并在支持时通过编辑器消息处理关联实例。 | `create_prefab_from_node`、`inspect_prefab_instance`、`apply_prefab_instance` |
| 预览与证据 | 控制受支持的预览模式、获取编辑器或预览图像、检查运行和构建状态。 | `run_project_preview`、`capture_preview_screenshot`、`validate_scene` |

上表仅列举主要能力，完整接口见[工具清单](./docs/TOOLS.md)。部分工具来自 Funplay 底座；新增功能的 Creator 实测记录位于 [docs/verification](https://github.com/abelsdf/cocos-mcp-kit/tree/main/docs/verification)。工具配置决定客户端可见范围，工具清单也区分只读、修改和有状态操作。

## 推荐操作流程

### 搭建并验收第一个 UI

1. 核对工程身份，选择 `full`，在普通 Scene 编辑模式打开已保存的场景。首次启动的未保存默认场景，需先在 Creator 中手动保存或打开其他场景；受保护工具不会替你丢弃它。需要新 Canvas/Camera 场景时，按 [UI 构建指南](./docs/UI_BUILDER.md)显式使用 `create_scene(mode="ui")`，处理 `expectedSceneUuid` 和 `needsSave`。
2. 导入工程自有的白色图片，核实实际 **SpriteFrame 子资源**，不要只填图片主资源 UUID。需要按钮响应时，准备已导入、已注册且具有目标回调方法的工程脚本；扩展不会生成游戏逻辑。
3. 使用 `pause_menu`、`settings_dialog` 或 `result_dialog` 调用 `get_ui_template`，检查返回的 `ui`，再向 `build_ui` 提供当前场景资源 UUID 和 Canvas/UI 父节点 UUID。若新建场景已成功打开，两者分别取创建结果的 `info.uuid` 和 `ui.parentUuid`，不要混用。参数示例见[模板指南](./docs/UI_TEMPLATES.md)。
4. 检查构建结果和实际节点后再决定下一次修改。同名根节点会拒绝，而非自动更新。未绑定动作使用静态灰色外观；后续手动启用还需恢复 Sprite/Label 颜色，不会自动迁移旧场景或实现运行时状态过渡。
5. 在编辑态调用 `verify_ui`，明确传入场景 UUID 和**所有待检查节点 UUID**，不能只给根节点：检查不会递归覆盖后代。显式保存、重新打开后，再核对资源、脚本与事件引用；切换场景前先处理未保存内容提示。
6. 需要运行画面时，另行启动内嵌 Game View，真实点击按钮并观察结果。预览中 `verify_ui(screenshot="game")` 仅提供截图证据，结构仍为 `not_checked`。裁剪截图只是局部证据，应调整 Game View 可见缩放/布局后重拍。来源和结果字段见[验证指南](./docs/UI_VERIFICATION.md)；测试回调触发不等于真实业务行为通过。

### 编辑已有节点

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

`inspect_asset` 是只读精确查询，接受 UUID、`db://` URL、`assets/...` 路径或工程 `assets` 目录内的绝对文件路径，不补猜扩展名。稳定的 `details` 投影会区分目标与源资源，并报告工程相对源文件、磁盘存在性和大小、目标/源/元数据 importer、元数据归属以及主/子资源关系；需要深查时仍可读取有界原始 info 和 meta。仅在 `includeData: true` 时读取序列化数据；深度、条目、节点、字符串和总字符上限共同约束快照，并报告截断原因。asset-db 报告的源文件缺失时 `complete` 为 false；`complete: true` 也只表示按本次选项完成了有界查询，不能证明运行时字符串引用或画面行为有效。

`create_asset` 是仅在 `full` 配置开放的安全创建入口，首批只接受新的 UTF-8 `.json` 和 `.txt` 资源，父目录必须已存在于 `assets/`。它会拒绝已有源文件、`.meta` 或 asset-db 身份，校验 JSON 与 1 MiB 内容上限，经 `asset-db:create-asset` 创建后再核对源内容、元数据 UUID/importer、导入后的 Cocos 类型、数据库就绪状态和等待后的第二次读取。它不会覆盖已有资源、在原生创建结果不确定时自动重试，也不接受场景、预制体、脚本、元数据或二进制格式；Cocos 序列化资源应使用对应的场景或预制体工具。

`save_asset` 是对应的 `full` 安全更新入口，仅支持最大 1 MiB、可写、已完整导入的 UTF-8 `.json` 和 `.txt` 主资源。可选的 `expectedSha256` 会在修改前拒绝过期内容；内容未变化时返回经过核验的空操作，否则只发送一次 `asset-db:save-asset`。成功前必须确认新内容完全一致，UUID、importer 与元数据未变，资源数据库就绪，并完成等待后的第二次读取。场景、预制体、动画片段、脚本、图片、音频、目录和导入子资源会被拒绝，并返回对应保存流程提示。`write_file` 与 `replace_in_file` 仍是文件系统辅助工具，不能证明 Cocos 资源已可靠持久化。

`reimport_asset` 是仅在 `full` 配置开放的已有资源重导入入口，支持最大 64 MiB 的已导入 JSON、文本、图片和音频主资源。它仅发送一次 `asset-db:reimport-asset`，并要求至少一个 `library` 导入产物实际重新生成且稳定，同时核对源字节、主/子资源 UUID 与嵌套 importer 设置未变化。目录、子资源、场景、预制体、脚本、其他格式和符号链接源路径均拒绝。若原生调用返回但导入产物未更新，会报告验收失败，且不会自动重复导入。

`import_asset` 是仅在 `full` 配置开放的单文件新建入口，支持最大 64 MiB 的外部 JSON、UTF-8 文本、图片和音频。`source` 填本机绝对路径，`target` 填工程 `assets/` 已有目录下的新路径且扩展名相同；可选 `expectedSha256` 用于拒绝过期源文件。它只调用一次 `asset-db:import-asset`，随后核对导入字节、新 UUID、磁盘与数据库元信息、子资源身份、`library` 产物、数据库就绪及等待后的第二次读取。已有目标、外部 `.meta`、符号链接源路径、不支持格式和 Cocos 序列化资源均被拒绝；原生结果不确定时不自动重试。详见[Creator 3.8.8 验证记录](https://github.com/abelsdf/cocos-mcp-kit/blob/main/docs/verification/ASSET_IMPORT_2026-09-26.md)。

`import_folder` 是仅在 `full` 配置开放的外部目录导入入口，在工程 `assets/` 的已有父目录下新建一个目录。源目录最多包含 64 个受支持文件、16 个目录、4 层子目录，合计不超过 64 MiB。它会在单次原生导入前拒绝 `.meta`、符号链接、不支持格式和目标冲突；成功前核对目录树、文件字节、不同的目录/文件/子资源 UUID、元信息、`library` 产物以及稳定的 asset-db 查询。部分导入或原生结果不确定时保留现场供显式检查，不自动重试或删除。详见[验证记录](https://github.com/abelsdf/cocos-mcp-kit/blob/main/docs/verification/ASSET_IMPORT_FOLDER_2026-09-26.md)。

`refresh_asset` 是仅在 `full` 配置开放的精确文件刷新入口，支持工程 `assets/` 中最大 64 MiB 的单个 JSON、文本、图片或音频文件。传入 `db://assets/` URL 或文件路径，只发送一次 `asset-db:refresh-asset`，随后核对源字节未变、元数据、主/子资源身份、`library` 产物、数据库就绪和等待后的稳定读取。数据库尚未登记的文件可以获得新身份；若 Creator 原本已认为资源是最新状态，工具只证明刷新后的资源一致，不宣称 `library` 必然重新生成。根目录和目录目标会被拒绝，精确刷新失败时也不会扩大到整个工程。若必须证明实际重新生成导入产物，应使用 `reimport_asset`。详见 [Creator 3.8.8 验证记录](https://github.com/abelsdf/cocos-mcp-kit/blob/main/docs/verification/ASSET_REFRESH_2026-09-26.md)。

`check_asset_ready` 是 `full` 配置中的只读状态探测。未指定目标时，要求两次稳定的 `asset-db:query-ready` 返回；指定精确 UUID 或 `db://assets` / `db://internal` URL 时，还要求资源已导入且非无效状态、UUID 与 URL 查询一致，并在第二次读取中保持稳定。默认轮询预算为 1.5 秒（`waitMs` 最大 10 秒），每次原生查询另有 3 秒上限；零等待只返回未经确认的单次观察。数据库忙、资源缺失、导入中、身份不一致、查询超时或未确认时均不返回 `ready: true`。该结果只证明 asset-db 查询状态，不证明导入队列已清空、源字节未变或构建产物已完成。

`query_asset_path` 是 `full` 配置下的只读精确定位工具，支持 UUID、db URL、工程内 `assets/` 相对路径及工程资源目录内的绝对路径。它会交叉核对资源身份和原生路径映射。对于导入子资源，`source.path` 是所属主资源的真实文件；`nativeMapping.path` 可能带有 Creator 的 `@子资源` 别名，并标记 `isPhysicalSource: false`，不能当作可直接读写的源文件。资源缺失、未导入、身份不一致或源文件不存在时返回不完整状态，不会打开或修改资源。详见 [Creator 3.8.8 验证记录](https://github.com/abelsdf/cocos-mcp-kit/blob/main/docs/verification/ASSET_PATH_2026-09-26.md)。

`query_asset_uuid` 是 `full` 配置下的只读精确 UUID 查询，支持资源 UUID、db URL、工程内 `assets/` 相对路径及资源目录内的绝对路径。它会核对资源记录、Creator 原生 URL 到 UUID 的映射，以及导入子资源与主资源的关系。由于原生 `query-uuid` 不直接解析相对路径，工具会先转换为 db URL；只有全部身份校验通过时才填充顶层 `uuid`，缺失或不一致时为 `null`。详见 [Creator 3.8.8 验证记录](https://github.com/abelsdf/cocos-mcp-kit/blob/main/docs/verification/ASSET_UUID_2026-09-26.md)。

`query_asset_url` 是 `full` 配置下对相同精确目标的只读规范 URL 查询。顶层 `url` 是已导入资源记录中的规范 URL，`nativeMapping.url` 单独展示 Creator 原生 UUID 到 URL 的结果。图片子资源的原生结果可能是 `@` 别名，而规范 URL 为 `/texture`；只有两种形式均映射到同一个 UUID 才返回可用的顶层 URL。缺失、未导入或身份不一致时返回 `url: null`。详见[验证记录](https://github.com/abelsdf/cocos-mcp-kit/blob/main/docs/verification/ASSET_URL_2026-09-26.md)。

`copy_asset` 是仅在 `full` 配置开放的安全复制入口，支持最大 64 MiB 的已导入 JSON、文本、图片和音频主资源。目标必须使用相同的受支持扩展名，且父目录已存在于 `assets/`。工具只调用一次 `asset-db:copy-asset`，拒绝任何目标源文件、`.meta` 或 asset-db 身份冲突，并核对字节一致、importer 设置、全新的主资源 UUID、图片子资源 UUID、源资源未变化、数据库就绪及等待后的第二次读取。它不复制目录、导入子资源、场景、预制体、脚本、元数据文件或其他格式，也不会覆盖或在原生复制结果不确定时自动重试。

`move_asset` 是对应的 `full` 安全移动/重命名入口，支持最大 64 MiB 的已导入 JSON、文本、图片和音频主资源。目标必须使用相同扩展名，父目录须已存在于 `assets/`；工具拒绝仅修改大小写以及任何源文件、`.meta` 或 asset-db 目标冲突，并且只调用一次 `asset-db:move-asset`。成功前必须确认旧源文件和 `.meta` 已消失，同时目标字节、importer 设置、主 UUID、图片子资源 UUID、导入状态和等待后的第二次读取全部一致。依赖主/子 UUID 的引用会保持有效；字符串或路径引用不会被发现或改写。它不移动目录、导入子资源、场景、预制体、脚本、元数据文件或其他格式；原生结果不确定时必须先检查两个精确路径再决定是否重试。详见 [Creator 3.8.8 验收](https://github.com/abelsdf/cocos-mcp-kit/blob/main/docs/verification/ASSET_MOVE_2026-09-26.md)。

`list_assets` 默认只搜索工程资源，按 URL 稳定排序后返回有界分页，不再直接输出无界 asset-db 结果。可组合使用 `name` 的 `contains`、`prefix`、`exact` 模式、精确 `ccType` 和 `assets` 目录。`IconPair` 这样的无扩展名精确名称可以匹配 `IconPair.prefab`；若精确名称命中多个资源，`selection.candidates` 会保留各候选的 UUID、URL、类型及主/子资源身份，调用方必须明确选择。带名称筛选的结果还会报告同名分组。设置 `includeSubassets: false` 可排除导入生成的 SpriteFrame/纹理；只有明确需要编辑器内置资源时才使用 `scope: "all"`。

后续操作需要一个精确资源身份时，使用 `find_asset_by_name`。它明确返回 `not_found`、`unique` 或 `ambiguous`；只有唯一结果才提供 `selected`。文件扩展名可以省略，但主资源与导入子资源可能共用显示名称，遇到重名时应通过 `ccType`、`directory`、`includeSubassets` 或区分大小写继续缩小范围。候选由 `maxCandidates` 限制，工具不会静默选择第一项。

`set_component_property` 目前每次只接受一个受支持的顶层字段：CCClass 声明的项目脚本字段及少量 Cocos UI 字段。工具会转换兼容的 Color、向量、节点/组件和资源引用，但拒绝点路径、未声明的脚本状态、不兼容值与关联预制体实例。设置 SpriteFrame 可能使 UITransform 自动改变尺寸；如需自定义尺寸，可随后设置 `contentSize`。`reset_component_property_to_default` 恢复 CCClass 声明默认值；`reset_component_property` 只清除字段。

组件类型目录单次最多检查 256 个项目脚本和 32 个指定类名。脚本显示 `no-component-registration` 时，也可能只是正常的工具模块，不能直接认定为编译失败。`list_components` 默认只展示项目脚本的 CCClass 声明字段；设置 `includeRuntimeFields: true` 可额外查看运行字段，但不能据此断定它们公开或持久化。

关联预制体实例的修改规则因工具而异。普通节点移动、复制、组件增删及属性赋值会拒绝关联预制体层级；预制体实例应用/还原和 Button 点击事件覆盖使用单独的编辑器流程。依赖持久化结果前，请核对相应[工具说明](./docs/TOOLS.md)和[验收记录](https://github.com/abelsdf/cocos-mcp-kit/tree/main/docs/verification)。

使用 `bind_button_click_event` 时，目标节点必须恰好有一个匹配组件，处理方法须由该组件提供，不能是引擎生命周期方法。`customEventData` 是最长 1024 字符的原样字符串。绑定或解绑前先列出已有事件；重复绑定会报告重复，不会再增加一条。`batch_bind_button_click_events` 一次按顺序处理最多 50 条绑定，可选择遇错停止或继续并逐项返回结果；后续失败不会整体撤销先前成功项。

`list_prefabs` 按稳定顺序分页列出预制体资源（默认每页 50 项，最多 100 项）。设置 `includeMetadata` 可查询精简的 `.meta` 状态，设置 `includeSceneInstances` 可关联当前场景中的实例根节点；若场景扫描被截断，实例数量只是部分结果。

`inspect_prefab` 会报告资源与元信息身份、序列化根节点/节点/组件概况，以及带明确截断标记的 UUID 类引用。设置 `includeSceneInstances` 可查询当前场景中的匹配实例根；序列化文件里出现预制体引用，不等于嵌套实例仍保持链接。

`validate_prefab_references` 会检查超出详情展示上限的显式序列化资源引用、组件条目链接和声明的嵌套预制体资源，并分别报告扫描未完成及资源库查询错误；它不能证明运行时动态加载的资源或自定义组件类已注册。

`create_prefab_from_node` 会克隆普通场景层级，拒绝关联的嵌套实例和编辑器专用节点；写入 asset-db 前检查单一连通节点树、组件归属、PrefabInfo 元信息和显式资源引用，随后回查导入 UUID、元信息、根名称及节点/组件数量。源场景层级不会被修改。

`create_prefab_instance` 与 `instantiate_prefab` 现在使用同一原生编辑器流程：只创建一次，核对实例根、资源与实例身份，再赋值并校验父节点本地 `position`。可用 `parentUuid` 精确指定父节点；同时提供 `parentPath` 时二者必须一致。省略名称/位置时使用预制体根节点默认值。活动场景须已保存并导入；调用后仍需显式 `save_current_scene`，`needsSave: true` 不代表已持久化。

UI 预制体要求父节点已有 Canvas 祖先；关联父层级、Canvas 根、启用的根 Widget 或父 Layout 暂不支持，避免不受支持的嵌套和自动布局覆盖。原生创建结果不明时不会回退到运行态重复创建；验证失败只尝试清理能确认属于本次创建范围的节点，结果不明须先检查层级再重试。详见 [Creator 3.8.8 实例化验收与限制](https://github.com/abelsdf/cocos-mcp-kit/blob/main/docs/verification/PREFAB_INSTANTIATE_2026-09-22.md)。

`unlink_prefab_instance` 通过原生编辑器消息解除已保存场景中明确选中的独立实例根关联，核对节点/组件身份、层级、变换和关联元信息清除，不修改源预制体；调用后须显式保存场景。关联祖先与含嵌套预制体的子树被拒绝：Creator 3.8.8 对照实验中，解除外层关联并保存后，有效的跨实例组件引用会丢失。`verified: true` 仅表示结构校验通过，不是全部组件属性审计；结果不明时不自动重试或重新关联。详见[解除关联验收与限制](https://github.com/abelsdf/cocos-mcp-kit/blob/main/docs/verification/PREFAB_UNLINK_2026-09-22.md)。

`apply_prefab_instance` 会立即将属性修改写回源预制体并影响同源实例；丢弃场景不会撤销这次资源写入。要求明确选择已保存场景中的非嵌套实例根，节点/组件结构不变，且没有指向实例外部场景节点/组件的引用。工具比对原生序列化预览与导入后的源文件，再核对实例身份；之后仍须显式保存场景。原生 `result` 即使写入成功也可能为 `false`，不能将它当作最终状态。结果不明不自动重试或回滚。详见[应用实例修改验收与限制](https://github.com/abelsdf/cocos-mcp-kit/blob/main/docs/verification/PREFAB_APPLY_2026-09-22.md)。

`revert_prefab_instance` 通过一次原生 `restore-prefab` 丢弃已保存场景中明确选中的非嵌套实例属性覆盖。根名称、位置和旋转保留，缩放、其他节点属性及组件数据还原为源值；两次核对序列化数据、运行身份和源文件/元信息未变，之后仍须显式保存场景。拒绝结构变更、指向实例外部场景节点/组件的引用及不可核验序列化。结果不明不自动重试或回滚。详见[还原实例修改验收与限制](https://github.com/abelsdf/cocos-mcp-kit/blob/main/docs/verification/PREFAB_REVERT_2026-09-22.md)。

`enter_prefab_edit_mode`（`full` 配置）从单个干净且已保存的场景进入明确指定的非嵌套工程预制体原生编辑模式。即使脏标记为 false，也会比较实时序列化与磁盘；核验实际编辑模式、预制体根身份和源资源/原场景文件未变，并返回供受保护保存使用的 `sourceHash`。同一干净预制体重复调用只核验、不重载；拒绝脏状态、多场景及正在编辑其他预制体，不自动保存、丢弃或退出。通用 `open_asset` 不具备这些专项保护。详见[进入编辑模式验收与限制](https://github.com/abelsdf/cocos-mcp-kit/blob/main/docs/verification/PREFAB_EDIT_ENTER_2026-09-22.md)。

`save_prefab_edit_mode`（`full` 配置）使用明确的当前 `prefabUuid`，并将进入/上次核验保存返回的 `sourceHash` 作为 `expectedSourceHash` 传入，保存非嵌套预制体的纯属性修改。拒绝源文件冲突、结构变更、向外场景引用及未保存的原场景。保存会立即写回资源并影响同源实例，丢弃场景不能撤销资源写入；即使 dirty 为 false 也比较内容，并有界等待目标资源重新导入，两次核对源文件、编辑现场与原场景。后续保存须使用新返回的哈希；干净且内容不变的重复调用不请求原生保存。冲突或结果不明时先检查并协调修改，不应直接换哈希重试。不会自动退出、重试写入、回滚或保存原场景，`needsSave: false` 仅指预制体。通用 `save_current_scene` 不具备这些专项保护。详见[保存编辑验收与限制](https://github.com/abelsdf/cocos-mcp-kit/blob/main/docs/verification/PREFAB_EDIT_SAVE_2026-09-22.md)。

`exit_prefab_edit_mode`（`full` 配置）通过一次原生 `close-scene` 退出已保存且内容一致的非嵌套预制体。明确传入 `prefabUuid`，以及首次进入或核验保存返回的 `previousScene.uuid` 作为 `returnSceneUuid`；预制体脏状态、dirty=false 但序列化仍有修改、原场景不匹配、嵌套和不可核验引用均在关闭前拒绝。两次核验返回场景及源资源/原场景文件未变；在匹配且通过核验的场景重复调用不会关闭该场景。已保存的预制体更新可能让返回场景变脏，应检查 `needsSave` 并按需显式保存场景。不会自动保存、丢弃、重试、重开或回滚，保存与退出保持独立。详见[退出编辑验收与限制](https://github.com/abelsdf/cocos-mcp-kit/blob/main/docs/verification/PREFAB_EDIT_EXIT_2026-09-22.md)。

`test_prefab_edit_mode`（`full` 配置）只接受明确的 `prefabUuid`，只读检查编辑上下文、源资源/引用和保留原场景；仅当目标已经打开时比较编辑内容。未打开的目标不会被打开（`editing: null`、`complete: false`），每项返回 `passed/failed/not_checked`。`readChecksPassed` 表示没有读取检查失败，`complete` 表示全部读取检查通过，均不是进入/保存/退出的许可或实测证明；读取通过仍可报告未保存差异，包括 dirty=false 的修改。`observationsStable` 为复查成功/失败的 true/false，前提不足时为 null，不是事务保证；外层 `ok` 仅表示报告已生成。`mutationTests` 始终为 `not_run`，不自动打开、保存、关闭、记录快照、创建或丢弃，也不返回可替换保存令牌的新源哈希。详见[编辑态诊断验收与限制](https://github.com/abelsdf/cocos-mcp-kit/blob/main/docs/verification/PREFAB_EDIT_TEST_2026-09-22.md)。

`delete_asset` 只接受精确 UUID、db URL 或文件路径，不猜测扩展名。它安全处理工程预制体，以及最大 64 MiB 的已导入 JSON、文本、图片或音频主资源。单次请求 asset-db 删除前，会核对可写且已导入的身份、真实源文件/元信息路径、未变化的字节与元信息，并通过原生接口检查主资源及导入子资源 UUID 的资源/脚本和当前场景引用。同一图片各子资源之间的内部引用不会阻断删除，外部引用会阻断；被引用的资源和正在编辑的预制体均被拒绝，不提供强制、级联或磁盘直删回退。只有 UUID/URL 记录、双向映射、源文件和 `.meta` 全部消失才报告成功；回查失败时删除可能已经发生，应先检查精确目标再重试。目录、子资源、场景、脚本、其他格式、运行时字符串/路径加载及原生查询之外的引用仍不支持。详见[预制体删除验收](https://github.com/abelsdf/cocos-mcp-kit/blob/main/docs/verification/PREFAB_DELETE_2026-09-22.md)和[常规资源删除验收](https://github.com/abelsdf/cocos-mcp-kit/blob/main/docs/verification/ASSET_DELETE_2026-09-26.md)。

## 自有 UI 知识库

MCP Resources 新增 `cocos://knowledge/index` 精简目录，可按 `cocos://knowledge/topic/widget-layout` 读取正文，或按 `cocos://knowledge/component/cc.Widget` 查询主题链接。六篇独立中文摘要涵盖尺寸/锚点、Canvas/Camera、布局、字体缓存、资源引用、事件和编辑态/运行态，附 Creator 3.8.x 官方来源与复核日期。查询离线、只读，不扫描工程或替代运行验证；需要客户端支持 Resources。详见[知识查询契约](./docs/KNOWLEDGE.md)。

## 常见问题

| 现象 | 优先检查 |
| --- | --- |
| 找不到菜单或扩展加载失败 | 核对扩展目录层级、包名及重复安装，重启目标 Creator 工程并查看控制台错误。 |
| 连接被拒绝或连错工程 | 保持 Creator 和 MCP 服务运行，使用当前面板地址，核对客户端条目和 `get_project_info`。先解决端口冲突/备用端口问题，不要默认使用 8765 或另一个工程的地址。 |
| 浏览器 GET 返回 405 | 不支持 GET/SSE 长连接；使用兼容的 HTTP MCP 客户端或随附 stdio 桥接。`/health` 仅检查服务存活，不是场景或客户端验收。 |
| 缺少构建、模板或验证工具 | 检查工具开放范围中的 `full` 与自定义工具/分类过滤，再重新连接客户端。`core` 数量较少，但并非只读。 |
| 拒绝切换场景、资源或回调报错 | 检查 `needsSave`、未保存序列化内容和准确活动场景；核对已导入 SpriteFrame/脚本身份及已注册方法，不绕过保护或盲目重试结果不明的写入。 |
| 截图失败/不完整，或按钮无反应 | 显示目标非最小化 Scene/Game View，核对 `region.clipped`、运行模式与来源；灰色按钮需检查事件绑定和禁用状态。截图成功从不代表视觉验收通过。 |

## 已知限制与交付状态

- 已记录的持久化、UI 点击和截图仅覆盖指定 Creator 3.8.8 样例，不代表所有工程、文案、素材、宽高比或设备。触摸、其他 Creator/系统、扩展管理器安装、更新、卸载仍未验证。[首版视觉证据](https://github.com/abelsdf/cocos-mcp-kit/blob/main/docs/verification/FIRST_RELEASE_VISUAL_ACCEPTANCE_2026-09-30.md)和[禁用外观补验](https://github.com/abelsdf/cocos-mcp-kit/blob/main/docs/verification/UI_DISABLED_STYLE_2026-09-30.md)明确了范围；历史真实点击不算新包点击重测。
- UI 模板是固定布局的起始 JSON，不实现暂停/恢复、音频偏好、奖励、导航、弹窗输入拦截或焦点管理。自定义配色、素材和长文本仍需视觉检查。
- 批次清理仅覆盖本次新节点，不回滚任意脚本副作用或场景资源创建。单次 Undo 记录仅在 Creator 3.8.8 验证；预制体专项仍受文档中的非嵌套/纯属性边界限制。部分完成或结果不明时先检查，不自动重试。
- 严格的 Scene/Game View 截图流程要求可见且匹配的 Creator 窗口，不捕获外部浏览器/Simulator、不证明运行场景新鲜度，也不自动判定视觉通过，`visualValidation` 始终为 `not_run`。可选官方 CLI 后端尚未配置。
- 默认 `npm run release:package` 仍生成本地候选；显式 `--github-prerelease` 打包要求干净源码及指向当前提交的版本标签，并记录本项目 GitHub 目的地，两种命令都不执行发布。Windows 使用 `tar.exe`；非 Windows 需要 `zip`/`unzip`，仍未实测。每次写入新的 `releases/<version>/candidate-<unique>/`，不覆盖旧产物。手动安装前核对 `SHA256SUMS.txt`。详见[发布流程](./RELEASE_WORKFLOW.md)和[Windows 本地安装证据](https://github.com/abelsdf/cocos-mcp-kit/blob/main/docs/verification/LOCAL_PACKAGE_INSTALL_2026-09-30.md)。

## 开发与文档

开发命令应在**源码副本**中运行，而不是安装后的运行包：`npm run check` 检查 JavaScript 语法，`npm test` 运行测试，`npm run docs:check` 核对生成工具清单，`npm run release:check` 核对入包和许可保护，`npm run pack:dry-run` 查看 npm 入包文件。运行包有意不携带测试和构建脚本。[开发计划](https://github.com/abelsdf/cocos-mcp-kit/blob/main/docs/PLAN.md)区分已实现工具与仍在推进的整体需求；[验收记录](https://github.com/abelsdf/cocos-mcp-kit/tree/main/docs/verification)列出 Creator 实测范围。本分支尚未配置发布更新渠道或包注册表发布，目前采用本地安装。

## 致谢与许可

感谢 [Funplay MCP for Cocos](https://github.com/FunplayAI/funplay-cocos-mcp) 的作者和贡献者以 MIT 许可证开放底座代码。[LICENSE](./LICENSE) 保留了 `Copyright (c) 2026 Funplay`、完整 MIT 条款及免责声明。Cocos MCP Kit 是独立分支，并非 Funplay 官方版本。贡献约束见 [CONTRIBUTING.md](./CONTRIBUTING.md)，随包内容边界见[来源与许可说明](./docs/SOURCES_AND_LICENSES.md)。开发分析和验收记录保留在源码仓库，不随安装包分发。
