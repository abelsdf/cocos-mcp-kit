# OP-069 安全资源复制验证

日期：2026-09-26

目标环境：Cocos Creator 3.8.8，`D:\AI\Game\arrow-puzzle`

工具：`copy_asset`

## 范围

- 通过已安装扩展的正式 MCP `tools/list` 与 `tools/call` 验证，不以直接加载工作区模块代替运行验收。
- 验证 JSON、纯文本、图片和音频主资源复制，以及图片导入生成的 SpriteFrame/Texture2D 子资源身份。
- 验证覆盖、扩展名变化、子资源源、预制体源、相对路径穿越和缺失父目录在复制前被拒绝。
- 全部现场样本放在 `assets/McpKitValidation/`，验收后通过正式 `delete_asset` 清理，并再次核对磁盘与 asset-db。

## 实现约束

- `copy_asset` 仅在 `full` profile 开放；`core` 不增加写入口。工具总数为 `full` 126、`core` 40。
- 源必须是工程 `assets/` 内可写、已导入且不超过 64 MiB 的 `cc.JsonAsset`、`cc.TextAsset`、`cc.ImageAsset` 或 `cc.AudioClip` 主资源；目录、导入子资源、场景、预制体、脚本和其他类型被拒绝。
- 支持 `.json`、`.txt`、`.png`、`.jpg`、`.jpeg`、`.webp`、`.mp3`、`.wav`、`.ogg`、`.m4a`；目标必须使用与源相同的扩展名，父目录必须已存在于 `assets/` 且路径中不能包含符号链接目录。
- 目标源文件、`.meta` 或 asset-db 身份任一已存在即拒绝覆盖；复制前要求 asset-db ready。
- 只调用一次 `asset-db:copy-asset`。原生调用抛错或结果不确定时不自动重试、覆盖或删除可能已经出现的目标。
- 返回成功前两次核对目标字节、主 UUID、类型、importer、元数据设置、子资源键/类型/UUID、源文件及源 `.meta` 哈希、导入状态和数据库就绪状态，中间等待 400 毫秒。
- Creator 复制图片时会将元数据中的源自引用 UUID 换成目标 UUID、按新文件名重算 `displayName`，并可能省略旧资源查询结果中的空 `id`/`name` 身份字段。校验只把这些身份派生值规范化；其他 importer 版本、文件列表、子元数据和 userData 仍须等价。

## 正式入口结果

- `/health` 返回 `Cocos MCP Kit - arrow-puzzle`，工程身份为 `758048aa923da9e57466f98a`；`tools/list` 返回 126 项并包含 `copy_asset`。
- JSON：源 UUID `ce96bea0-bcdc-4670-9e33-614f926d075b`，目标 UUID `5031f581-0ccc-4a0a-a9f4-aa0cafb138f8`；81 字节，源/目标 SHA-256 均为 `fcf0df5d13e9984b38883d613e6acd54c95481dc9bb478419434a2da114353ce`，类型/importer 为 `cc.JsonAsset`/`json`。
- 纯文本：源 UUID `73423a2d-921d-4ea2-b982-f6cb9e7cf7ac`，目标 UUID `e26a0b87-2b36-4601-89af-fd59bf2641e7`；42 字节，源/目标 SHA-256 均为 `e4587722b41d9eaed7e459500575b998b86d1398dfd7643c94bf2175b5d83a90`，类型/importer 为 `cc.TextAsset`/`text`。
- 图片：源 UUID `7222d7a1-b348-41ec-9f8a-4eea647d8774`，目标 UUID `b72d75f8-d4b0-4f09-b017-d0dba749a896`；23982 字节，源/目标 SHA-256 均为 `d26ec0920fc2b25aba319179b031e59feee2bc2837a099c227f9a4aae1944520`，类型/importer 为 `cc.ImageAsset`/`image`。
- 图片副本生成 `cc.SpriteFrame` UUID `b72d75f8-d4b0-4f09-b017-d0dba749a896@f9941` 与 `cc.Texture2D` UUID `b72d75f8-d4b0-4f09-b017-d0dba749a896@6c48a`，都与源子资源 UUID 不同；正式 `inspect_asset` 返回 `complete=true` 且元数据身份一致。
- 音频：源 `Click.mp3` UUID `2c29c3f0-7610-4852-8ca2-d89728ba273a`，目标 UUID `63bc22f7-1691-4241-af93-87bc26fb2e11`；7936 字节，源/目标 SHA-256 均为 `4483e29b3f3d35ee96b699004d4cf6acd1bf1d3ae26159b1e2ca9fd2189f32ad`，类型/importer 为 `cc.AudioClip`/`audio-clip`。
- 四类结果均报告 `sourceUnchanged`、`targetBytesMatch`、`metadataSettingsMatch`、`distinctMainUuid`、`distinctSubassetUuids`、`imported`、`databaseReady` 和 `stableAfterSettle` 为 true。
- 已有目标、JSON 改为 `.txt`、SpriteFrame 子 UUID 作为源、预制体作为源、含 `..` 的目标和不存在的父目录均返回 MCP 错误，未产生对应目标文件或 `.meta`。

