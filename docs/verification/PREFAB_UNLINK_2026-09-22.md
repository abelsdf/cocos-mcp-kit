# OP-057 预制体解除关联验证（2026-09-22）

## 实现范围

新增 `full` 配置工具 `unlink_prefab_instance`，工具总数为 119，`core` 仍为 39。本项不修改 `apply_prefab_instance` 或 `revert_prefab_instance`。

- 至少提供 `uuid`、`path`、唯一 `name` 中一个非空选择器；多个选择器必须指向同一节点。不自动向上寻找实例根，不接受 `recursive` 等额外选项。
- asset-db 与场景须就绪，活动场景 UUID 须对应已导入、有效的 `cc.SceneAsset`。未保存场景和预制体编辑模式不支持。
- 目标必须为独立、完整的关联实例根：根 UUID、自身根指针、资产 UUID、PrefabInfo/fileId 和实例 fileId 均须有效。普通节点、实例内部子节点、仍有关联祖先的节点、含嵌套或根归属不一致关联的子树均拒绝。
- 只读获取完整子树快照，最多 5000 个节点；存在 `DontSave` 节点或超出上限即拒绝，不用部分扫描证明安全。快照包括名称、父子 UUID/顺序、active、layer、本地位置/四元数/缩放、组件 UUID/类名，以及节点和组件的关联元信息。
- 写入前再次按根 UUID 核对同一快照。只请求一次原生 `scene:unlink-prefab`，要求返回 `true`，再核对同一节点/组件结构和变换不变，节点 `_prefab` 与组件 `__prefab` 元信息全部清除。
- 成功返回 `unlinked: true`、`verified: true`、`needsSave: true`、场景/节点/源预制体身份和节点/组件数量。`verified` 仅为上述结构与关联检查，不是任意组件字段或跨资源引用的完整审计；`needsSave` 表示仍须显式保存场景。
- 不保存或改写源预制体，不自动保存场景，不做手工元信息清除、重复 unlink、重新关联或删除重建。原生调用或后检失败时说明操作可能已发生，要求先检查现场，不能将错误响应理解为已回滚。

## 原生契约与嵌套限制

