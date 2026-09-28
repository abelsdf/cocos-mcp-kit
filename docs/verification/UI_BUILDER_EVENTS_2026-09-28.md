# JSON UI 构建器脚本与事件验证（2026-09-28）

## 交付与边界

基线 `a1e1de9`（FR-17）之后，扩展原 `build_ui` 与批次 DTO v1：节点可声明已导入工程脚本 UUID，顶层最多 50 条有序 Button 事件指向同批新脚本组件。core 43 / full 141，版本仍为 0.1.0 Unreleased。没有第二条创建路线，仍由同一批次完成预检、引用绑定、回读、限定清理和 Creator 3.8.8 单次 Undo。

通过开发文档检索/抓取技能核对 [Button 官方说明](https://docs.cocos.com/creator/3.8/manual/en/ui-system/components/editor/button.html)、[组件装饰器](https://docs.cocos.com/creator/3.8/manual/en/scripting/decorator.html)和本机公开类型声明。事件使用公开 EventHandler 的 target/component/handler/customEventData；UUID→注册类沿用已有脚本挂载工具，方法检查复用原按钮绑定实现。没有引入第三方实现。

文档明确了 `executeInEditMode` 和自动组件依赖的影响，因此不承诺脚本构造、生命周期或销毁回调的任意外部副作用可恢复。含脚本的场景执行报告返回 `scriptEffects:"not_audited"`，两项写工具保守设置 `destructiveHint:true`。清理 complete 只证明本批节点移除，不证明旧内容、资源或外部状态未被脚本修改。

本次不生成脚本源码，不设置任意脚本字段、不绑定旧节点/外部目标，不支持原型方法以外的实例箭头函数字段，不自动保存或调用事件。详细字段与示例见 [UI_BUILDER.md](../UI_BUILDER.md) 和 [NODE_BATCH_DTO.md](../NODE_BATCH_DTO.md)。

## 自动验证

- 新增 **30 项**：UI 编译 11、场景执行 16、编辑器资产预检 2、DTO 1；旧按钮方法校验测试继续复用。编译和场景正向测试在实现前失败，再由同一批次实现使其通过。
- 定向 **270/270** 通过，覆盖嵌套/前向事件目标、脚本资产核对、静态非法输入、缺失/保留方法、同节点重复类、不同节点同脚本、有序事件、空数据、事件回读失败、类注册漂移、未声明依赖、收养旧子树不递归删除，以及原视口/构建/批次/事件能力。
- 全量 **1262 项，1259 通过，3 失败，0 跳过**。失败仍为原有 Skills 换行问题：`UI skill v1 with a manifest can upgrade to v2`、`UI skill v1 without a manifest can upgrade to v2`、`legacy Codex UI v1 migrates with a backup and preserves the original file`；未修改该模块，不能宣称全量通过。
- 全部 **71** 个语法检查、工具目录生成/校验、发布清单和差异格式检查通过；没有生成安装包或发布新版本。保留 Funplay 版权、完整 MIT 许可与独立包身份。

## Creator 3.8.8 正式入口

工程为本工作区隔离 `temp/op055-project`，未触碰 CouchArcade。部署前备份扩展，用 `--project` 启动。专用场景 `UiEventsValidation.scene`，UUID `f16d396d-440d-4d69-bc57-f12f75ba7e4a`；新增专用脚本 `UiBuildActionProbe.ts`，UUID `5048c96a-e9c0-43d1-b758-7a5c1ddafbc7`。该脚本只计数、记录参数/来源节点并更新自身 Label，未开启编辑态生命周期。

最终 6 个变更运行文件与隔离工程安装内容哈希一致；最后重启的只读复核确认保存场景与原资源未变，正式 tools/list 仍为 141 项，两个写工具均返回保守风险注解，随后正常退出测试 Creator。

| 检查 | 结果 |
| --- | --- |
| 正式构建 | build_ui 创建两个根、6 个组件、1 条普通 Button target 引用和 1 条事件；脚本位于第二个根，按钮事件前向指向该组件。返回 created/verified=true、eventCount=1、Undo recorded=true，视口报告完整。 |
| 无隐式事件调用 | 构建后脚本 hits=0；事件目标、注册名 UiBuildActionProbe、handleAction 方法及 resume 字符串准确。 |
| 旧内容保护 | 构建前将 Sentinel 原生改名为 PriorUnsaved，未保存；构建/撤销/重做后该改名及 Observer 的传入节点引用保持，原场景磁盘哈希未变。 |
| 重复调用 | 原请求根同名，preflight 阶段拒绝，无节点或事件追加。 |
| 单次 Undo/Redo | 一次 Undo 删除两根及脚本/事件，Redo 恢复相同节点/组件 UUID、目标引用和事件字段，不丢失前一未保存修改。 |
| 无写入拒绝 | 缺失方法、onLoad、引擎 destroy、未注册脚本 UUID、非字符串事件数据、外部目标均在 preflight 拒绝，cleanup=not_needed，场景快照保持。 |
| 挂载/事件故障 | 临时钩子仅对专用失败节点抛出 addComponent 或 clickEvents setter 异常，分别报告 create/events 阶段；本批节点全部清除，取消本次录制，旧内容和前一 redo 保留。钩子均在 finally 恢复，不开放生产故障参数。 |
| 保存/切换重开 | 显式保存，切换 Blank 后重开；脚本组件、默认字段、事件字段和节点/组件身份完全一致。 |
| 引擎实际事件派发 | 重开后调用公开 EventHandler.emitEvents，传入包含按钮节点 target 的事件对象。脚本 hits 从 0 到 1，收到 resume 和真实按钮 UUID，Label 变为 Clicked 1: resume；再保存重开，这些结果保持。 |
| 完整退出/重启 | 脚本/事件身份及上述字段保持；再次派发同一已保存事件，hits 从 1 到 2，Label 为 Clicked 2: resume，再显式保存。测试结束正常退出隔离 Creator。 |
| 原资源 | 测试前 104 个资源文件 SHA-256 全部不变；只新增专用 scene/.meta 和 ts/.meta，测试代码和证据均在忽略目录。 |

最终场景 SHA-256：`cb8881a4b554d73666521e83b5b8842a243e0c0e6f2c528176af859d47619cb3`。原始证据为 `temp/ui-events-verify.js`、`temp/UiBuildActionProbe.ts`、`temp/ui-events-evidence.json`，不提交或打包。

首次测试在 Creator 启动未完成时调用 get_editor_state，因无活动场景超时，未创建测试资源；随后改用已验证的 get_project_info 核对工程身份，打开专用场景后继续。没有修改或扩大该状态工具的实现范围。

以上是正式编辑器中的结构/恢复/持久化及真实引擎程序化回调验证，不是物理鼠标点击、Game View/浏览器运行、触控命中或视觉验收。其他 Creator 版本、任意脚本生命周期、网络/资源副作用和并发编辑未验证；阶段 2 完整点击验收项保持未勾选。下一功能为新建场景入口及未保存内容处理。
