# Cocos MCP Kit

**English** | [简体中文](./README_CN.md)

Cocos MCP Kit is an open-source extension that runs an MCP server inside Cocos Creator. It lets an MCP client inspect a project, work with scenes and assets, and verify results in the editor. It is built on [Funplay MCP for Cocos 0.6.3](https://github.com/FunplayAI/funplay-cocos-mcp) and has its own package, extension, and configuration identity.

The current target is Cocos Creator 3.8.x; the editor checks linked below were performed on **3.8.8**. Available tools are not a promise that every workflow or Creator version has been validated. See the [tool reference](./docs/TOOLS.md), [development plan](./docs/PLAN.md), [requirements](./docs/REQUIREMENTS.md), and [official Cocos CLI comparison](./docs/OFFICIAL_CLI_ANALYSIS.md) for the exact scope.

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
| Project and assets | Inspect the editor, scenes, exact asset metadata/data, dependencies, logs, and script diagnostics. | `get_project_info`, `inspect_asset`, `list_assets`, `validate_asset_dependencies` |
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

`inspect_asset` is a read-only exact lookup by UUID, `db://` URL, `assets/...` path, or an absolute file path inside the project's `assets` directory. It does not add guessed extensions. The result identifies main assets and imported subassets such as SpriteFrames, reports which identity supplied metadata, and exposes missing/error states instead of silently substituting an empty value. Serialized asset data is omitted unless `includeData: true`; depth, item, node, string, and character limits bound returned snapshots and report truncation. Treat `complete: true` as a complete bounded query under the requested options, not as proof that runtime string-based references or visual behavior are valid.

`list_assets` searches project assets by default and returns a compact, URL-sorted page instead of an unbounded raw asset-db result. Combine `name` with `contains`, `prefix`, or `exact` matching, an exact `ccType`, and an `assets` directory. Extensionless exact names such as `IconPair` can match `IconPair.prefab`; when an exact name has multiple matches, `selection.candidates` retains their UUIDs, URLs, types, and main/subasset identities so the caller must choose explicitly. Name-filtered results also report duplicate-name groups. Use `includeSubassets: false` to omit imported SpriteFrames/textures, or `scope: "all"` when internal editor assets are intentionally required.

`set_component_property` currently accepts one supported top-level field at a time: CCClass-declared project-script fields and selected Cocos UI fields. It converts compatible Color, vector, node/component, and asset references, but rejects dot paths, undeclared script state, incompatible values, and linked prefab instances. SpriteFrame assignment can resize UITransform; set `contentSize` afterward if a custom size is needed. `reset_component_property_to_default` restores a declared CCClass default; `reset_component_property` only clears a field.

The component catalog is bounded to 256 project scripts and 32 requested class-name probes. A script reported as `no-component-registration` may be a normal utility module, not a compilation failure. `list_components` shows CCClass-declared project-script fields by default; `includeRuntimeFields: true` reveals additional live fields without proving that they are public or persistent.

Linked prefab instance edits have tool-specific rules. Ordinary node move, duplicate, add/remove component, and property assignment reject linked prefab hierarchies; prefab instance apply/revert and Button click overrides use separate editor workflows. Check the relevant [tool description](./docs/TOOLS.md) and [verification record](./docs/verification) before relying on a persistent prefab change.

For `bind_button_click_event`, the target node must have exactly one matching component and the handler must be a component-owned method, not an engine lifecycle method. `customEventData` is a literal string of at most 1024 characters. List existing events before binding or unbinding; duplicate bindings are reported without adding another event. `batch_bind_button_click_events` applies up to 50 ordered bindings with stop or continue on error and reports each result; successful entries remain changed if a later entry fails.

`list_prefabs` returns a sorted, paged asset catalog (50 per page by default, up to 100). Set `includeMetadata` for a compact `.meta` status and `includeSceneInstances` to join links from the active scene. Instance counts are partial if the bounded scene scan reports truncation.

`inspect_prefab` reports the asset and metadata identity, serialized root/node/component summary, and UUID-like references with an explicit truncation flag. Set `includeSceneInstances` to find matching roots in the active scene; a serialized prefab reference alone does not prove that a nested instance remains linked.

`validate_prefab_references` checks explicit serialized asset references beyond the inspection display limit, plus component entry links and declared nested prefab assets. It reports incomplete scans and lookup errors separately; it cannot prove dynamic runtime loads or that a serialized custom component class is registered.

`create_prefab_from_node` clones an ordinary scene hierarchy, rejects linked nested instances and editor-only nodes, and validates a single connected node tree, component ownership, PrefabInfo metadata, and explicit asset references before writing through asset-db. It then verifies the imported UUID, metadata, root name, and node/component counts; the source scene hierarchy is not modified.

`create_prefab_instance` and `instantiate_prefab` now share a native editor workflow: create once, verify the linked root/asset/instance identity, and assign and verify the parent-local `position`. `parentUuid` selects an exact parent; if `parentPath` is also provided, both must match. Omitted name/position use the prefab root defaults. An imported, saved scene is required; call `save_current_scene` explicitly afterward (`needsSave: true` is not persistence proof).

UI prefabs require an existing Canvas ancestor. Linked parent hierarchies, Canvas roots, enabled root Widgets and enabled parent Layouts are refused to avoid unsupported nesting or editor-controlled placement. There is no runtime fallback on uncertain native creation; failed verification only attempts cleanup of a node confirmed inside this creation scope. Inspect the hierarchy before retrying an uncertain result. See the [Creator 3.8.8 instantiation verification and limits](./docs/verification/PREFAB_INSTANTIATE_2026-09-22.md).

`unlink_prefab_instance` uses the native editor message on an explicitly selected, independent instance root in a saved scene. It verifies node/component identities, hierarchy, transforms and removal of link metadata without editing the source prefab; save the scene explicitly afterward. Linked ancestors and nested prefab subtrees are refused: a Creator 3.8.8 control test lost a valid cross-instance component reference after outer-instance unlink/save. `verified: true` is a structural check, not an audit of every component property. There is no automatic retry or relink after uncertain results. See the [unlink verification and limits](./docs/verification/PREFAB_UNLINK_2026-09-22.md).

`apply_prefab_instance` immediately writes property changes back to the source prefab and can affect other instances; discarding the scene does not undo that asset write. It requires an explicit non-nested instance root in a saved scene, unchanged node/component structure, and no outgoing external scene references. It compares the native serialized preview against the imported source file, rechecks instance identity, and still requires an explicit scene save. The raw native `result` can be `false` even after a successful write; use the verified tool result, not that boolean. Uncertain writes are never retried or rolled back automatically. See the [apply verification and limits](./docs/verification/PREFAB_APPLY_2026-09-22.md).

`revert_prefab_instance` discards property overrides on an explicit non-nested instance root in a saved scene through one native `restore-prefab` request. It preserves the root name, position and rotation, but restores scale, other node properties and component data from the source. It verifies serialized values, live identities and unchanged source/metadata files twice; save the scene explicitly afterward. Structure changes, outgoing external scene references and unverifiable serialization are refused. An uncertain result is not automatically retried or rolled back. See the [restore verification and limits](./docs/verification/PREFAB_REVERT_2026-09-22.md).

`enter_prefab_edit_mode` (`full` profile) enters native editing for an exact non-nested project prefab from one clean, saved scene. It compares live serialization with disk even when the dirty flag is clear, verifies the actual editor mode and prefab root, and checks that source/origin files remain unchanged. It returns `sourceHash` for guarded saves. Re-entering the same clean prefab verifies it without reloading; dirty, multi-scene and other-prefab states are refused. It never auto-saves, discards or exits. The generic `open_asset` does not provide these guards. See the [entry verification and limits](./docs/verification/PREFAB_EDIT_ENTER_2026-09-22.md).

`save_prefab_edit_mode` (`full` profile) saves property-only edits of the current non-nested prefab using its explicit `prefabUuid` and the `expectedSourceHash` from entry or the last verified save. It rejects source conflicts, structure changes, outgoing scene references and an unsaved origin scene. Saving immediately writes the asset and can affect same-source instances; discarding the scene will not undo that write. It checks content even when dirty is false, waits a bounded time for the target's reimport, and verifies source/live/origin state twice. Use the returned new hash for subsequent saves; a clean, unchanged repeat performs no native save. On a conflict or uncertain result, inspect and reconcile changes before retrying, rather than simply replacing the hash. It never auto-exits, retries the write, rolls back or saves the origin scene; `needsSave: false` refers only to the prefab. Generic `save_current_scene` does not acquire these prefab-specific guards. See the [save verification and limits](./docs/verification/PREFAB_EDIT_SAVE_2026-09-22.md).

`exit_prefab_edit_mode` (`full` profile) closes a saved, unchanged non-nested prefab through one native `close-scene` request. Supply its `prefabUuid`; set `returnSceneUuid` to `previousScene.uuid` returned by initial entry or verified save. Dirty prefab state, unsaved serialization even with dirty=false, a mismatched origin, nesting or unverifiable references are refused before closing. It verifies the restored scene and unchanged source/origin files twice; repeating in the matching verified scene does not close that scene. Saved prefab updates may mark the restored scene dirty, so inspect `needsSave` and save that scene explicitly if needed. There is no automatic save, discard, retry, reopen or rollback; saving and exiting remain separate operations. See the [exit verification and limits](./docs/verification/PREFAB_EDIT_EXIT_2026-09-22.md).

`test_prefab_edit_mode` (`full` profile) accepts only an explicit `prefabUuid` and performs read-only diagnostics: editor context, source/reference and retained-scene checks, plus live-content comparison only when that target is already open. An unopened target stays unopened (`editing: null`, `complete: false`); each check reports `passed`, `failed` or `not_checked`. `readChecksPassed` means no read check failed, while `complete` means all read checks passed; neither grants permission or proves that enter/save/exit works. Unsaved differences can coexist with successful reads, including dirty=false edits. `observationsStable` is true/false for a successful/failed recheck and null when prerequisites are unavailable, not a transaction guarantee. The outer `ok` only confirms report generation. All `mutationTests` remain `not_run`: there is no automatic open, save, close, snapshot, creation or discard, and no replacement source hash for guarded saves. See the [diagnostic verification and limits](./docs/verification/PREFAB_EDIT_TEST_2026-09-22.md).

`delete_asset` requires an exact UUID, db URL, or file path; it does not guess extensions. For project `.prefab` assets it verifies identity, import status, source/metadata paths, and native asset/script and active-scene reference queries before deleting once through asset-db. Referenced or currently edited prefabs are rejected; there is no force/cascade option. Success requires both database mappings and source/`.meta` files to be absent. A verification failure may occur after deletion: inspect the asset before retrying. These prefab-specific safeguards do not cover folder deletion, dynamic string-based loading, or references outside the native queries; recovery relies on your own backups/version control. See the [Creator 3.8.8 verification](./docs/verification/PREFAB_DELETE_2026-09-22.md).

## Development and documentation

Run `npm run check` for JavaScript syntax, `npm test` for the bundled tests, and `npm run docs:check` to verify the generated tool catalog. The [development plan](./docs/PLAN.md) distinguishes implemented tools from broader requirements still in progress; [verification reports](./docs/verification) record what was tested in Creator. This fork currently has no configured release update channel or package registry publication; install it locally.

## Attribution and license

Thanks to the authors and contributors of [Funplay MCP for Cocos](https://github.com/FunplayAI/funplay-cocos-mcp) for releasing the MIT-licensed foundation. The `Copyright (c) 2026 Funplay` notice, complete MIT terms, and disclaimer remain in [LICENSE](./LICENSE). Cocos MCP Kit is an independent fork, not an official Funplay release. See [CONTRIBUTING.md](./CONTRIBUTING.md) for contribution and source-boundary rules.
