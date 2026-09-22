# OP-059 还原预制体实例修改验证（2026-09-22）

## 实现范围

收紧现有 `full` 工具 `revert_prefab_instance`，不新增工具名：`full` 仍为 119 项，`core` 仍为 39。本项不扩展预制体编辑模式、结构恢复或嵌套还原。

本操作丢弃所选实例的属性覆盖，保留根名称、本地位置和旋转，但根缩放会恢复源值。它不写源预制体、不自动保存场景；用户应明确选择需要还原的实例，之后显式 `save_current_scene`。没有逐属性选择、自动备份、重试或回滚选项。

- 至少提供一个非空 `uuid`、`path` 或唯一 `name`；多条件必须一致。不向上寻找根，不接受 `recursive` 等额外选项。
- asset-db 和场景须就绪；活动场景 UUID 必须是有效、已导入的 `cc.SceneAsset`。允许已保存场景存在待还原覆盖，不支持未保存新场景或预制体编辑态。
- 明确选择有完整 asset UUID、root/fileId 和 instance fileId 的独立实例根；拒绝普通节点、内部节点、关联祖先、真正嵌套和不一致的关联归属。
- 复用 OP-058 的 `getPrefabApplyState` 有界预检：最多 5000 节点，拒绝 DontSave、mounted children/components 和 removed components。按声明的组件序列化字段扫描引用，拒绝向实例外的节点/组件引用、无 UUID 的临时资产、自定义序列化器、访问器和不可核验容器；最多 100000 个值、32 层，不接受部分扫描。
- 复用源文件身份校验：仅支持工程 `assets` 内已导入、有效、非只读的 `.prefab`；核对 URL、真实路径、源文件、`.meta` UUID。源文件与原生实例预览各不超过 8 MiB。虽然还原不写源资源，首版仍沿用非只读工程资源边界。
- 核对源序列化单根连通树、对象指针、组件归属和唯一 fileId；按 fileId 比较节点/组件结构，不接受增删、重排或重新挂接。源中的嵌套实例记录明确拒绝。最多 5000 条显式资源引用须完整且有效。
- 源数据构成还原预期，只替换根位置、四元数和欧拉角为操作前的值；根名称通过运行身份另行验证。读取根字段依据各自的 `cc.Prefab.data` 指针，不假设源文件与预览数组的根索引相同。
- 写入前再次核对整个实例快照、序列化预览及源文件/meta 文本。变化时不请求还原；只发送一次 `scene:restore-prefab`，原生返回必须为 `true`。
- 原生返回后比较运行节点/组件 UUID、父子顺序、PrefabInfo/fileId、实例身份、根名称/位置/旋转、完整规范化序列化数据和源文件/meta 未变；400 ms 后再执行相同核验。布尔返回本身不构成成功证据。
- 返回 `reverted/verified: true`、`needsSave: true`、`sourceUnchanged: true`、`instanceChanged`、实例/资源身份及节点/组件数量。`instanceChanged` 按规范化序列化内容比较，不等同于文件字节或视觉变化。
- 调用或后检失败明确提示实例可能已经改变，应先检查再决定是否重试；不尝试另一个消息、删除重建、写磁盘或自动恢复覆盖。

## 官方语义与原生契约

