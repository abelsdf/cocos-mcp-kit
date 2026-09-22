# OP-060 进入预制体编辑模式验证（2026-09-22）

## 实现范围

新增 `full` 工具 `enter_prefab_edit_mode`：`full` 从 119 增至 120 项，`core` 仍为 39。只实现进入和同目标状态核验，不实现 OP-061 保存、OP-062 退出，也不将直接修改 JSON 当作原生编辑模式。

- 只接受非空 `target`，支持精确资源 UUID、db URL、`assets/` 相对路径或源文件绝对路径；不猜测扩展名，不接受 `force`、自动保存/丢弃等选项。
- asset-db 与场景须就绪；原生模式只能是 `general` 或 `prefab`，要求单个匹配的干净标签页，禁止多场景模式、未保存新场景和未知状态。若已在其他预制体编辑态，要求显式退出后再进入。
- 原场景与预制体均须是工程 `assets` 内有效、已导入、非只读的资源，核对类型、URL、实际文件路径及 `.meta` UUID；源文本与原生序列化各最多 8 MiB。本操作不写源文件，但首版沿用非只读工程资源边界。
- 复用单根连通树、对象指针、组件归属、PrefabInfo/fileId 校验，完整检查最多 5000 条显式资源引用；首版拒绝嵌套预制体。源资源检查失败时不请求打开。
- `general` 模式不仅检查 dirty，还将原生场景序列化与磁盘比较；只规范化 `cc.SceneAsset._name`，实际 `cc.Scene` 名称和其他用户数据保留。再次检查上下文、源文件/meta 和原场景内容后，才发送一次 `asset-db:open-asset(UUID)`。
- 最多 21 次查询等待原生模式/目标身份一致，查询间隔 100 ms；不以打开消息返回值证明成功，不试探另一个消息或重试打开。
- 编辑根按源资源 UUID、`_prefab.root === node`、无实例身份定位，允许位于隐藏编辑器容器下；不靠名字猜根。最多扫描 5000 节点，找到唯一根后复用 OP-058 的完整子树和声明序列化字段检查，拒绝嵌套、向外场景引用、不透明序列化、访问器及不完整扫描。
- 比较实际根名称、source UUID、root/fileId、无 instance 标识以及完整规范化预制体序列化；核对源文件/meta、保留的原场景内容与文件未变。400 ms 后再次核验，运行节点/组件身份须稳定。
- 同一干净预制体重复调用不发送 open，只重新核验；返回 `alreadyOpen: true`、`method: null`、`previousScene: null`，不推断未知的上一个场景。
- 成功返回 `entered/verified: true`、`mode: prefab`、`needsSave: false`、目标与编辑根信息、节点/组件数量；从场景进入时返回 `previousScene`。这里只表示进入时未产生待保存内容，不承诺后续编辑无需保存。
- 原生 open 请求后若验证失败，明确提示可能已进入编辑模式，应先检查现场；不自动保存、关闭、丢弃、回滚或重试。预检和后检不是跨进程事务，调用期间不要并发编辑或切场景。

通用 `open_asset` 保持原行为，不具备上述专项保护。编辑态保存/退出仍需在 Creator 中明确处理，不能据本项声称这些后续操作已有完整安全契约。

## 官方语义与实测消息