[官方预制体文档](https://docs.cocos.com/creator/3.8/manual/zh/asset/prefab.html)说明解除关联后成为普通节点，[扩展消息文档](https://docs.cocos.com/creator/3.8/manual/zh/editor/extension/messages.html)说明消息注册和调用机制。安装版 Creator 3.8.8 的 `builtin/scene/package.json` 注册了 `unlink-prefab` 消息；本轮读取公开消息/类型声明并在自有隔离工程实测，没有读取或移植受限插件实现。

本版本 `builtin/scene/@types/message.d.ts` **没有声明 unlink 参数签名**。以下具体参数和返回值来自已注册原生消息的现场实验，不当作所有 Creator 版本的公开类型保证：

```js
await Editor.Message.request('scene', 'unlink-prefab', exactInstanceRootUuid);
// 本轮成功实测返回 true
```

原生解除外层关联虽能保留内层预制体链接，但引用持久化不能据此推定通过。决定拒绝嵌套的对照实验为：

1. 在隔离工程中创建真正的嵌套源 `Op057Outer.prefab`：进入外层预制体编辑模式，经原生创建关联内层实例并保存；不是历史扁平化样本。
2. 在场景创建该外层实例，场景中的普通 `Op057ReferenceProbe` 组件分别引用内层节点和其 Label 组件。
3. 通过原生 `scene:set-property`，按持有者节点 UUID 与 `__comps__.<index>.<field>` 赋值；两次均返回 `true`。
4. **先保存、切走并重开**，确认节点引用和 Label 组件引用均正确，建立有效的对照基线。
5. 实验版只调用一次上述原生 unlink；当次外层结构/元信息后检通过，内层仍关联。
6. 再保存、切走并重开：节点引用仍正确，Label 组件引用丢失。原始证据在本机忽略目录 `temp/op057-native-references.json`。直接修改运行对象造成的其他失败探针不作为本结论依据。

因此正式版本在原生写入前拒绝**所有含嵌套关联的子树**，也拒绝直接解除仍处于关联祖先中的内层实例；未添加推测性的引用重映射或递归解除选项。实验版返回过的 `preservedNestedInstances` 不是正式工具字段。

## 自动化测试

- 修改前新增 40 项测试全部失败；首次实现后通过。现场发现嵌套引用问题后再补两项写入前拒绝测试，先复现 2 项失败，再收紧实现。
- 最终 `test/prefab-unlink.test.js` 36/36、`test/scene-prefab-unlink.test.js` 6/6 通过。覆盖唯一原生写入、参数/身份/嵌套/场景预检、异步上下文变化、异常和非 true 返回、元信息残留、结构变化、后检失败、选择器冲突、只读扫描与 5000 节点边界。
- 相关回归：`node --test test/prefab-unlink.test.js test/scene-prefab-unlink.test.js test/prefab-instantiation.test.js test/scene-prefab-instance.test.js test/tool-registry.test.js test/scene-node-queries.test.js test/assets.test.js test/prefabs.test.js`，216/216 通过。
- 全量：499 项，496 通过，3 失败，0 跳过。失败仍为 `UI skill v1 with a manifest can upgrade to v2`、`UI skill v1 without a manifest can upgrade to v2`、`legacy Codex UI v1 migrates with a backup and preserves the original file`，与 OP-056 的 Skills 换行/哈希基线一致。本次未修改其实现或夹具，不宣称全量通过。
- `npm run check`、`npm run docs:generate` 后的 `npm run docs:check` 和 `git diff --check` 通过。

## Creator 3.8.8 正式入口验收

使用本仓库忽略目录 `temp/op055-project` 的隔离工程，通过 `http://127.0.0.1:27855/mcp` 调用同步并重启后的正式扩展。`scene.js`、`lib/prefabs.js`、`lib/tool-registry.js` 和面板描述文件与工作区 SHA-256 一致。未修改用户提供的 `F:\AIWork\CouchArcade-main`。

最终场景为 `Op057Final.scene`，UUID `0f6e5e6d-0bfe-4625-b7cf-eafc1521f1d7`。父节点 `Canvas/Container` 位置 `(123,-45,2)`、缩放 `(2,1.5,1)`、Z 旋转 30 度。以下三个样本均通过当次工具后检、显式保存、切到 `Blank.scene` 再重开，以及正常退出并完整重启 Creator 后显式打开最终场景的复查：

| 实例路径 | 内容 | 保留的本地位置 | 节点 / 组件 |
| --- | --- | --- | --- |
| `Canvas/Container/Ui` | Sprite、SpriteFrame、Caption Label | `(0,-8,2)` | 2 / 4 |
| `Plain` | 普通非 UI 根与子节点 | `(14,0,-3)` | 2 / 0 |
| `Canvas/Container/Refs` | Sprite、Button、自定义脚本、Caption Label，内外部引用 | `(19,-11,1)` | 2 / 6 |

三者解除后的节点/组件 UUID、名称、父子结构、active/layer、本地变换、SpriteFrame UUID 和 Label 文本与解除前相同，节点及组件关联元信息均已清除。解除后成为普通节点，因此这些样本的节点/组件 UUID 在重开和重启后也保持；此结果不能推广为仍关联的实例 UUID 永久稳定。

引用样本核对：脚本 `target` 指向内部 Caption 节点、`label` 指向其 Label、`frame` 指向 Sprite 使用的 SpriteFrame；Button 事件的目标节点、注册组件类、`onProbeClick` 方法和 `unlink-ref` 自定义字符串保持。场景普通 `Observer` 的外部节点/Label 引用也保持。该验收检查绑定关系，**未实际点击 Button 或运行游戏**。

场景同时保留 `Canvas/Container/GuardedOuter/NestedUi` 真嵌套关联，以及普通 `GuardObserver` 对内层节点/Label 的引用。调用前先保存重开确认引用有效；对外层和内层根的正式解除调用均被拒绝。最终保存重开和完整编辑器重启后，两层仍关联且外部引用仍有效。关联实例在重开时允许活节点/组件 UUID 变化，因此该保护样本按层级、实例 fileId、资产 UUID、属性及实际引用关系复查，不误用过期 UUID。

12 项拒绝用例逐次确认活动层级/引用快照及场景文件哈希不变：无选择器、空 UUID、额外 `recursive`、不存在 UUID、普通 Canvas、实例内部 Caption、含嵌套关联外层、仍有关联祖先的内层、路径/UUID 冲突、歧义 Caption 名称、场景根、对已解除实例重复解除。

另打开 `Op057Refs.prefab` 的预制体编辑模式，按真实编辑根 UUID 调用，因缺少完整实例身份被拒绝；切回最终场景后全部样本与源资源哈希复查通过。未将此负例描述为触发了后续的 SceneAsset 类型分支。

哈希证据：

- 最终 `Op057Final.scene` 保存后、重开后及编辑器重启后：`05701dd12eda99dcc9cbdc6a4fabc8db808ee5b9130fde7b0bbae4b32eb564fb`。
- `Op057Refs.prefab`：`67da89c3c22f38030a66dbc32d9f4f8d65ca5dfee32d49497c318bd574cf5f96`，源 UUID `ab429830-d6b8-4131-967f-2faae1113a75`。
- `Op057Outer.prefab`：`8a5dd276bd5b0fd5dce2fecfb9c83cfa7a007f75638b4c849c3c3f5638acef1b`，源 UUID `f74df917-af5b-4935-9c84-9bfd6850efcc`。
- `Op056Ui.prefab`：`a5505f5582aa90a9d19cd0c4e609ce96cf4021d0c920eaadf31e4c4d82898b1e`；`Op056Plain.prefab`：`eefc5725c51769744808d07cc894f652d346a3cf84fe4dc016effcac1b47a581`。
- 上一项 `Op056.scene`：`f7202698ac50f8878e0060cda7e5becf0ca169198adc572b131bf5bad51a5427`。`Validation.scene` 与 `DeleteProbe.prefab` 也逐一与前次保留哈希核对不变。

本机最终自动验收记录为 `temp/op057-final-evidence.json`，驱动为 `temp/op057-final-verify.js`。早期实验记录不替代此最终验收。隔离工程与探针保留供复查，不进入提交或发布包；测试编辑器已在确认场景无脏状态后正常退出。

## 限制与后续

- 仅验收 Windows / Creator 3.8.8 上述普通 UI、非 UI 和脚本/Button 引用样本；不保证所有 Creator 版本或自定义组件、所有引用形式均通过。工具只读结构快照不调用任意自定义属性 getter，也不审计每个组件的全部值。
- 嵌套解除明确未实现；没有递归、强制、重新关联或引用自动修复。不要用实验版的局部成功绕过正式工具保护。
- 预检、原生写入与回查不是跨进程事务；调用期间不要切场景或并发编辑。结果不明会保留现场并报告，不保证恢复 dirty 状态、撤销栈或自动回滚。
- 未保存场景、原生消息错误和后检故障主要由模拟测试覆盖；没有把模拟注入当作真实编辑器故障验收。未进行 GUI 视觉、真实点击、游戏运行或目标工程验收。
- FR-05 完整 CRUD 总项仍未完成；下一项为 OP-058，单独核对应用实例修改的原生消息及保存/引用语义。