[官方预制体文档](https://docs.cocos.com/creator/3.8/manual/zh/asset/prefab.html)说明从资源还原不恢复实例名称、位置和旋转。本轮参考官方文档确定保留项，并以 Creator 3.8.8 隔离实验核验缩放、引用和真实消息参数，而非直接采用旧代码的候选消息列表。

安装版公开贡献清单 `builtin/scene/package.json` 注册了 `restore-prefab`，没有 `revert-prefab`。`builtin/scene/@types/message.d.ts` 声明参数为 `ResetComponentOptions`、返回 boolean，`public.d.ts` 中该类型为 `{ uuid: string }`；实际调用与声明有差异：

| 参数形式 | 隔离普通节点探针结果 |
| --- | --- |
| `Editor.Message.request('scene', 'restore-prefab', { uuid })` | 返回 `false`，实例覆盖和序列化数据未变。 |
| `Editor.Message.request('scene', 'restore-prefab', uuid)` | 返回 `true`，还原生效，名称/位置/旋转保留，缩放和激活状态恢复，子节点名称/坐标恢复。 |

对象参数实验后先核对现场未变，再独立测试字符串形式；这不是生产入口的自动回退。实现只使用本版本已验证的 UUID 字符串形式。不宣称所有 Creator 版本均遵循此参数契约。只读了公开声明与消息清单，没有读取、移植受限插件代码。

`getdata-prefab` 与源文件的比较保留全部用户数据，仅接受以下已观察到的序列化差异：

1. 原生预览资产名为空、根名称是实例名；两者按源资产名规范化，实际实例名称另行核验。
2. 节点及其明确挂载组件的 `_id` 在预览中为空；比较时移除此运行 ID，另核对运行 UUID。不会递归丢弃用户对象的 `_id`。
3. 实例根预览省略空 `PrefabInfo.instance` / `nestedPrefabInstanceRoots`，源中为 `null`；只处理空关联记录，非空嵌套数据拒绝。
4. 沿用 OP-058 对空 `PrefabInfo.targetOverrides` 的 `null/[]` 等价处理；不忽略非空覆盖或用户字段差异。

原生普通节点与脚本对照保存在忽略目录 `temp/op059-native-evidence.json`，驱动为 `temp/op059-native-probe.js`。

## 自动化测试

- 初始 58 项测试在旧实现下 52 失败、6 通过。实现后全部通过；再补根对象索引变化用例，先复现一次失败，再按预览根指针取保留属性，最终新增 59/59 通过。
- 覆盖选择器、就绪/场景/完整根身份、源路径/导入/meta 身份、结构变更、源引用缺失/超限、无效预览、并发修改、原生 false/异常、错误还原值、根变换/运行身份变化、源文件或 meta 改变、延迟漂移、用户 `_id` 保留和重复还原。
- 相关回归：`node --test test/prefab-revert.test.js test/prefab-apply.test.js test/scene-prefab-apply.test.js test/prefab-unlink.test.js test/scene-prefab-unlink.test.js test/prefab-instantiation.test.js test/scene-prefab-instance.test.js test/tool-registry.test.js test/scene-node-queries.test.js test/assets.test.js test/prefabs.test.js`，335/335 通过。
- 全量 618 项，615 通过、3 失败、0 跳过。仍为 `UI skill v1 with a manifest can upgrade to v2`、`UI skill v1 without a manifest can upgrade to v2`、`legacy Codex UI v1 migrates with a backup and preserves the original file` 三项既有 Skills 换行/哈希失败；本轮未修改其实现或夹具。
- `npm run check`、生成后的 `npm run docs:check`、`git diff --check` 通过。不将有基线失败的全量套件写为全部通过。

## Creator 3.8.8 正式入口验收

使用仓库忽略目录 `temp/op055-project`，MCP 为 `http://127.0.0.1:27855/mcp`。四个改动源码文件与安装副本 SHA-256 一致，重启后加载正式入口；没有修改 `F:\AIWork\CouchArcade-main`。

专用场景 `Op059Final.scene`，UUID `ef5a400e-e287-43bb-9cc1-5fe05cbe14dd`。UI 父级 `Canvas/Container` 位置 `(91,-26,2)`、缩放 `(2,1.5,1)`、Z 旋转 30 度。三个操作根预先保存了位置 `(113,-42,7)`、Z 旋转 35 度、缩放 `(2,3,4)` 和 inactive 覆盖，重开确认后才执行还原：

| 实例 / 源资源 | 还原内容 | 节点 / 组件 |
| --- | --- | --- |
| `Canvas/Container/UiA` / `Op056Ui.prefab` | Caption 从 `OP-059 override` 回到源文本 `OP-056 linked`，Sprite 从 `(17,181,222,255)` 回到白色，SpriteFrame UUID 保留。 | 2 / 4 |
| `Canvas/Container/RefsA` / `Op057Refs.prefab` | calls 从 59 回到 0；target 从自己恢复为内部 Caption，清空的 Label/SpriteFrame 字段恢复源引用；Button customEventData 从覆盖值回到 `unlink-ref`，目标、脚本与 handler 保持。 | 2 / 6 |
| `PlainA` / `Op056Plain.prefab` | 子节点从 `OverriddenChild` 恢复 `PlainChild`，位置从 `(70,80,90)` 回到 `(0,0,0)`。 | 2 / 0 |

三个根的名字、位置、旋转保留，缩放恢复 `(1,1,1)`、active 恢复 true。每次还原均确认源资源/meta 不变、其他场景对象语义快照不变，并且场景文件仍保持操作前哈希，证明未自动保存。工具即时核对运行 UUID，跨重开使用路径、资源 UUID、fileId 和 instance fileId 核验；Creator 会重新分配运行 UUID，不能将其当作跨次打开标识。

其他样本：同源 `UiB`、`RefsB`、`PlainB` 未改变；普通 `Observer` 指向 RefsA 根和内部 Label 的引用保持；同源 `ExternalGuard` 指向 Canvas、UiA Label 的覆盖保持。`NestedGuard` 的真实嵌套关联与 `MountedGuard` 的新增子节点保留，它们自身的还原被拒绝，不能据此声称支持嵌套或结构还原。

13 项拒绝：无选择器、空 UUID、额外 `recursive`、不存在 UUID、普通 Canvas、实例内部 Caption、真正嵌套外层、有关联祖先的内层、向外场景引用、mounted child、路径/UUID 冲突、重名 Caption、场景根。逐次检查完整快照、引用、源文件/meta 和场景文件哈希不变。

另进入 `Op057Refs.prefab` 编辑模式，按隐藏容器下的真实编辑根 UUID 调用，因缺少完整实例身份被拒绝。最初测试驱动误按场景直接子节点找根，没有发出还原请求；只读检查实际层级后修正驱动并完成负例，未修改生产定位规则。切回后全部语义/引用/哈希检查通过。

随后显式保存、切到 Blank、重开；完整退出并重启编辑器，再打开专用场景，全部验证通过。已确认现场后，再分别还原三个实例，均返回 `instanceChanged: false`；再次保存重开后场景哈希仍一致。这是已知成功状态的重复操作测试，不是不确定状态的自动重试。

持久化证据：

- 最终场景 SHA-256：`6d139c9149f6a5659f342380545940e668917b2e7114821e6d746893ee8a665b`。
- `Op056Ui.prefab` UUID `66d92b50-f476-4d90-a6e1-514718352c54`，前后 SHA-256 `a5505f5582aa90a9d19cd0c4e609ce96cf4021d0c920eaadf31e4c4d82898b1e`。
- `Op057Refs.prefab` UUID `ab429830-d6b8-4131-967f-2faae1113a75`，前后 SHA-256 `67da89c3c22f38030a66dbc32d9f4f8d65ca5dfee32d49497c318bd574cf5f96`。
- `Op056Plain.prefab` UUID `b076a3f3-fcf5-48f7-9b2e-d49315a312ce`，前后 SHA-256 `eefc5725c51769744808d07cc894f652d346a3cf84fe4dc016effcac1b47a581`。
- 上述 meta、`Op056/Op057Final/Op058Final/Validation.scene`、`DeleteProbe/Op057Outer/Op058FinalUi/Op058FinalRefs/Op058FinalPlain.prefab` 及对应 meta 均保留原哈希。

本机原始记录 `temp/op059-final-evidence.json`，驱动 `temp/op059-final-verify.js`。工程、探针及原始记录留在忽略目录，不进入提交或发布包。

## 限制与下一项

- 仅验收 Windows / Creator 3.8.8 上述样本，不承诺所有版本、组件、脚本回调或自动布局行为。序列化后检是本次限定内容核验，不是整个工程任意字段/动态引用审计。
- 结构增删、真正嵌套、向外场景引用、不可完整扫描序列化均明确拒绝。源资源外的其他场景、动态字符串加载及跨实例复杂覆盖没有泛化保证。
- 预检、原生调用和后检不是跨进程事务；调用期间不要并发编辑或切场景。异常后覆盖可能已经丢弃，不保证撤销栈、dirty 状态或内存回滚。
- 未保存新场景、原生故障及延迟漂移主要由模拟测试覆盖。实际验收没有执行游戏运行、真实 Button 点击或视觉检查，也没有在 CouchArcade 工程测试。
- FR-05 完整 CRUD 总项仍未完成；下一项是 OP-060 进入预制体编辑模式，需另行核对进入、脏状态和退出边界，不能以此次负例视作该项已实现。
