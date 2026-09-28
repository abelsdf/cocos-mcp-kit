# 新 UI 场景入口与未保存内容保护验证

日期：2026-09-28。环境：Windows，Creator 3.8.8，仓库内隔离工程 `temp/op055-project`，正式 MCP 端口 27855、full 配置。未改动 CouchArcade 工程；`temp/` 证据和测试资源不提交。

## 实现边界

复用 core/full `create_scene` 增加 `mode=ui`，不增加工具数量（core 43 / full 141）。构造独立 Scene/Canvas/Camera，再沿已有 asset-db 序列化持久化路径保存；不先切换当前场景。默认不打开，UI 模式不覆盖。需要创建后打开时必须给出准确的原场景 UUID。

独立 `open_scene` 与创建后打开共用严格的未保存检查：已保存单一普通场景、ready/imported、源路径/meta UUID、原场景真实序列化、两次上下文检查。dirty=true 和 dirty=false 的实际内容差异都拒绝。原生打开只请求一次，检查新旧源文件未变及目标身份/内容稳定；失败不自动保存、丢弃、重试、返回或删除新资源。

打开成功的 `verified` 只承诺身份、源文件保留和稳定性；目标首次加载可能初始化内容，需根据 `contentMatchesSource`/`needsSave` 明确决定后续显式保存。目标加载的脚本外部副作用、并发编辑和跨资源事务不在保障范围。完整契约见 [UI_BUILDER.md](../UI_BUILDER.md)。

## 自动测试

- 新增 32 项：28 项场景入口/保护测试，4 项离线 UI 序列化测试。
- 保护覆盖：已保存场景进入与幂等重复、错误 UUID、dirty=true、未标脏内容、prefab/multi/未 ready、缺少原场景、源/meta 不匹配、未导入、非法参数、孤立 meta、当前场景覆盖、创建过程中的原场景变化、原生打开异常、目标身份变化、打开后源文件变化和不稳定内容。失败路径不隐式保存或重试。
- 序列化覆盖：1280×720 与 720×1280 的尺寸、层、相机投影/关联/位置；分辨率无效及序列化异常只销毁临时 Scene，不碰原场景。
- 定向 222/222：scene-entry、scene-ui-serialization、scenes、tool-registry、ui-builder、node-batch-create、ui-viewport、ui-viewport-scene、scene-button-events。
- 全量 1294 项：1291 通过、3 失败、0 跳过。既有失败仍为 `UI skill v1 with a manifest can upgrade to v2`、`UI skill v1 without a manifest can upgrade to v2`、`legacy Codex UI v1 migrates with a backup and preserves the original file`，未扩大或顺带修改。
- 71 项语法检查、工具文档生成/一致性、发布检查和 `git diff --check` 通过。

## Creator 3.8.8 实测

1. `mode=ui` 创建但不打开：原场景 UUID 和实时序列化不变；新资源及 meta 导入成功。返回的 Canvas/Camera 节点 ID 在打开后完全一致。
2. 新建场景为 1280×720，Canvas/Camera 同中心，UI_2D 层和相机可见层一致，正交高度 360，关联引用存在，alignCanvasWithScreen=false。随后 `build_ui` 创建 2 节点/6 组件/1 普通引用/1 Button 事件，视口报告两节点 inside（不等同视觉验收）。
3. 直接改 Canvas 名称，Creator 仍报告 dirty=false：独立打开与创建后打开均拒绝，旧现场保持，拒绝目标没有生成文件。错误原场景 UUID 和 UI overwrite 也拒绝。
4. 原生 begin/end-recording 记录测试改名，确认 dirty=true：两种入口均拒绝；只 Undo 本次测试录制后，节点/组件/事件身份精确恢复，再显式保存。普通 set-property/snapshot 在此样本没有可靠标脏，不能把其调用成功当作 dirty=true 的证据。
5. 创建后打开另一个新场景通过，原场景文件保留；新目标加载差异返回 needsSave=true，测试显式保存后再切换。
6. 构建后的两种新场景往返、显式保存、重开通过。使用真实引擎 `EventHandler.emitEvents`，接收器 hits=1、参数 entry、文字为 `Clicked 1: entry`；重新保存/打开后保持。
7. 完整正常退出并重启 Creator，确认相同项目与目标场景：Canvas、Camera、UI 节点/组件 UUID、脚本/事件目标及保存效果保持；重复打开当前干净场景返回 alreadyOpen=true，不再调用原生打开。
8. 108 个本轮之前的资源文件 SHA-256 均不变。只新增 3 个本轮诊断/验收 `.scene` 及其 `.meta`；没有修改历史 Blank 或之前验证的游戏内容。

关键标识：

| 项目 | 值 |
| --- | --- |
| 主验收场景 | `SceneEntryVerified.scene` / `fd1ee66f-531c-454b-af4e-ef30adaee0c7` |
| Canvas 节点 | `60fNwz38tP+r6CLf0S7+f0` |
| Camera 节点 | `a8WoMVe7lE4bh8KVOVOVXT` |
| 第二新场景 | `SceneEntryOpened.scene` / `4d5537f5-a913-4f97-8a08-5361259d684c` |
| 最终主场景 SHA-256 | `f17fbfce3fd073bbf175a2bda6d14cd34cec253e2e67d6ed0a4c02bff5b5ecca` |

## 发现与限制

初始诊断样本首次打开时，Canvas 原点被 Creator 调到设计中心，环境光 `_skyColorHDR.w` / `_skyColor.w` 从 1 初始化为 0.520833125，dirty 仍为 false。最终 UI 构造显式设置 Canvas/Camera 中心；不忽略环境光差异、不偷偷保存，而是报告 needsSave。严格的切换前检查仍按真实内容拒绝。

测试途中旧 Blank 场景也出现同样环境光初始化差异，正式 `open_scene` 正确拒绝离开。仅在隔离测试清理中逐字段证明差异完全是本次引擎初始化、确认源哈希未变后，显式原生返回本次新建样本；产品代码没有该回退。后续往返均使用本轮新建且显式保存的场景。

原始调用与快照：`temp/scene-entry-evidence.json`（初始诊断）、`temp/scene-entry-evidence-v2.json`（正式验证和恢复记录），脚本 `temp/scene-entry-verify.js`。测试中保留了失败记录，恢复时复用已创建资源/节点，不删除或盲目重复创建。

未验证物理鼠标点击、Game View/浏览器/真机运行、视觉与不同窗口宽高比适配、其他 Creator 版本或任意脚本副作用。阶段 2 的完整点击/视觉验收项仍未勾选；下一功能是暂停菜单、设置弹窗、结果弹窗模板。
