# OP-063 编辑态能力诊断验证（2026-09-22）

## 范围与契约

新增 `test_prefab_edit_mode`，仅在 `full` 配置暴露；`full` 共 123 项，`core` 仍为 39。它是针对明确对象的只读诊断，不是在用户场景自动执行进入、保存和退出的测试套件。

```js
const report = await test_prefab_edit_mode({ prefabUuid: '精确的工程预制体资产 UUID' });
// report.checks 是逐项结果；即使读取通过，也要单独检查未保存差异。
// mutationTests.enter / save / exit 始终为 'not_run'。
```

- 只接受非空 `prefabUuid`；不接受路径、节点选择器、save/force 等选项。非法参数在查询前拒绝。
- 复用已有源文件和编辑根保护：工程内真实路径、导入状态、只读标记、UUID/meta、最多 8 MiB 的源内容、严格序列化身份及非嵌套限制。显式资产引用最多检查 5000 条，缺失、查询错误与截断分别计数。
- 环境不支持、资源缺失、查询错误等记录为检查失败；前提不足记录 `not_checked`，不猜测替代原生消息，不用创建临时实例来“验证”。错误文本最多 500 字符。
- 仅目标已处于当前受支持的 prefab 编辑态时调用既有 `getPrefabEditingState` 和 `getdata-prefab`。普通场景或其他预制体编辑态下，目标保持未打开，`editing: null`。
- 不打开、保存、关闭、记录原生快照、创建、丢弃、回滚或改写文件；不返回可替换进入/上次保存乐观并发令牌的 `sourceHash`。

固定八项检查：

| 检查名 | 检查对象与结果含义 |
| --- | --- |
| `assetDatabase` | 资源数据库是否 ready。 |
| `editorContext` | 场景 ready、模式、当前资产、dirty、单标签一致性；允许读取脏状态，不清除它。 |
| `sourcePrefab` | 指定源文件、meta、序列化根及非嵌套身份。 |
| `sourceReferences` | 源序列化中的显式资产引用摘要。 |
| `originScene` | 保留原场景的资产身份和序列化，与已保存源是否相同。 |
| `editingRoot` | 已打开目标的编辑根、结构及内容与源是否相同。 |
| `liveReferences` | 实时预制体序列化中的显式资产引用摘要。 |
| `stability` | 再查上下文、源/原场景内容及 meta、编辑根和实时序列化，检查两次观察是否一致。 |

每项状态为 `passed/failed/not_checked`。外层 `ok: true` 仅表示报告生成成功。`readChecksPassed` 表示没有读取检查失败，允许存在未检查项；`complete` 表示八项全部通过。两者均不表示内容干净，也不是进入/保存/退出的许可或实测证明。

`editing.sourceMatchesLive`、`structureMatchesSource` 分别报告内容/结构比较；`hasUnsavedChanges = context.dirty || !sourceMatchesLive`，防止将未标脏修改误报为已保存。`originScene.matchesSavedContent` 独立报告原场景差异；prefab 模式下保留原场景的 dirty 不可据当前查询推出，返回 null。观察结果正常读取但内容不同，不应冒充“查询失败”。

`observationsStable` 在复查成功时为 true，复查失败时为 false，缺少前提不能复查时为 null。它仅指两次查询观察，不是事务锁、未来状态保证或全部外部依赖的稳定性证明。

## 官方依据与独立实现

