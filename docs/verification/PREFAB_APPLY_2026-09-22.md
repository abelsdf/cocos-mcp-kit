# OP-058 应用预制体实例修改验证（2026-09-22）

## 实现范围

收紧现有 `full` 工具 `apply_prefab_instance`，不新增工具名：`full` 仍为 119 项，`core` 仍为 39。本项不修改 OP-057 解除关联或 OP-059 还原逻辑。

本工具会立即写回源预制体，并可能更新其他同源实例。丢弃当前场景修改不会撤销已写入的源资源；应使用工程自身的版本控制/备份管理恢复。工具不自动回滚，也不自动保存场景。

- 至少提供 `uuid`、`path`、唯一 `name` 中一个非空选择器；多条件必须一致。不自动向上寻找实例根，不接受 `recursive` 等额外选项。
- asset-db 和场景须就绪，活动场景 UUID 须对应已导入、有效的 `cc.SceneAsset`。这是要求场景资源已存在，不是要求场景没有待应用的脏修改；未保存的新场景和预制体编辑模式不支持。
- 目标必须是有完整资产 UUID、PrefabInfo/fileId 和实例 fileId 的独立实例根。普通节点、内部子节点、关联祖先、真正嵌套关联或不一致的关联归属均拒绝。
- 首版仅应用属性，节点/组件结构必须与源资源一致。拒绝 mountedChildren、mountedComponents、removedComponents；再以 fileId 比较源文件与原生预览的节点、父子顺序、组件类型及顺序，避免以属性应用接受结构增删或重新挂接。
- 复用完整子树结构快照，最多 5000 节点，拒绝 `DontSave` 或不完整扫描。组件按 `__values__` 声明的序列化字段检查引用，最多 100000 个值、32 层；拒绝指向子树外的场景节点/组件、缺少 UUID 的临时资产、声明字段访问器、自定义序列化器、Map 等不可核验容器。精确的引擎向量/颜色等数值类型不包含对象引用，跳过其访问器；不豁免自定义子类。
- 源资源须为工程 `assets` 路径下有效、已导入、非只读的 `.prefab`，核对 URL、源文件、真实工程路径边界和 `.meta` UUID。源文件和原生预览各最多 8 MiB。
- 原生 `getdata-prefab` 生成拟应用的序列化内容。复用单根连通树、内部对象指针、组件归属、唯一 fileId 校验及最多 5000 条显式资源引用校验；不完整或缺失时不应用。
- 写入前再次比对同一实例快照、原生预览、源文件文本与 `.meta` 文本，变化则拒绝。只请求一次原生 `apply-prefab`，不直接调用磁盘写入或其他保存消息作回退。
- 写入后最多检查 11 次源资源状态，未匹配时相隔 100 ms；首次匹配后再等待 400 ms 复查。源 JSON 与预览内容一致、导入身份及 meta 保持、实例节点/组件身份与结构/变换保持才报告通过。不将原生布尔返回值或文件哈希变化单独作为成功依据。
- 成功返回 `applied/verified: true`、`needsSave: true`、实例与源资源身份、节点/组件数量，以及 `sourceChanged`。后者按规范化后的 JSON 数据比较，不等同于文件字节是否变化。调用方仍须显式 `save_current_scene` 并按需要重开确认。
- 原生调用或后检异常会说明源资源和其他实例可能已改变，要求检查后再决定是否重试；不重复应用、不重新关联、不删除重建，不声称已恢复现场。

## 原生契约及现场发现

