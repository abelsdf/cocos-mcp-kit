# 首版安装包内容、来源与 MIT 审查

日期：2026-09-30。源码基线 `73ab8e160668246a71de121d065953ad9e15aad8` 加本轮打包边界修改；版本仍为 `0.1.0` / Unreleased。基线已推送 `origin/main`；本轮新修改未提交，没有创建 GitHub Release、npm 发布、Registry 注册或启用自动更新。

## 发现与处理

1. 原 npm 清单为 195 文件，`docs/` 整目录入包，包括商业插件的原始 `tools/list` 描述、分析矩阵、含本机路径的开发验收记录及截图。正常接口观察不等于再分发许可，且这些内容不是扩展运行依赖。
2. 原 ZIP 清单同样收录整个 docs，但缺少 npm 包已有的 `RELEASE_WORKFLOW.md` 和 `RELEASE_CHECKLIST.md`。
3. 原 `release:check` 只确认 LICENSE 存在；路径/敏感内容检查到创建暂存目录后才执行，且未明确拒绝嵌套 AGENTS.md、环境文件、工具缓存或目录链接。

处理后，npm 与 ZIP 使用相同的明确入包列表：78 个运行 JavaScript、package.json、完整 LICENSE、6 个根目录说明文档和 11 个使用文档，共 **97 文件**。开发分析、商业接口原始记录、参考矩阵、验收记录/截图不随安装包分发，但没有从源码仓库删除。README 和使用文档中 63 个指向被排除资料的链接改指本项目源码仓库，离线包内保留本地使用文档链接。

增加完整 Funplay MIT 文本和 `license:MIT` 检查，允许 LF/CRLF、空白和附加声明，但不能删除版权、授权条款或免责声明。`release:check` 在暂存/打包前检查实际候选文件，拒绝越界路径、本地指令/环境文件、受限来源目录、非清单文档、运行目录中的非 JavaScript 文件以及链接/特殊文件。既有凭据模式提前检查；它仍会跳过大于 1 MiB 或含 NUL 的文件，不是完整安全扫描。本轮实际候选均另行读取检查，没有借此跳过候选内容审查。

## 来源清单与证据边界

- **Funplay 底座**：现有 README、需求及初始仓库快照记录使用 0.6.3 / MIT。当前 LICENSE 与本仓库初始提交 `077b740` 的文本在忽略换行后完全相同，保留原版权和完整条款；没有把本仓库初始提交当成上游固定 commit。双语 README 的归属和独立分支声明保持。
- **新增实现**：当前 78 个运行脚本均为本仓库原有文件，本轮没有修改运行代码。审查所依据的来源记录为 Funplay 底座与项目独立实现；UI 模板不附带商业模板、图片、字体或脚本资源，知识摘要记录官方 API/手册来源。
- **宿主依赖**：package.json 没有声明 dependencies、optionalDependencies、bundledDependencies 或 peerDependencies。运行文件中的静态非相对 `require` 仅为 Node 内置模块，以及 Creator 提供的 `electron` 和 `cc`；没有把宿主或游戏引擎打包。
- **Cocos 官方 CLI**：只保留官方 API 候选路线与既有分析结论，当前运行适配器仍 `not_configured`。没有复制或分发其源码；历史 MIT/ISC 元数据差异不被本审查擅自解释为已解决，未来直接引入另行固定提交与核查。
- **受限项目**：未访问、比较或复制受限项目代码。本轮候选路径中没有受限目录/载荷、第三方包、游戏资产或原始商业接口资料；运行脚本的受限项目/上游发布地址标识检查为 0 命中。该静态检查与现有来源记录支持本次有限内容审查，但不能凭关键词缺失证明任意代码不存在改写衍生关系，也不是法律鉴定。

随包版本的边界说明见 [SOURCES_AND_LICENSES.md](../SOURCES_AND_LICENSES.md)。仓库中的历史接口观察记录不因本轮审查而获得新的再分发许可；本轮未重新上传这些记录，也未清理历史提交。

## 实际压缩包检查

新建 `temp/package-audit-20260930-pv301V`，保留所有旧产物。npm 通过 `npm pack --json --ignore-scripts --pack-destination <新目录>` 生成真实 TGZ；ZIP 使用当前正式清单复制到独立暂存目录，再由本仓库已有 Windows ZIP 测试工具（`tar.exe`）生成。**没有运行正式 `release:package`，不把测试工具替代路径当作正式打包通过。**

| 内容 | ZIP | npm TGZ |
| --- | --- | --- |
| 文件数 | 97 | 97 |
| 压缩字节 | 409551 | 347855 |
| 解包后与当前源码逐文件 SHA-256 | 全部一致 | 全部一致 |
| 完整 LICENSE、双语归属、来源说明 | 保留 | 保留 |
| AGENTS、test、temp、缓存、node_modules、原始接口/验收资料 | 无 | 无 |

ZIP：`CocosMcpKit.v0.1.0.audit.zip`，SHA-256 `b440b16c28821a89b8a70f7fe353d57f221f7898fb330bdff623f7923279c8fb`。

TGZ：`cocos-mcp-kit-0.1.0.tgz`，SHA-256 `a4241bf072a013f9f12f489bc8270d31e7cf30f2444ca35236204892b1823a66`。

源码/ZIP/TGZ 的 LICENSE SHA-256 均为 `2cc95ff43d97fed2e5f5ec93fd607d5335563246c62c23bcc61e6cc9c992e979`。

全部候选文本检查既有 token/private-key 模式，以及本仓库历史验收资料使用的 Windows 工程/用户路径、Unix 用户目录模式，均 0 命中。目录、扩展名和静态模块清单亦已核对；不是任何形式个人信息/凭据的穷尽证明。文档可以保留上游致谢、原始变更历史和公开官方资料链接，但默认更新源 `LATEST_RELEASE_URL` 与发布 manifest 仓库地址仍为空，`private:true` 保持。`git remote` 自有源码地址不自动成为更新源，全局安装目标仍是独立 `cocos-mcp-kit` 目录。

## 验证与剩余项

- 新增发布检查回归 **15/15**：双清单一致、MIT 完整性/LF/CRLF、禁止文件/目录、包内文档链接、凭据模式、目录链接及检查阶段不产生发布产物。
- 完整自动测试 **1456/1456**，0 失败、0 跳过；语法、生成文档、发布检查及差异格式检查通过。
- 本轮没有场景/组件/资源行为修改，不启动 Creator，不操作 CouchArcade。以前的场景与真实点击证据保持原范围，不把它们冒充新包安装验证。
- 当前 Windows 环境只有可用的 `tar.exe`，没有正式脚本要求的 `zip`；正式脚本还会替换同版本旧发布目录。下一次最终打包需处理工具兼容和旧产物保留，不能直接覆盖现有产物。
- 本轮审查包不是最终交付包，也没有通过 Creator 扩展管理器安装、更新/卸载、其他系统、npm 发布或 Registry 验证。README 完整安装/已知限制更新和最终本地包任务继续保持未完成。

本地原始记录：`temp/package-audit-20260930-pv301V/audit.json`（文件/模块/哈希清单）、`temp/package-audit.js`、`temp/package-audit-tests.log`、`temp/package-audit-full-tests.log`。本报告在打包后添加，但不在入包清单内；包内源码/说明未因此变化。原始工程、日志和审查压缩包不提交。
