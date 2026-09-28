# FR-29 受限批次创建与失败清理验证（2026-09-28）

## 范围

新增 full-profile `create_node_batch`，复用公开 v1 DTO；`core` 保持 42 项，`full` 为 139 项。实现显式场景/父节点核对、同级名称冲突、受限组件和属性预检、新身份映射、内部引用及项目 SpriteFrame 绑定、回读和新节点清理。完整契约见[节点批次 DTO](../NODE_BATCH_DTO.md)。版本仍为 0.1.0 Unreleased。

这只完成 FR-29 的 P0 受限写入/恢复基础：不支持预制体、任意脚本、外部引用 resolve、跨场景复制、资源写入、自动保存或单次 Undo。`undo.supported` 与 `undo.recorded` 均为 false，不能把失败清理称为全事务回滚。

## 自动检查

- 新增的编辑器入口/场景模拟测试 **52/52 通过**。覆盖非法参数写前拒绝、场景漂移、导入资源身份/类型、并发请求拒绝、通信不确定结果不重试、内部节点/组件/资源引用、外部 clear、属性回读失败、创建/组件故障、部分清理，以及外部节点被收养后拒绝递归删除。
- 全量 `node --test --test-reporter=tap`：**1107 项，1104 通过，3 失败，0 跳过**。失败均为执行前已复现的 Skills CRLF/LF 模板识别/内容比较问题，本次未修改该模块：`UI skill v1 with a manifest can upgrade to v2`、`UI skill v1 without a manifest can upgrade to v2`、`legacy Codex UI v1 migrates with a backup and preserves the original file`。不能宣称全量测试全绿。
- `package.json` 中 68 个 `node --check` 检查通过；工具文档生成后 `node scripts/generate-tool-docs.js --check` 和 `node scripts/release.js check` 通过；`git diff --check` 通过。没有生成发行包或推送版本。

## Creator 3.8.8 实测

使用仓库内已有的隔离工程 `temp/op055-project`（项目名 `op055-validation`，UUID `e5055f21-1699-4530-8d40-5a7e12575caa`，MCP 端口 27855）。先备份原安装扩展，再安装本次代码；没有修改用户提供的 `F:\AIWork\CouchArcade-main`。测试前记录原有 94 个资源文件 SHA-256。

专用场景为 `Fr29Validation.scene`，UUID `919f12ba-291d-4685-9935-b3c9e84e7a6b`。另生成并经正式 `import_asset` 导入 16×16 纯色测试 PNG，不使用第三方素材；以 asset-db 实际返回的子资源 UUID `f58f7922-78da-43ec-8317-2c20e0247efc@f9941` 作为 SpriteFrame，不拼接或猜测子资源。

| 检查 | 结果 |
| --- | --- |
| 正式工具与安装身份 | 最终 5 个运行源文件与已安装扩展字节一致；`tools/list` 为 139 项，`create_node_batch.readOnlyHint=false`。 |
| 创建与引用 | 正式入口创建 4 节点、8 组件、3 引用的 UI 批次，包含 UITransform、Label、Sprite、Button、ProgressBar；验证大小、锚点、文字、颜色、interactable、progress，以及 Button→新节点、ProgressBar→新 Sprite 组件、Sprite→项目 SpriteFrame 的真实对象/UUID。 |
| 普通节点和 clear | 在场景根创建无组件普通节点；另创建 2 节点/4 组件批次，Sprite.spriteFrame 和 ProgressBar.barSprite 的外部 clear 均保持 null。两次调用前后所有旧节点快照一致。 |
| 写前拒绝 | 重复同级名称、错误场景、未知父节点、自定义组件、缺失资源和错误资源类型均拒绝；原场景快照和源文件不变。内置 SpriteFrame 也被“仅项目资源”规则拒绝。 |
| 中途故障 | 在专用 `Fr29FaultChild` 的 Label 创建位置临时注入异常，通过正式 `create_node_batch` 调用；随后立即恢复钩子。MCP 返回 `ok:false`、`phase:create`、`cleanup.status:complete`、`removedCount:2`、空残留列表；原节点、旧节点未保存文字、已成功创建批次和资源文件均未变化。生产入口不提供故障注入参数。 |
| Button 空引用边界 | 首次真实 external clear 触发 Creator 激活时恢复自身 target，回读检测失败并完整清理该新节点。最终改为 Button.target 显式 null / external clear 写前拒绝；重启后的正式入口确认拒绝且无新身份、无场景变化。 |
| 保存、重开、重启 | 显式 `save_current_scene`，切换 Blank 再重开；正常退出 Creator 后用 `--project` 完整启动。两轮均比对节点/组件 UUID、层级、属性、内部引用和 SpriteFrame，无差异；null 引用也保留。 |
| 资源保护 | 结束时原有 94 个资源文件哈希全部一致；新导入 PNG 和 `.meta` 在批次创建期间未变。只有专用验证场景进行了显式保存。最终正常关闭本次验证编辑器。 |

Label 在修改文字后会异步更新尺寸；初次测试脚本立即抓取的旧节点尺寸尚未稳定，不能据此指称批次写入修改了旧节点。后续先等待稳定，再验证未保存文字与原身份保留；中途故障、普通节点和 clear 用例均以完整稳定快照比较。工具不使用 dirty=false 推断已保存。

专用场景最终 SHA-256 为 `b696b81089b2ebd5ca3e159b0e5907faca9a42c8e535fbd20a53cb58594a4045`；PNG 为 `1e62ec5b106dab85d2dce19f55261a84c778ae53aafe343a3f6bd9cb2b7e1cd4`。本机脚本与原始记录保存在忽略目录 `temp/fr29-verify.js`、`temp/fr29-evidence.json`，不纳入发布包或提交。

## 未验收部分

部分清理/重新挂接/收养外部节点、丢失写回复等由模拟测试覆盖，没有在实际用户工程破坏性制造。未验证 GUI 手动点击、Button 事件、单次 Undo/redo、其他 Creator 版本或运行时视觉布局。项目监听脚本造成的外部副作用、用户并发操作和跨资源修改不在恢复承诺内。阶段 2 的完整 JSON UI 构建器/模板仍为待办。
