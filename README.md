# Cocos MCP Kit

**English** | [简体中文](./README_CN.md)

Cocos MCP Kit is an open-source extension that runs an MCP server inside Cocos Creator. It lets an MCP client inspect a project, work with scenes and assets, and verify results in the editor. It is built on [Funplay MCP for Cocos 0.6.3](https://github.com/FunplayAI/funplay-cocos-mcp) and has its own package, extension, and configuration identity.

The current target is Cocos Creator 3.8.x; the editor checks linked below were performed on **3.8.8**. Available tools are not a promise that every workflow or Creator version has been validated. See the [tool reference](./docs/TOOLS.md), [development plan](./docs/PLAN.md), and [requirements](./docs/REQUIREMENTS.md) for the exact scope.

## Quick start

1. Copy the repository contents to `<Cocos project>/extensions/cocos-mcp-kit` so that `package.json` and `scene.js` are directly inside that folder.
2. Open the project in Cocos Creator 3.8.x, or restart Creator if the extension was already installed.
3. Open **Cocos MCP Kit > MCP Server**. Confirm that the server says **Running** and copy the URL shown in the panel. The default listener is local (`127.0.0.1`); its port is derived from the project path, so use the displayed URL rather than a fixed port.
4. Select your client in the panel and choose **Configure** for its MCP entry. **Configure + Skills** also installs the optional project skills. If your client needs stdio instead of a direct HTTP MCP URL, run the bundled bridge from the Cocos project root:

   ```sh
   node extensions/cocos-mcp-kit/bin/cocos-mcp-kit.js --url http://127.0.0.1:PORT/
   ```

Replace `PORT` with the port shown in the panel. The bridge requires Node.js 18 or newer. Use **Cocos MCP Kit > Tool Exposure** to select `core`, `full`, or a custom tool set. `core` is the default; `full` includes scene editing and component tools such as `list_available_component_types`. Select `full` for the editing workflow below. The [generated tool reference](./docs/TOOLS.md) shows each tool's profile and access type. Project settings are stored in `cocos-mcp-kit.config.json` at the Cocos project root.

## What it can do

| Area | Current capabilities | Examples |
|---|---|---|
| Project and assets | Inspect the editor, scenes, asset metadata, dependencies, logs, and script diagnostics. | `get_project_info`, `get_scene_info`, `list_assets`, `validate_asset_dependencies` |
| Scene graph | Create and inspect nodes; move, reorder, duplicate, transform, or batch-edit ordinary scene nodes. | `find_nodes`, `move_node`, `reorder_node`, `batch_modify_nodes` |
| Components and scripts | Discover registered types; attach, remove, list, inspect, and edit supported component fields. | `list_available_component_types`, `attach_script_component`, `list_components`, `set_component_property` |
| UI and events | Create Canvas, Label, Button, and Sprite nodes; resolve SpriteFrames and manage Button click bindings. | `create_sprite`, `set_sprite_frame`, `list_button_click_events`, `bind_button_click_event` |
| Prefabs | Inspect and create prefab assets, validate references, and work with linked instances through editor messages where supported. | `create_prefab_from_node`, `inspect_prefab_instance`, `apply_prefab_instance` |
| Preview and evidence | Control supported preview modes, capture editor/preview images, and inspect runtime and build status. | `run_project_preview`, `capture_preview_screenshot`, `validate_scene` |

These are examples, not the complete catalog. Some entries come from the Funplay base; newer tools have separate Creator verification records under [docs/verification](./docs/verification). The tool profile controls what an MCP client can see, and read-only, mutating, and stateful tools are marked in the [tool reference](./docs/TOOLS.md).

## A safe editing workflow

1. Inspect the target with `get_scene_info`, `find_nodes`, or `list_components`. Prefer a node UUID or a unique path; ambiguous names are rejected, and multiple selectors must agree.
2. For component work, call `list_available_component_types` or `inspect_component` before editing. The type catalog marks missing and non-Component classes; `attachable` means a registered Component subclass was found, not that every node will accept it.
3. Make one bounded change with a tool such as `set_component_property`, `move_node`, or `set_sprite_frame`. For example, this sets a Label's top-level `string` field (`valueJson` is a JSON-encoded string):

   ```json
   {
     "uuid": "<node-uuid>",
     "componentName": "cc.Label",
     "propertyPath": "string",
     "valueJson": "\"Hello Cocos\""
   }
   ```

4. Save the scene, reopen it in Creator, and inspect the node or resource again. For a visual or interactive change, also check the running preview. An MCP success response alone does not prove persistence or visible behavior.

`set_component_property` currently accepts one supported top-level field at a time: CCClass-declared project-script fields and selected Cocos UI fields. It converts compatible Color, vector, node/component, and asset references, but rejects dot paths, undeclared script state, incompatible values, and linked prefab instances. SpriteFrame assignment can resize UITransform; set `contentSize` afterward if a custom size is needed. `reset_component_property_to_default` restores a declared CCClass default; `reset_component_property` only clears a field.

The component catalog is bounded to 256 project scripts and 32 requested class-name probes. A script reported as `no-component-registration` may be a normal utility module, not a compilation failure. `list_components` shows CCClass-declared project-script fields by default; `includeRuntimeFields: true` reveals additional live fields without proving that they are public or persistent.

Linked prefab instance edits have tool-specific rules. Ordinary node move, duplicate, add/remove component, and property assignment reject linked prefab hierarchies; prefab instance apply/revert and Button click overrides use separate editor workflows. Check the relevant [tool description](./docs/TOOLS.md) and [verification record](./docs/verification) before relying on a persistent prefab change.

For `bind_button_click_event`, the target node must have exactly one matching component and the handler must be a component-owned method, not an engine lifecycle method. `customEventData` is a literal string of at most 1024 characters. List existing events before binding or unbinding; duplicate bindings are reported without adding another event. `batch_bind_button_click_events` applies up to 50 ordered bindings with stop or continue on error and reports each result; successful entries remain changed if a later entry fails.

`list_prefabs` returns a sorted, paged asset catalog (50 per page by default, up to 100). Set `includeMetadata` for a compact `.meta` status and `includeSceneInstances` to join links from the active scene. Instance counts are partial if the bounded scene scan reports truncation.

`inspect_prefab` reports the asset and metadata identity, serialized root/node/component summary, and UUID-like references with an explicit truncation flag. Set `includeSceneInstances` to find matching roots in the active scene; a serialized prefab reference alone does not prove that a nested instance remains linked.

## Development and documentation

Run `npm run check` for JavaScript syntax, `npm test` for the bundled tests, and `npm run docs:check` to verify the generated tool catalog. The [development plan](./docs/PLAN.md) distinguishes implemented tools from broader requirements still in progress; [verification reports](./docs/verification) record what was tested in Creator. This fork currently has no configured release update channel or package registry publication; install it locally.

## Attribution and license

Thanks to the authors and contributors of [Funplay MCP for Cocos](https://github.com/FunplayAI/funplay-cocos-mcp) for releasing the MIT-licensed foundation. The `Copyright (c) 2026 Funplay` notice, complete MIT terms, and disclaimer remain in [LICENSE](./LICENSE). Cocos MCP Kit is an independent fork, not an official Funplay release. See [CONTRIBUTING.md](./CONTRIBUTING.md) for contribution and source-boundary rules.