通过开发文档检索和页面读取技能核对 [Creator 3.8 Message API](https://docs.cocos.com/creator/3.8/manual/zh/editor/extension/api/message.html)，并只读安装版公开 `node_modules/@cocos/creator-types/editor/message.d.ts`。公开文档说明消息请求与广播方式，未提供可证明任意编辑态写消息实际工作的通用能力枚举接口。因此不把 `Editor.Message.request` 存在、版本号或读取成功推断为进入/保存/退出可用。

本项按开发计划将写测试留给显式调用和独立测试工程，报告中 `mutationTests` 始终为 `not_run`。未读取或引入受限插件实现，未新增版本白名单或猜测型写消息探针。

## 自动化测试

- 新增 `test/prefab-edit-test.test.js` 55 项，每个夹具先断言工具存在；实现前 55 项失败，实现后 55/55 通过。
- 模拟消息只允许预期只读查询，场景桥只允许 `getPrefabEditingState`；任何其他消息或桥方法令测试失败。覆盖正常/未打开/其他目标、dirty=true/false、内容与结构差异、原场景修改、重复调用和只读注解。
- 覆盖非法参数、编辑器缺失、资源库未就绪、异常模式/标签、源与原场景身份/meta/路径/导入限制、错误序列化、嵌套/向外场景引用、缺失引用、查询错误、5001 条引用截断和错误输出上限。
- 覆盖上下文、源文件、原场景文件/实时内容、编辑根和序列化的并发漂移；失败不能继续报告稳定或全部检查通过。
- 相关回归 631/631：诊断/退出/保存/进入编辑、编辑根、还原、应用、解除关联、实例化、工具目录、节点查询、资源与预制体。
- 全量 914 项，911 通过、3 失败、0 跳过。仍为 `UI skill v1 with a manifest can upgrade to v2`、`UI skill v1 without a manifest can upgrade to v2`、`legacy Codex UI v1 migrates with a backup and preserves the original file` 三项既有 Skills 换行/哈希失败，未修改其实现或夹具。
- `npm run check`、`npm run docs:check`、`git diff --check` 通过；全量套件不是全部通过。

## Creator 3.8.8 正式入口验收

Windows / Creator 3.8.8，忽略目录 `temp/op055-project`，MCP `http://127.0.0.1:27855/mcp`。三个改动源码文件与安装副本 SHA-256 一致，最终代码经过完整编辑器重启。未修改 `F:\AIWork\CouchArcade-main`。

专用 `Op063Final.scene` UUID 为 `a4cd0778-7d2e-4268-a9f7-021ee1ad93c6`，包含三份独立源副本的实例，根位置覆盖为 `(110,-20,5)`；Observer 持有 Refs 根和 Caption Label 的传入引用，预先保存重开确认有效。

| 预制体 | 节点 / 组件 | 核对内容 |
| --- | --- | --- |
| `Op063Ui.prefab` | 2 / 4 | Sprite、SpriteFrame、Caption 文本和 UITransform；未打开、已打开、重复诊断及重启后检查。 |
| `Op063Refs.prefab` | 2 / 6 | 自定义脚本的节点/Label/SpriteFrame 引用、Button target/component/handler/data；属性修改、向外场景引用失败报告、独立显式保存后重开与重启检查。 |
| `Op063Plain.prefab` | 2 / 0 | 缩放和子节点属性；未标脏修改识别，明确恢复已知原值后重新检查。 |

累计记录 26 次报告核对，涉及 24 个不同标签（其中两次为恢复驱动后重复的 UI 检查），另有 4 次非法参数拒绝。逐次比较模式/资产/dirty/标签、完整节点组件运行快照、保留原场景序列化和选择，并核对源/meta、原场景文件及历史保留文件未变；不是只检查工具返回成功。

1. 普通场景下三类目标均不自动打开：读取可通过，但编辑根未检查，`complete: false`。原场景脚本直接修改、dirty=false 时正确报告与磁盘不同，诊断不恢复该值。
2. 三类目标由驱动显式进入后八项通过；同一目标重复报告一致。正在编辑 Refs 时诊断 Ui，不切换目标，Ui 的实时检查为 `not_checked`。
3. 缺失 UUID 返回源检查失败；已有真实嵌套预制体返回不支持；Refs 指向外部编辑场景的脚本引用导致编辑根检查失败。报告生成后现场保持原样，没有替代打开、保存或退出。
4. Plain 实时缩放改为 `(4,5,6)` 时 dirty=false，但 `sourceMatchesLive: false`、`hasUnsavedChanges: true`；驱动明确恢复原值后未保存差异消失。
5. Refs 的脚本 calls 改为 63、Caption 改为 `OP-063 diagnostic saved`，原生 dirty 仍为 false；报告通过内容比较识别修改。驱动随后单独调用已有 `save_prefab_edit_mode`，再诊断为已保存，之后显式退出、保存原场景、切换并重开；值、Button 绑定及内外引用保持。
6. 独立退出操作曾使原场景 dirty=true，但序列化未变；诊断如实返回该状态且不清除。驱动明确保存后再继续。当前轮未成功构造 prefab dirty=true 的原生样本，该分支以单元测试验证，不冒称真实编辑器通过。
7. 正常关闭测试主进程并确认退出后，以同一工程完整重启；三类目标重新进入诊断均通过，原场景实例、属性、引用及哈希保持。再次显式保存/重开，场景语义和文件哈希不变。最后正常关闭并确认本任务测试主进程退出。

驱动校正记录：一次显式原场景保存返回后，文件写入尚未稳定，旧哈希断言失败；等待文件稳定并与场景序列化一致后再继续，加入调用前哈希检查。另一次驱动错误地要求修改后 dirty 必为 true，改为记录实际标记并检查真实内容差异；功能实现未为这些断言改动。重启时第一次误用 `--path`，未加载工程且 MCP 连接被拒绝；依据 [3.8 官方命令行参数](https://docs.cocos.com/creator/3.8/manual/en/editor/publish/publish-in-command-line.html)改用 `--project` 后完成重启验证。只结束本任务误启动的进程，不影响其他 Creator。

最终持久化证据：

- 场景 SHA-256：`1c4b1e8487a8e66e30aa471fb463e106264c25eed8d982f0bcc15d8d97180302`。
- Ui UUID `82fc75aa-6073-4204-88f4-f76db49a7bf4`，SHA-256 `a84fd789427cc62b98ae1f66ca7914e3d4559f968944d27336040475ddeb29b4`。
- Refs UUID `0bead6d5-35d1-4691-8f6d-f3f5f9b0d452`，显式保存后的 SHA-256 `b557ae39f097c8ec87e1a5e9e0bdd39033f3bea2d6948a6b46eac468ae567c46`。
- Plain UUID `e1663fed-8a0d-4ba5-9cbe-6a0d3b77a21d`，SHA-256 `6e13d112c864a43709d211bd108f828e09e1e44cc67001a0d8d26af2a456bee9`。
- 三个专用源的 `.meta` 均未变。OP-062 保留的 42 个文件，加其三个正式源/meta、正式场景/meta 和 DirtyReturn 场景/预制体/meta，共 54 个历史保留文件哈希不变。

本机驱动 `temp/op063-final-verify.js`、记录 `temp/op063-final-evidence.json` 与样本均留在忽略目录，不进入提交或发布包。测试驱动创建样本、修改属性、保存和退出的行为与正式只读诊断严格分开。

## 限制与下一项

- 不是自动写操作自测，也不证明某个项目可以安全进入、保存或退出。调用各写工具时仍需重新满足其参数、并发和现场保护条件。
- 仅核验 Creator 3.8.8 上述样本。其他版本、原生查询故障、并发漂移和截断场景主要由模拟覆盖；不提供完整动态依赖、游戏运行、真实 Button 点击或 GUI 视觉验收。
- 不支持未保存新场景、多场景、嵌套或不可完整读取的编辑态；这些情况会报告失败或未检查，不自动绕过。
- FR-05 完整 CRUD 总项保持未完成；下一项为 OP-064 资源信息查询 `query_info`，区分原文件、子资产与导入器信息。
