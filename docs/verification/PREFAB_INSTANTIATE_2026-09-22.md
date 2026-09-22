# OP-056 预制体实例化验证（2026-09-22）

## 实现范围

统一 `full` 配置下的 `create_prefab_instance` 与 `instantiate_prefab`，保留两个公开工具名，不新增工具；总数仍为 118，`core` 为 39。旧运行态 `instantiatePrefab` 场景方法改为只读预检，不再作为公开工具的备用写入路径。

- 输入资源须为已导入、有效的 `cc.Prefab`；asset-db 与场景均须就绪，活动场景 UUID 须对应已导入的 `cc.SceneAsset`。未保存场景及预制体编辑模式被拒绝。
- `parentUuid` 精确选择普通父节点，`parentPath` 仍可使用；同时提供时须指向同一节点，重名路径不猜测。不指定父节点时使用当前场景根；关联预制体父层级和编辑器专用节点不可作为父节点。
- 预检加载资源并记录场景、父节点和已有直接子节点 UUID；异步加载后复查场景与父节点未切换。预检不实例化、不修改源预制体。
- `name` 须非空，提供时去除首尾空格；`position` 须包含有限数值 `x/y/z`，不接受缺项或额外字段。省略名称/位置时使用源预制体根节点值；坐标始终为父节点本地坐标，不是世界或视口坐标。
- 通过原生 `scene:create-node` 创建一次，显式指定父 UUID、`unlinkPrefab: false`、`nameIncrease: false` 和 `keepWorldTransform: false`。验证场景、父节点、新节点身份、名称、链接资产 UUID、实例根、PrefabInfo/fileId 和实例 fileId。
- 再经 `scene:set-property` 写入本地 `position`，要求原生返回 `true`，随后重新验证链接、层级及位置（逐轴误差不超过 `1e-5`）。这是原生预制体属性覆盖，不是仅修改运行对象。
- 成功返回 `created/instantiated/linkedPrefab/verified: true` 与 `needsSave: true`。这些字段只证明当次内存状态；调用方仍须显式保存场景，并按需要重开复查。
- 原生创建抛错或没有返回 UUID 时提示先检查层级，不重新发起创建或回退 `cc.instantiate`。后续验证失败，只在再次检查同一场景、同一父节点及非原有直接子节点身份后尝试原生移除，并用 `query-node` 确认消失。无法确认所有权、查询失败或清理失败会明确报告，不宣称回滚完成。

## 原生契约与现场发现