## 现场修正

- 初版对图片元数据执行原样 userData 相等比较。Creator 已成功复制资源，但把 self UUID 改为目标 UUID，因此工具按设计返回“验证失败”且没有重试。
- 第一次修正加入 self UUID 和 `displayName` 的身份规范化；第二次正式复核又发现旧源查询会补出空 `id`/`name` 身份字段，新副本会省略这两个空字段。
- 最终实现仅忽略 `displayName` 和空 `id`/`name` 身份字段，并把当前主 UUID 规范化为占位身份；外部 UUID 和其他 importer 设置不会被放宽。对应图片单元样本包含这些差异。
- 两次验证失败留下的已导入目标被保留供检查，没有自动重试或覆盖；最终与其他样本一起通过正式删除入口清理。

## 清理与回归验证

- 共 9 个 `Op069*` 现场资源通过正式 `delete_asset` 返回删除成功；随后 `assets/McpKitValidation/` 的磁盘残留为 0，正式 `list_assets` 前缀查询也返回 0。
- 清理后工程 `assets` 共 3519 个文件；按相对路径、NUL 分隔和文件内容计算的合并 SHA-256 为 `0F15184ACC2A50B083AC92D4542976B95ECE9759B8669A31D9D3425886EC8D26`，与 OP-068 清理后的既有基线一致。
- 原始 `ArrowHammer.png` 仍为 23982 字节，SHA-256 为 `D26EC0920FC2B25ABA319179B031E59FEEE2BC2837A099C227F9A4AAE1944520`；其 `.meta` 清理后 SHA-256 为 `D698D047829D48F92EEEF45CBA93803CEBA63DF5CAA68EBD650EFE8C42D1F5E5`。
- 新增 6 项资源复制测试并扩展文件工具和工具目录断言；全量 `node --test` 为 950 项通过、0 失败、0 跳过。
- 工具文档生成检查、改动 JavaScript 语法检查和 `git diff --check` 通过。

## 限制

- 本工具只复制单个主资源，不复制目录，也不用于场景、预制体、脚本或任意 Cocos 序列化格式；这些格式需要专用流程。
- 当前只接受相同扩展名，避免借复制隐式转换 importer；重命名或移动属于 OP-070。
- 64 MiB 上限限制单次内存读取；大资源和资源目录批处理需要后续独立设计。
- 成功证明 Creator 3.8.8 已持久化并导入副本，不证明业务代码引用、播放效果或画面表现正确。
- 本次仅在 Windows、当前验证工程及列出的四种样本上验收，其他 Creator 版本和各支持扩展的全部 importer 组合仍需单独验证。
