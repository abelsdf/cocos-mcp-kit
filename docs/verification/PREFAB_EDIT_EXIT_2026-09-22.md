# OP-062 退出预制体编辑验证（2026-09-22）

## 范围与契约

新增 `exit_prefab_edit_mode`，仅在 `full` 配置暴露；`full` 共 122 项，`core` 仍为 39。退出已保存且实时内容与源一致的非嵌套预制体，不提供自动保存、丢弃、强制退出或确认弹窗功能。

- 必须显式传入 `prefabUuid` 与 `returnSceneUuid`，均为资产 UUID；原场景 UUID 取自首次进入或核验保存返回的 `previousScene.uuid`，不是任意替代场景，也不接受路径、force/save/discard 等选项。
- 检查 ready、单场景/唯一标签、当前资产、dirty、工程源路径/真实路径、导入/只读/meta 身份、编辑根/fileId、非嵌套结构及最多 5000 条显式资产引用。dirty=false 仍严格比较 `getdata-prefab` 与磁盘，避免丢失未标脏修改。
- 比较 `query-scene-json` 中保留的原场景与指定场景源文件；原场景身份不匹配、有未保存内容或不能完整核验时，关闭前拒绝。
- 复查编辑根、上下文、源/原场景内容后只请求一次 `scene:close-scene()`；最多查询 21 次、间隔 100 ms 等待目标场景，然后间隔 400 ms 两次核验模式、唯一标签、场景序列化及两个源文件/meta 未变。不将原生返回值当作成功证明。
- 返回 `exited/verified`、`alreadyExited`、`sceneUuid/sceneUrl`、`sourceUnchanged` 和原场景实际 `needsSave`。原场景可能因预制体更新变脏；不会清除 dirty 或自动保存。
- 已处于明确指定的场景时，只校验内容和文件，返回 `alreadyExited: true`、`method: null`，绝不再次关闭场景；这是一种当前状态核验，不是历史编辑会话证明。
- 关闭后验证失败会提示可能已经退出，需先检查状态；不自动重试、保存、丢弃、重开、回滚或改写磁盘。

调用顺序示意（MCP 工具参数）：

```js
const entry = await enter_prefab_edit_mode({ target: 'assets/Example.prefab' });
// 若修改了属性，先显式调用 save_prefab_edit_mode 并确认 verified。
const exit = await exit_prefab_edit_mode({
  prefabUuid: entry.prefabUuid,
  returnSceneUuid: entry.previousScene.uuid,
});
// exit.needsSave 指返回后的原场景；是否保存由调用方明确决定。
```

## 官方语义与原生实测