接口依据为安装版 Creator 3.8.8 的公开 `builtin/scene/@types/message.d.ts`、`builtin/scene/@types/public.d.ts` 与消息贡献声明；只读声明并通过实际编辑器验证，不读取或移植受限插件实现。消息基础机制见 [Cocos 官方文档](https://docs.cocos.com/creator/3.8/manual/zh/editor/extension/messages.html)。

| 消息 | 本轮采用的契约与实测 |
| --- | --- |
| `scene:create-node` | `CreateNodeOptions` → 新节点 UUID 字符串；结果不明不猜测其他返回形状。 |
| `scene:set-property` | `{uuid, path: 'position', dump: {type: 'cc.Vec3', value: {x,y,z}}}` → 布尔值；保存后存在位置覆盖。 |
| `scene:remove-node` | `{uuid}` → 无返回值；不能仅凭返回判断完成。 |
| `scene:query-node` | UUID → 节点转储；本版本不存在节点实测为 `undefined`。 |

原生创建的 `position` 不能直接当作父节点本地坐标：在有位移、旋转和缩放的父节点下，传入 `(17,-9,2)` 实测产生了不同的本地位置。UI 预制体挂在无 Canvas 上下文的普通父节点下时，原生还会自动插入 Canvas/Camera、改变直接父节点。因此本工具先要求 UI 根的目标父节点已有 Canvas 祖先，创建后再单独写入本地位置，不自动创建 Canvas。

另一现场探针显示，Canvas 根虽然创建当时读回 `(8,-5,0)`，保存重开后被编辑器自动居中为 `(640,360,0)`。最终实现拒绝 Canvas 根，同时拒绝启用的根 Widget 和父 Layout，避免把即时赋值宣称为稳定位置；不自动关闭或改写这些组件。该失败探针节点已通过原生移除并确认消失，测试用源预制体保留，可按记录重建。

## 自动化测试

- 修改前新增 42 项注册入口测试：39 失败、3 通过，复现原生入口忽略位置、运行态回退及预检/结果确认不足。
- 现场发现布局覆盖后，先补测试复现 3 项失败，再增加拒绝边界；最终 `test/prefab-instantiation.test.js` 42/42、`test/scene-prefab-instance.test.js` 14/14 通过。覆盖两个入口、默认值、非法参数/资产、父选择、异步场景变化、UI/布局上下文、错误链接、位置写入失败、限定清理与清理结果不明。
- 相关回归：`node --test test/prefab-instantiation.test.js test/scene-prefab-instance.test.js test/tool-registry.test.js test/scene-node-queries.test.js test/assets.test.js test/prefabs.test.js`，174/174 通过。旧文件中 3 个预制体测试由新套件替代。
- 全量：457 项，454 通过，3 失败，0 跳过。失败仍是 `UI skill v1 with a manifest can upgrade to v2`、`UI skill v1 without a manifest can upgrade to v2`、`legacy Codex UI v1 migrates with a backup and preserves the original file`，与 OP-055 前后的 Skills 换行/哈希基线一致。本次未修改迁移实现或夹具，不宣称全量通过。
- `npm run check`、重新生成工具说明后的 `npm run docs:check` 与 `git diff --check` 通过。

## Creator 3.8.8 正式入口验证

使用本仓库忽略目录 `temp/op055-project` 的隔离工程，安装修改后的扩展并重启，经 `http://127.0.0.1:27855/mcp` 调用正式工具。未修改用户提供的 `F:\AIWork\CouchArcade-main`。

创建 `Op056.scene`（UUID `7d7506c4-517e-4465-8156-dc60825f1ce1`）；`Canvas/Transformed` 有位移 `(100,-50,3)`、缩放 `(2,1.5,1)`、Z 旋转 30 度。源资源为：

- `Op056Ui.prefab`：UUID `66d92b50-f476-4d90-a6e1-514718352c54`，Sprite、内置 atom SpriteFrame 和 Caption 子 Label，源根本地位置 `(3,-4,5)`。
- `Op056Plain.prefab`：UUID `b076a3f3-fcf5-48f7-9b2e-d49315a312ce`，无 UITransform 的普通根与一个普通子节点，源根位置 `(6,7,8)`。

以下 7 个实例均经过创建结果检查、显式保存、切换到 `Blank.scene` 再重开，以及完整退出/重启 Creator 后显式打开 `Op056.scene` 复查。最终布局保护版扩展重启后，两个公开入口又分别创建 `UI_FinalA/B`，不是只测试旧内存方法。

| 实例路径 | 入口 | 保存重开后的本地位置 |
| --- | --- | --- |
| `Canvas/Transformed/UI_A` | `create_prefab_instance` | `(0,-9,2)` |
| `Canvas/Transformed/UI_B` | `instantiate_prefab`，路径与父 UUID 同时指定，名称去除空格 | `(17,0,-2)` |
| `Canvas/Op056Ui` | `instantiate_prefab`，省略名称和位置 | `(3,-4,5)` |
| `Plain_A` | `create_prefab_instance`，场景根 | `(0,0,0)` |
| `Op056Plain` | `instantiate_prefab`，省略父节点、名称、位置 | `(6,7,8)` |
| `Canvas/Transformed/UI_FinalA` | `create_prefab_instance`，仅父 UUID | `(-21,0,3)` |
| `Canvas/Transformed/UI_FinalB` | `instantiate_prefab`，仅父 UUID | `(0,12,-1)` |

所有实例的预制体资产 UUID、实例 fileId、根链接、名称和路径保持；UI 实例的 SpriteFrame UUID `24c419ea-63a8-4ea1-a9d0-7fc469489bbc@f9941`、Label 文本 `OP-056 linked` 及子节点位置 `(-2,6,0)` 保持。注意活场景节点 UUID 会在重开后变化：例如 `UI_A` 从 `e4Ekme3mhMu50VaTA2EKqE` 变为 `40zNpbk8VGWIUzJI3zmkss`，但实例 fileId 始终为 `98xJlPR8pLq5qCfJ/xWs9Y`；不能持有旧活节点 UUID 作为跨会话身份。

12 类负例：UI 放场景根、UI 放无 Canvas 普通父节点、关联实例根作为父节点、关联实例子节点作为父节点、父 UUID 不存在、父路径/UUID 冲突、场景资源当预制体、坐标缺项、空名称、Canvas 根、启用的根 Widget、启用的父 Layout。逐次失败后活动层级快照与场景文件哈希均不变。另打开 `Op056Plain.prefab` 的编辑模式调用实例化，明确因非已保存 `cc.SceneAsset` 拒绝；切回场景及重启复查，原资源未变化。

哈希证据（保存后、场景重开后、完整编辑器重启后相同）：

- `Op056.scene`：`f7202698ac50f8878e0060cda7e5becf0ca169198adc572b131bf5bad51a5427`。
- `Op056Ui.prefab`：`a5505f5582aa90a9d19cd0c4e609ce96cf4021d0c920eaadf31e4c4d82898b1e`。
- `Op056Plain.prefab`：`eefc5725c51769744808d07cc894f652d346a3cf84fe4dc016effcac1b47a581`。
- 上一项保留的 `Validation.scene`：`7a5037402e787e1b2361eafcf4bbbad7fb45307201301e003f7bbc36c2600232`。
- 上一项保留的 `DeleteProbe.prefab`：`6411cf287c6e4b8768a50a1f1f28e6e7e7e51627762d356c759a0a200e362f47`。

本机原始记录为忽略目录 `temp/op056-evidence.json`，隔离工程保留供复查，不进入提交或发布包。

## 限制

- 验收覆盖 Windows / Creator 3.8.8 的普通 UI 与非 UI 层级，不代表所有 Creator 版本、嵌套关联预制体、复杂脚本/资源均通过。没有逐个审计整个预制体依赖树；需要引用审计时仍用 `validate_prefab_references`。
- Canvas 根、启用的根 Widget/父 Layout 被明确拒绝；任意自定义编辑态脚本、动画或之后启用的布局仍可能改变位置，不承诺永久锁定变换。子树内部布局并不由该工具重写或逐组件验收。
- 预检、创建、属性赋值和失败清理不是跨进程事务；不要在调用期间切场景或并发修改同一层级。无法确认归属或原生结果时保留现场并报告，不盲目删除/重复创建，也不保证恢复原 dirty 状态或撤销栈。
- 未保存场景拒绝、原生写入错误与清理故障主要由模拟测试覆盖；真实编辑器覆盖成功持久化和上述拒绝场景，不冒充真实故障注入。未做游戏运行、鼠标交互或视觉验收。
- 本项不实现解除关联、应用或还原；下一项为 OP-057。FR-05 完整 CRUD 验收仍未完成。