通过开发文档检索技能定位并核对[官方预制体文档](https://docs.cocos.com/creator/3.8/manual/zh/asset/prefab.html)，以真实编辑模式、编辑后保存和关闭为独立动作确定范围。另只读安装版公开贡献清单 `builtin/scene/package.json`、`builtin/asset-db/package.json` 和公开 `.d.ts`；没有读取或引入受限插件实现。

以下为 Windows / Creator 3.8.8 的隔离实测，不是跨版本承诺。部分查询虽在贡献清单注册，但没有完整公开类型声明，因此必须核对返回结构，不能按名字假定成功。

| 消息 | 实测用途与边界 |
| --- | --- |
| `asset-db:open-asset(UUID)` | 对 `.prefab` 真正进入原生编辑模式；只请求一次，结果由后检确定。 |
| `scene:query-scene-mode` / `query-current-scene` | 场景中返回 `general` 与场景资产 UUID；预制体中返回 `prefab` 与预制体资产 UUID，而非生成的编辑场景 UUID。 |
| `scene:query-is-ready` / `query-dirty` | 就绪与脏状态；dirty 为 false 不足以证明没有待保存内容。 |
| `scene:multi-is-multi-edit-mode` / `multi-scene-query` | 核对单场景模式和唯一标签的 UUID、类型、URL、dirty。 |
| `scene:query-scene-json` | 场景态为当前场景序列化；预制体态仍返回保留的原场景，不能拿它当编辑根内容。 |
| `scene:getdata-prefab(editRootUuid)` | 取得真实编辑根的序列化，单独与源预制体比较。 |

实测隐藏容器 `should_hide_in_hierarchy` 下同时有编辑器相机与预制体根，根节点不是场景的直接子节点；不能复用仅识别 `_prefab.instance` 的实例列表来定位编辑根。asset-db 查询不直接接受源文件绝对路径，因此入口先校验路径及真实路径未逃出工程，再映射为精确 db URL；不补扩展名。

场景中直接设置脚本字段，以及请求原生 `set-property`、`record: true` 和 `snapshot` 后，都观察到内容已改变但 dirty 仍为 false；原场景序列化比较正确拦截。预制体中原生 Label 修改实际产生 dirty=true；原生 undo 清除了 dirty，但并未恢复测试文字和连带宽度。测试驱动按已知源值恢复文字和 UITransform 尺寸，再核对完整序列化；没有保存这些测试修改，也不承诺撤销栈可靠。

序列化比较沿用 OP-059 的有限规范化：资产/根名称、节点及明确组件运行 `_id`、空 `PrefabInfo.instance/nestedPrefabInstanceRoots`、空 targetOverrides 的 null/[]。此次实测 undo 还会省略空 `PrefabInfo.targetOverrides`，补充“缺省等价 null”的处理；只限该类型字段，不丢弃非空覆盖，也不忽略同名用户字段。场景名称、组件属性、UI 尺寸和用户 `_id` 仍严格比较。

## 自动化测试

- 新增 `test/prefab-edit-enter.test.js` 67 项、`test/scene-prefab-edit.test.js` 4 项，共 71 项通过。
- 初始 65 项在实现前有 38 失败、27 通过；部分拒绝用例也能被“工具不存在”满足，因此不把全部初始通过项当作旧行为符合要求。补充空标签页/null 和缺失 URL 用例，先复现 2 项失败再修正预检。
- 实测空 targetOverrides 省略后，补 2 项测试：等价默认值与同名用户字段差异；先复现前者失败，修复后两项通过。
- 绝对路径实测发现原生查询不直接接受文件路径后，补 2 项测试，先复现工程内路径失败与工程外路径边界错误，再修正为有边界校验的精确 db URL 映射。
- 覆盖精确目标、类型/路径/meta 身份、未保存/错误场景、dirty、多标签、多场景、编辑根定位、序列化差异、源引用缺失、预检期间变化、open 无效/异常、错误根/模式、源或原场景变化、延迟漂移，以及禁止自动保存/关闭/重试。
- 相关回归 406/406：进入编辑、场景编辑根、还原、应用、解除关联、实例化、工具目录、场景查询、资源和预制体测试。
- 全量 689 项，686 通过、3 失败、0 跳过。仍为 `UI skill v1 with a manifest can upgrade to v2`、`UI skill v1 without a manifest can upgrade to v2`、`legacy Codex UI v1 migrates with a backup and preserves the original file` 三项既有 Skills 换行/哈希失败，本轮未改其实现或夹具。
- `npm run check`、`npm run docs:check` 和 `git diff --check` 通过；全量套件不报告为全部通过。

## Creator 3.8.8 正式入口验收

使用忽略目录 `temp/op055-project`，MCP 为 `http://127.0.0.1:27855/mcp`。四个改动源码文件与安装副本 SHA-256 一致；修正版经编辑器完整重启后验收。未修改 `F:\AIWork\CouchArcade-main`。

专用原场景 `Op060Final.scene`，UUID `088d025a-45a4-43ec-84df-c69fb96ff55f`，预先保存重开；包含三个关联实例和普通 `Observer`，后者的脚本字段指向 Refs 根与内部 Caption 的 Label。三类资源均从该场景经正式入口进入、核对实际编辑态和源内容，再按 UUID 重复进入，编辑根 UUID/现场快照保持不变。

| 预制体 | 编辑根节点 / 组件 | 检查内容 |
| --- | --- | --- |
| `Op056Ui.prefab` | 2 / 4 | SpriteFrame、Caption 文本、根与子节点变换、PrefabInfo/fileId。 |
| `Op057Refs.prefab` | 2 / 6 | 自定义脚本的节点/Label/SpriteFrame 引用、Button 目标/组件/handler/customEventData、文本和关联身份。 |
| `Op056Plain.prefab` | 2 / 0 | 普通根及子节点的名称、变换、fileId 和源身份。 |

每次明确返回原场景后，普通 Observer 的传入节点/组件引用、三个实例的资源/fileId/instance 身份和语义快照保持，场景源文件哈希未变。跨打开时运行 UUID 会变化，因此持久性比较使用路径、资源 UUID 与 fileId/instance fileId，不以运行 UUID 作为跨次打开标识。

拒绝用例：缺少/空 target、额外 force、不存在 UUID、缺扩展名 URL、场景资源冒充 prefab、真正嵌套源；另验证两类未保存场景属性、当前已打开其他预制体、dirty=true 的当前预制体，以及 dirty=false 但内容已变的当前预制体。逐次核对上下文、现场快照、序列化与保留文件不变；场景 dirty=true 的专项模拟测试通过，不能将本次场景 dirty=false 实测写为 dirty=true 的现场验收。最后通过工程内绝对路径进入 Plain、精确 db URL 重复进入，并验证工程外绝对路径在切换前被拒绝。

修正版重启后，三类进入/重复/返回用例再次通过，预制体 dirty=true/false 两类拒绝和恢复后重复进入通过。随后记录 Refs 编辑根与引用，明确返回干净原场景、正常退出并确认旧进程消失，再启动唯一新进程；重新进入 Refs 后属性和引用一致，返回原场景显式保存、切到 Blank 并重开，场景哈希与语义/引用仍一致。此处是测试驱动明确控制返回和保存，不是新工具自动执行退出/保存。

持久化证据：

- `Op060Final.scene` SHA-256：`b2b2a9b6fa1acc745071e8838edd799b33b6c8552e46fb2b9bb679a1ea9c9ba8`。
- `Op056Ui.prefab` UUID `66d92b50-f476-4d90-a6e1-514718352c54`，SHA-256 `a5505f5582aa90a9d19cd0c4e609ce96cf4021d0c920eaadf31e4c4d82898b1e`。
- `Op057Refs.prefab` UUID `ab429830-d6b8-4131-967f-2faae1113a75`，SHA-256 `67da89c3c22f38030a66dbc32d9f4f8d65ca5dfee32d49497c318bd574cf5f96`。
- `Op056Plain.prefab` UUID `b076a3f3-fcf5-48f7-9b2e-d49315a312ce`，SHA-256 `eefc5725c51769744808d07cc894f652d346a3cf84fe4dc016effcac1b47a581`。
- 三个源资源/meta、`Op056/Op057Final/Op058Final/Op059Final.scene` 及 `Op057Outer/Op058FinalUi/Op058FinalRefs/Op058FinalPlain.prefab` 和各自 meta，共 22 个保留文件全程哈希不变。

本机记录为 `temp/op060-final-evidence.json`，驱动 `temp/op060-final-verify.js`；原生查询和脏状态探针为 `temp/op060-contract-*.json`、`temp/op060-dirty-evidence.json`。全部留在忽略目录，不进入提交/发布包。

## 限制与下一项

- 仅验收 Windows / Creator 3.8.8 的上述样本，不承诺任意版本、自动布局、自定义编辑态脚本或动态加载。编辑回调可能在进入后修改内容；后检会报错，但不会自动退回或恢复。
- 未保存新场景、多场景、大规模截断、原生故障和并发变化主要由模拟测试覆盖；不支持真正嵌套和不可完整核验的序列化。归一化后的严格比较可能保守拒绝其他合法格式。
- 源资源/原场景文件未变与当前引用核验不是项目级全部引用审计，也不是游戏运行、真实 Button 点击或视觉验收。
- 探针退出时曾因返回自建 Guard 场景后出现脏标记而未退出；只保存该自建探针，确认进程退出后才进行正式单进程验收。没有将 app.quit 返回 true 当作进程退出证明。
- FR-05 完整 CRUD 总项仍未完成。下一项是 OP-061 保存预制体编辑，之后 OP-062 退出；需分别验证源写回、同源实例更新、未保存处理和返回场景契约。
