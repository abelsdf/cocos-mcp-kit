# JSON UI 构建器 v1 验证（2026-09-28）

## 本轮交付

在基线 `02b28f5`（FR-29 单次 Undo）之后新增 `build_ui`，工具数量 core 42 / full 140，版本仍为 0.1.0 Unreleased。UI schema 与批次 DTO 分层，输入嵌套节点，编译局部 ID、UITransform、Label、Sprite、Button 及明确引用；整个创建/清理/Undo 仍走原批次入口，没有第二条通用脚本创建路线。

本次仅完成阶段 2 的当前父节点创建增量，不是完整 FR-06—FR-08 或 FR-17。详细字段、限额、重复调用、失败与保存约定见 [UI_BUILDER.md](../UI_BUILDER.md)。自定义脚本、点击事件、新场景、Canvas/Camera 创建、视口越界判断和模板均未实现；下一项为 FR-17 视口上下文。

## API 依据与实现取舍

- 使用开发文档检索与抓取技能查阅 [Cocos 3.8 Canvas](https://docs.cocos.com/creator/3.8/manual/en/ui-system/components/editor/canvas.html)、[Label](https://docs.cocos.com/creator/3.8/manual/en/ui-system/components/editor/label.html) 和 [Sprite](https://docs.cocos.com/creator/3.8/manual/en/ui-system/components/editor/sprite.html) 官方资料，并对照本机 3.8.8 的公开 `engine/bin/.declarations/cc.d.ts`；没有复制引擎或第三方插件实现。
- 相机关联不代表实际能渲染目标 layer：入口检查最近 Canvas、关联相机所属场景/启用状态/非临时节点、无 RenderTexture 和完整层掩码覆盖；不猜其他相机，不把检查通过解释为画面内可见。
- 文字使用 CLAMP（公开枚举 1），图片使用 CUSTOM（0），在渲染属性和资源绑定后应用 UITransform 声明尺寸，以避免自动尺寸覆盖 JSON；位置调用公开 `Node.setPosition`，只写本批新节点。
- 默认按钮 target 显式引用本节点，而非依赖激活后的隐式恢复；不同节点 target 使用同批局部 ID。target 不是点击事件。

## 自动验证

- 新编译器测试先运行，在模块实现前失败；场景变更前的定向测试暴露严格 UI 上下文、位置与回读缺口，随后实现并复验。
- 本次比基线新增 **59 项**；最终 DTO/场景/编辑器入口/注册表/UI 编译定向 **182/182** 通过。覆盖字段类型/未知字段、ID/引用、大小/深度/节点上限、同级重名、固定尺寸编译、默认 target、自定义脚本/事件拒绝、真实入口调用链、录制不确定不能报成功、相机/层掩码/嵌套 Canvas 与父节点、上下文漂移和位置回读失败清理。
- 全量 **1184 项，1181 通过，3 失败，0 跳过**。3 项与基线一致：`UI skill v1 with a manifest can upgrade to v2`、`UI skill v1 without a manifest can upgrade to v2`、`legacy Codex UI v1 migrates with a backup and preserves the original file`。它们是既有 Skills 模板 CRLF/LF 升级/迁移问题，本轮未修改该模块，不能宣称全量通过。
- **69** 个语法检查、工具目录生成/校验、`node scripts/release.js check` 与 `git diff --check` 通过。没有构建或发布安装包；保留原有 Funplay 版权与 MIT 条款。

## Creator 3.8.8 正式入口

使用本工作区隔离工程 `temp/op055-project`，先核对工程身份，备份安装文件，启动参数为 `--project`。本轮专用场景 `JsonUiValidation.scene`，UUID `b3918fba-a1f8-43e2-9f4e-06de7dff1119`；未修改用户提供的 CouchArcade。场景基线先建既有 Canvas/相机、普通哨兵节点和从另一根脚本组件传入哨兵的引用，再保存重开。

| 检查 | 实际结果 |
| --- | --- |
| 正式嵌套 JSON 创建 | 两个 roots，共 5 节点、11 组件、3 引用；文字、字体尺寸/行高、颜色、图片、层级、位置、尺寸、锚点与实际 UUID 回读一致。500×320 的面板与 400×64 的文字保持声明尺寸，没有被 16×16 图片素材或 Label 自动宽度覆盖。 |
| 资源与节点引用 | 两个 Sprite 使用精确项目子资源 UUID `f58f7922-78da-43ec-8317-2c20e0247efc@f9941`；Button target 引用新建 caption 节点，不是外部 UUID 或点击业务绑定。 |
| 既有未保存内容 | 构建前将普通 Sentinel 原生改名为 PriorUnsaved，未保存；创建及 Undo/redo 后旧节点/组件 UUID、改名、其他根的传入引用与场景原文件哈希不变。 |
| 重复调用 | 原 JSON 再调用因根同名在 preflight 拒绝，`cleanup:not_needed`，已有节点不被更新或改名。 |
| 无写入拒绝 | 缺失资源、断链 Button target、非空事件、同节点 Label/Sprite 冲突，以及相机不覆盖 layer/只覆盖部分 layer 位均失败，无新节点。 |
| 单次 Undo/redo | 一次 Undo 移除两个 UI 根的整批，Redo 恢复精确节点/组件 UUID、层级和引用；保留前一未保存编辑。 |
| 组件创建失败 | 对专用 UiFailureLabel 节点临时注入 Label addComponent 异常，phase=create，清理本批新节点，残留为空，取消本次录制。钩子 finally 中移除，不提供生产故障参数。 |
| 引用绑定失败 | 对专用 Failedreference 的 SpriteFrame setter 临时注入异常，phase=references，已创建的本批节点全部清理，残留为空，取消本次录制。setter 在 finally 恢复；之前的 redo 仍恢复成功 UI 批次。 |
| 指定已有嵌套父节点 | 最终代码在已有 JsonPanel 下另建一个文字/按钮节点，校验最近 Canvas 身份、分数局部位置、尺寸与默认自身 target；单次 Undo/redo 精确恢复后再 Undo 移除该临时测试节点，不保留到最终场景。 |
| 保存、切换重开、完整重启 | 显式保存专用场景，切换 Blank 后重开，并完整退出/启动 Creator，主要 5 节点批次的结构、身份、位置/尺寸/锚点、字体与颜色、全部引用一致。不宣称 Undo 历史跨重启持久化。 |
| 原资源与运行边界 | 100 个原有资源文件的 SHA-256 全部不变，仅新增专用 scene/.meta。最终运行源文件与安装内容一致；验证结束正常退出隔离编辑器，未强杀用户工程。 |

最终专用场景 SHA-256：`82361b0733614e70e9d4c4edae0fdcfffe9855a8325317039f3b050d25819b54`。测试脚本和逐次 MCP 结果位于忽略目录 `temp/ui-builder-verify.js`、`temp/ui-builder-evidence.json`，不提交或打包。

本轮证据是编辑态结构、恢复及持久化，不是 GUI 点击、Game View 视觉、屏幕可见性、脚本生命周期或事件业务逻辑验收。其他 Creator 版本、并发用户编辑、跨场景复制、外部引用解析和任意已有内容事务未验证。
