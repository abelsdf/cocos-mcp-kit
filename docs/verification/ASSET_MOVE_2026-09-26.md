# OP-070 安全资源移动验证

日期：2026-09-26

目标环境：Cocos Creator 3.8.8，`D:\AI\Game\arrow-puzzle`

工具：`move_asset`

## 范围

- 通过已安装扩展的正式 MCP `/health`、`/tools` 与 `tools/call` 验证，不以直接加载工作区模块代替运行验收。
- 验证 JSON、纯文本、图片和音频主资源移动，以及图片导入生成的 SpriteFrame/Texture2D 子资源身份。
- 验证 UUID 引用在移动后的解析结果，并明确区分不受保证的字符串/路径引用。
- 验证覆盖、扩展名变化、子资源源、预制体源、相对路径穿越、缺失父目录、同路径及仅修改大小写均在移动前被拒绝。
- 全部现场样本位于 `assets/McpKitValidation/`，验收后通过正式 `delete_asset` 清理，并再次核对磁盘与 asset-db。

## 实现约束

- `move_asset` 仅在 `full` profile 开放；工具总数为 `full` 127、`core` 40。
- 源必须是工程 `assets/` 内可写、已导入且不超过 64 MiB 的 `cc.JsonAsset`、`cc.TextAsset`、`cc.ImageAsset` 或 `cc.AudioClip` 主资源；目录、导入子资源、场景、预制体、脚本和其他类型被拒绝。
- 支持 `.json`、`.txt`、`.png`、`.jpg`、`.jpeg`、`.webp`、`.mp3`、`.wav`、`.ogg`、`.m4a`；目标必须使用与源相同的扩展名，父目录必须已存在于 `assets/` 且路径中不能包含符号链接目录。Windows 上不支持仅修改大小写。
- 目标源文件、`.meta` 或 asset-db 身份任一已存在即拒绝覆盖；移动前要求 asset-db ready，并在写入前复核源字节、`.meta` 和数据库身份没有发生竞态变化。
- 只调用一次 `asset-db:move-asset`。原生调用抛错或结果不确定时不自动重试、回滚、覆盖或删除任一路径。
- 返回成功前两次核对旧源文件与 `.meta` 均不存在，目标字节、主 UUID、类型、importer、元数据设置、子资源键/类型/UUID、导入状态和数据库就绪状态一致，中间等待 400 毫秒。
- 主资源和导入子资源的 UUID 引用会继续解析；动态字符串、运行时代码和路径引用不会被发现或改写，结果中会返回明确警告。

## 正式入口结果

- `/health` 返回 `Cocos MCP Kit - arrow-puzzle`，工程身份为 `758048aa923da9e57466f98a`；`/tools` 返回 127 项并包含 `move_asset`。
- JSON：UUID `d92de96f-958a-483c-9a13-fdcf0a35142b`；68 字节，移动前后 SHA-256 均为 `01a58041274e9cace12c307a2c89c1d73335ac200c6e31df0cd7c15a5e365bfa`，类型/importer 为 `cc.JsonAsset`/`json`。
- 纯文本：UUID `94bf94bc-6e49-4c6d-ba93-fddfaecde871`；37 字节，移动前后 SHA-256 均为 `4c2554ebbe375ab52b98429985a5c507bc7dc5c1faa1dfadf79cca38efdd4d97`，类型/importer 为 `cc.TextAsset`/`text`。
- 图片：UUID `691412b9-5ada-4220-bc06-d156bfec2d85`；23982 字节，移动前后 SHA-256 均为 `d26ec0920fc2b25aba319179b031e59feee2bc2837a099c227f9a4aae1944520`，类型/importer 为 `cc.ImageAsset`/`image`。
- 图片移动前后保持 `cc.SpriteFrame` UUID `691412b9-5ada-4220-bc06-d156bfec2d85@f9941` 与 `cc.Texture2D` UUID `691412b9-5ada-4220-bc06-d156bfec2d85@6c48a`；URL 和文件名派生 `displayName` 更新为新路径。
- 音频：UUID `933d2da3-a0e3-4190-94b6-c7901337c306`；7936 字节，移动前后 SHA-256 均为 `4483e29b3f3d35ee96b699004d4cf6acd1bf1d3ae26159b1e2ca9fd2189f32ad`，类型/importer 为 `cc.AudioClip`/`audio-clip`。
- 四类结果均报告 `sourceRemoved`、`targetBytesMatch`、`identityPreserved`、`subassetIdentitiesPreserved`、`metadataSettingsMatch`、`imported`、`databaseReady` 和 `stableAfterSettle` 为 true。Creator 3.8.8 的成功原生调用返回 `null`，最终成功判断来自持久化状态而不是原生返回值。
- 临时 `Op070Reference.json` 同时保存图片主 UUID 与 SpriteFrame 子 UUID。移动前后 `inspect_asset_dependencies` 都返回 `referenceCount=2`、`dependencyCount=2`、`missingCount=0`；解析 URL 从 `Op070Moved.png` 更新为 `Op070Referenced.png`，UUID 不变。
- 已有目标、JSON 改为 `.txt`、SpriteFrame 子 UUID 作为源、预制体作为源、含 `..` 的目标、不存在的父目录、同路径和仅大小写变化均返回 MCP 错误；用于验证的 JSON 源 UUID 和 URL 在全部拒绝后保持不变。

## 清理与回归验证

- 共 6 个 `Op070*` 现场主资源通过正式 `delete_asset` 返回删除成功；随后正式 `list_assets` 前缀查询为 0，`assets/McpKitValidation/` 的磁盘残留为 0。
- 验收前后工程 `assets` 均为 3519 个文件；本次按相对路径和文件 SHA-256 计算的快照合并 SHA-256 均为 `DABE138D12C294C922C80A6248341C7AA4FEC5650B0441DB085FC47E35BB91CD`。
- 原始 `ArrowHammer.png` 仍为 SHA-256 `D26EC0920FC2B25ABA319179B031E59FEEE2BC2837A099C227F9A4AAE1944520`，原始 `Click.mp3` 仍为 `4483E29B3F3D35EE96B699004D4CF6ACD1BF1D3AE26159B1E2CA9FD2189F32AD`。
- 新增 7 项资源移动测试并扩展文件工具和工具目录断言；全量 `node --test` 为 958 项通过、0 失败、0 跳过。
- 工具文档生成检查、改动 JavaScript 语法检查和 `git diff --check` 通过。

## 限制

- 本工具只移动单个主资源，不移动目录，也不用于场景、预制体、脚本或任意 Cocos 序列化格式；这些格式需要专用流程。
- 当前只接受相同扩展名，避免借移动隐式转换 importer；Windows 上的仅大小写重命名需要后续单独设计两阶段原生流程。
- 64 MiB 上限限制单次内存读取；大资源和资源目录批处理需要后续独立设计。
- UUID 引用保持验证不覆盖动态字符串或路径加载。使用 `resources.load`、bundle 路径或自定义映射的工程必须在调用前自行查找并在移动后更新路径。
- 成功证明 Creator 3.8.8 已持久化并导入移动后的资源，不证明音频播放、图片显示或业务运行行为正确。
- 本次仅在 Windows、当前验证工程及列出的四种样本上验收，其他 Creator 版本和各支持扩展的全部 importer 组合仍需单独验证。
