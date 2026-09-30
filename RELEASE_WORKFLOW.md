# Release workflow

Cocos MCP Kit source is maintained in `abelsdf/cocos-mcp-kit`. No release/update source, npm publication, or MCP Registry namespace is configured yet. `package.json` is marked `private`, automatic update checks have no default source, and registry publishing is disabled. Do not publish artifacts using the upstream project's account, repository, Store page, or release channel.

For a local test package, run `npm run check`, `npm test`, and `npm run pack:dry-run`. Test the extension in a clean Cocos Creator 3.8.x project, including save and reopen for edited scenes and assets.

Run `npm run release:check` before packaging. It verifies the complete Funplay MIT block, license metadata, matching npm/extension-ZIP include lists, local instruction/credential-looking files and package paths. Both formats include only runtime JavaScript and explicitly listed user documentation; development/reference/verification material stays in the source repository. See [sources and license boundaries](./docs/SOURCES_AND_LICENSES.md). Existing secret patterns are a bounded heuristic, not a full secret or provenance audit.

The current `release:package` script requires `zip` and replaces the existing same-version release directory. Do not run it over artifacts that need preservation; use a separate audit/candidate directory until final packaging is explicitly planned. A package-content check is not a Creator installation, update, or uninstall test.

Before public release, set the actual project-owned repository URL and release source, choose an available npm name and registry namespace if needed, review the release script and manifest output, then remove `private` only when publication is intended. Verify that the package contains [LICENSE](./LICENSE) and preserves the Funplay copyright notice.
