# 图片 SpriteFrame 子资源解析验收（2026-09-19）

测试工程为 `D:\AI\Game\arrow-puzzle`，Creator 3.8.8；`/health` 返回工程身份 `758048aa923da9e57466f98a`。使用已有的 `assets/McpKitValidation/ArrowHammer.png`；它的 ImageAsset 主 UUID 为 `7222d7a1-b348-41ec-9f8a-4eea647d8774`，SpriteFrame 子 UUID 为 `7222d7a1-b348-41ec-9f8a-4eea647d8774@f9941`，Texture2D 子 UUID 为 `7222d7a1-b348-41ec-9f8a-4eea647d8774@6c48a`。官方[精灵帧文档](https://docs.cocos.com/creator/3.8/manual/zh/asset/sprite-frame.html)区分图片资产、纹理和精灵帧子资源。

运行中的测试扩展尚未重新安装本次源码。通过其 `execute_editor_script` 在 Creator 编辑器进程加载本仓库当前的 `lib/asset-resolution.js` 与 `lib/tool-registry.js`；新工具注册器只将已解析的 `spriteFrameUuid` 转交现有场景创建工具。因而本次验证覆盖当前解析器和工具处理逻辑、编辑器 `asset-db` 查询、现有场景创建、保存和重开，不声称已安装扩展面板正在运行新版本。

| 检查 | 实际结果 |
| --- | --- |
| 只读解析 | 图片 `db://assets/...` 路径与主 UUID 都解析为 `@f9941`；直接传 `@f9941` 保持原值。均由 `asset-db:query-asset-info` 返回的子资源类型与导入状态确定，未拼接固定后缀。 |
| 创建 | 新建独立 `SpriteTargetProbe_20260919.scene`（场景 UUID `496edcff-b38d-492e-82af-a3ce4212d63b`），分别以图片路径和主 UUID 创建 `PathSpriteProbe`、`UuidSpriteProbe`。两者均返回创建成功和 `@f9941` 解析结果。 |
| 保存与重开 | 显式 `scene:save-scene` 后磁盘出现两个 `cc.Sprite`；切换至 `Main.scene` 并确认生效，再重开测试场景。场景运行对象两个 `sprite.spriteFrame.uuid` 都为 `@f9941`，磁盘两个 `_spriteFrame.__uuid__` 也为 `@f9941`。 |
| 错误输入 | 传 Texture2D `@6c48a` 或同时传 `spriteFrameTarget`、`spriteFrameUuid` 都报错；桥接创建调用 0 次，测试场景节点数 2 → 2。 |
| 清理 | 切回 `ComplexRefs.scene`，通过 `asset-db:delete-asset` 删除测试场景；查询无资产，`.scene` 和 `.meta` 均不存在。 |

本次范围仅为 `create_sprite` 的图片 SpriteFrame 解析。其他资源类型、脚本/事件引用、多个 SpriteFrame 的实际导入样本及预览画面仍未验收。单元测试另覆盖未导入、无子资源、多子资源和子资源查询结果不匹配等失败路径。
