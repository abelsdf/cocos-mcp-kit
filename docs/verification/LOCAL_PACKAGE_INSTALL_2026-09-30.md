# Windows 本地安装包交付与 Creator 安装验证

日期：2026-09-30。上一轮五个文档文件已提交并推送 `6e753084e33214fd6f446224b1cfc1e5892a605b`；推送后 HEAD、origin/main 和远端 main 一致。本轮为该基线上的正式打包脚本/测试/说明修改，尚未提交。版本保持 `0.1.0` / Unreleased，不创建 GitHub Release、npm 发布、Registry 注册、更新源或新版本标签。

## 本次实现

- Windows 正式打包使用系统 `tar.exe` 创建 ZIP 并读取清单；非 Windows 路线使用 `zip`/`unzip`，本轮未在其他系统运行。缺工具、归档读取失败、非法路径、文件遗漏或重复均不能跳过检查后返回成功。
- 每次生成 `releases/<version>/candidate-<unique>/`，保留旧同版本文件及不属于本次的暂存文件；只清理本次独立暂存目录。失败候选保留并明确报错，不报告 ready；归档检查失败时不写入清单。输出目录链接被拒绝。
- 候选清单标记 `local-candidate`，记录源码 commit 和 dirty 状态，实际不存在的 tag 为 null；发布源和下载地址仍为空。候选说明采用当前 Unreleased 内容，摘要取首项，不再把末尾上游历史说明当成本轮摘要。安装说明明确完整目标路径和旧扩展备份，提供 Windows 校验方式。
- 删除因候选说明简化而不再使用的 changelog 分节渲染辅助函数；未修改 78 个扩展运行 JavaScript、UI 模板行为、依赖或许可证。

## 可安装产物与内容核对

最终交付目录：`releases/0.1.0/candidate-EJPocd/`，由实际 `npm run release:package` 生成，而非测试工具替代打包。

- ZIP：`CocosMcpKit.v0.1.0.zip`，**418111 字节**。
- ZIP SHA-256：`5793a61780c733c22a4bc1ab57ed72563838ae5f9d1616bb66c8e8abf5f65f2f`。
- 同目录：`release-manifest.json`、`SHA256SUMS.txt`、`RELEASE_NOTES.md`、`README.md`；校验和文件中的四个产物均逐项核对通过。
- ZIP 解包共 **97 文件**：78 个运行 JS、package.json、完整 LICENSE、6 个根目录文档和 11 个使用文档。完整路径集合符合正式清单，逐文件 SHA-256 与本轮源码及实际安装目录一致。开发脚本/测试、AGENTS、缓存、原始商业接口记录、验收材料和游戏素材不入包。
- LICENSE SHA-256：`2cc95ff43d97fed2e5f5ec93fd607d5335563246c62c23bcc61e6cc9c992e979`；保留 `Copyright (c) 2026 Funplay`、完整 MIT 授权和免责声明。双语归属与来源说明保留。
- 本轮逐个候选文本的既有凭据/私钥模式和既有本机路径模式为 0 命中；不是穷尽的凭据、个人信息或任意代码来源鉴定。来源/许可判断沿用 [内容审查](PACKAGE_CONTENT_AUDIT_2026-09-30.md) 的限定边界，未访问受限项目源码。

清单记录基线 commit `6e75308`、`dirty:true`、`tag:null`，不会把包含未提交修改的包冒充该 commit 的纯净发布。npm dry-run 仍 97 文件；本轮未另外生成或发布 npm TGZ。

实际生成了三份独立候选。首份完成 UI 创建/保存/完整重启；随后修正候选摘要和外围安装说明，每份都保留并核对校验和。三份 ZIP 的 97 个解包文件逐字节一致，但 ZIP 本身摘要不同，分别保留而不视为同一压缩文件；包外生成元数据/说明也相应修正。最后一份仍直接解包安装并独立启动复核，没有仅凭“内容相同”跳过最终安装。

首份 `candidate-2ImwbR` 的 ZIP SHA-256 仍为 `0bd01836dc94a04effb9f79e791be5c90c3b6dee1aed5aa58d2db7da454d6bc7`；中间份 `candidate-4CnP5W` 仍为 `8448b2ec0f7373f255bbf6d8d07d6f4b7427f8a7fc5f4e22f38f812853fb35fa`。此前 `temp/package-audit-20260930-pv301V` 的整个文件哈希集合保持；没有覆盖或删除旧包。

## 真实 Creator 安装与持久化

仅使用已授权隔离工程 `temp/stage4-20260930/project-a`，Creator **3.8.8 / Windows**，工程 UUID `d39a315e-9101-4311-92d7-f7a5a5353462`，固定服务端口 `27930`。开始前通过进程启动参数确认该工程未运行；当前 CouchArcade 实例保持，未对其发送工具请求、替换扩展或修改资源。

