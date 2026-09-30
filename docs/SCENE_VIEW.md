# Native Scene view state

The full tool profile exposes three bounded tools backed by Creator 3.8's public `scene` messages:

| Tool | Effect |
|---|---|
| `get_scene_view_state` | Query the active Gizmo tool, pivot, coordinate space, query-only Gizmo view mode, 2D/3D mode, grid visibility, and IconGizmo mode/size. |
| `set_scene_view_state` | Set any verified writable fields, read each value back, and roll back already-applied fields after a partial failure. Omitted fields stay unchanged. |
| `align_selected_nodes_with_scene_view` | Apply the current Scene observer camera position and rotation to the current node selection. This changes authored node transforms and requires an explicit save. |

The state tool uses only Creator's public `change-*`, `set-*`, and matching `query-*` messages. `iconGizmoSize` must be finite; Creator 3.8.8 publishes no numeric range, so this adapter does not invent one. Native readback remains authoritative.

## Safe workflow

1. Verify the project with `get_project_info`, select the `full` profile, and open the intended scene.
2. Call `get_scene_view_state` before changing anything. Keep the returned values if the workflow must restore the user's view settings.
3. Call `set_scene_view_state` with only the fields that need to change, then inspect its `changed` list and returned native state.
4. Before `align_selected_nodes_with_scene_view`, explicitly select the intended nodes. The tool reads their transforms before and after the native operation and returns the Scene dirty state; it does not save automatically.
5. Use Creator Undo or restore the returned `before` transforms if the alignment should not be kept. Save only after inspecting the actual scene.

## Boundaries

- Creator 3.8.8 registers `query-gizmo-view-mode` publicly, but no matching public setter. `gizmoViewMode` is therefore read-only.
- `focus-camera` and `align-view-with-node` are public messages, but Creator exposes no public observer-camera state query or completion acknowledgement. In the isolated hidden-window test their effect could not be independently observed, so no narrow tool claims those operations.
- `align_selected_nodes_with_scene_view` maps to native `align-with-view`. It changes node transforms, not the observer camera, and is the only camera-alignment direction exposed by this increment.
- These controls change editor-local Scene-view state except for node alignment. They do not change project design resolution, prove Game View/device visibility, or replace `get_ui_viewport`.
- Runtime verification covers Windows / Creator 3.8.8. Other versions may change or omit these messages.

The interaction concepts are described in the [Cocos Creator Scene panel documentation](https://docs.cocos.com/creator/3.8/manual/en/editor/scene/). The concrete message names, arguments, return types, and examples were taken from Creator 3.8.8's own public message registry, as directed by the [Editor message documentation](https://docs.cocos.com/creator/3.8/manual/en/editor/extension/api/message.html).
