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

`detect_node_type` classifies a node from its attached Cocos components as `camera`, `ui`, or `plain`. A node with both Camera and UI components returns `ambiguous` with both candidates and the matching components. Names are never used as type evidence; custom UI components without recognized built-in UI components may appear as `plain`.

`batch_modify_nodes` applies 1-50 ordered local position, scale, Euler rotation, or active-state changes to ordinary scene nodes. Each step requires a UUID, path, or unique name and at least one complete field; use `onError: "stop"` (default) or `"continue"`. The report distinguishes attempted steps, failures, and the first stopping point. Failed steps report `rollbackStatus` as `not-needed`, `restored`, or `failed`. A failed step attempts to restore its own previous values, but earlier successful steps remain changed; save the scene to persist them. Linked prefab instances and arbitrary component properties are outside this tool's scope.

`add_component` accepts a registered Cocos Component class name on an ordinary scene node. It reports the requested component and any dependencies automatically added by Creator. Invalid classes and linked prefab hierarchies are rejected; Creator enforces duplicate-component rules. Save the scene to persist the result.

`remove_component` removes one component from an ordinary scene node by class name or zero-based index. When a class appears more than once, provide the index; if both selectors are supplied, they must match. It refuses to remove a required or referenced component, then waits for Creator to confirm removal. Linked prefab hierarchies are excluded. Save the scene to persist the result.

In the `full` tool profile, `move_node` reparents an ordinary scene node using a `uuid`, `path`, or unique `name` and a destination `parentUuid`, `parentPath`, or unique `parentName`. It preserves world transform by default; set `keepWorldTransform: false` to preserve local transform. Use `parentPath: "/"` for the scene root. Linked prefab hierarchies require a separate editor-aware workflow.

`reorder_node` changes an ordinary node's zero-based index among its serializable siblings. Supply `uuid`, `path`, or a unique `name`, plus `index`; optional `parentUuid`, `parentPath`, or `parentName` checks that the node is still under the expected parent. Out-of-range indices and linked prefab hierarchies are rejected. Save the scene to persist the order.

`duplicate_node` clones an ordinary scene node and its children beside the source. It gives the copy a unique name (`<source> Copy` by default), creates fresh node identities, and preserves Cocos-cloned component data and references. Linked prefab hierarchies and editor-only descendants are rejected; external references and other component types should be checked in the target project. Save the scene to persist the copy.

`attach_script_component` attaches an imported TypeScript or JavaScript script asset to an ordinary scene node. Supply the node's `uuid`, `path`, or unique `name` and a `scriptTarget` asset path or UUID. The tool checks the asset type and resolves its registered Component class by script UUID, waits briefly for compilation, and leaves an existing instance unchanged. Save the scene to persist the component.

`detach_script_component` removes that script's component from an ordinary scene node using the same `scriptTarget` identity. It refuses to remove a component referenced by another active-scene component property or Button click event; clear those references first. Save the scene to persist removal. Linked prefab instances and references outside the active scene require separate review.

`reset_node_transform` resets an ordinary scene node's local position, rotation, and scale to `(0,0,0)`, identity rotation, and `(1,1,1)`. Pass `fields` to reset only selected values. It preserves the node's active state and rejects linked prefab hierarchies; use the separate prefab revert workflow for those. `reset_component_property` only clears a field and does not restore its Cocos class default.

`reset_component_property_to_default` restores one public, writable, serialized component field to its declared CCClass default. Select the node and component by class name or index, then pass the top-level `propertyName`. Primitive values, Cocos ValueTypes, and small arrays are supported; fields without a declared default, accessors, and linked prefab instances are rejected. Save the scene to persist the result. The older `reset_component_property` tool remains a field-clearing operation.

`create_sprite` accepts `spriteFrameTarget` as an imported image path (`assets/icons/arrow.png` or `db://assets/icons/arrow.png`), an ImageAsset UUID, or an exact SpriteFrame UUID. It resolves and checks the SpriteFrame subasset before creating a node. The existing `spriteFrameUuid` argument still accepts an exact SpriteFrame UUID; supply only one of the two arguments.

To replace the image on an existing Sprite, call `set_sprite_frame` with its node `path`, `uuid`, or unique `name` and a `spriteFrameTarget`. The tool reports the previous and new SpriteFrame UUIDs. It rejects an invalid resource before changing the component.

For a Button click binding, call `list_button_click_events` first. To remove one binding, pass its returned `index` as `eventIndex` and the same event object as `expectedEvent` to `unbind_button_click_event`. The tool refuses to remove a binding if the event at that index has changed.

On a linked prefab instance, binding or unbinding a Button click event records a scene-level `clickEvents` override without changing the prefab asset. Save and reopen the scene, then check the instance bindings and preview input.

Changing scenes, prefabs, scripts, or asset references requires a real Creator save-and-reopen check. A successful MCP response alone does not prove that a change persisted.

## Attribution and license

Thanks to the authors and contributors of [Funplay MCP for Cocos](https://github.com/FunplayAI/funplay-cocos-mcp) for releasing the code used as this project's foundation. Their `Copyright (c) 2026 Funplay` notice, complete MIT terms, and disclaimer are preserved in [LICENSE](./LICENSE). This is an independent fork and is not an official Funplay release. New dependencies and assets must be checked under their own licenses.

Contribution and source-boundary rules are in [CONTRIBUTING.md](./CONTRIBUTING.md).
