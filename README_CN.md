# Cocos MCP Kit

[English](./README.md) | **简体中文**

Cocos MCP Kit 是基于 [Funplay MCP for Cocos 0.6.3](https://github.com/FunplayAI/funplay-cocos-mcp) 开发的开源 Cocos Creator 编辑器扩展。它在编辑器中提供本地 MCP 服务，使兼容的开发助手能够查询并操作 Cocos 工程。

本分支已采用独立的扩展与包标识。当前代码以 Funplay 工具为底座；[需求文档](./docs/REQUIREMENTS.md)和[开发计划](./docs/PLAN.md)记录新增能力的实施状态。场景与资源的实际效果还需在独立测试工程中验证。

## 本地安装

1. 将本仓库复制到 Cocos Creator 工程的 `extensions/cocos-mcp-kit` 目录。
2. 用 Cocos Creator 3.8.x 打开或重启该工程。
3. 打开 **Cocos MCP Kit > MCP 服务**，按面板显示的地址配置 MCP 客户端。

面板还提供工具开放范围和客户端配置。需要本地 stdio 桥接时，运行 `node bin/cocos-mcp-kit.js --url <面板中的地址>`。工程配置文件名为 `cocos-mcp-kit.config.json`。本分支尚未配置自动发布更新和注册表发布渠道，目前请使用本地安装。

## 开发与验证

- `npm run check`：检查 JavaScript 语法。
- `npm test`：运行现有测试。
- [工具清单](./docs/TOOLS.md)：当前继承的工具接口。
- [开发计划](./docs/PLAN.md)：新增能力与验收状态。

节点查询遇到重名或重路径时会拒绝任选一个节点，并返回候选 UUID。同时提供多个定位条件时，它们必须指向同一节点；失效的 UUID 不会静默回退到名称。`get_scene_info` 与 `get_hierarchy` 默认最多返回 200 个节点并报告截断情况；`find_nodes` 同时报告匹配总数和实际返回数。

`create_sprite` 新增 `spriteFrameTarget`，可传入已导入图片的路径（如 `assets/icons/arrow.png` 或 `db://assets/icons/arrow.png`）、ImageAsset 主 UUID 或 SpriteFrame 子 UUID。工具先解析并检查 SpriteFrame 子资源，再创建节点。原有 `spriteFrameUuid` 仍接受明确的 SpriteFrame 子 UUID；两个参数只能选一个。

修改已有 Sprite 的图片时，调用 `set_sprite_frame`，传入节点 `path`、`uuid` 或唯一 `name`，以及 `spriteFrameTarget`。工具返回修改前后的 SpriteFrame UUID；无效资源会在修改组件前报错。

解绑 Button 点击事件时，先调用 `list_button_click_events`；把目标事件返回的 `index` 作为 `eventIndex`，并将该事件对象作为 `expectedEvent` 传给 `unbind_button_click_event`。如果该位置的事件已变化，工具会拒绝删除。

对关联的预制体实例绑定或解绑 Button 点击事件时，工具会在场景中记录 `clickEvents` 实例覆盖，不修改预制体资源本体。保存并重开场景后，还需核对实例绑定及预览输入。

修改场景、预制体、脚本或资源引用后，须在真实 Creator 中保存并重新打开验证；MCP 返回成功不能单独证明修改已持久化。

## 致谢与许可

感谢 [Funplay MCP for Cocos](https://github.com/FunplayAI/funplay-cocos-mcp) 的作者与贡献者以 MIT 许可证开放底座代码。本项目在 [LICENSE](./LICENSE) 中保留 `Copyright (c) 2026 Funplay`、完整 MIT 条款及免责声明。本项目是独立分支，不代表 Funplay 官方版本；新增依赖和资源须分别核查许可。

开发约束与代码来源规则见 [CONTRIBUTING.md](./CONTRIBUTING.md)。