[官方预制体文档](https://docs.cocos.com/creator/3.8/manual/zh/asset/prefab.html)区分实例覆盖、更新到资源和从资源还原，[消息系统文档](https://docs.cocos.com/creator/3.8/manual/zh/editor/extension/messages.html)说明消息注册/请求机制。安装版 Creator 3.8.8 的 `builtin/scene/package.json` 注册了 `getdata-prefab` 和 `apply-prefab`；本轮只读公开声明与贡献清单，没有读取或移植受限插件实现。

本版本的 `builtin/scene/@types/message.d.ts` 未声明这两个消息的具体参数签名。以下契约来自注册消息及隔离工程实测，不当作全部 Creator 版本的类型保证：

| 消息 | 本轮实测 |
| --- | --- |
| `scene:getdata-prefab` | 明确实例根 UUID → `cc.Prefab` 序列化 JSON 字符串；预览资产名为空、根名为实例名。 |
| `scene:apply-prefab` | 同一根 UUID → 原生值。本轮成功写入与重复应用均返回 `false`，但源文件、同源实例和重开结果已更新。 |

因此保留响应中的原始 `result` 供诊断，但 `applied/verified` 来自实际后检。原生抛错仍报告不确定状态，不据此盲目再次写入。

内容比对仅接受两项经实测确认的规范化：

1. 原生应用保留源资产/根的名称，不把重命名后的场景实例名写入资源。预览中的这两个名称按源文件名核对；其他节点名和属性不忽略。普通根的位置、旋转、缩放会写入源默认值，不能套用还原操作的规则。
2. `cc.PrefabInfo.targetOverrides` 的 `null` 与空数组 `[]` 表示相同的空关联覆盖。修改脚本属性时，独立对照连续采样确认，预览为 `null` 而写回为 `[]`；这不是延迟写入。只规范化此空字段，非空覆盖及任何用户字段的 `null/[]` 差异仍拒绝。

另一个只读对照显示：实例脚本指向外部场景节点或 Label 时，`getdata-prefab` 会将这些引用序列化为 `null`。正式工具因此在原生预览前检查运行对象的声明字段并拒绝，不把丢失后的空值当作正确写回。内部节点/组件及资源引用则进入后续序列化和实际验收。

本机忽略目录的探针：`temp/op058-native-probe.json`、`temp/op058-transform-probe.json`、`temp/op058-external-probe.json`、`temp/op058-ref-timing.json`。早期严格比对对脚本样本报过一次不一致；独立回查和空字段复现后才修正，未自动重试该不确定写入。最终验收另用新的属性值确认真实写回，不拿早期局部结果冒充完整通过。

## 自动化测试

- 首批 52 项新测试在旧实现下 44 失败、8 通过。实现后全部通过；现场发现 Color 访问器与空 targetOverrides 差异后分别先补复现测试，再修正边界。另覆盖不可核验对象、元信息访问器以及工具返回引用路径。
- 最终 `test/prefab-apply.test.js` 44/44、`test/scene-prefab-apply.test.js` 16/16 通过，合计 60 项。
- 覆盖非法选择器、独立根/场景检查、只读/缺失/错误资源身份及 meta、原生预览格式、结构变化、缺失/超限资源引用、并发修改、单次写入、原生 false 的有效写入、原生 true 的无效写回、不确定状态、稳定重复应用，以及有界引用扫描。
- 相关回归：`node --test test/prefab-apply.test.js test/scene-prefab-apply.test.js test/prefab-unlink.test.js test/scene-prefab-unlink.test.js test/prefab-instantiation.test.js test/scene-prefab-instance.test.js test/tool-registry.test.js test/scene-node-queries.test.js test/assets.test.js test/prefabs.test.js`，276/276 通过。
- 全量 559 项，556 通过、3 失败、0 跳过。失败仍是 `UI skill v1 with a manifest can upgrade to v2`、`UI skill v1 without a manifest can upgrade to v2`、`legacy Codex UI v1 migrates with a backup and preserves the original file`，与 OP-057 的 Skills 换行/哈希基线一致；本轮未修改其实现或夹具，不宣称全量通过。
- `npm run check`、生成后的 `npm run docs:check` 和 `git diff --check` 通过。

## Creator 3.8.8 正式入口验收

使用本仓库忽略目录 `temp/op055-project` 的隔离工程，MCP 地址 `http://127.0.0.1:27855/mcp`。修改后扩展已同步并重启；最终源码与安装副本的 SHA-256 一致。未修改用户提供的 `F:\AIWork\CouchArcade-main`。

场景 `Op058Final.scene`，UUID `445dc163-a192-45c3-82f4-0ce811485e5a`；UI 父节点 `Canvas/Container` 有位置 `(91,-26,2)`、缩放 `(2,1.5,1)`、Z 旋转 30 度。测试源均从既有探针复制为新资产，未在原资源上试验应用：

| 应用实例 / 源资源 | 应用的属性与结果 | 节点 / 组件 |
| --- | --- | --- |
| `Canvas/Container/UiA` / `Op058FinalUi.prefab` | Caption 为 `OP-058 verified`，Sprite RGBA 为 `(37,143,212,255)`；已有 `UiB` 和新建 `UiNew` 同步。 | 2 / 4 |
| `Canvas/Container/RefsA` / `Op058FinalRefs.prefab` | `Op057ReferenceProbe.calls = 60`；已有 `RefsB` 和新建 `RefsNew` 同步，内部节点/Label/SpriteFrame 引用及 Button 事件保持。 | 2 / 6 |
| `PlainA` / `Op058FinalPlain.prefab` | 根本地位置 `(28,-13,4)`、缩放 `(2,3,4)`，子节点位置 `(-5,6,0)`；同源子节点同步，新建 `PlainNew` 使用新根默认值。已有实例的根位置覆盖仍可保留自己的值。 | 2 / 0 |

三个正式调用均返回 `applied/verified: true`、`sourceChanged: true`，原生 `result` 为 `false`。随后显式保存、切到 `Blank.scene` 再重开；正常退出并完整重启 Creator 后显式打开最终场景，结构、属性、fileId 和引用均保留。仍关联的节点/组件运行 UUID 在重开时会变化，跨会话按路径、资产 UUID、fileId 和实际引用关系复查，不使用旧运行 UUID。

最终审查版重启后，三个正式入口又各应用一次已匹配的内容，均确认 `sourceChanged: false`、返回路径正确；再次保存重开后，源文件、meta 和场景哈希仍相同。这些重复调用是在此前结果已独立确认后主动验证，不是工具对异常自动重试。

引用核对：`RefsA/B/New` 脚本的 `target` 指向内部 Caption，`label` 指向其 Label，`frame` 与 Sprite 的 SpriteFrame 一致；Button 目标为各自根节点，组件为 `Op057ReferenceProbe`，处理方法 `onProbeClick`、自定义数据 `unlink-ref` 保持。普通场景 `Observer` 指向 `RefsA` 的节点和 Label 引用也保持。

`ExternalGuard` 的外部引用在调用前已通过原生属性接口绑定、保存重开确认有效。它自身的 apply 被拒绝；同源 `RefsA` 应用后，其外部覆盖引用仍指向 Canvas 与 `UiA` 的 Label。`NestedGuard` 保持真实嵌套关联；`MountedGuard` 保留新增节点。不能把这些保护样本表述为支持嵌套或结构应用。

13 项拒绝用例：无选择器、空 UUID、额外 `recursive`、缺失 UUID、普通 Canvas、实例内部 Caption、含嵌套关联的外层、仍有关联祖先的内层、向外引用实例、有 mounted child 的实例、路径/UUID 冲突、歧义 Caption 名称、场景根。逐次失败后活动层级/引用快照、三个待应用源文件及场景文件哈希均不变。

另打开 `Op058FinalRefs.prefab` 编辑模式并按真实编辑根 UUID 调用，因缺少完整实例身份拒绝；切回后全部样本、引用和哈希复查通过。未将该负例误写为触发了后续的 SceneAsset 类型分支。

最终持久化证据：

- 场景 SHA-256：`a5ceed305f7525741927a119051b307ca52c9bd489f17cc352fd03695d08f485`。
- UI 源 UUID `de47c619-1e44-4eac-9be5-7645e40cb748`，写回 SHA-256 `c3957bfe824d237634634a7d3ab49a74d654b56644d51d09bcf30c8a3c6d8f5c`。
- 脚本源 UUID `4d0f24e7-3081-46ba-9dda-ce3ce229d230`，写回 SHA-256 `4a65536d6b00023fc8e70dca0b2751c82df1955e8e1c6aa5b29966101be75a5b`。
- 普通节点源 UUID `3432004f-881e-48bb-a8a8-559ea194ee39`，写回 SHA-256 `2ec4481929ca09ead069d23b4f1b84259efeb80a7d95cdb7f4f4312f2853940f`。
- 三个源 `.meta` 前后哈希一致；此前 `Op056.scene`、`Op057Final.scene`、`Validation.scene`、`DeleteProbe.prefab`、`Op056Ui/Plain.prefab`、`Op057Refs/Outer.prefab` 均与既有验收哈希一致。

最终本机记录 `temp/op058-final-evidence.json`，驱动 `temp/op058-final-verify.js`；工程、探针与原始记录保留供复查，不进入提交或发布包。测试编辑器在确认无脏状态后正常退出。

## 限制与后续

- 仅验收 Windows / Creator 3.8.8 的上述属性、引用和同源同步样本。没有承诺所有 Creator 版本、组件类型、布局行为或动态加载形式均支持。
- 不支持结构增删、真正嵌套应用、向外的场景引用、自定义序列化器或无法完整扫描的值；不添加递归、强制、逐属性选择或引用修复选项。未声明的运行字段不视作可持久化字段。
- 资源文件后检不代表整个工程的其他场景和预制体均已审计；引用预检只检查明确序列化资源 UUID，动态字符串加载不在保障内。
- 预检、原生调用、其他实例同步和后检不是跨进程事务。调用期间不要并发编辑或切场景；异常后可能已有源文件变化，不保证回滚、撤销栈或 dirty 状态恢复。
- 未保存新场景、原生 IPC 异常、写回缺失等主要由模拟测试覆盖；真实编辑器验收不冒充故障注入、游戏运行、视觉检查或真实 Button 点击。未在 CouchArcade 工程验收。
- FR-05 完整 CRUD 总项仍未完成；下一项为 OP-059，单独核对从资源还原实例的原生契约、覆盖属性和引用持久化。
