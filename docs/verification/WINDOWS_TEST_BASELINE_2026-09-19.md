# Windows 全量测试基线排查（2026-09-19）

环境：Windows、Node.js 24.14.0，在 `E:\AIWork\CocosMcp\cocos-mcp-kit` 执行 `node --test`。修复前 268 项中 254 通过、10 失败、4 跳过。失败来自测试环境假设，不能据此认定相关产品功能已经通过或失败。

| 原结果 | 原因 | 处理与验证 |
| --- | --- | --- |
| 3 项失败：`global-install.test.js` 的 legacy 路径与两个激活用例 | 测试用 `path.join('/tmp', ...)` 构造伪路径；Windows 上为当前盘根相对路径，而被测代码使用 `path.resolve` 得到带盘符路径。 | 改用 `os.tmpdir()` 构造跨平台绝对路径；3 项通过。 |
| 3 项失败：两个 OpenCode 配置和一个原子写入用例 | 测试强制断言 Unix 的 `0o600` 权限位；Windows 的 `fs.statSync().mode` 返回值不按 POSIX 权限模型表示该设置。 | 在写入前记录实际模式，写回后断言模式未变；仍验证内容、并发保护与临时文件清理。3 项通过。 |
| 4 项失败：文件/目录符号链接安全用例 | 当前 Windows 会话无法创建普通符号链接，测试在准备样本时抛出 `EPERM`；沙箱外重试同样失败。 | 目录链接用 Windows junction 执行真实越界/拒绝测试，相关用例通过；文件符号链接测试在无法建立样本时明确跳过。 |
| 1 项跳过：全局路径悬空符号链接 | 同样无法建立普通目录符号链接。 | Windows 使用可创建的悬空 junction，真实运行并通过。 |
| 3 项跳过：ZIP 解包/更新/全局安装 | 测试仅使用系统 `zip` 命令造包，本机没有该命令。 | Windows 使用系统 `tar.exe -a` 生成 ZIP；已由项目解包器读取并完成三项端到端测试。其他平台仍使用 `zip`，缺少造包工具时明确跳过。 |

修复后全量 **269 项：267 通过、0 失败、2 跳过**。总数增加 1 是把“文件符号链接”和“链接目录”拆成独立测试。剩余跳过为 OpenCode 配置文件符号链接保留、项目提示词符号链接文件拒绝；在有文件符号链接创建权限的环境中运行这两项才能取得真实端到端证据，不能将跳过视为通过。Windows 上的模式比较也只验证 Node 报告的模式保持不变，不等于独立核验 NTFS ACL。

平台依据：[Node.js 文件系统文档](https://nodejs.org/api/fs.html)说明 Windows 文件模式仅能操作写权限，且 junction 只指向目录；[Microsoft CreateSymbolicLinkW 文档](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-createsymboliclinkw)说明非提升进程创建符号链接的标志依赖开发者模式。本轮没有更改 Windows 系统设置。

相关测试 68 项中 66 通过、2 跳过；`npm run check`、工具文档检查和 `git diff --check` 通过。本轮只调整测试和测试 ZIP 样本工具，没有修改产品代码或系统权限。
