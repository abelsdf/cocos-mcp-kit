# OP-072 JSON/文本资源保存验证

日期：2026-09-26

目标环境：Windows、Cocos Creator 3.8.8、`D:\AI\Game\arrow-puzzle`，MCP `http://127.0.0.1:21482/`。

## 范围与实现

- `save_asset` 仅在 `full` profile 开放，支持已存在、可写且已导入的 `.json`/`.txt` 主资源，源与新内容均不超过 1 MiB。工具总数为 `full` 128、`core` 40。
- 接受精确 UUID、`db://assets` URL 或工程资源路径。保存前核对源文件与 `.meta` 均为工程内真实文件、asset-db URL/UUID/类型/importer、磁盘及数据库元信息，并再次读取以检测并发变更。`expectedSha256` 可选，冲突时不写入；JSON 新内容必须能解析。
- 内容不变时等待并再次核验后返回 `saved:false`、`method:none`。需要修改时只发送一次 `asset-db:save-asset`；成功须两次确认精确源内容、原 UUID/importer/元信息、导入与数据库就绪。原生调用或写后验证不确定时不会重复发送保存请求。
- 场景与预制体指向专用保存流程；动画片段、脚本、图片、音频、目录和导入子资源不由此入口覆盖。通用 `write_file` 和 `replace_in_file` 仍是文件系统编辑，不作为资源持久化证明。

## 代码与正式入口验证

- `node --test`：974 项通过，0 失败，0 跳过。定向 `test/asset-save.test.js` 与文件工具/注册表测试覆盖单次写入、稳定核验、空操作、SHA 冲突、无效/过大内容、导入与元信息拒绝、预检竞态、原生返回不确定和写后验证失败。
- `node scripts/generate-tool-docs.js --check`、`node scripts/release.js check`、相关 JavaScript 语法检查及 `git diff --check` 通过。`npm.cmd` 的本机入口仍缺失 `npm-cli.js`，故使用等价的直接 Node 命令。
- 扩展关闭时备份到 `E:\AIWork\CocosMcp\.local-install-backups\arrow-puzzle-cocos-mcp-kit-20260926-175542`，同步后核对 133 个安装文件哈希全部一致；重开 Creator 后 `/health` 返回正确工程身份 `758048aa923da9e57466f98a`，`/tools` 返回 128 项并包含正式 `save_asset` schema。
- 正式 `create_asset` 建立 `__McpSaveFormal_20260926.json`（UUID `b647dc17-24c5-4339-9540-873c2103f76d`）及 `.txt`（UUID `e422f275-4524-4ba4-b179-22a214a95127`）。正式 `save_asset` 分别以 UUID 和 URL 指定目标并提供当前源 SHA；两次更新均返回 `saved:true`、`method:asset-db:save-asset`，六项核验标记全为 true，UUID、类型及 importer 分别保持 `cc.JsonAsset/json`、`cc.TextAsset/text`。
- JSON 保存后 SHA-256 为 `2d6bdab30edecc129e2ca3f2c5fcb24fe455f4a616d9cf7b659650268463a88c`；TXT 为 `57cba10dbf252572f806ea89d172f14bed88eef7cf31485441d8cf684038de08`。正式 `inspect_asset` 与磁盘读取再次确认两个目标已导入、详情完整、源哈希一致。对相同 TXT 再保存返回 `saved:false`、`method:none`。
- 过期 SHA、无效 JSON、场景、预制体、图片和目录均由正式 `save_asset` 拒绝。安装前在同一 Creator 进程动态加载当前实现时，脚本和音频目标亦按类型拒绝；这些两类拒绝未重复走安装后的正式入口。
- 两个探针经正式 `delete_asset` 删除，UUID/URL 记录、双向映射、源文件及 `.meta` 六项均确认不存在。工程 `assets` 回到 3519 个文件；按相对路径、NUL、文件 SHA-256 与换行组合的快照 SHA-256 在测试前后均为 `725DAC00D7BFA84F26896FEE1C28893C3F34B45F4AFA15B887400DBC36550D27`。

## 结论与限制

在上述 Creator 3.8.8 工程中，JSON/文本主资源的正式保存入口可用，可行性矩阵中 OP-072 的限定范围由 C 调整为 B。该结论不扩展到 Cocos 序列化资源、二进制资源、其他 Creator 版本或运行时业务加载；样本保存后在同一编辑器会话完成 asset-db 与磁盘读回，未为此项再执行一次完整编辑器重启。
