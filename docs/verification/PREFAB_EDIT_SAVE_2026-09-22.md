# OP-061 保存预制体编辑验证（2026-09-22）

## 范围与契约

新增 `save_prefab_edit_mode`，仅在 `full` 配置暴露；`full` 共 121 项，`core` 仍为 39。保存已经处于原生编辑模式的非嵌套工程预制体，只支持节点/组件结构不变的属性修改。本项不实现 OP-062 退出，也不扩大通用 `save_current_scene` 的保护范围。

- 必须提供当前预制体资产 `prefabUuid` 和 `expectedSourceHash`。哈希取自 `enter_prefab_edit_mode` 新增的 `sourceHash`，或上次核验保存返回的哈希；不是节点 UUID，也不接受路径、force 等选项。
- 预检单场景/唯一标签、模式、导入/只读状态、源路径和真实路径、meta UUID、根/fileId、结构、最多 5000 条显式资源引用及保留原场景。源哈希不匹配、未保存原场景、嵌套、向外场景引用或不可完整核验序列化时不写入。
- 复查编辑现场、上下文和源/原场景后，至多发送一次原生 `scene:save-scene()`。dirty=false 也比较序列化内容；干净且内容等价时只核验，返回 `alreadySaved: true`、`method: null`。
- 目标资源导入和保存状态最多查询 11 次、间隔 100 ms，再间隔 400 ms 两次核对文件内容/meta、干净编辑状态、运行身份及原场景未变；不以原生返回值判断成功。
- 成功返回新的 `sourceHash`、`saved/verified`、`sourceChanged`、节点路径/数量和原场景身份。`sourceChanged` 表示规范化内容变化，`needsSave: false` 仅指当前预制体，不意味着返回后原场景无需显式保存。
- 写入后验证失败会明确提示源资源和同源实例可能已经改变；没有自动重试、回滚、退出、原场景保存或文件直写回退。哈希和复查不是事务锁，冲突应先检查协调，不应仅更换哈希再次覆盖。

调用顺序示意（MCP 工具参数）：

```js
const entry = await enter_prefab_edit_mode({ target: 'assets/Example.prefab' });
// 在 Creator 中明确修改受支持的预制体属性后：
const saved = await save_prefab_edit_mode({
  prefabUuid: entry.prefabUuid,
  expectedSourceHash: entry.sourceHash,
});
// 后续保存使用 saved.sourceHash；退出与原场景保存是独立动作。
```

## 官方语义与原生实测

