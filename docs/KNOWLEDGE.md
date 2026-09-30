# UI 知识查询（FR-09）

知识版本 `1.0.0`，适用 Cocos Creator **3.8.x**，官方来源复核日期 **2026-09-28**。正文为本项目独立编写的中文摘要；不复制商业插件知识库，不打包官方页面、图片或示例代码。源码位于 `lib/knowledge.js`，随扩展发布，无额外依赖。

## 使用

复用 MCP Resources，core/full 均可用，不增加 tools 数量。客户端必须支持 `resources/list`、`resources/templates/list` 和 `resources/read`；仅支持工具调用的客户端不会自动获得这些资源。

先读精简目录：

```json
{"jsonrpc":"2.0","id":1,"method":"resources/read","params":{"uri":"cocos://knowledge/index"}}
```

按主题读取正文，或按组件取得相关主题链接：

```json
{"jsonrpc":"2.0","id":2,"method":"resources/read","params":{"uri":"cocos://knowledge/topic/widget-layout"}}
{"jsonrpc":"2.0","id":3,"method":"resources/read","params":{"uri":"cocos://knowledge/component/cc.Widget"}}
```

响应沿用 `contents[].text`（`text/plain`），其中为 JSON 文本。目录和组件查询只返回标题、摘要、组件标签及主题 URI，不默认展开全部正文；主题查询一次仅返回一篇。每个响应包含 `knowledgeVersion`、`appliesTo`、`sourceReviewedAt`、`language` 和适用边界。

| 主题 ID | 组件/类型标签 | 内容 |
| --- | --- | --- |
| ui-transform | UITransform、Node、Canvas、Camera | 尺寸、锚点、本地/世界坐标、Canvas 相机关联与可见性边界 |
| widget-layout | Widget、Layout | 对齐模式、ALWAYS/动画冲突、自动排列与更新时机 |
| label-fonts | Label | 字体、换行、溢出和 CHAR/BITMAP 缓存限制 |
| sprite-assets | Sprite、SpriteFrame | 类型区分、尺寸模式、资源身份和引用持久化 |
| button-events | Button | 外观 target 与事件 target、回调参数、禁用与视觉状态 |
| editor-runtime | Component | 类/属性序列化、编辑态生命周期与运行证据边界 |

组件名称大小写敏感，可省略 `cc.`，如 `Widget` 与 `cc.Widget` 等价。Node/SpriteFrame 是知识标签，并不表示它们可以作为组件挂载；本接口不枚举工程脚本类、不接受模糊搜索或任意属性名。

未知主题/组件、空参数、额外路径、query/hash、畸形编码及超过 256 字符的 URI 明确报错（JSON-RPC `-32602`，保留请求 ID），不会猜测、读取任意文件或退回联网搜索。正文固定为有界目录数据，测试限制每种响应少于 6000 个 JavaScript 字符；这不是字节或 token 计费承诺。增加知识前应同步检查输出预算。

## 来源与证据分层

每篇的 `guidance` 是基于下列官方资料独立归纳的说明；`projectNotes` 是本扩展的限制、验收注意事项和已记录的工程经验，不能混同官方 API 承诺。`sources` 提供逐篇官方链接。复核范围为对应手册页面，不承诺所有补丁版本、平台或工程行为完全一致。

- [UITransform](https://docs.cocos.com/creator/3.8/manual/zh/ui-system/components/editor/ui-transform.html)、[坐标与变换](https://docs.cocos.com/creator/3.8/manual/zh/concepts/scene/coord.html)、[Canvas](https://docs.cocos.com/creator/3.8/manual/zh/ui-system/components/editor/canvas.html)。
- [Widget](https://docs.cocos.com/creator/3.8/manual/zh/ui-system/components/editor/widget.html)、[Layout](https://docs.cocos.com/creator/3.8/manual/zh/ui-system/components/editor/layout.html)。
- [Label](https://docs.cocos.com/creator/3.8/manual/zh/ui-system/components/editor/label.html)、[Sprite](https://docs.cocos.com/creator/3.8/manual/zh/ui-system/components/editor/sprite.html)、[Button](https://docs.cocos.com/creator/3.8/manual/zh/ui-system/components/editor/button.html)。
- [脚本装饰器](https://docs.cocos.com/creator/3.8/manual/zh/scripting/decorator.html)。

查询阶段完全离线，不访问 Editor/场景 API、不扫描游戏文件、不发送工程内容、不执行代码或修复，也不更新知识。修改知识需随扩展源码显式更新版本与复核日期；没有自动更新或远程下载机制。

## 不包含的能力

不是组件属性 schema、全量 API 参考或真实项目诊断器；暂不覆盖 RichText、任意自定义组件、所有字体效果及其他 Creator 主版本。结构检查与规则排除由独立的 [validate_ui](UI_VALIDATION.md) 提供，截图流程由 [verify_ui](UI_VERIFICATION.md) 提供；读取知识不会自动调用它们，也不会执行自动视觉判定。

知识查询成功不等于保存/引用、布局、点击或视觉验收通过。结构结论与客户端视觉判断必须分别记录；视觉判断由客户端提供，本资源不会生成截图或宣称自动视觉验证成功。
