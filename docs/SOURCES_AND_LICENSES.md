# 随包来源与许可说明

Cocos MCP Kit 是独立的开源分支，不是 Funplay、VberAI 或 Cocos 的官方产品。

## 随包内容

| 来源 | 采用方式 | 许可与边界 |
| --- | --- | --- |
| Funplay MCP for Cocos 0.6.3 | 本项目代码底座，后续功能在此基础上修改或独立实现 | 根目录 [LICENSE](../LICENSE) 保留 `Copyright (c) 2026 Funplay`、完整 MIT 授权和免责声明。来源仓库标识：`FunplayAI/funplay-cocos-mcp`；本仓库初始快照 `077b740` 保留了相同许可文本，但不是上游固定提交的证明。 |
| Cocos MCP Kit 自有实现 | `lib`、`panel`、`i18n`、入口、CLI bridge 及使用文档 | 随本项目 MIT 许可；没有捆绑游戏工程、字体、图片、音频、预制体或平台程序。三个 UI 模板仅生成本项目的 JSON，素材与回调脚本由使用者提供。 |
| Cocos 官方公开 API 与手册 | 用于独立实现和知识摘要；知识来源逐篇保存在 `lib/knowledge.js` | 不随包复制官方网页、示例工程或官方 CLI 源码。官方 CLI 适配器当前为 `not_configured`，不是运行依赖；其历史分析中的 MIT/ISC 元数据差异不在本项目内擅自消解，未来直接引入前须另行核查。 |
| Node.js、Creator 内置 Electron 与 `cc` | 调用宿主提供的运行时模块/API | 不随扩展重新分发运行时或引擎。本包没有声明 npm 运行依赖，也没有 `node_modules` 或第三方 vendored 目录。 |

## 明确不随包分发

开发计划、商业插件分析、原始 `tools/list` 接口记录、参考矩阵、验收文档与截图只留在源码仓库，不作为运行资料随安装包分发。正常接口观察不等于获得第三方实现、描述正文或资源的再分发许可。

不得引入 `cocos-mcp-server-main`、商业 `cocos-mcp-v1.8.1-all`、VberAI Pro 的源码、编译产物、模板、知识库正文、资源或其改写衍生物。不得绕过授权、解密复刻或冒用品牌。更多规则见[贡献指南](../CONTRIBUTING.md)。

## 打包边界

`package.json.files` 与扩展 ZIP 使用相同的明确清单：运行 JavaScript、包元数据、双语 README、变更记录、贡献/发布说明、完整 LICENSE，以及列出的使用文档。开发资料链接转到源码仓库；安装后的离线文档不包含开发验收历史。

`release:check` 检查两份清单一致、完整上游 MIT 文本、入包路径及现有敏感内容规则。此检查不证明任意新增代码的来源，也不能替代人工第三方审查。新增代码、资源、依赖或新的入包文件类型前，应重新核对来源、许可证、商用和再分发条件。

源码远程为 `abelsdf/cocos-mcp-kit`；这不等于已有发布渠道。当前 `private:true`，默认自动更新源为空，npm/MCP Registry 发布及上游全局安装来源仍未启用。