1. 关闭目标工程时，将原 **187 文件**扩展移到 `temp/local-package-20260930/old-extension`，位于 `extensions/` 之外；从实际 ZIP 解包目录完整安装，未合并残留文件。后续两个候选同样完整安装，前两份安装目录另存 `first-candidate-extension` / `second-candidate-extension`，均不覆盖原备份。
2. 隐藏启动目标 Creator，使用**安装包自带** `bin/cocos-mcp-kit.js --url http://127.0.0.1:27930/mcp` 的独立 stdio 客户端完成初始化；核对真实工程/扩展路径、Creator 版本及 **full 144 工具**，不是只检查 HTTP 健康响应。
3. 先检查旧 AcceptanceUI 和 DisabledAppearance 的作者 JSON 与历史快照一致，随后新建 `LocalPackageUI`：三个模板共 **25 新节点、3 个控制器、8 个按钮、5 条事件和 11 个 Sprite**。五个启用事件为 resume/restart、music/close、retry；quit/sound/continue 不绑定且禁用。
4. 通过正式 `save_current_scene` 保存，再正式切换旧场景和重开新场景。比较完整原生场景 JSON，核对每条事件的控制器节点/组件/handler/customEventData、SpriteFrame 子资源 UUID、启用/禁用状态和静态背景/文字颜色；正式 `verify_ui` 结构检查通过，视觉仍明确 `not_run`。
5. 恢复原场景并正常退出该隔离 Creator，确认端点关闭；完整重新启动后核对同一新场景 JSON、上述引用/配色及 **12 个资产文件**的全部哈希。最后一份候选直接安装后，再次以该包自带 stdio 桥接完成相同持久化复核。
6. 测试后确认预览没有运行、原场景 JSON 未变，恢复 AcceptanceUI 并正常退出隔离实例；保留安装包、扩展备份和测试场景供复查。

原 **10 个资产文件**、工程 MCP 配置、原扩展备份及先前审查产物均保持原哈希。新增的场景与 `.meta` 共 2 文件保留；`LocalPackageUI.scene` UUID 为 `9fe69e1b-ee91-4bbb-bdf9-3b5382a738ef`，文件 SHA-256 为 `73138258df72d6fca1a9eefd13333db3298bcaef49a4afee0e8be33cab952bb3`。正式安装目录始终为候选中的 97 文件。

验收脚本首次把深层事件对象当作完整返回值，因 `execute_scene_script` 的有界快照显示 `[Object]` 而断言失败；调整为浅层字符串化事件字段后，从已保存场景继续核对，没有重复构建、忽略错误或修改扩展的截断策略。这是验收脚本读取方式问题，不计作一次未经修正的通过。

## 自动检查与明确边界

- 新增 **5 项**回归；相关发布测试 **20/20**：真实重复打包和解包字节、旧产物/共享暂存保留、缺工具、归档漏文件、非法路径、读取失败；同时断言实际标签、候选渠道、当前说明和校验和。
- 完整自动测试 **1461/1461**，0 失败、0 跳过；源码语法、生成文档、发布检查、npm dry-run 和差异格式检查通过。
- 离线文档复核：2 个 README JSON 示例可解析，40 个本地链接及 56 个源码仓库链接的本地目标存在，未请求在线页面。上一轮临时校验脚本还要求已删除的 `release:verify` 覆盖风险提示，更新为检查本轮实际 `release:package` 入口后通过；没有恢复过期警告或改动正式文档检查器。
- 本轮没有真实鼠标点击、Game View 截图或设备视觉重测；之前的 [视觉验收](FIRST_RELEASE_VISUAL_ACCEPTANCE_2026-09-30.md) 和 [禁用外观补验](UI_DISABLED_STYLE_2026-09-30.md) 保持原范围。结构、序列化颜色和引用通过不等于视觉/交互通过。
- 验收的是**手动清空旧目录后的完整文件安装**，不是 Creator 扩展管理器 ZIP 安装、自动更新、卸载、全局安装、其他版本/操作系统或所有预制体。没有填写自有发布渠道，也不宣布整体首版对外发布就绪或完整替代 Pro。

原始记录：`temp/local-package-20260930/evidence.json`、`verify.js`、解包目录及备份；自动日志为 `temp/local-package-full-tests-final.log`、`temp/local-package-npm-dry-run.log`。报告与 PLAN 不在入包清单，写入报告后再次核对安装/源码/ZIP 文件集合不变；测试产物、项目、日志和压缩包不提交。新报告链接在本轮修改提交推送之后才可从源码仓库在线访问。
