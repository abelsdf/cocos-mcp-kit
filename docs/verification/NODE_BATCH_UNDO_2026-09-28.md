# FR-29 单次 Undo/redo 适配验证（2026-09-28）

## 交付与边界

`create_node_batch` 在 **Creator 3.8.8** 中使用公开的父节点范围录制消息，为成功批次记录一个 Undo 步骤；输入 DTO 和工具数量不变（core 42 / full 139）。其他版本继续允许既有受限创建/清理，但明确返回 Undo 不支持。没有新增任意场景撤销工具，没有自动执行 Undo/redo、保存或跨资源回滚。

此次实现是在批次创建基线提交 `0bad441` 之后独立推进的功能。具体字段与不确定状态处理见[节点批次契约](../NODE_BATCH_DTO.md)。

## 原生接口依据

- [Cocos Creator 3.8 消息系统](https://docs.cocos.com/creator/3.8/manual/en/editor/extension/messages.html)说明通过 `Editor.Message.request` 请求消息，并在 Developer → Message Manager 查看可用契约；通用消息文档本身不证明某个 Undo API 可用。
- 检查本机 Creator 3.8.8 `builtin/scene/package.json` 的公开消息声明，确认 `begin-recording`、`end-recording`、`cancel-recording` 均为 `public:true`。进一步通过 `Editor.I18n.t` 读取该消息管理器使用的公开描述和示例，参数分别为 `nodeUuid`、`undoID`、`undoID`。实际 begin 返回非空字符串句柄，end/cancel 返回 void。
- 测试期间的 `undo` / `redo` 调用依据编辑器自身菜单/快捷键公开贡献清单中的消息名；只在隔离测试脚本中执行，不作为扩展新的公共 API，也不把较旧版本 `Editor.Undo` 文档或其他插件实现当作 3.8.8 的接口依据。
- 实现独立编写，没有复制其他插件、商业包或官方 CLI 的源码。

## 实现策略

1. 完成原有静态、场景、组件、资产及名称预检，再开始目标父节点的录制。
2. 执行一次批次创建；成功回读后结束录制，返回 `recorded:true`。明确失败则等待原有新节点清理结束，再仅取消本次句柄，返回 `cancelled:true`。
3. 写回复丢失时不取消仍可能执行中的录制；开始/结束/取消回复异常或场景漂移时不猜测状态、不重试、不调用原生 Undo 兜底。
4. 不确定状态返回 `undo.recorded:null`，保留已知句柄和创建/清理证据，并阻止同项目在本扩展进程内继续批次。结束录制不确定时，即使 `created:true, verified:true`，MCP 外层仍为 `ok:false`。须检查未保存内容后安全重启 Creator；仅重载扩展不能证明原生录制已关闭。

## 自动测试

- 先添加 15 个行为用例，实现前 14 个预期失败，资产预检不触发录制用例已通过；之后补充 3 个异常回复/解除正常锁用例。本次共 **新增 18 项**。
- DTO、场景创建/清理、编辑器入口和工具注册定向回归：**123/123 通过**。覆盖录制顺序、精确父 UUID、版本限制、录制句柄校验、成功结束、失败取消、保留部分清理结果、通信异常、场景漂移、禁止自动 Undo/redo/snapshot、不确定状态阻止后续批次，以及 MCP 不伪报成功。
- 全量：**1125 项，1122 通过，3 失败，0 跳过**。3 项仍为执行前已有的 Skills 模板 CRLF/LF 升级/迁移问题，名称与[创建基线](NODE_BATCH_CREATE_2026-09-28.md)相同；未修改该模块。
- 68 个脚本语法检查、工具文档生成校验、发布检查和 `git diff --check` 通过。版本保持 0.1.0 Unreleased。

## Creator 3.8.8 正式入口

使用 `temp/op055-project` 隔离工程，新建 `Fr29UndoValidation.scene`（UUID `3359339e-d6b3-4859-89ff-a2798359f7cc`）；沿用先前独立生成的项目 SpriteFrame。安装前备份修改的扩展文件，明确保存并正常关闭验证工程后再替换。未修改 CouchArcade。

| 检查 | 结果 |
| --- | --- |
| 原生契约探索 | 在 Canvas 父节点开启录制，调用已有批次创建，再结束：一个 Undo 去除整个 4 节点/8 组件/3 引用批次，Redo 恢复相同 UUID 与引用。之前的未保存原生改名和从另一场景根传入旧节点的脚本引用保留。 |
| 原生取消边界 | 先 Undo 留下一项 redo，再注入新批次组件创建失败；清理完后取消本次录制，原 redo 仍可恢复，前一用户编辑仍是独立 Undo 步骤。 |
| 正式自动录制 | 安装新代码后，正式工具连续创建 `FormalFirst`、`FormalSecond` 两批，各包含 UITransform、Label、Button、ProgressBar、Sprite。两次 Undo 分别回到第一批后和两批前的状态，两次 Redo 分别精确恢复；节点/组件 UUID、层级、属性、Button→节点、ProgressBar→组件、Sprite→资源引用均一致。 |
| 既有未保存内容 | 在批次前直接修改哨兵 Label 文字，没有先保存；Undo/redo 后稳定回读仍保留该文字、原 UUID 和传入引用。Label 自动尺寸存在异步更新，初次即时快照未稳定；后续比较使用其稳定状态，不将自动计算的中间尺寸当作手工修改丢失。 |
| 正式失败清理与取消 | 第二批 Undo 后，临时对专用故障节点的 Label 创建注入异常；正式入口报告清理了本批 2 个节点、残留为空、`recorded:false,cancelled:true`，原 redo 仍恢复第二批。钩子在 finally 中立即移除，生产工具不提供注入参数。 |
| 场景根与多根批次 | 完整重启后，在场景根创建两个普通根及一个子节点；一次 Undo/redo 整批移除/恢复，所有旧内容保持一致；显式保存与切换重开也通过。 |
| 保存与重启 | UI 两批及场景根批次都经过显式保存、切换 Blank 再重开，并完整退出/启动 Creator；最终节点/组件身份与所有引用一致。只验证场景内容持久化，不宣称重启后 Undo 历史持久化。 |
| 资源与安装保护 | 最终 3 个运行源文件与安装内容字节一致；原有 98 个资源文件（包括上一轮创建验收场景和 PNG/.meta）哈希全部不变。本轮只显式保存专用 Undo 场景，最后正常关闭验证编辑器。 |

本机测试脚本/原始记录位于忽略目录 `temp/fr29-undo-probe.js`、`temp/fr29-undo-evidence.json`，不打包或提交。模拟测试覆盖通信异常和不确定历史隔离，未在真实用户工程人为中断 IPC。尚未验证其他 Creator 版本、键盘快捷键焦点、GUI 点击、任意旧内容事务、并发用户/脚本写入或跨场景复制。FR-29 的高级传输/外部 resolve 仍未完成；接下来可推进阶段 2 的 JSON UI 构建器。
