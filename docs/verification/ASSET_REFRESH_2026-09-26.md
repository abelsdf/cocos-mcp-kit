# OP-076 精确资源刷新验证（2026-09-26）

## 实现边界

- 新增 full-profile `refresh_asset`：只接受工程 `assets/` 下单个已存在的 JSON、UTF-8 文本、图片或音频普通文件，最大 64 MiB；目标可为精确 db URL、工程资源路径或 `assets` 内绝对路径。目录、`assets` 根目录、场景、预制体、脚本、`.meta` 和符号链接路径不纳入此入口。
- 预检源字节、现有 asset-db 身份与元信息；若数据库尚未登记且没有孤立 `.meta`，允许单次刷新导入新文件。只请求一次 `asset-db:refresh-asset`，再有界等待资源数据库就绪并两次核对源哈希、主/子资源身份、磁盘/数据库元信息和 `library` 产物。已有资源的身份与 importer 设置须保持。原生返回不确定时不自动重试。
- 该工具检查刷新后的身份和导入状态。若 Creator 原本已认为资源为最新状态，不能单凭 `refresh_asset` 返回证明 `library` 文件重新生成；需要证明重新生成时应使用 `reimport_asset`。原有 `refresh_assets` 是尽力辅助入口，未升级为持久化证明；其精确刷新失败后不再退回刷新整个工程。
- [Cocos Creator 3.8 偏好设置](https://docs.cocos.com/creator/3.8/manual/zh/editor/preferences/)说明编辑器可自动或手动刷新资源；具体 `asset-db` 消息参数与实际结果仍须以本机 Creator 3.8.8 核对。

## 当前证据与待验收

- 单元测试覆盖已有图片及子资源身份、新 JSON 文件、MP3 `audio-clip` importer、目录/不支持格式/越界拒绝、孤立 `.meta`、类型不符、源在刷新期间变化、子资源身份变化、忙碌数据库、原生结果不确定以及旧辅助入口不扩大刷新范围。
- `node --test` 全量 1012 项通过，0 失败，0 跳过；文档生成检查、发布检查、语法检查及 `git diff --check` 通过。
- `D:\AI\Game\arrow-puzzle` Creator 3.8.8 的动态方法实测：现有 `ArrowHint.png` 精确刷新通过，主 UUID `1b3c2630-2ff7-4455-a872-072e320c0d8c` 与 2 个子资源身份保持；新建 `Op076RefreshProbe.json` 经 `refresh-asset` 获得 `cc.JsonAsset/json`、UUID `af292f4a-6a5a-4bb4-9f34-177b978990a8`；新建 PNG 获得 `cc.ImageAsset/image`、UUID `51b2d001-4bcf-4f40-af24-64f29d5bfd1f` 与 1 个 Texture2D 子资源。外部修改该 JSON 后再次精确刷新，主 UUID 保持；`library` JSON 的 `version: 2` 与新的源内容一致，新 PNG 的 `library` 二进制 SHA-256 与源文件一致。三次动态结果均报告就绪、元信息匹配与稳定读取。
- Creator 关闭后，原扩展 139 个文件备份到 `E:\AIWork\CocosMcp\.local-install-backups\arrow-puzzle-cocos-mcp-kit-op076-20260926`；同步 11 个运行/文档文件到工程扩展，源与安装文件 SHA-256 差异为 0。重开后 `/health` 工程身份仍为 `758048aa923da9e57466f98a`，正式 `tools/list` 为 132 项且含 `refresh_asset`。
- 完整重开后，正式 `inspect_asset` 查得 JSON 主 UUID `af292f4a-6a5a-4bb4-9f34-177b978990a8`、PNG 主 UUID `51b2d001-4bcf-4f40-af24-64f29d5bfd1f` 与 Texture2D 子 UUID `51b2d001-4bcf-4f40-af24-64f29d5bfd1f@6c48a` 均保持，`complete: true`，磁盘 `.meta` UUID 一致；源 SHA-256 亦保持。
- 正式 `refresh_asset` 分别刷新上述 JSON、PNG 与已有 `ArrowHint.png`，三个调用的源字节、主/子 UUID、importer 设置、导入状态、数据库就绪、`library` 可用性及等待后稳定性验证全部为 true。`assets` 根目录、普通目录、`.scene`、越界路径和 PNG 子资源目标均在原生调用前拒绝。首轮拒绝提示因共享路径校验器出现 `copy_asset` 字样，虽然实际没有调用复制或扩大刷新范围；校验器现已接收操作名。修正版完整重开后，正式 MCP 入口对根目录、普通目录和 `.scene` 均返回 `refresh_asset supports ...`，不含 `copy_asset`；已有 `ArrowHint.png` 再次刷新通过，原主 UUID 和两个子资源仍保持。
- 删除前通过原生 `query-asset-users` 检查两项主资源与 PNG 子资源，外部使用者均为 0。正式 `delete_asset` 分别只调用一次原生删除，返回文件、`.meta`、UUID/URL 双向映射均不存在；当前场景引用数为 0。最终 `assets` 共 3519 个文件，按相对路径排序汇总“路径 + NUL + 单文件 SHA-256 + LF”的 SHA-256 为 `372A58284BC329BDB50E127717FE001956EEA2415370D181CE0EF1D810B609D5F`，与 OP-075 清理后的基线完全一致，两项 `Op076RefreshProbe*` 文件无残留。

## 结论与范围

OP-076 限定的精确单文件刷新已在 Creator 3.8.8 通过动态方法、正式 MCP 入口、完整重开及零残留验收，矩阵由 C 调整为 B。当前仍为 0.1.0 Unreleased，FR-05 总项保持未勾选。结论不覆盖目录/根刷新、脚本/场景/预制体或其他导入器，也不把原生空返回视为产物重新生成的证明。
