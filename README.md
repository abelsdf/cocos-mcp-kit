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

In the `full` tool profile, `move_node` reparents an ordinary scene node using a `uuid`, `path`, or unique `name` and a destination `parentUuid`, `parentPath`, or unique `parentName`. It preserves world transform by default; set `keepWorldTransform: false` to preserve local transform. Use `parentPath: "/"` for the scene root. Linked prefab hierarchies require a separate editor-aware workflow.

`reorder_node` changes an ordinary node's zero-based index among its serializable siblings. Supply `uuid`, `path`, or a unique `name`, plus `index`; optional `parentUuid`, `parentPath`, or `parentName` checks that the node is still under the expected parent. Out-of-range indices and linked prefab hierarchies are rejected. Save the scene to persist the order.

`duplicate_node` clones an ordinary scene node and its children beside the source. It gives the copy a unique name (`<source> Copy` by default), creates fresh node identities, and preserves Cocos-cloned component data and references. Linked prefab hierarchies and editor-only descendants are rejected; external references and other component types should be checked in the target project. Save the scene to persist the copy.

`create_sprite` accepts `spriteFrameTarget` as an imported image path (`assets/icons/arrow.png` or `db://assets/icons/arrow.png`), an ImageAsset UUID, or an exact SpriteFrame UUID. It resolves and checks the SpriteFrame subasset before creating a node. The existing `spriteFrameUuid` argument still accepts an exact SpriteFrame UUID; supply only one of the two arguments.

To replace the image on an existing Sprite, call `set_sprite_frame` with its node `path`, `uuid`, or unique `name` and a `spriteFrameTarget`. The tool reports the previous and new SpriteFrame UUIDs. It rejects an invalid resource before changing the component.

For a Button click binding, call `list_button_click_events` first. To remove one binding, pass its returned `index` as `eventIndex` and the same event object as `expectedEvent` to `unbind_button_click_event`. The tool refuses to remove a binding if the event at that index has changed.

On a linked prefab instance, binding or unbinding a Button click event records a scene-level `clickEvents` override without changing the prefab asset. Save and reopen the scene, then check the instance bindings and preview input.

Changing scenes, prefabs, scripts, or asset references requires a real Creator save-and-reopen check. A successful MCP response alone does not prove that a change persisted.

## Attribution and license

Thanks to the authors and contributors of [Funplay MCP for Cocos](https://github.com/FunplayAI/funplay-cocos-mcp) for releasing the code used as this project's foundation. Their `Copyright (c) 2026 Funplay` notice, complete MIT terms, and disclaimer are preserved in [LICENSE](./LICENSE). This is an independent fork and is not an official Funplay release. New dependencies and assets must be checked under their own licenses.

Contribution and source-boundary rules are in [CONTRIBUTING.md](./CONTRIBUTING.md).
