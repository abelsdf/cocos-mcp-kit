# Cocos MCP Kit

**English** | [简体中文](./README_CN.md)

Cocos MCP Kit is an open-source Cocos Creator editor extension built on [Funplay MCP for Cocos 0.6.3](https://github.com/FunplayAI/funplay-cocos-mcp). It embeds a local MCP server so compatible development assistants can inspect and work with a Cocos project.

This fork has its own extension and package identity. The Funplay tools remain the starting point; the [requirements](./docs/REQUIREMENTS.md) and [development plan](./docs/PLAN.md) track the implementation status of additional capabilities. Editor behavior and saved assets still need validation in a test project.

## Local installation

1. Copy this repository into your Cocos Creator project's `extensions/cocos-mcp-kit` directory.
2. Open or restart the project in Cocos Creator 3.8.x.
3. Open **Cocos MCP Kit > MCP Server** and use the endpoint shown there to configure your MCP client.

The extension's panel also includes tool exposure and client configuration. For a local stdio bridge, run `node bin/cocos-mcp-kit.js --url <endpoint-from-panel>`. The project configuration file is `cocos-mcp-kit.config.json` in the Cocos project root. Automatic release updates and registry publishing are not configured for this fork yet; install local copies directly.

## Development

- `npm run check` checks JavaScript syntax.
- `npm test` runs the bundled tests.
- [Tool reference](./docs/TOOLS.md) describes the current inherited tool surface.
- [Development plan](./docs/PLAN.md) tracks planned work and validation status.

Node queries now reject ambiguous names or paths and report candidate UUIDs. When supplying multiple selectors, all of them must identify the same node; a stale UUID will not silently fall back to a name. `get_scene_info` and `get_hierarchy` default to at most 200 returned nodes and report truncation; `find_nodes` reports both the total match count and the returned count.

`create_sprite` accepts `spriteFrameTarget` as an imported image path (`assets/icons/arrow.png` or `db://assets/icons/arrow.png`), an ImageAsset UUID, or an exact SpriteFrame UUID. It resolves and checks the SpriteFrame subasset before creating a node. The existing `spriteFrameUuid` argument still accepts an exact SpriteFrame UUID; supply only one of the two arguments.

Changing scenes, prefabs, scripts, or asset references requires a real Creator save-and-reopen check. A successful MCP response alone does not prove that a change persisted.

## Attribution and license

Thanks to the authors and contributors of [Funplay MCP for Cocos](https://github.com/FunplayAI/funplay-cocos-mcp) for releasing the code used as this project's foundation. Their `Copyright (c) 2026 Funplay` notice, complete MIT terms, and disclaimer are preserved in [LICENSE](./LICENSE). This is an independent fork and is not an official Funplay release. New dependencies and assets must be checked under their own licenses.

Contribution and source-boundary rules are in [CONTRIBUTING.md](./CONTRIBUTING.md).
