# FR-10 UI 结构与引用检查验证

日期：2026-09-28。Windows、Node.js v24.15.0、Creator 3.8.8。新增 full 只读 `validate_ui`，core 43 / full 143。调用与规则边界见 [UI_VALIDATION.md](../UI_VALIDATION.md)。

## 实现与测试

场景侧检查明确节点的 UITransform、Sprite/Label、Button 事件及 Widget/Animation 共存；编辑器侧复用 FR-17 视口查询，校验资产元数据并生成有界报告。无第二条写入路线、自动修复或新依赖；事件验证复用已注册组件和声明方法解析，不执行方法。

先运行新增测试得到缺失模块失败，再实现功能。新增两个测试文件共 **39 项**，覆盖参数、规则/节点排除、非对称 Canvas 锚点和设计尺寸、越界/几何缺失、资源类型与 Font 子类、查询失败、缺失/编辑器临时节点、事件目标/组件/方法/访问器、无事件按钮、事件数量上限、Widget 潜在冲突、报告截断、只读及查询期间状态变化。查询失败和中途元数据变化使用单元故障注入，没有篡改真实 asset-db 服务。

全量首轮发现中文面板说明遗漏，补充 `validate_ui` 中文说明并重跑后，**1398 项，1395 通过、3 项失败、0 跳过**。失败仍为既有基线：

- `UI skill v1 with a manifest can upgrade to v2`
- `UI skill v1 without a manifest can upgrade to v2`
- `legacy Codex UI v1 migrates with a backup and preserves the original file`

相关检查（新增模块、视口、按钮、工具注册及中文面板）**147/147 通过**。不宣称全量测试通过；未修改无关 Skills 迁移实现。本地忽略日志为 `temp/fr10-full-tests.log` 和 `temp/fr10-focused.log`。

75 项 JavaScript 语法检查、工具文档一致性、发布检查和 `git diff --check` 通过。`npm pack --dry-run` 使用仓库内临时缓存复核清单，确认两个验证模块、契约/报告及完整 LICENSE 在包内，排除 `temp/`、`.firecrawl/` 和 AGENTS.md；没有发布 npm 包。

## 真实 Creator 验证

使用仓库内既有隔离工程 `temp/op055-project`，工程名 `op055-validation`，UUID `e5055f21-1699-4530-8d40-5a7e12575caa`，MCP `127.0.0.1:27855`。更新扩展前完整备份旧扩展到 `temp/fr10-extension-backup`，正常退出并用 `--project` 重启该实例。未关闭、更新或改动用户的 CouchArcade 工程。

重启进入 Creator 空白临时场景，正式 `create_scene` 按保护规则拒绝从未保存场景切换。确认隔离实例身份、空白场景序列化保持后，仅测试引导调用原生 `asset-db:open-asset` 打开既有验收场景；未放宽正式工具保护，也未把临时场景保存到原资源。

通过正式 `create_scene(mode="ui")`、`get_ui_template`、`build_ui` 创建独立 `UiValidationChecks.scene`。暂停菜单包含 9 节点，复用隔离工程的白色 SpriteFrame 与 `UiVisualClickProbe` 脚本，三个按钮绑定 `onAction`。每次样例变更后均显式保存、切换到原场景再打开测试场景，比较原生 scene JSON 一致，然后调用正式 `validate_ui`。

| 样例 | 实测结果 |
| --- | --- |
| 正常 UI | complete=true / passed=true，0 问题 |
| 面板整体移至 x=3000 | 9 项 `outside_design_range`，节点身份明确 |
| 全局排除 design_bounds | 排除项回显，0 问题；只代表剩余规则通过 |
| 仅排除面板 design_bounds | 剩余 8 项越界，不隐藏子节点的问题 |
| maxFindings=1 | 输出 1 项、总数 9、truncated=true、complete=false |
| 清空面板 SpriteFrame | 1 项 `missing_asset` |
| 按钮方法改为不存在的方法 | 1 项 `invalid_event`，定位按钮和事件索引 |
| 清空按钮事件 target | 1 项 `invalid_event` |
| UITransform 宽度设为 0 | `invalid_ui_rectangle` + `bounds_unavailable`，complete=false |
| 请求不存在节点 | `node_not_found` + 5 项未检查，complete=false |
| 恢复尺寸、资源及事件并重开 | complete=true / passed=true，0 问题；探针 hits 仍为 0 |

每个正式检查前后均比较原生 scene JSON 和全部 assets 文件 SHA-256，一致；说明检查没有修改本批样例。测试结束回到原 `UiVisualAcceptance.scene`，序列化与最初一致，**120 个原 assets 文件哈希不变**，仅增加测试场景及 `.meta` 两个文件。样例、证据 JSON 和辅助脚本留在忽略目录，不进入源码包。

## 输出规模与边界

以下为正式工具 `data` 的紧凑 JSON UTF-8 字节数（不是 token；不含 MCP 外层）。9 节点正常报告 **790 B**，9 项越界 **3870 B**，截断为 1 项 **1140 B**；其余样例 814—3580 B。11 次调用连同只读比对耗时 57—105 ms，这是单次本地观测，不是性能保证。

本轮未截图、未真实鼠标点击，也未修改禁用按钮视觉样式。自定义字体/动态资产和 Widget/Animation 潜在冲突仅单元验证，不声称字体渲染或实际动画轨道冲突已通过 Creator 验收。`visualValidation` 始终为 `not_run`；遮挡、遮罩、运行时监听器、任意脚本引用和动画轨道仍在首版范围外。FR-11 的定位/裁剪/失败提示及组合验证流程为下一任务。
