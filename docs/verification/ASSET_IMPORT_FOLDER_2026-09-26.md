# OP-075 外部目录导入验证（2026-09-26）

## 范围和边界

- 新增 `full` 配置的 `import_folder`。源必须是本机外部普通目录，无 `.meta` 侧车、符号链接或不支持格式；最多 64 个 JSON、UTF-8 文本、图片和音频文件、16 个目录、4 层嵌套，源字节总计不超过 64 MiB。目标是工程 `assets/` 已有父目录下的全新目录。
- 预检源快照、目标目录及 `.meta` 冲突和 asset-db 就绪，只调用一次 `asset-db:import-asset`。之后有界轮询并两次核对精确目录树、每个源文件字节、目录/文件/子资源 UUID 唯一性、磁盘/数据库元信息、文件 `library` 产物及数据库就绪。原生异常或部分导入结果不自动重试、覆盖或清理，需检查目标后决定处理。
- [Cocos Creator 3.8 资源管理器手册](https://docs.cocos.com/creator/3.8/manual/zh/editor/assets/)说明可导入新文件夹。具体 `asset-db` 消息签名和返回行为以 Creator 3.8.8 实测为准。

## 当前证据

- `node --test`：1001 项通过，0 失败，0 跳过。定向测试覆盖嵌套目录、图片子资源、目录与文件身份、覆盖/越界/`.meta`/不支持格式拒绝、目标子路径在 asset-db 中已有孤立身份、源在预检期间变化、深度与文件数上限、符号链接、原生异常或不完整结果不重试。
- 在 `D:\AI\Game\arrow-puzzle` 的 Creator 3.8.8 中，原生 `asset-db:import-asset(外部目录, db://assets/目标, {overwrite:false,rename:false})` 导入含 JSON 与嵌套 TXT 的目录，根/子目录 importer 均为 `directory`，文件分别为 `json`/`text`；根/子目录及文件各有独立 UUID 和 `.meta`。
- 动态加载当前 `lib/asset-import-folder.js` 后，两次成功导入并完整核对：第一组含 JSON 与嵌套 TXT；第二组含 JSON、TXT、PNG、MP3，PNG 有 1 个子资源，MP3 importer 为 `audio-clip`。第二组根 UUID 为 `d8f46ec0-7f40-4844-9431-c6c216e57dfe`，四个文件均通过字节、元信息、`library` 与等待后稳定校验。
- 动态负例覆盖已有目标、路径越界、缺失父目录。补充 `.meta` 目标名保护后，Creator 模块缓存仍持有旧代码，首次动态负例意外生成一个未被 asset-db 登记的 `Op075Never.meta` 目录并在完整性校验处失败。该目录的四个文件逐一与本轮外部源样本核对路径和 SHA-256 后已单独删除；清除 Node 模块缓存重新加载修正版，同一目标在原生调用前被拒绝，磁盘无残留。
- 首组 `Op075Probe` 的根、子目录和两个文件通过 `query-asset-users` 与当前场景引用检查，均无外部使用者；只发送一次原生 `asset-db:delete-asset` 删除根 UUID 后，四个 asset-db 身份、目录及根 `.meta` 均消失。其余动态样本暂保留到正式入口和重开验收。
- Creator 关闭后，已将原扩展 137 个文件备份至 `E:\AIWork\CocosMcp\.local-install-backups\arrow-puzzle-cocos-mcp-kit-op075-20260926`；同步 12 个源码、入口及文档文件，源/安装 SHA-256 差异为 0。重开后 `/health` 仍指向 `arrow-puzzle` 工程身份 `758048aa923da9e57466f98a`，正式 `tools/list` 为 131 项且包含 `import_folder`。
- 正式 `import_folder` 把同一外部四文件目录导入为 `Op075Formal`：根 UUID `f88740aa-cd6a-4edd-9386-5dd0790f60fd`，嵌套目录 UUID `d9a23311-76aa-4975-84bc-91ae570582ea`；JSON、MP3、TXT、PNG 主 UUID 分别为 `814d7b12-eca6-4fed-b6c1-7631fbae5d28`、`6e51a11a-fb2e-4f20-9503-0d4c4ccfbd73`、`4d1e3444-c0c9-452e-bc50-b08a6b8a5c74`、`905487e4-a09e-4aa9-ac4b-747778c94fde`。PNG 子资源 `905487e4-a09e-4aa9-ac4b-747778c94fde@6c48a` 可通过正式 `inspect_asset` 单独读出。返回的八项验证全部为 true。
- 正式入口对目标已存在、路径越界、缺失父目录及 `.meta` 后缀目标均在原生调用前拒绝，`Op075Never.meta` 未重新生成。
- 再次完整关闭并重开 Creator 后，正式 `inspect_asset` 逐一检查三组临时目录共 16 个目录/主资源身份，全部 `complete:true`，UUID、importer、磁盘 `.meta` 与外部源字节 SHA-256 相符；两张 PNG 的 Texture2D 子资源 UUID 分别保持 `e98d40dc-71d1-4d49-839d-9ef59bd8160e@6c48a`、`905487e4-a09e-4aa9-ac4b-747778c94fde@6c48a`。
- 删除前检查三组样本的 18 个目录、主资源及子资源身份，`query-asset-users` 无外部使用者，当前场景无引用。随后每组仅发送一次原生 `asset-db:delete-asset` 删除根 UUID，所有子身份、根目录及 `.meta` 消失。工程 `assets` 恢复为 3519 个文件；以相对路径排序，合并“相对路径 + NUL + 文件 SHA-256 + LF”得到的快照 SHA-256 为 `372A58284BC329BDB50E127717FE001956EEA2415370D181CE0EF1D810B609D5F`，与验收前一致，`Op075*` 文件无残留。外部临时源样本也已清理。

## 结论与范围

在 Creator 3.8.8 的该工程中，OP-075 限定的外部目录导入已通过正式入口、完整重开及零残留验收，矩阵由 C 调整为 B。版本仍为 0.1.0 Unreleased，FR-05 总项继续保持未完成；下一项为 OP-076 资源刷新。此结论不涵盖其他 Creator 版本、场景/预制体/脚本、模型、其他复杂导入器或运行时视觉表现。
