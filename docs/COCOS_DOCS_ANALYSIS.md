# Cocos Creator 3.8 官方文档分析与实现边界

版本：0.4　日期：2026-09-12　范围：开源 Funplay 衍生扩展的需求分析

## 结论

可以基于Funplay和公开Cocos API独立实现大部分所需能力。已对正常Pro接口目录的232个枚举条目完成逐项工程评估：**36项公开API明确、115项组合路线可行、66项原生适配待核验、15项可用替代实现**。完整记录见[逐项可行性矩阵](./reference/PRO_API_FEASIBILITY.md)和[机器可读JSON](./reference/pro-api-feasibility.json)。

这些数字衡量证据和设计路线，不衡量开发完成度。A/B类部分依赖C类资产保存或编辑器工作流；D类不承诺原生交互/数据格式等价。全部条目目前未做运行验收，因此不能据此确认完整替代Pro，也不能把目录232项理解为首版232项全实现。

## 文档怎样转化为实现依据

官方手册覆盖编辑器操作和引擎用法；API参考提供具体类和方法；扩展文档提供进程、消息和面板机制。引擎API适合实现节点、组件和动画模型，但编辑器的脏状态、撤销、导入和保存仍需单独适配。scene-script允许场景进程使用引擎API，不代表该进程是正在运行的游戏预览。跨进程传递节点或组件对象也不能代替可传输的JSON结果。[场景脚本文档](https://docs.cocos.com/creator/3.8/manual/zh/editor/extension/scene-script.html)

已查阅27个官方手册/API页面，并只读核对本机Creator 3.8.8的部分官方引擎声明。3.8在线API页面的部分链接跨版本，生成基线与本机补丁版本也可能不同；实施时以目标版本公开契约与真实验收为准。没有解密、反混淆或读取Pro非公开实现来推导路线。

## 各模块具体判断

| 模块 | 可独立实现的内容 | 必须保留的边界 |
| --- | --- | --- |
| 节点与组件 | 查询、层级、变换、创建/销毁、组件增删、公开属性赋值、自定义组件及事件组合。 | 引擎修改不自动证明原生撤销、脏标记及保存；重名/跨引用/异步销毁需处理。[Node](https://docs.cocos.com/creator/3.8/api/zh/class/Node) |
| 资源与预制体 | 资源解析、子资产、引用检查、实例构建可沿用Funplay候选。 | 资产导入/保存和链接实例须核验原生消息；嵌套实例不能任意删除/改父级，revert也不是所有字段复原。[预制体](https://docs.cocos.com/creator/3.8/manual/zh/asset/prefab.html) |
| 构建器/模板/验证 | 自有JSON构建、分阶段绑定、规则检查、参数化模板。 | 模板和知识正文独立编写；结构规则不能判断所有遮挡/美观或游戏逻辑。 |
| 文字排版 | Label/RichText文字、字体、对齐、换行、缓存，支持模式下的描边与阴影。 | 位图字体/CHAR缓存限制，RichText使用独立标记和组件规则；字体文件另核查许可。[Label](https://docs.cocos.com/creator/3.8/manual/zh/ui-system/components/editor/label.html)、[RichText](https://docs.cocos.com/creator/3.8/manual/zh/ui-system/components/editor/richtext.html) |
| 视图与参考图 | 游戏/UI边界可计算；自有参考面板可设置位置、缩放、透明度和切换。 | Gizmo、网格、图标和原生观察相机的自动化消息尚未确认；自有参考面板不是原生Scene叠加。[场景编辑器](https://docs.cocos.com/creator/3.8/manual/zh/editor/scene/) |
| 配置与日志 | Profile已确认键的CRUD；项目/编辑器信息、选择、编辑器日志、自有服务状态。 | 不能从通用Profile API推断完整原生设置目录；不能把编辑器日志当浏览器控制台。[Profile](https://docs.cocos.com/creator/3.8/manual/zh/editor/extension/api/profile.html)、[Logger](https://docs.cocos.com/creator/3.8/manual/zh/editor/extension/api/logger.html) |
| 普通动画 | 创建轨道/路径、关键帧增删移动/复制、间距、插值/切线、事件、状态、播放以及自有预设。 | 外部导入ExoticAnimation不是普通可编辑轨道；动画编辑器模式与.anim保存还需核验。[曲线](https://docs.cocos.com/creator/3.8/manual/zh/animation/use-animation-curve.html)、[AnimationClip](https://docs.cocos.com/creator/3.8/api/zh/class/AnimationClip) |
| Spine | 资源/动画/皮肤查询，设置动画/皮肤、公开属性、合法资源绑定及socket。 | 内置runtime、资源版本、缓存模式影响能力；不包含完整骨骼创作工具。[Spine](https://docs.cocos.com/creator/3.8/manual/zh/editor/components/spine.html) |
| 构建与截图 | 官方CLI构建加自有浏览器截图、窗口/实时预览截图及结构快照。 | Creator构建需要图形环境；浏览器无头不能推导Creator完全无头；缓存与启动时序会影响画面。[CLI构建](https://docs.cocos.com/creator/3.8/manual/zh/editor/publish/publish-in-command-line.html) |

## 需要加入需求与计划的具体限制

1. **原生消息契约**：在Creator 3.8.8的“开发者→消息列表”核对场景保存/关闭、资产导入、预制体编辑、撤销、动画编辑模式和场景视图消息。通用Editor.Message.request存在不代表任意消息名存在。[消息系统](https://docs.cocos.com/creator/3.8/manual/zh/editor/extension/messages.html)
2. **Funplay持久化审查**：本地 `lib/scenes.js` 和 `lib/prefabs.js` 存在直接写文件及回退路径；还包含预制体JSON编辑入口。首版前必须检查序列化格式、meta/UUID、导入器及内存状态一致性，未经真实验证的路径不作为可靠编辑入口。本轮只记录风险，没有修改代码。
3. **剪贴板**：公开Clipboard API没有给出原生节点数据契约。可设计独立节点剪贴板，粘贴重建内部引用；若要求与编辑器Ctrl+C/Ctrl+V完全互通，另列原生核验，不能默认支持。[Clipboard](https://docs.cocos.com/creator/3.8/manual/zh/editor/extension/api/clipboard.html)
4. **动画时间与模型**：关键帧时间统一秒；对外帧号按sample换算；事件字段frame也是秒。sample、clip速度、state速度、循环模式各自定义，不默认拉伸时间。数值/向量/旋转/离散轨道采用对应曲线规则，不能全部套标量evaluate。[动画事件](https://docs.cocos.com/creator/3.8/manual/zh/animation/animation-component.html)、[RealCurve](https://docs.cocos.com/creator/3.8/api/zh/class/RealCurve)
5. **动画保存和编辑态**：new AnimationClip只证明内存对象创建；资源UUID、导入、保存重开和实际预览各自验证。query_clip_dump只能先返回自有公开DTO，不能承诺原生内部转储格式兼容。
6. **布局和动画冲突**：Widget的ALWAYS更新可能覆盖节点的位置/尺寸动画；可以明确使用ONCE或动画化边距，验证器应指出冲突。[Widget](https://docs.cocos.com/creator/3.8/manual/zh/ui-system/components/editor/widget.html)
7. **Spine挂点**：根据官方SpineSocket路径/target模型实现；验证骨骼路径及空挂点容器。实时模式与共享缓存模式的混合/多轨能力分别测试，设置成功不等于视觉正确。[Spine挂点与缓存说明](https://docs.cocos.com/creator/3.8/manual/zh/editor/components/spine.html)
8. **截图构建**：构建任务必须按官方退出码判定，成功码36不能当成失败。浏览器可无头截图，Creator CLI仍需图形环境；未保存或过期构建截图不作为当前场景证据。时间、随机数、网络、异步加载需显式稳定策略，否则不承诺像素确定性。[CLI](https://docs.cocos.com/creator/3.8/manual/zh/editor/publish/publish-in-command-line.html)
9. **偏好设置**：重置移除指定覆盖层，不删除整个用户配置；只承诺已确认的键与分类，完整原生目录继续核验。[Profile](https://docs.cocos.com/creator/3.8/manual/zh/editor/extension/api/profile.html)

## 建议实施顺序

先核验Funplay底座的场景/资源/预制体保存及消息契约，再实现P0统一解析、JSON UI构建、事件绑定、验证与知识查询。P1先做确定性组合、文字、快照和截图来源管理，再扩展动画轨道模型及保存；原生视图/编辑模式与恢复以验证结果决定范围。Spine、平台兼容和开发工具进入后续阶段。详细任务见[开发计划](./PLAN.md)。

首个交付承诺仍按需求中的八项P0场景验收；本轮没有执行生产游戏中的创建、删除、设置或构建操作，也没有把文档分析任务标为功能开发完成。

## 来源与证据

来源ID用于矩阵定位；仅记录自行撰写的结论和链接，没有保存/移植Pro知识正文。官方页面本次已读取；本地源文件只用于核对底座和官方声明。

| ID | 来源 | 本次使用范围 |
| --- | --- | --- |
| S01 | [Cocos Creator 3.8 中文手册](https://docs.cocos.com/creator/3.8/manual/zh/) | 版本入口，不能据此推断每个原生编辑器消息。 |
| S02 | [扩展消息系统](https://docs.cocos.com/creator/3.8/manual/zh/editor/extension/messages.html) | 说明消息注册与请求；具体原生消息需在目标编辑器的开发者→消息列表核对。 |
| S03 | [Editor.Message API](https://docs.cocos.com/creator/3.8/manual/zh/editor/extension/api/message.html) | 文档提供 send/request/broadcast，以及 scene query-dirty 示例。 |
| S04 | [场景脚本](https://docs.cocos.com/creator/3.8/manual/zh/editor/extension/scene-script.html) | 扩展可在场景进程使用引擎 API；跨进程参数和返回值须为可传输数据。 |
| S05 | [Node API](https://docs.cocos.com/creator/3.8/api/zh/class/Node) | 节点变换、层级和组件基础能力；不能单凭该 API 保证撤销及资产保存。 |
| S06 | [预制体手册](https://docs.cocos.com/creator/3.8/manual/zh/asset/prefab.html) | 编辑、应用、还原及嵌套规则；手册工作流不等于对应扩展消息签名。 |
| S07 | [Editor.Profile API](https://docs.cocos.com/creator/3.8/manual/zh/editor/extension/api/profile.html) | get/set/removeConfig 与 get/set/removeProject；须区分配置层级。 |
| S08 | [Editor.Selection API](https://docs.cocos.com/creator/3.8/manual/zh/editor/extension/api/selection.html) | 选择类型与 UUID；不能把选择状态当成操作完成。 |
| S09 | [Editor.Clipboard API](https://docs.cocos.com/creator/3.8/manual/zh/editor/extension/api/clipboard.html) | 文本、图片及自定义剪贴板数据；没有给出原生节点剪贴板序列化契约。 |
| S10 | [Editor.Network API](https://docs.cocos.com/creator/3.8/manual/zh/editor/extension/api/network.html) | IP 和端口检查；testConnectServer 的文档目标不是本项目 MCP 服务。 |
| S11 | [Editor.Logger API](https://docs.cocos.com/creator/3.8/manual/zh/editor/extension/api/logger.html) | 编辑器日志查询和清理；不同于浏览器游戏控制台。 |
| S12 | [Editor.Project API](https://docs.cocos.com/creator/3.8/manual/zh/editor/extension/api/project.html) | 项目名称、路径、临时目录和 UUID。 |
| S13 | [Editor.App API](https://docs.cocos.com/creator/3.8/manual/zh/editor/extension/api/app.html) | 编辑器版本和路径等；未据此确认原生 reload 消息。 |
| S14 | [Editor.Panel API](https://docs.cocos.com/creator/3.8/manual/zh/editor/extension/api/panel.html) | 扩展面板定义、打开、关闭和聚焦；原生面板 ID 须核对。 |
| S15 | [场景编辑器](https://docs.cocos.com/creator/3.8/manual/zh/editor/scene/) | Gizmo、网格、2D/3D 和相机对齐交互；此页未给出自动化消息签名。 |
| S16 | [UITransform](https://docs.cocos.com/creator/3.8/manual/zh/ui-system/components/editor/ui-transform.html) | 尺寸、锚点和 UI 边界；兄弟顺序使用节点接口。 |
| S17 | [Button](https://docs.cocos.com/creator/3.8/manual/zh/ui-system/components/editor/button.html) | 点击事件目标、组件和方法；方法名需与脚本一致。 |
| S18 | [Label 手册](https://docs.cocos.com/creator/3.8/manual/zh/ui-system/components/editor/label.html) | 字体、换行、溢出和缓存；不同字体模式有功能差异。 |
| S19 | [Label API](https://docs.cocos.com/creator/3.8/api/zh/class/Label) | 文字属性 API；具体描边阴影属性已补充核对本机 3.8.8 引擎。 |
| S20 | [RichText](https://docs.cocos.com/creator/3.8/manual/zh/ui-system/components/editor/richtext.html) | 图文标记、字体和点击事件；不能直接套用全部 Label 属性。 |
| S21 | [Widget](https://docs.cocos.com/creator/3.8/manual/zh/ui-system/components/editor/widget.html) | 对齐边距与更新模式；ALWAYS 可能覆盖位置动画。 |
| S22 | [Animation 组件与事件](https://docs.cocos.com/creator/3.8/manual/zh/animation/animation-component.html) | 播放控制、状态与事件；事件 frame 字段单位为秒。 |
| S23 | [程序化动画曲线](https://docs.cocos.com/creator/3.8/manual/zh/animation/use-animation-curve.html) | 轨道、路径、曲线及插值；外部导入 ExoticAnimation 不能按普通轨道编辑。 |
| S24 | [AnimationClip API](https://docs.cocos.com/creator/3.8/api/zh/class/AnimationClip) | 轨道、事件、时长、采样、速度和循环；对象创建不等于保存动画资产。 |
| S25 | [RealCurve API](https://docs.cocos.com/creator/3.8/api/zh/class/RealCurve) | 关键帧读取、时间更新、增删、assignSorted 与插值参数。 |
| S26 | [命令行构建](https://docs.cocos.com/creator/3.8/manual/zh/editor/publish/publish-in-command-line.html) | Creator 构建仍需图形环境；成功退出码为36，需按官方码表判断。 |
| S27 | [Spine 组件](https://docs.cocos.com/creator/3.8/manual/zh/editor/components/spine.html) | 资源、动画、皮肤、缓存和挂点；实时/缓存模式的混合能力不同。 |
| L01 | [本机官方 Creator 3.8.8 引擎](C:/ProgramData/cocos/editors/Creator/3.8.8/resources/resources/3d/engine) | 只读核对 Node、AnimationClip、Label 和 cocos/spine/skeleton.ts；不复制实现。 |
| F01 | [Funplay 已注册工具文档](./TOOLS.md) | 105 个 full 工具作为候选复用入口，文档描述不代表已通过本项目真实编辑器验收。 |
| F02 | [Funplay 资源适配代码](../lib/assets.js) | 候选 asset-db 请求；在线文档未确认全部原生消息签名。 |
| F03 | [Funplay 场景持久化代码](../lib/scenes.js) | 存在文件直写回退，须在首版之前审查资产导入、UUID 与保存一致性。 |
| F04 | [Funplay 预制体代码](../lib/prefabs.js) | 预制体持久化和 JSON 编辑候选；文件直写与内部元数据须审查。 |
| P01 | [已激活 Pro 正常 tools/list](./reference/pro-tools-list.json) | 仅正常接口定义用于需求对照；不是实现来源，也不是运行通过证据。 |

核对本机官方文件：`cocos/scene-graph/node.ts`、`cocos/animation/animation-clip.ts`、`cocos/2d/components/label.ts`、`cocos/spine/skeleton.ts`。API页面的`/class/Skeleton`指3D骨骼资产，未作为sp.Skeleton依据。

未建立可信精确依据的猜测地址（如扩展api/asset-db.html）返回404，已排除；资源消息路线保留候选标记。官方公开消息列表尚未逐条采集，因此C类保持待核验。

## 完成本轮分析的核对规则

矩阵与原始目录一一对应，工具16组，总数232，无重复/漏项；所有候选Funplay工具名称须在本地TOOLS.md中存在；所有来源ID须存在；所有运行状态仍为未测试。机器可读JSON可供后续排期及验收更新，但不能替代运行证据。

本轮上述完整性检查已通过，Markdown与JSON的操作/分类/需求/优先级一致，四份核心文档的本地链接有效，MIT LICENSE与上游SHA256一致。记录见[文档检查结果](./reference/DOCS_ANALYSIS_CHECK.json)；本记录不包含任何功能运行通过结论。
