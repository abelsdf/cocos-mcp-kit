# 已有 Sprite 图片替换验收（2026-09-19）

测试工程为 `D:\AI\Game\arrow-puzzle`，Creator 3.8.8；`/health` 工程身份为 `758048aa923da9e57466f98a`。测试使用已有的 `ArrowHammer.png` 和 `ArrowHint.png` 图片副本，不修改游戏主场景。运行中的扩展尚未重新安装本轮源码：在编辑器进程加载当前 `lib/tool-registry.js`，通过场景脚本加载当前 `scene.js` 的 `setSpriteFrame` 方法，验证本轮工具和场景实现。

| 步骤 | 结果 |
| --- | --- |
| 建立样本 | 用 `asset-db:create-asset` 创建并打开 `SpriteReplaceProbe_20260919.scene`，资产 UUID `d5f87ff2-9234-4aeb-803c-9fd788bbde66`。`ReplaceSprite` 初始引用 Hammer 的 SpriteFrame `7222d7a1-b348-41ec-9f8a-4eea647d8774@f9941`。 |
| 错误输入 | 用 Hammer 的 Texture2D 子 UUID `@6c48a` 调用 `set_sprite_frame`，返回类型错误；场景桥接调用次数为 0，原 Sprite 引用未修改。 |
| 替换 | 以 `assets/McpKitValidation/ArrowHint.png` 为 `spriteFrameTarget` 调用当前工具。返回 `updated:true`，修改前 UUID 为 Hammer 的 `@f9941`，修改后为 Hint 的 `1b3c2630-2ff7-4455-a872-072e320c0d8c@f9941`。 |
| 持久化 | 显式 `scene:save-scene`，切换至 `Main.scene` 并确认生效，再打开测试场景。运行对象 `sprite.spriteFrame.uuid` 与磁盘 `cc.Sprite._spriteFrame.__uuid__` 均为 Hint 的 `@f9941`。 |
| 清理 | 切回 `ComplexRefs.scene`，通过 `asset-db:delete-asset` 删除测试场景；资产查询为空，`.scene` 和 `.meta` 均不存在。 |

验证限于普通场景节点及这两张已导入图片。测试工程中已安装扩展仍是旧版，因此本轮证明当前源码在编辑器/场景进程中有效，不代表旧版扩展面板已暴露新工具。预制体实例覆盖、预制体本体编辑和预览画面另行验收。
