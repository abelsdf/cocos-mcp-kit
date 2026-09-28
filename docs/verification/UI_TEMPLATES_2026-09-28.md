# FR-08 游戏 UI 模板验证

日期：2026-09-28。环境：Windows、Creator 3.8.8、仓库内隔离工程 `temp/op055-project`，正式 MCP 端口 27855、full 配置。未修改 CouchArcade；临时工程和证据不提交。

## 范围

新增只读 `get_ui_template`，工具数 core 43 / full 142。三个模板独立编写，不来源于受限制项目或商业包。输入包括文案、尺寸、颜色、工程 SpriteFrame 和已有脚本回调；返回可编辑 UI v1 JSON，交给原 `build_ui` 构建。没有新增场景写入机制、附带素材或生成脚本。

模板不实现暂停游戏、音量/音效存储、结算奖励、关闭/导航或全屏输入拦截。未绑定按钮禁用；事件目标限定于同批创建的面板脚本组件。生成器只做结构校验，`resources`、`scene` 均明确 not_checked，资源导入/类型及回调有效性仍由构建器核查。详细字段与示例见 [UI_TEMPLATES.md](../UI_TEMPLATES.md)。

## 自动测试

- 新增 43 项：42 项模板契约与复用构建链路测试，1 项只读正式工具注册/无 Editor 查询测试。
- 覆盖三模板的确定性、输入不被修改、局部布局边界、文案/尺寸/颜色/事件参数、部分绑定/默认 action 参数、未绑定按钮禁用、输出可独立修改、未知模板/字段、非法资源标识/根名/尺寸/颜色/文本/脚本/绑定以及保留已有失败清理/Undo 报告。
- 定向 255/255：ui-templates、tool-registry、ui-builder、node-batch-create、node-batch-scene、node-batch-dto。
- 全量 1337 项：1334 通过、3 失败、0 跳过。既有失败仍为 `UI skill v1 with a manifest can upgrade to v2`、`UI skill v1 without a manifest can upgrade to v2`、`legacy Codex UI v1 migrates with a backup and preserves the original file`；未扩大或顺带修改。
- 72 项语法检查、工具文档生成/一致性、发布检查和 `git diff --check` 通过。

## Creator 正式入口

1. 在已有场景连续两次生成每个模板，结果相同，当前场景序列化和历史文件哈希不变。随后创建独立验收场景，首次加载 needsSave 时显式保存。
2. 对返回 JSON 编辑根位置，然后逐个调用 `build_ui`。三个 280×440 面板位于 x=-300、0、300，使用原隔离工程的 `Fr29Pixel.png` SpriteFrame 和 `UiBuildActionProbe` 脚本，无新增图片或业务脚本。
3. 核对根尺寸、颜色、节点/组件 ID、图片引用、Button target、事件目标。设置样本只绑定 music/close，sound 的 interactable=false 且没有事件。全部 25 节点的编辑相机几何报告 inside，这不是截图或视觉证明。
4. 每个相同根名称再次构建均在 preflight 拒绝；每个成功批次独立 Undo 后精确恢复先前节点，Redo 后精确恢复该模板及引用。
5. 错误模板/文案键在只读生成时拒绝。缺失 SpriteFrame 或不存在脚本方法可以通过纯结构生成，但 build_ui 在 preflight 拒绝且无新节点。对本次特定模板 Title 注入一次 Label 挂载异常，失败清理 complete、取消本批 Undo 录制，原三个模板保持，先前 Undo/Redo 仍可用；注入立即在 finally 中解除。
6. 显式保存，在本次场景与上一轮已保存样本间往返，节点/组件身份、颜色/尺寸、SpriteFrame 和事件引用保持。调用真实引擎 `EventHandler.emitEvents` 共 7 次，三个接收器计数分别为 3、2、2，最后参数和 sender 对应各自最后按钮。
7. 通过正式 `set_component_property` 将暂停模板标题改为“已编辑标题”，保存重开保持，验证生成后仍是普通可编辑 UI。
8. 正常退出并完整重启 Creator，重复核对场景、节点/组件身份、全部 7 条事件目标/方法/参数和资源引用；只读 `list_button_click_events` 正确解析脚本类。Creator 可把事件的旧 `component` 字段保存为空而以 `_componentId` 保存注册类，不能单凭旧字段为空判断丢失。
9. 114 个本轮之前的资源文件 SHA-256 全部不变。仅新增 `UiTemplatesValidation.scene` 和 `.meta`；验收工程最终显式保存，保留所有证据。

| 模板 | 根节点 UUID | 新节点 / 组件 / 普通引用 / 事件 |
| --- | --- | --- |
| pause_menu | `a0EjLzp6tCsannfQblVhV6` | 9 / 22 / 7 / 3 |
| settings_dialog | `3b78+TzaxJDJreXrrRDe61` | 9 / 22 / 7 / 2 |
| result_dialog | `e0vZNYOfpJ8qep2cFaK5Ml` | 7 / 17 / 5 / 2 |

场景 UUID：`0bf448ca-36ff-4341-ace9-7adaaff06da9`。最终 `.scene` SHA-256：`af9fbb95483e5b5fd592259bf1c5501d649e78345708d98677f930cba499e806`。

原始调用、断言快照和文件哈希：`temp/ui-templates-evidence.json`；复核脚本：`temp/ui-templates-verify.js`。创建/构建阶段不可盲目重跑，以免重复生成；只读 restart 阶段可复核已保存状态。

## 本轮未验收与后续补验

上述隔离工程测试未执行真实鼠标/触摸点击、Game View/浏览器/真机运行截图或视觉验收。同日后续已在 CouchArcade 的独立场景补齐 Game View 真实鼠标点击与有限视觉检查，详见[点击验收报告](UI_VISUAL_CLICK_2026-09-28.md)，阶段 2 对应闭环已勾选。触摸、浏览器/真机、全部文案/语言、任意背景图、不同窗口宽高比以及实际游戏脚本副作用仍未验证；禁用按钮外观无区分已记录。固定布局不承诺长文案不裁切。