通过开发文档检索与页面读取技能核对[Creator 3.8 官方预制体文档](https://docs.cocos.com/creator/3.8/manual/zh/asset/prefab.html)：编辑态保存会写回预制体，关闭编辑模式是独立动作。据此保持保存与退出分离。另只读安装版公开 `builtin/scene/package.json` 和 `builtin/scene/@types/message.d.ts`；没有读取或引入受限插件实现。

公开声明的 `save-scene` 参数为无参数或 boolean，返回类型为 string/undefined；Creator 3.8.8 预制体模式实测返回 `true`。即使直接修改属性后 dirty=false，原生调用仍会保存；保存后仍处于同一预制体编辑态。`query-scene-json` 继续返回保留的原场景，编辑根须单独用 `getdata-prefab` 读取。复用既有有限规范化，仅忽略已确认的运行 `_id`、预览资产名称和空 PrefabInfo 默认格式差异，不忽略用户字段或实际属性变化。

首次 UI 保存后，源文件已成功写入，但立即校验发现目标 `imported=false`，原实现因此返回结果不明，而非成功。先只读检查 settled 状态并通过同目标进入工具核验内容，再明确返回并保存自建原场景；没有重复请求源保存。随后独立 `Op061ImportProbe.prefab` 探针确认：原生保存返回时全局 `query-ready=true`，目标 UUID/URL/type 不变、`imported=false`、library 为空；100 ms 后目标导入完成。修正为仅对身份匹配且 `imported === false` 的状态进行有界只读等待，其他身份/路径/meta 异常仍失败。修正版 UI 验收使用一次新的、不同的属性修改，不把前次不明写入算作修正版成功。

## 自动化测试

- 新增 `test/prefab-edit-save.test.js` 共 83 项通过；覆盖保存/无操作、dirty=true/false、原生不同返回值、延迟写回/导入、哈希冲突、模式/源/原场景身份、结构/引用拒绝、并发变化和保存后异常，不允许自动重试或退出。
- 初始 80 项在实现前 43 失败、37 通过；部分拒绝正则也能匹配“工具不存在”，不将其当作有效行为证据。实测导入问题后新增 3 项，先复现 2 项失败，再完成修正；补充结果路径断言后先复现失败，再修正字符串路径，避免引用摘要出现 `[object Object]`。
- 相关回归 489/489：保存/进入编辑、场景编辑根、还原、应用、解除关联、实例化、工具目录、节点查询、资源和预制体测试。
- 全量 772 项，769 通过、3 失败、0 跳过。仍为 `UI skill v1 with a manifest can upgrade to v2`、`UI skill v1 without a manifest can upgrade to v2`、`legacy Codex UI v1 migrates with a backup and preserves the original file` 三项既有 Skills 换行/哈希失败，本轮未改其实现或夹具。
- `npm run check`、`npm run docs:check` 和 `git diff --check` 通过；全量套件不报告为全部通过。

## Creator 3.8.8 正式入口验收

Windows / Creator 3.8.8，忽略目录 `temp/op055-project`，MCP `http://127.0.0.1:27855/mcp`。三个改动源码文件与安装副本 SHA-256 一致，最终版本经完整编辑器重启后复测。未修改用户提供的 `F:\AIWork\CouchArcade-main`。

新建专用 `Op061Final.scene`，UUID `a092be6e-3d3a-4d77-a1ca-975848f27c59`；每类预制体预先建立 A/B 两个实例，根位置分别覆盖为 `(110,-20,5)`、`(210,-20,5)`。普通 Observer 脚本引用 RefsA 根及其 Caption 的 Label；场景预先保存重开确认引用有效。

| 专用预制体 | 节点 / 组件 | 保存内容 | 保存前 dirty |
| --- | --- | --- | --- |
| `Op061FinalUi.prefab` | 2 / 4 | Sprite 颜色 `(31,171,221,255)`，Caption 为 `OP-061 verified UI`，SpriteFrame 保持。 | false |
| `Op061FinalRefs.prefab` | 2 / 6 | 脚本 calls=61、target 改为根自身；Label/SpriteFrame 引用保持；Button 目标/组件/handler 保持，customEventData 改为 `op061-saved`。 | true |
| `Op061FinalPlain.prefab` | 2 / 0 | 根缩放 `(1.5,2,2.5)`；子节点改名 `SavedChild`，位置 `(71,72,73)`。 | false |

三类均通过正式 MCP 工具单次保存；实时编辑快照保持，源文件内容/哈希变化符合预期，源 `.meta` 不变，原场景文件/meta 在工具执行期间不变。每次保存后旧哈希被拒绝，使用新哈希重复保存返回 `alreadySaved: true`、`method: null`，不再次写入。

随后由测试驱动明确返回原场景，核对 A/B 同源实例更新、根位置覆盖/旋转/fileId/instance 保留、无关对象不变，Observer 传入引用与内部脚本/Button 引用正确；明确保存原场景、切换 Blank 并重开，属性和引用保持。之后各增加一个新实例，共 9 个实例，保存重开后均读取新源值。

正式拒绝共 13 次：缺少/空参数、缺哈希/错误哈希格式、额外 force、普通场景调用、错误当前 UUID、源哈希冲突、指向编辑场景的外部脚本引用、当前真正嵌套预制体，以及三类成功保存后的旧哈希。逐次核对上下文、现场、原场景和保留文件未变；临时外部引用由驱动按已知原值恢复并核验，嵌套样本未修改。结构变更拒绝是模拟测试覆盖，不写作真实结构编辑验收。

关闭并确认本任务旧主进程退出，重新启动唯一的新主进程后，9 个实例、Observer/内部引用和资源哈希再次一致；三类重新进入后执行保存均为无操作，结果路径为字符串。再次明确保存/重开原场景，场景哈希不变。最后正常关闭测试编辑器并确认主进程退出；不是仅凭 `app.quit` 返回值判断退出。

最终持久化证据：

- `Op061Final.scene` SHA-256：`c9ed29393c94fb040590a0c447df8b3fa372d76f067b38e2ba661cdb79893a6d`。
- Ui UUID `74e8cd30-a26f-4939-9f29-eb44f3c24153`，SHA-256 `2f83f14306cdeda6804dfb702ad16ae3c3f5433c9a1489d6d02522385f52248e`。
- Refs UUID `9ab1a9b4-936a-4afc-a748-74223a5eb5d0`，SHA-256 `48585358bed8512eed99200e5023569a31eafbee694a01e657a77060ffe8f804`。
- Plain UUID `e05b6395-8528-4e49-b59a-cc3bcd9a674c`，SHA-256 `abab645861cb4a956a2cc666d01e289a307b6bf6f49402c858226e5279a015b7`。
- 三个专用预制体 `.meta` 全程不变。OP-060 记录的 22 个保留文件，加 `Op060Final.scene` 与本次原生探针 `Op061Native.scene/prefab` 及各自 meta，共 28 个保留文件哈希不变。

本机证据为 `temp/op061-final-evidence.json`、驱动 `temp/op061-final-verify.js`；原生保存和导入探针为 `temp/op061-native-evidence.json`、`temp/op061-import-evidence.json`。全部保留在忽略目录，不进入提交或发布包。

## 限制与下一项

- 源保存立即影响同源实例，丢弃场景不能撤销资源写入；原场景后续显式保存由调用方决定。本项未实现新的属性编辑工具，也不放宽既有普通组件编辑工具的预制体限制。
- 不支持节点/组件结构增删、嵌套、向外场景引用、不可完整扫描的字段/序列化；仅验收上述 Creator 3.8.8 样本。并发修改、慢于等待窗口的导入及其他版本没有事务或兼容保证。
- 真实编辑器保存、资源哈希与引用持久化不是游戏运行、真实 Button 点击或 GUI 视觉验收，也不是全部工程资源引用审计。
- FR-05 完整 CRUD 总项仍未完成；下一项 OP-062 退出预制体编辑模式，需独立核对未保存处理与返回原场景契约。
