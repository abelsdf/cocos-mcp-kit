# OP-071 常规资源安全删除验证

日期：2026-09-26

目标环境：Cocos Creator 3.8.8，`D:\AI\Game\arrow-puzzle`

工具：`delete_asset`

## 范围

- 将既有预制体专项删除保护扩展到已导入的 JSON、纯文本、图片和音频主资源。
- 删除前检查主资源与导入子资源的原生资源/脚本反向引用及当前场景引用。
- 同一图片内部 SpriteFrame 对 Texture2D 的引用随主资源共同删除，不应被当成外部引用；来自其他资源或当前场景的引用仍须阻断。
- 验证精确目标、工程路径边界、导入/只读状态、源文件与 `.meta`、资源字节、元信息及子资源身份，并在引用查询后再次核对，避免删除竞态替换后的资源。
- 只向 `asset-db:delete-asset` 发送一次请求；成功前确认 UUID/URL 查询、双向映射、源文件和 `.meta` 六项均已消失。

## 实现边界

- 常规资源首批只支持最大 64 MiB 的 `cc.JsonAsset`、`cc.TextAsset`、`cc.ImageAsset` 和 `cc.AudioClip` 主资源，以及 `.json`、`.txt`、`.png`、`.jpg`、`.jpeg`、`.webp`、`.mp3`、`.wav`、`.ogg`、`.m4a` 源文件。
- 目录、导入子资源、场景、脚本、预制体以外的 Cocos 序列化格式和其他类型被拒绝；预制体继续使用 OP-055 的专用保护。
- 不提供强制、级联、磁盘直删、自动重试破坏性请求或自动回滚。原生调用抛错或删除后回查失败时，结果可能已经变化，调用方必须先检查精确目标。
- UUID 原生引用查询不能发现运行时字符串、路径、bundle 映射或自定义索引，结果会返回明确警告。

## 自动测试

- `test/assets.test.js` 共 50 项通过：包含 40 项既有预制体删除/注册测试及 10 项常规资源测试。
- 常规资源测试覆盖四类成功删除、主资源和导入子资源引用阻断、asset-db/scene 就绪、无效查询结果、查询异常、路径/元信息/大小/身份拒绝、引用查询后的字节/元信息/子资源竞态、单次破坏性请求、延迟完成、原生异常和删除后查询异常。
- 图片夹具复现同一主资源内部的 SpriteFrame → Texture2D 使用关系；内部关系被统计但不阻断，外部资源和场景引用仍阻断。
- 修正后全量 `node --test` 为 966 项通过、0 失败、0 跳过。

## Creator 现场结果

首次同步版本通过正式 `/health`、`/tools` 和 `tools/call` 运行，工程身份为 `758048aa923da9e57466f98a`，`full` 仍为 127 项工具，`core` 仍为 40 项。

- 正式 `delete_asset` 成功删除 JSON UUID `d02c2420-8dd1-45d3-aa0f-ec1ae8bcf3ba`、文本 UUID `fab4c02d-4002-4372-9e00-a6d6f0f14263` 和音频 UUID `fece0a2c-0db5-4e37-87d7-1c0d597534e1`。三项均检查 1 个身份并报告六项删除确认全为 true。
- 图片 UUID `c5be3959-88a7-4dd5-8fd0-28dd06e56950` 的首次正式删除被拒绝。原生查询显示 Texture2D `@6c48a` 的使用者是同一图片 SpriteFrame `@f9941`，证明初版把资源内部关系误当成外部引用，没有发生误删。
- 修正后在同一 Creator 编辑器进程动态加载当前工作区 `lib/assets.js`。临时图片成功删除，检查主资源、Texture2D、SpriteFrame 共 3 个身份，报告 `internalAssetUserCount=1`，六项删除确认全为 true。
- 对原始 `ArrowHammer.png` 运行修正实现时，主资源与 SpriteFrame 各检测到 4 个外部资源使用者并拒绝删除；同一图片的 SpriteFrame → Texture2D 内部关系未出现在阻断详情中。原始资源未变化。
- 正式入口还拒绝了 SpriteFrame 子资源 UUID、`McpKitValidation` 目录、`ComplexRefs.scene` 场景和不存在的目标，均未发出删除请求。
- 四个 `Op071Delete.*` 现场主资源最终全部清理；正式 `list_assets` 的 `Op071` 前缀结果为 0，磁盘也没有 `Op071*` 残留。

## 最终安装入口复核

- 关闭 Creator 后备份已安装扩展，同步修正版并重开；工作区与安装副本的 `lib/assets.js` SHA-256 一致。
- `/health` 再次确认工程身份 `758048aa923da9e57466f98a`；`/tools` 返回 127 项，正式描述明确区分外部引用和同一主资源内部子资源链接。
- 通过正式 `copy_asset` 生成未引用图片 `Op071Final.png`，UUID 为 `e67481bb-7877-475e-887c-8304c66b140f`，含 Texture2D 与 SpriteFrame 两个子资源。
- 正式 `delete_asset` 删除该图片成功：检查 3 个身份，`internalAssetUserCount=1`，外部资源与当前场景引用均为 0，UUID/URL 记录、双向映射、源文件和 `.meta` 六项确认均为 true。
- 正式 `delete_asset` 对原始 `ArrowHammer.png` 仍检测到主资源及 SpriteFrame 各 4 个外部资源使用者并拒绝删除；Texture2D 的同源 SpriteFrame 使用者没有误报为阻断项。
- 正式 `list_assets` 与磁盘检查均确认 `Op071*` 残留为 0。原始图片仍为 UUID `7222d7a1-b348-41ec-9f8a-4eea647d8774`、23982 字节，SHA-256 `D26EC0920FC2B25ABA319179B031E59FEEE2BC2837A099C227F9A4AAE1944520`。
- 最终验收前后工程 `assets` 均为 3519 个文件；以排序后的相对路径、NUL、文件 SHA-256 和换行组合计算的快照 SHA-256 均为 `725DAC00D7BFA84F26896FEE1C28893C3F34B45F4AFA15B887400DBC36550D27`。

OP-071 已完成最终安装入口验收，可行性从 C 更新为 B；不将动态字符串/路径引用、目录删除和未列出的 importer 扩大为已支持能力。

## 限制

- 成功证明 Creator 3.8.8 的 asset-db 和磁盘已移除列出的资源身份，不证明游戏运行时已释放缓存对象。
- 64 MiB 与最多 64 个导入子资源的边界用于限制删除前快照和引用查询成本；更大或更复杂的 importer 需要独立设计。
- 只在 Windows、当前工程和列出的 importer 样本上现场验证；其他 Creator 版本及扩展 importer 组合仍需单独验收。
