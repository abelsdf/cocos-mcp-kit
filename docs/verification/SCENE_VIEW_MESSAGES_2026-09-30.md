# Native Scene-view message verification — 2026-09-30

Environment: Windows, Cocos Creator 3.8.8, isolated project `temp/stage4-20260930/project-a`. Source branch: `codex/fr18-reference-image-feasibility`. This record covers public Scene-view message feasibility and three new full-profile tools; it is not pixel-level visual acceptance or cross-version proof.

## Public-message evidence

Creator's installed `scene` package (`1.0.3`) marks the following message entries `public: true` and publishes their parameter/return examples through its Message List metadata:

- Gizmo: `change-gizmo-tool` / `query-gizmo-tool-name`, `change-gizmo-pivot` / `query-gizmo-pivot`, `change-gizmo-coordinate` / `query-gizmo-coordinate`, and query-only `query-gizmo-view-mode`.
- View state: `change-is2D` / `query-is2D`, `set-grid-visible` / `query-is-grid-visible`, `set-icon-gizmo-3d` / `query-is-icon-gizmo-3d`, and `set-icon-gizmo-size` / `query-icon-gizmo-size`.
- Observer camera: `focus-camera`, `align-with-view`, and `align-view-with-node`.

No restricted commercial source, package implementation, template, or asset was inspected or reused. Only Creator's public package metadata, public messages, official documentation, and this project's own code were used.

## Runtime checks

The original state was `position / pivot / local / 2D / grid visible / IconGizmo 2D / size 2 / view mode select`; the scene was clean.

1. Each of the seven writable state fields was changed to a distinct value and read back through its matching native query: `rotation / center / global / 3D / grid hidden / IconGizmo 3D / size 3`.
2. All seven fields were restored through the same public messages and exact readback matched the original values. The scene remained clean because these are editor-local view settings.
3. Current source was loaded directly in the running editor. `querySceneViewState` returned the exact native values, `setSceneViewState` reported all seven changed keys, and the second call restored them.
4. With the game Camera node selected in 3D view, native `align-with-view` changed its position from `(480, 320, 1000)` to `(180, 430, 1004.8235157611516)`. The new adapter reported `changed:true`, `dirty:true`, and the exact before/after transforms. Native Undo restored `(480, 320, 1000)` and `query-dirty` returned `false`.
5. `focus-camera` and `align-view-with-node` returned without error, but the public profile/query surface did not expose a changed observer-camera state or completion acknowledgement in this hidden-window run. They remain unimplemented rather than being claimed from message success alone.

A post-review retry loaded the final module through the restored older isolated extension to recheck the newly added `dirtyBefore` / `dirtyAfter` fields. That transport stalled after receiving `tools/call` and returned no result, so it is not counted as a successful Creator check. The fields are covered by automated regression; the underlying native alignment, transform evidence, dirty transition and Undo were already observed in the preceding live run. The stalled process was stopped only after confirming the scene file still matched its backup.

## Cleanup

- Final Scene-view state: original seven values restored; selection empty; scene dirty state `false`.
- `AcceptanceUI.scene` was not saved during the test. Before/after SHA-256 stayed `90289CE1B24EAF3E1A0F4DBF9DCF17E40E73862E6ADC80735B9C96DADC308701`.
- After normal Creator shutdown, the Scene profile was restored byte-for-byte to SHA-256 `7A9EAE146BE28C11258C1B677F262BFE51BCFAC8A08401E6202F783613CC0A88`, because observer-camera/profile state is editor-local and not fully queryable through public messages.
- The isolated project's prior 97-file extension was restored from backup, Creator had no remaining process, and port `27930` stopped listening. The primary verification run closed normally; the separate inconclusive retry required terminating its exact isolated root process after the RPC stall.

## Automated and package checks

- Six focused tests cover native query normalization, all writable fields, validation, partial-failure rollback, selected-node alignment evidence, and pre-mutation refusal.
- The complete suite passed **1477/1477**. Syntax checks, generated tool documentation, bilingual panel descriptions, release include parity, and release checks passed.
- Full profile increased from 151 to 154 tools; core remains 43. npm dry-run contains 103 files, including both runtime modules and the packaged Scene-view guide.
