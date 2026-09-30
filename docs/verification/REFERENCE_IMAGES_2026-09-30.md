# FR-18 native reference-image verification — 2026-09-30

Environment: Windows, Cocos Creator 3.8.8, isolated project `temp/stage4-20260930/project-a`. Source branch: `codex/fr18-reference-image-feasibility`. This record covers the native route and seven new full-profile tools; it is not cross-version or pixel-level visual acceptance.

## Source and design boundary

- Reviewed the public reference-image operations in Cocos' official `cocos/cocos-cli` repository at main commit `4aeaf59a7d7694a69e753ed7d2c649d98eb18134`: library query/add/delete/select, clear binding, desired visibility, refresh, finite position/scale, and opacity 0–100.
- Inspected Creator 3.8.8's installed public message metadata and exercised only the documented built-in `reference-image` messages: `query-config`, `query-current`, `add-image`, `remove-image`, `switch-image`, `set-image-data`, and `refresh`, plus Scene `query-is2D`.
- Creator 3.8.8 does not publish a reference-image message for its native panel Show checkbox. The adapter therefore does not implement or infer a visibility toggle. It returns `effectiveVisible:null`, `observable:false`, and only reports 2D eligibility.
- No official CLI package was installed or bundled. No third-party/commercial implementation, template, resource, or code was read into or copied into this project. The implementation independently adapts Creator's public native messages.

## Automated checks

- Added four focused tests covering native-state normalization, asynchronous settling, all seven operations, finite/opacity/path validation, missing-entry cleanup, original-file preservation semantics, and independent response snapshots.
- Full tool profile increases from 144 to 151; core remains 43. The seven tools are in the `reference-images` category and no unsupported `set_reference_image_visibility` tool exists.
- Syntax, generated tool documentation, bilingual descriptions, package include parity, and release checks passed. The full suite passed **1471/1471**; npm dry-run contained 100 files, including the two new runtime modules and the packaged reference-image guide.

## Creator 3.8.8 runtime checks

Using the current branch copied into the isolated extension:

1. `tools/list` returned 151 tools and all seven reference-image names.
2. `get_reference_images` returned an empty library, the exact current scene UUID, `is2D:true`, and an unbound state.
3. `add_reference_image` added and selected an existing PNG after the native asynchronous update settled. The source remained outside AssetDB.
4. `set_reference_image_parameters` round-tripped `x=12`, `y=-8`, `scaleX=0.75`, `scaleY=1.25`, and `opacity=40`. Creator's native field names `sx`/`sy` were normalized only at the adapter boundary.
5. Clear binding retained the library; select restored the same scene binding; refresh kept the original local path.
6. Scene view mode was changed 2D → 3D → 2D through the public Scene messages. The adapter reported `eligible / not-2d / eligible` without claiming actual pixels or the native Show checkbox state.
7. Remove cleared the library and binding. The original PNG was not deleted or modified.

The first live response exposed a shared-object serialization issue (`current.image` appeared as `[Circular]`). A regression was added and the response now contains an independent complete image snapshot; the corrected build was restarted and rechecked.

## Immutability and cleanup evidence

- `AcceptanceUI.scene` SHA-256 before and after: `90289CE1B24EAF3E1A0F4DBF9DCF17E40E73862E6ADC80735B9C96DADC308701`.
- Source PNG SHA-256 before and after: `7645836E0A3FC217FAE111D9F584A261B6455320AB333F924B56F465B001CC7E`.
- Native Scene dirty state remained `false`.
- Final native library was empty, current binding was empty, and Scene view mode was restored to 2D.

## Remaining limits

The Creator process was intentionally hidden. Strict Scene capture correctly refused to use a hidden/minimized window, so this task does not claim pixel-level overlay visibility, alignment, opacity appearance, or the state of Creator's manual Show checkbox. Those remain manual visible-editor checks. The native state route, parameters, binding lifecycle, 2D eligibility, original-file preservation, and non-persistence into the scene were verified.
