# OP-073 资源重导入验证（2026-09-26）

## 范围和边界

- 新增 `full` 配置的 `reimport_asset`，限定已导入、可写、最大 64 MiB 的 JSON、文本、图片和音频主资源。接受精确 UUID、`db://assets/` URL 或工程 `assets/` 文件路径；拒绝目录、子资源、场景、预制体、脚本、不支持的扩展名、符号链接和跨工程路径。
- 预检资源数据库就绪、UUID/URL/类型/importer、真实源文件和 `.meta`、磁盘及数据库导入设置、源字节、子资源身份和现有 `library` 产物。只发送一次 `asset-db:reimport-asset`，有限轮询并两次核对源内容、主/子资源 UUID、嵌套 `userData`、导入状态及数据库就绪；至少一个 `library` 产物的修改时间必须增加且二次检查稳定。原生返回但导入产物没有更新时拒绝报成功，不自动再次触发重导入。
- [Cocos Creator 3.8 资源管理器手册](https://docs.cocos.com/creator/3.8/manual/zh/editor/assets/)描述“重新导入资源”会更新工程 `library`。本实现的具体编辑器消息和返回行为以 Creator 3.8.8 实测为准。

## 验证

- `node --test`：986 项通过，0 失败，0 跳过。定向测试覆盖单次重导入、支持类型、扩展名/类型/importer 错配、非法身份、嵌套设置/子资源变更、没有重新生成的原生空返回、原生异常不重试、数据库繁忙及符号链接拒绝。
- `node scripts/generate-tool-docs.js --check`、`node scripts/release.js check`、`node --check lib/asset-reimport.js` 和 `git diff --check` 通过。本机 `npm-cli.js` 缺失，使用直接 Node 命令。
- 在 `D:\AI\Game\arrow-puzzle` 的 Creator 3.8.8 中，通过已运行扩展的正式 `execute_editor_script` 动态加载当前 `lib/asset-reimport.js`，对独立临时资源执行原生消息。JSON、TXT、PNG、MP3 四类均返回 `reimported:true`，源 SHA、原主 UUID 与图片子资源 UUID、importer 设置未变，`libraryRegenerated:true`；原生消息本身返回 `null`，因此没有以返回值当作完成证明。另一次对 PNG 的前后 `library` 文件检查确认 `.json`、`.png` 两个产物的修改时间都增加。
- 第一轮四个动态方法探针经正式 `delete_asset` 删除后，工程 `assets` 中无 `__mcp_op073*` 残留，文件数为 3519。
- Creator 关闭后，已将原扩展 133 个文件备份至 `E:\AIWork\CocosMcp\.local-install-backups\arrow-puzzle-cocos-mcp-kit-20260926-182138`；同步 10 个新增/改动文件后，安装目录 135 个文件与当前源码逐一核对 SHA-256，差异为 0。
- 重开后的 `/health` 指向 `arrow-puzzle` 工程身份 `758048aa923da9e57466f98a`，正式 `tools/list` 列出 129 项，含 `reimport_asset`。正式入口对临时 JSON、TXT、PNG 返回成功，均报告原 UUID、源哈希、导入设置及 `libraryRegenerated:true`；图片有 1 个子资源，其 UUID 保持。子资源、场景、目录和路径越界输入均在原生调用前被拒绝。
- 正式 MP3 首次调用在新增的扩展名/importer 校验处被拒绝：Creator 3.8.8 的实际 importer 为 `audio-clip`，而初版写成 `audio`。拒绝发生在原生调用前，源文件未变化；修正后当前源码动态方法对同一 MP3 返回 `reimported:true`、`libraryRegenerated:true`，全量测试增至 986 项。关闭 Creator 后单独备份并同步修正的 `lib/asset-reimport.js`，源码与安装文件 SHA-256 均为 `83EF77A7C907B22A1E539212F4AB1439B9041B7798A2E1681965B74179ECCE25`。
- 第二次重开后，正式 `inspect_asset` 读取 JSON、TXT、PNG、MP3 四类均为 `complete:true`，主 UUID、importer 与磁盘 `.meta` 一致；PNG `cc.Texture2D` 子资源 `f556f0f5-6fe6-4d8a-95cc-bd38cdbc8d60@6c48a` 仍可单独解析，主资源归属正确。修正版正式 `reimport_asset` 对 MP3 返回 `cc.AudioClip/audio-clip`、原 UUID/源 SHA 和七项核验全部为 true，其中 `libraryRegenerated:true`。
- 第二轮四个临时主资源均经正式 `delete_asset` 删除。清理前后的 `assets` 都有 3519 个文件；按相对路径排序，并以“相对路径 + NUL + 文件 SHA-256 + LF”合并的快照 SHA-256 前后均为 `372A58284BC329BDB50E127717FE001956EEA2415370D181CE0EF1D810B609D5F`；不存在 `__mcp_op073*` 残留。

## 结论与范围

在 Creator 3.8.8 的该工程中，OP-073 限定的 JSON、文本、图片和音频主资源重导入已通过正式入口与重开持久化验收，可行性由 C 调整为 B。版本仍为 0.1.0 Unreleased，FR-05 总项继续保持未完成；下一项是 OP-074 资源导入。此结论不涵盖其他 Creator 版本、模型等复杂导入器，也不证明游戏运行时视觉表现。