通过开发文档检索和页面读取技能核对[Creator 3.8 官方预制体文档](https://docs.cocos.com/creator/3.8/manual/zh/asset/prefab.html)：保存预制体后关闭编辑模式，返回场景编辑。本项据此保持保存与退出分离。另只读安装版公开贡献清单 `builtin/scene/package.json` 和 `builtin/scene/@types/message.d.ts`；其中 `close-scene` 声明无参数、返回 boolean。没有读取或引入受限插件实现。

Creator 3.8.8 中，干净预制体调用 `scene:close-scene()` 返回 true，模式从 prefab 回到 general，当前 UUID 回到原场景，原场景序列化和源文件不变。不需要用另开场景冒充原生退出，也不试探第二个关闭消息。

独立 `Op062SaveProbe` 原生探针中，两个实例的源预制体显式保存新缩放和子节点名称后关闭，两个同源实例更新，运行 UUID/fileId/instance 保持。原场景序列化和文件不变，但 dirty=true。正式三类样本返回时 dirty=false；因此不能将退出等同于场景必然干净，也不能要求返回后 dirty 必须为 false 才承认退出成功。

另建 `Op062DirtyReturn.scene/prefab` 通过正式工具复现 dirty=true：`needsSave: true`，原场景文件和序列化未变；重复退出返回 `alreadyExited: true`、`method: null`、`needsSave: true`，没有关闭或保存场景。由驱动随后明确保存、切换、重开，属性和持久化身份保持。该探针的初版重开断言错误地要求运行 UUID 不变；改为核对属性和 prefab/fileId/instance 身份后通过，功能源码未因此修改。退出本身保留运行 UUID，跨次重开则可能重新分配。

## 自动化测试

- 新增 `test/prefab-edit-exit.test.js` 87 项。先在每个夹具中明确断言工具存在，实现前 87 项全部失败；实现后 87/87 通过，避免把“工具不存在”误当作负例通过。
- 覆盖一次关闭、真实状态优先于原生返回、延迟退出、重复调用不关闭原场景、dirty=true/false 返回、非法参数、错误模式/源/原场景/meta、未标脏修改、不可核验序列化、嵌套/引用拒绝、预检并发变化及关闭后异常/延迟漂移。
- 相关回归 576/576：退出/保存/进入编辑、场景编辑根、还原、应用、解除关联、实例化、工具目录、节点查询、资源和预制体测试。
- 全量 859 项，856 通过、3 失败、0 跳过。仍为 `UI skill v1 with a manifest can upgrade to v2`、`UI skill v1 without a manifest can upgrade to v2`、`legacy Codex UI v1 migrates with a backup and preserves the original file` 三项既有 Skills 换行/哈希失败，本轮未改其实现或夹具。
- `npm run check`、`npm run docs:check` 和 `git diff --check` 通过；不把全量套件描述为全部通过。

## Creator 3.8.8 正式入口验收

Windows / Creator 3.8.8，忽略目录 `temp/op055-project`，MCP `http://127.0.0.1:27855/mcp`。三个改动源码文件与安装副本 SHA-256 一致，最终源码经编辑器完整重启后验收。未修改 `F:\AIWork\CouchArcade-main`。

新建专用 `Op062Final.scene`，UUID `f6b2682f-48cc-47b5-9966-ddb3f3773ede`。三类专用预制体各建立 A/B 两份实例，根位置分别覆盖为 `(110,-20,5)`、`(210,-20,5)`；普通 Observer 脚本引用 RefsA 根与 Caption 的 Label，预先保存重开确认有效。

| 预制体 | 节点 / 组件 | 验收内容 |
| --- | --- | --- |
| `Op062FinalUi.prefab` | 2 / 4 | 未修改退出；显式保存 Sprite 颜色 `(22,140,210,255)`、Caption 文本 `OP-062 saved UI` 后退出，SpriteFrame 保持。未保存时 dirty=false 仍拒绝退出。 |
| `Op062FinalRefs.prefab` | 2 / 6 | 未修改退出；保存脚本 calls=62、Button customEventData=`op062-saved` 后退出，节点/Label/SpriteFrame、Button target/component/handler 保持。dirty=true 的退出被拒绝。 |
| `Op062FinalPlain.prefab` | 2 / 0 | 未修改退出；保存根缩放 `(2,3,4)`、SavedChild 位置 `(81,82,83)` 后退出。未标脏修改仍被拒绝。 |

每类未修改退出及重复退出后，完整运行快照与引用一致，文件哈希不变。保存后退出时，同源 A/B 两份实例正确更新，根位置覆盖、节点/组件 UUID、fileId/instance、无关对象和 Observer 传入引用保持。再重复退出，不关闭原场景，也不改写任何文件。随后驱动明确保存原场景、切换 Blank 并重开，属性和引用保持；各类增加一个新实例后再次保存重开，共 9 个实例正确读取新源值。

正式拒绝共 15 次：缺少/空参数、非法返回 UUID、额外 force/save/discard、错误返回场景、已经返回但场景有未标脏修改、错误当前预制体、编辑态错误返回场景、指向编辑场景的外部脚本引用、真正嵌套预制体，以及三类未保存属性。逐次核对上下文、现场快照、原场景序列化及保留文件无变化。临时字段按已知原值恢复并核验，不依赖原生 undo，也没有自动丢弃。

正式实例保存完成后正常关闭旧主进程，确认退出，再启动新主进程。9 个实例、内外引用和哈希保持；三类重新进入/退出均成功且 needsSave=false。再次显式保存/重开原场景，语义与场景哈希不变。最后正常关闭并确认本任务测试主进程退出，不将 app.quit 返回值作为退出证明。

最终持久化证据：

- `Op062Final.scene` SHA-256：`380a1ad67a1236c6265dde714a0c418958b3d5c5865e8daea59f39a14df77ee0`。
- Ui UUID `001352c1-4640-4f2d-9e1b-55d08136ea0c`，SHA-256 `6c4f3962969b9938a4b613d2d12e0051967110e55196f76c5d8b6582fbd3b7e1`。
- Refs UUID `7e290cd4-6ef0-46bd-bf33-5071966a14c4`，SHA-256 `4765966e13cf7bcacd4eb6416a37076b6f6e73d7f24a3c9cdcfb1523ca61fce7`。
- Plain UUID `94f8a626-b80b-4bc8-b31f-d79905e749cd`，SHA-256 `b945ea09aa61caafa0923a4d43dfa14ea9471dd8cb2020aa30eed0a69b6b0c2b`。
- 三个专用源 `.meta` 在全部保存/退出中不变。OP-061 的 28 个保留文件，加其三份源副本/meta、正式场景/meta、ImportProbe/meta 和本轮原生 SaveProbe 的场景/预制体/meta，共 42 个保留文件哈希不变。

本机记录为 `temp/op062-final-evidence.json`，驱动 `temp/op062-final-verify.js`；原生消息、保存后返回与正式 dirty 返回探针分别为 `temp/op062-native-evidence.json`、`temp/op062-save-close-evidence.json`、`temp/op062-dirty-return-evidence.json`。全部留在忽略目录，不进入提交或发布包。

## 限制与下一项

- 不支持脏预制体的保存并退出/丢弃并退出、未保存新场景、多场景或嵌套。源资源/序列化无法完整核验时保守拒绝，由调用方明确处理，不绕过确认弹窗。
- 仅核验 Creator 3.8.8 的上述样本。回调晚于核验窗口、并发编辑、大规模截断、原生故障与其他版本主要依赖模拟或未覆盖；双重检查不是事务锁或任意字段的完整引用审计。
- 本项没有游戏运行、真实 Button 点击或 GUI 视觉验收，也没有扩大通用 open/save 工具的安全契约。
- FR-05 完整 CRUD 总项仍未完成；下一项为 OP-063 编辑态能力探测与测试，不能在用户生产场景静默试验进入/保存/退出。
