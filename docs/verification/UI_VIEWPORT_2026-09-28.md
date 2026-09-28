# FR-17 P0 视口上下文验证（2026-09-28）

## 范围与来源

在 `5c1929d`（JSON UI 构建器）之后新增只读 `get_ui_viewport`，core 43 / full 141，版本保持 0.1.0 Unreleased。`build_ui` 成功结果及节点变换、批量变换、变换重置、组件属性设置四个入口附加独立 `viewport`，不改变写入/清理/Undo 结果。完整坐标、字段和降级约定见 [UI_VIEWPORT.md](../UI_VIEWPORT.md)。

按开发文档检索/抓取技能核对 [Profile.getProject](https://docs.cocos.com/creator/3.8/manual/en/editor/extension/profile.html)、[多分辨率适配](https://docs.cocos.com/creator/3.8/manual/en/ui-system/components/engine/multi-resolution.html)和 [Camera](https://docs.cocos.com/creator/3.8/api/en/class/Camera)，并读取本机 Creator 3.8.8 公开 `cc.d.ts` 与内置 project 包公开配置声明。设计分辨率使用已确认的四个原生配置键；坐标转换和矩阵刷新使用公开 API，未复制引擎或其他插件实现。文档核对促使实现明确区分项目设计配置、UI 单位与关联场景相机 render buffer，不把它们视为同一视口。

只支持可计算的正交相机自身 UITransform 四边形；编辑态关联场景相机不等于 Scene 观察窗口、Game View 或设备。透视、RenderTexture 和无法核验的上下文明示 unavailable，不伪造可见区域。

## 自动测试

- 新增 **48 项**：场景几何 34 项、编辑器入口/附加报告 14 项。缓存问题的两个回归测试先得到 **32 通过 / 2 失败**，加入公开矩阵刷新后全部通过。
- 批次 DTO/场景/编辑器入口、UI 构建器、视口、工具注册表定向 **230/230** 通过。覆盖四边形而非 AABB 判交、视口包围、负缩放/旋转/锚点、近远裁剪、退化几何、不同/未关联相机、配置漂移、缺失或非 UI 节点、只读性，以及附加查询失败仍保留原写入与部分失败结果。
- 全量 **1232 项，1229 通过，3 失败，0 跳过**。失败与本次改动前相同：`UI skill v1 with a manifest can upgrade to v2`、`UI skill v1 without a manifest can upgrade to v2`、`legacy Codex UI v1 migrates with a backup and preserves the original file`；属于既有 Skills CRLF/LF 升级/迁移问题，本轮未修改该模块。
- **71** 个语法检查、生成工具目录校验、发布清单检查与 `git diff --check` 通过；未打包或发布新版本。原 Funplay 归属、版权与 MIT 条款保留。

## Creator 3.8.8 正式入口

使用已核实身份的工作区隔离工程 `temp/op055-project`，备份安装扩展及原项目设置后用 `--project` 启动。专用场景 `Fr17Viewport.scene`，UUID `7e97ea3c-0ca5-4883-b3db-6cb1de1a17b6`。未修改 CouchArcade；探针和原始 MCP 结果均在忽略目录。

最终 7 个运行源文件与安装内容 SHA-256 一致；重启后的正式 `tools/list` 返回 141 项，视口工具的 readOnlyHint/idempotentHint 为 true、destructiveHint 为 false，描述明确排除 Scene 观察窗口。

| 检查 | 实际结果 |
| --- | --- |
| 横屏创建 | 项目 1280×720，fitWidth=true / fitHeight=false，Canvas align=false，正交相机 orthoHeight=360。正式 build_ui 创建画内、画外和非中心锚点三个节点，自动报告分别为 inside/outside/inside。 |
| 单位与独立数值核对 | 相机实际 buffer 为 531×414，绝非 1280×720。中心 200×80 节点投影 x=208…323、y=184…230；按每 UI 单位 414/720 像素独立核对。Canvas 平面视口 x 约 ±461.739、y=±360，不等于 Canvas 内容宽度。 |
| 修改后报告 | 位置接近边缘得到 partial；位置重置恢复 inside；UITransform 宽改为 10000 得到 partial 后恢复。批量修改含一项缺失节点时原部分失败保留，已知节点仍带视口报告。 |
| 锚点/负缩放/旋转 | 非中心锚点节点缩放 x=−2、y=1.5 并旋转 30°，Canvas 局部 maxX=−90，与独立计算一致；之后恢复原旋转/缩放。 |
| 局部视口 | rect=(0.25,0.25,0.5,0.5)，像素偏移及投影缩放与独立公式一致，之后恢复全屏 rect。 |
| 竖屏创建与保存 | 项目 720×1280，fitWidth=false / fitHeight=true，Canvas align=true，orthoHeight=640；正式 build_ui 创建新的 PortraitFresh 节点，附加报告为 inside。中心样本投影 x≈233.15625…297.84375、y=194.0625…219.9375；保存、切换 Blank 后重开，全节点报告一致。 |
| 明确降级 | 透视相机返回 perspective_unsupported，inactive 节点返回 inactive_target，已知/缺失 UUID 混合查询保留可用目标且 complete=false；不自动调整场景来获得 complete。 |
| 只读性 | 查询前后作者节点/组件/相机/Canvas 快照一致，场景文件及项目设置文件哈希不变。修改相机后公开矩阵刷新也满足该检查。 |
| 完整重启 | 恢复原设计配置与完整原设置文件，保存专用场景后正常退出/重启；5 个 UI 节点及 Canvas/Camera 的 UUID、组件、变换、相机关联、尺寸与投影裁剪报告保持。再次正常退出测试 Creator。 |
| 资源保留 | 测试前的 102 个资源文件 SHA-256 全部不变，仅新增专用 scene/.meta；项目设置原字节恢复。未强杀或打开用户游戏工程。 |

## 实测发现与修复

首次从横屏切到竖屏后，组件的 orthoHeight 和位置已改变，但编辑态相机尚未渲染新帧，`worldToScreen`/matView 仍使用旧缓存，保存重开后结果不同。独立探针把相机临时设为 (200,400,1000)、orthoHeight=500，世界点 (360,640,0) 刷新前仍投影到 (265.5,207)，公开 `camera.camera.update(true)` 后为 (331.74,306.36)，随后立即恢复原参数。该 API 在 3.8.8 公开声明中说明用于更新相机内置矩阵。

实现已在投影前强制刷新派生矩阵，失败则不返回完整投影。随后重新执行横→竖切换、独立坐标公式、保存重开和完整重启；所有节点报告一致，不依赖先保存才能查询。记录中保留了首次失败及修复后证据，未删改失败历史。

最终专用场景 SHA-256：`6017fc06458e71a25b1939b773e89508ed08a0417c1c7cf038b3457e892000c5`。原始测试脚本/记录为 `temp/fr17-verify.js`、`temp/fr17-cache-probe.js`、`temp/fr17-evidence.json`，不提交或打包。

首版验收场景8仅在上述 P0 编辑态几何范围内通过。未进行 Game View 截图、设备显示、GUI 点击、遮挡/透明度/Mask、运行时布局或脚本视觉验收，其他 Creator 版本和并发用户编辑不在本次证明范围。下一任务是将自定义脚本挂载与按钮事件绑定接入 JSON UI 构建器。
