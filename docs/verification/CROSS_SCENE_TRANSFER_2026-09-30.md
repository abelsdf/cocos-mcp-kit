# 跨场景复制与两阶段剪切验证（2026-09-30）

环境：Windows、Cocos Creator 3.8.8、隔离工程 `temp/stage4-20260930/project-a`，分支 `codex/fr29-cross-scene-copy`。仅验证公开节点批次 DTO v1 声明字段和已支持内置 UI 组件；不代表任意组件完整克隆、其他 Creator 版本、运行画面或原生剪贴板互通。

## 实现边界

- `copy_nodes_between_scenes` 要求当前源场景已保存且干净，根节点同父、普通、无 DontSave/关联预制体；导出 active、局部 position/quaternion rotation/scale、组件 enabled 和 DTO 支持字段，把内部 Node/Component 与项目 SpriteFrame 映射到目标新身份。带组件批次自动使用严格 UI 路径，目标保持未保存，源不删除。
- `prepareCut:true` 只返回扩展进程内的 `transferId`。`finalize_cross_scene_cut` 先重新导出目标并比对，安全切回后再比对源 DTO、根 UUID、父节点和反向引用；仅 Creator 3.8.8 建立 `begin-recording(sourceParentUuid)` 后删除源，成功才 `end-recording`。源保持 dirty，显式保存前磁盘源场景是恢复副本。
- 目标未保存、目标或源漂移、源出现外部反向引用、版本不符或录制建立失败均在删除前拒绝。删除 RPC 回包丢失时不取消、不重试，隔离后续传输；收到明确删除失败结果时才取消录制。

## Creator 正式入口

新建 `CrossSceneSource.scene`（UUID `335e2574-79f8-415a-bc70-1f9ed8ecb429`）和 `CrossSceneTarget.scene`（UUID `cbeef723-dfd7-4977-8aa1-8918fb5fae77`）。源批次包含 2 节点、5 组件和 3 条引用：Button.target 指向批次子节点、ProgressBar.barSprite 指向子节点 Sprite、Sprite.spriteFrame 指向项目子资源 `f58f7922-78da-43ec-8317-2c20e0247efc@f9941`。

| 检查 | 结果 |
| --- | --- |
| 复制身份 | 源根 `80rgyMZ5xJZZfnPJ1KueQD`，目标根 `b1j11HLwZMZpHIF3xaDp2B`；节点/组件均为新身份。 |
| 变换与状态 | 根 position `{41,-23,0}`、scale `{1.25,0.75,1}`、inactive 及禁用 UITransform 在目标回读一致。ProgressBar 驱动的子节点使用引擎实际值，不同时伪造冲突的手工位置。 |
| 引用重映射 | 目标 Button 指向目标子节点，ProgressBar 指向目标 Sprite；SpriteFrame UUID 保持。 |
| 未保存保护 | 目标未保存时 `finalize_cross_scene_cut` 明确失败，仍停留目标场景，目标副本存在，源未删除。 |
| 两阶段剪切 | 显式保存目标后，目标和源再次导出比对通过；源删除成功，返回 `sourceRecovery:"saved_scene_unchanged_until_explicit_save"` 及一次源父节点 Undo。 |
| Undo/Redo | Undo 恢复源 2 节点及三条引用；Redo 再删除。随后显式保存源。 |
| 完整重启 | 重启后目标副本及三条引用保持，源节点保持删除；目标/源保存 SHA-256 分别为 `f1b65f84788fc6f72bba478dff0e968f011725ac618f3a7cb9a7f5844dab2919`、`70450efd22bcc94e0113e0b9bfad0d16cf18b456c7c064ab246066b51d51a452`。 |

首次测试从 Creator 未导入的默认启动场景调用安全切换，被现有入口按设计拒绝，没有复制或删除。另一个探针显式给 ProgressBar 所控制的 barSprite 子节点位置/尺寸，Creator 将其计算为运行值；批次回读发现冲突并完整清理、取消 Undo。由此保留“相互驱动的显式字段冲突即拒绝”的边界，并修正两项真实问题：位置回读改为有限浮点容差且报告 actual/expected；含 UI 组件的导出补上 `ui:true`，让源和目标复用相同的尺寸重应用规则。

## 清理与证据边界

完整重启复核后，通过 asset-db 删除两个测试 SceneAsset；工程原 12 个资产文件的路径和 SHA-256 与测试前完全一致。测试安装的 104 文件扩展移出工程，原 97 文件扩展完整恢复；Creator 正常退出，端口 27930 关闭，测试场景无残留。原始调用记录位于忽略目录 `temp/cross-scene-20260930/evidence.json`，不提交或打包。

自动测试 **1489/1489** 通过，0 失败、0 跳过；新增覆盖 DTO 新字段、导出/重映射、外部引用拒绝、反向引用保护、未保存目标、目标/源漂移、明确删除失败取消和丢失回复隔离。真实验收没有测试项目脚本、Button clickEvents、预制体、外部 resolve、跨扩展重载的 transferId 或像素视觉效果；这些均不在本次完成声明中。
