# OP-055 预制体删除验证（2026-09-22）

## 实现范围

复用 `full` 配置中的 `delete_asset`，不新增工具或强制删除参数，工具总数仍为 118（`core` 为 39）。

- 所有删除目标先精确查询 asset-db；支持 UUID、完整 db URL、`assets/…` 路径和源文件绝对路径，不使用只读查询中的扩展名猜测与路径后缀回退。
- 对工程 `.prefab`，要求 `cc.Prefab`、已导入、非只读/无效/目录；URL 与源文件须指向工程 assets 下同一文件。核对真实路径及 `.meta` UUID，拒绝越界、符号链接文件或通往工程外的目录链接。
- 要求 asset-db 和场景已就绪。调用 `asset-db:query-asset-users(uuid, 'all')` 和 `scene:query-nodes-by-asset-uuid(uuid)`；错误或无效返回不视为空引用。存在引用时返回资源/脚本及场景节点数量和前 20 个标识，拒绝删除；不会自动解除引用或保存其他资源。
- 引用查询后重新以 UUID 和 URL 核对身份，再按 UUID 调用一次 `asset-db:delete-asset`，避免按旧路径删除替换后的资源。没有磁盘直删回退。
- 回查 UUID/URL 的资产记录、双向映射、源文件和 `.meta` 六项均消失才返回 `deleted: true`。尚未完成时每 100 毫秒重查，最多 10 次重试；不会重复发起删除。查询异常或仍有残留时报告未确认，并提示删除可能已经发生，须检查现场后再重试。

接口依据为安装版 Creator 3.8.8 的公开 `builtin/asset-db/@types/message.d.ts`、`builtin/scene/@types/message.d.ts` 和对应消息贡献声明，并在实际编辑器中核对返回值。消息机制见 [Cocos 官方文档](https://docs.cocos.com/creator/3.8/manual/zh/editor/extension/messages.html)。缺失资产的 `query-asset-info`、`query-url` 实测返回 `null`，缺失 URL 的 `query-uuid` 返回空字符串；查询抛错不能作为不存在证据。

## 自动化测试

- 修改前新增测试 41 项：38 失败、3 通过，复现旧接口跳过预检及仅凭消息返回报告成功的问题。
- 完成实现并增加注册入口测试后，`test/assets.test.js` 42/42 通过：精确目标、错误类型/路径/元信息、只读与导入状态、目录链接越界、引用/查询错误、身份变化、假成功、六类残留、异步完成、仅一次删除以及错误结果封装。
- `node --test test/assets.test.js test/prefabs.test.js test/tool-registry.test.js`：103/103 通过。
- `npm run check` 通过。工具说明已重新生成，并通过 `npm run docs:check`。
- 全量测试：404 项，401 通过，3 失败，0 跳过。失败仍为修改前已有的 `UI skill v1 with a manifest can upgrade to v2`、`UI skill v1 without a manifest can upgrade to v2` 和 `legacy Codex UI v1 migrates with a backup and preserves the original file`；涉及 CRLF/LF 内容比较及旧模板哈希识别。本次未修改 Skills 迁移代码或夹具，不宣称全量测试通过。

## Creator 3.8.8 正式入口验证

使用本仓库忽略目录中的独立工程 `temp/op055-project`，由官方 empty-2d 模板准备；安装本次扩展后重开 Creator，经过 `127.0.0.1:27855/mcp` 的正式工具入口调用。未改动用户提供的 `F:\AIWork\CouchArcade-main` 工程，也未使用历史记录中的另一台机器工程。

1. `Validation.scene`（UUID `3c0eed81-8ffb-4d02-be05-0a6cb47720f9`）保存了 `DeleteProbe.prefab`（UUID `e01c2e67-a41c-43c4-a547-b232611eba66`）的实例。当前场景中删除被拦截；切到 `Blank.scene` 后仍有 1 个资产引用、0 个当前节点引用，同样被拦截。两个资源未改变。
2. 从普通 `DeleteSource` 节点创建 `Unreferenced.prefab`（UUID `94464a08-6289-488b-89fe-455aeb2c21e5`）。创建未保存实例后，资产反向引用为 0，场景节点引用为 1，删除被拦截。移除该测试实例后，直接打开预制体编辑，再次以 1 个当前节点引用阻止删除。
3. 保存并退出该预制体编辑，回到 `Validation.scene` 后用 `delete_asset` 删除。六项回查全部为 `true`，独立文件检查确认 `.prefab` 和 `.meta` 不存在；重复删除及省略扩展名目标均返回找不到资产，不误删 `DeleteProbe.prefab`。
4. 保存，切到 `Blank.scene`，再重开 `Validation.scene`：已删除 UUID 仍无记录，保留的 `DeleteProbe` 仍有 1 个资产引用和 1 个场景实例。删除动作没有改变保留场景或预制体内容。
5. 另创建 `ComponentTarget.prefab`（UUID `a5c29080-76ee-4eec-a12f-a44382c68981`）和本次测试专用脚本 `DeletionReferenceProbe`，其序列化 `Prefab` 字段指向该资源。未保存字段时由当前场景引用阻止删除；保存后切到空场景，由资产反向引用阻止删除。重开原场景后读回组件字段 UUID 一致。
6. 清空组件引用并保存，删除 `ComponentTarget.prefab` 成功；移除测试组件、保存，再经 asset-db 删除测试脚本。场景内容恢复到测试前哈希。脚本首次编译触发场景重载，挂载接口明确拒绝；等待编译完成后重新挂载通过，此过程未更改挂载工具实现。
7. 保存并完整退出 Creator，再启动同一隔离工程：两个已删预制体的 UUID/URL 记录及映射仍为空、源文件与 `.meta` 仍不存在；保留预制体仍有 1 个资产引用和 1 个当前实例，场景 UUID 与哈希保持一致。

哈希证据：

- `Validation.scene`：`7a5037402e787e1b2361eafcf4bbbad7fb45307201301e003f7bbc36c2600232`，引用拦截前后、无引用预制体删除前后、组件测试清理后均相同。
- 保留的 `DeleteProbe.prefab`：`6411cf287c6e4b8768a50a1f1f28e6e7e7e51627762d356c759a0a200e362f47`，删除测试前后相同。

临时原始记录在本机忽略目录 `temp/op055-results.json`、`temp/op055-component-results.json` 和 `temp/op055-restart-results.json`，不进入发布包。被删除内容均为本次创建的测试资源，可通过测试步骤重建；保留的隔离工程用于复查。

## 限制

- 这是单个工程预制体的安全预检与完成确认，不是所有资源/目录删除的统一重构；非预制体仍沿用既有 asset-db 删除路径，不获得本项六项回查保证。
- 引用保护只覆盖原生资产/脚本依赖查询和当前活动编辑场景，不能证明运行时字符串加载、其他未纳入查询的未保存编辑上下文或外部工程没有引用。真正的嵌套实例组合及大工程并发编辑仍待专项验证。
- 预检与删除之间不是跨进程事务；应避免同时编辑或替换目标及其引用。不会自动回滚、重建被删资源，也不保证回收站或编辑器撤销恢复，正式工程须保有版本控制或备份。
- 本轮验证资源删除及引用持久化，不涉及游戏运行/视觉验收；不据此勾选 FR-05 全部 CRUD 或宣称其他 Creator 版本通过。
