# FR-09 自有知识查询验证

日期：2026-09-28。Windows、Node.js v24.15.0；知识目标 Creator 3.8.x，知识版本 1.0.0。本轮功能是静态只读文本服务，不执行 Editor API、脚本生命周期、场景查询、资源写入或网络请求。

## 来源与实现

- 通过 Firecrawl 复核九个官方 3.8 手册页面：UITransform、坐标、Canvas、Widget、Layout、Label、Sprite、Button、装饰器。独立归纳六篇中文摘要，逐篇列出来源；原始页面仅存在被忽略的 `.firecrawl/`，不进入源码或安装包。
- `lib/knowledge.js` 提供版本信息、主题目录、单主题正文和精确组件/类型标签查询；`lib/resources.js` 接入既有 Resources，新增 1 项目录资源及 2 项模板，原入口保留。
- `lib/server.js` 仅为资源参数错误增加 `-32602` 响应并保留请求 ID；其他异常仍走原错误路径。没有增加 tool、修改工具 profiles 或引入第三方运行依赖。
- 首批覆盖 6 个主题、11 个标签，详见 [查询契约](../KNOWLEDGE.md)。`guidance` 是官方资料的独立摘要，`projectNotes` 是本扩展边界/已记录经验；两者不作为当前工程的诊断结果。

## 测试

先新增契约测试，确认模块尚未实现时报缺失模块，再实现查询。普通沙箱中的 Node 测试启动曾报 spawn EPERM，之后使用批准的子进程权限运行，不把环境失败当成功或功能失败。

- `test/knowledge.test.js`：20 项，覆盖版本/来源、六主题、十一标签及 `cc.` 别名、URI 编码、大小写、未知值、原型属性名、路径穿越、空路径、query/hash、超长输入、结果确定性和输出上限。
- `test/server.test.js`：新增 2 项，直接使用真实 ResourceProvider 接入 McpServer，验证资源目录、模板、正文和参数错误；其中一项实际启动 127.0.0.1 随机端口，通过 HTTP POST 读取目录/主题/组件，并确认畸形和未知 URI 返回 `-32602` 及原请求 ID。测试结束关闭监听器。
- 只读测试让工程上下文/场景桥在被调用时抛错，知识读取仍成功；原 scene/asset 资源入口继续保留。没有用户数据、网络搜索或文件路径拼接读取路线。
- 定向知识/服务器测试 **37/37** 通过；全量 **1359 项，1356 通过、3 失败、0 跳过**。失败仍为 `UI skill v1 with a manifest can upgrade to v2`、`UI skill v1 without a manifest can upgrade to v2`、`legacy Codex UI v1 migrates with a backup and preserves the original file`。不宣称全量测试通过。

全量日志：本地忽略文件 `temp/knowledge-full-tests.log`。该日志包含既有测试的换行差异，不提交。

73 项 JavaScript 语法检查、工具文档一致性、发布检查和 `git diff --check` 通过。`npm pack --dry-run --json` 清单含 176 个文件，已确认知识模块、查询文档及 LICENSE 在包内，`.firecrawl/`、`temp/` 和 AGENTS.md 不在包内；没有发布 npm 包或生成新的对外安装承诺。

## 默认输出规模

下表是 `contents[0].text.length`，单位为 JavaScript 字符，不是 UTF-8 字节或 token。所有已支持组件响应也受少于 6000 字符的测试约束，不通过截断破坏 JSON。

| 查询 | 字符数 |
| --- | ---: |
| index（不含正文） | 1718 |
| topic/ui-transform | 1514 |
| topic/widget-layout | 1241 |
| topic/label-fonts | 982 |
| topic/sprite-assets | 1011 |
| topic/button-events | 1062 |
| topic/editor-runtime | 859 |

## 边界

本轮未更新或重启用户打开的 CouchArcade 扩展，没有修改其场景/资源；HTTP 测试是在 Node 进程中运行真实协议服务，不等于 Creator 内扩展重载或游戏验收。场景持久化和视觉行为仍沿用各自独立报告，知识查询不新增相关承诺。

FR-10 的真实结构检查、可配置规则排除、FR-11 的截图定位与验证流程尚未实现；知识内容不执行这些动作。阶段 3 尚未整体完成。新功能尚未自动更新客户端配置或对外发布。
