# Release workflow

Cocos MCP Kit has no project-owned Git repository, npm package, or MCP Registry namespace configured yet. `package.json` is marked `private`, automatic update checks have no default source, and registry publishing is disabled. Do not publish artifacts using the upstream project's account, repository, Store page, or release channel.

For a local test package, run `npm run check`, `npm test`, and `npm run pack:dry-run`. Test the extension in a clean Cocos Creator 3.8.x project, including save and reopen for edited scenes and assets.

Before public release, set the actual project-owned repository URL and release source, choose an available npm name and registry namespace if needed, review the release script and manifest output, then remove `private` only when publication is intended. Verify that the package contains [LICENSE](./LICENSE) and preserves the Funplay copyright notice.
