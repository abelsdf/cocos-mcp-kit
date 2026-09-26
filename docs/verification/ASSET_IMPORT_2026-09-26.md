# OP-074 外部资源导入验证（2026-09-26）

## 范围和边界

- `import_asset` 仅在 `full` 配置开放。一次导入一个本机外部普通文件，限定最大 64 MiB 的 JSON、UTF-8 文本、图片和音频；目标为工程 `assets/` 已存在目录下同扩展名的新路径。可选 `expectedSha256` 用于源内容冲突保护。
- 预检源文件、外部 `.meta`、目标路径、磁盘与 asset-db 冲突及数据库就绪；只发送一次 `asset-db:import-asset`，有限轮询确认目标字节、主资源新 UUID、磁盘/数据库元信息、子资源身份、`library` 产物与数据库就绪，并等待后二次核验稳定。原生结果不确定时不自动重试或覆盖。
- [Cocos Creator 3.8 资源管理器手册](https://docs.cocos.com/creator/3.8/manual/zh/editor/assets/)说明可把外部文件导入项目资源。具体编辑器消息签名及返回行为以 Creator 3.8.8 实测为准。

## 当前证据

- `node --test`：993 项通过，0 失败，0 跳过。定向测试覆盖 JSON 创建、图片子资源、`audio-clip`、目标冲突、过期 SHA、外部 `.meta`、非法 JSON、原生不确定结果不重试和符号链接拒绝。
- 在 `D:\AI\Game\arrow-puzzle` 的 Creator 3.8.8 中，动态加载当前源码并以真实 `asset-db` 执行四类单文件导入：JSON 为 `cc.JsonAsset/json`，TXT 为 `cc.TextAsset/text`，PNG 为 `cc.ImageAsset/image` 且含 1 个子资源，MP3 为 `cc.AudioClip/audio-clip`。四类均报告源文件未变、目标字节一致、主 UUID/元信息一致、`library` 存在、数据库就绪及等待后稳定；PNG 主 UUID 为 `e4efbc49-6af6-46ee-ba47-a58fcd5cc361`，MP3 主 UUID 为 `a1b0eeac-7f8a-4938-81d1-af46068f8aec`。
- 动态入口对已有目标、过期源 SHA、目标路径越界和扩展名不匹配均在原生导入前拒绝。为避免误删用户资源，六个临时导入样本保留到正式扩展入口及重开核验完成后，再经正式 `delete_asset` 清理并比对原始 `assets` 快照（3519 个文件，合并 SHA-256 `372A58284BC329BD50E127717FE001956EEA2415370D181CE0EF1D810B609D5F`）。
- Creator 关闭后，原扩展 135 个文件备份到 `E:\AIWork\CocosMcp\.local-install-backups\arrow-puzzle-cocos-mcp-kit-op074-20260926`。同步 11 个源码、入口及文档文件后，源/安装文件 SHA-256 差异为 0；重新打开的 `/health` 指向 `arrow-puzzle` 工程身份 `758048aa923da9e57466f98a`，正式 `tools/list` 为 130 项并包含 `import_asset`。
- 正式 `import_asset` 入口再次导入 JSON、TXT、PNG、MP3 四类：主 UUID 分别为 `9e963670-3540-4d23-bb85-ac494be363eb`、`50265891-ad3b-455b-883a-1d43d3836e59`、`ec2a783c-4933-4858-9710-b774b7addae7`、`be06d9ea-1e5a-4df8-ae6b-445cdc75d1c5`；类型/importer 对应 `cc.JsonAsset/json`、`cc.TextAsset/text`、`cc.ImageAsset/image`、`cc.AudioClip/audio-clip`，PNG 含 1 个子资源。四类的七项返回校验均为 true。正式入口对已有目标、过期 SHA、越界目标和扩展名不匹配均返回拒绝，没有创建 `Op074Never*`。
- 再次完整关闭并重开 Creator 后，正式 `inspect_asset` 检查原生/动态/正式入口共十个临时资源均为 `complete:true`，主 UUID、importer、目标字节、外部源 SHA-256 与磁盘 `.meta` 对应。两张 PNG 的 `cc.Texture2D` 子资源分别保持 `e4efbc49-6af6-46ee-ba47-a58fcd5cc361@6c48a` 与 `ec2a783c-4933-4858-9710-b774b7addae7@6c48a`。
- 十个临时资源均经正式 `delete_asset` 返回 `deleted:true`。清理后 `assets` 恢复为 3519 个文件；以相对路径排序并合并“相对路径 + NUL + 文件 SHA-256 + LF”得到的快照 SHA-256 为 `372A58284BC329BDB50E127717FE001956EEA2415370D181CE0EF1D810B609D5F`，与清理前基线完全一致，`Op074*` 文件无残留。

## 结论与范围

在 Creator 3.8.8 的该工程中，OP-074 限定的单文件导入通过正式入口、完整重开及零残留验收，矩阵由 C 调整为 B。版本仍为 0.1.0 Unreleased，FR-05 总项继续保持未完成；下一项为 OP-075 目录导入。此结论不涵盖其他 Creator 版本、目录批量导入、场景/预制体/脚本、复杂导入器或运行时视觉表现。
