# Native reference images

The full tool profile exposes seven tools backed by Cocos Creator 3.8's built-in `reference-image` message channel:

| Tool | Effect |
|---|---|
| `get_reference_images` | Read the native library, current scene/prefab binding, parameters, and whether the Scene view is in 2D mode. |
| `add_reference_image` | Add an existing absolute local PNG/JPG/JPEG and bind it to the current scene or prefab. |
| `remove_reference_image` | Remove one library record and its bindings without deleting the original file. |
| `select_reference_image` | Bind an existing library item to the current scene or prefab. |
| `clear_reference_image_binding` | Clear only the current binding and preserve the library. |
| `set_reference_image_parameters` | Set 2D `x`/`y`, independent `scaleX`/`scaleY`, and opacity from 0 to 100. |
| `refresh_reference_image` | Reload the current overlay from its original local path. |

These tools use Creator's native Scene overlay. The image is not copied into the project, imported into AssetDB, or added as an authored scene node. Position values use 2D scene world units rather than panel pixels. Reference-image state is editor-local data associated with scene/prefab UUIDs; saving a scene does not embed the image.

## Safe workflow

1. Verify the target with `get_project_info`, switch to the `full` profile, and open the intended scene or prefab.
2. Call `get_reference_images` and confirm `current.sceneUuid`. The response reports `visibility.is2D`, but does not claim that pixels are visible.
3. Add an absolute local PNG/JPG/JPEG or select an item already in the native library.
4. Change only the required parameters, then query again. All numeric values must be finite; opacity is inclusive 0–100.
5. In a visible Creator session, open **Reference Image** and visually inspect the Scene overlay. Creator 3.8.8's panel exposes add/delete, offset, scale and opacity but no independent Show control. Hidden/minimized-window capture is rejected rather than treated as visual evidence. Use `refresh_reference_image` after changing the source file on disk.
6. Use `clear_reference_image_binding` to detach the current scene while keeping the library, or `remove_reference_image` to remove a record and all native bindings. Neither operation deletes the original file.

## Boundaries

- Creator 3.8.8's public reference-image messages and native panel expose no independent visibility state. Therefore `visibility.effectiveVisible` is deliberately `null` and `visibility.observable` is `false`; there is no `set_reference_image_visibility` tool.
- `visibility.eligible` only means the Scene view is in 2D mode, a non-missing image is bound, and the public state is otherwise suitable. It is not screenshot or pixel evidence.
- Add/select require an existing local file. Remove accepts a missing file's existing library record so stale entries can be cleaned up.
- Creator updates its native reference-image state asynchronously. Mutating tools poll for a bounded settled state and fail rather than treating the initial message return as proof.
- This adapter is verified against Creator 3.8.8. Other Creator versions may omit or change these native messages and must be checked separately.

The route follows the public concepts in the [Cocos Creator Scene panel documentation](https://docs.cocos.com/creator/3.8/manual/en/editor/scene/) and the formal reference-image contract in the [official Cocos CLI repository](https://github.com/cocos/cocos-cli). The implementation calls Creator's built-in public messages directly; it does not bundle the official CLI, third-party reference-image code, or a custom panel fallback.
