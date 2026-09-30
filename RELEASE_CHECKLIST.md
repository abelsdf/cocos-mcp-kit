# Release checklist

- [x] Configure the project-owned manual GitHub Pre-release destination `abelsdf/cocos-mcp-kit`; verify CLI write/admin permission before every upload. This does not enable npm, Registry or updates.
- [x] Confirm the extension/package/CLI name `cocos-mcp-kit`, settings filename `cocos-mcp-kit.config.json`, installation directory `extensions/cocos-mcp-kit`, and client examples agree.
- [x] Keep `private:true`; remove it only for separately authorized npm publication.
- [x] Keep default updates and Registry publishing disabled; configure those channels only under separate authorization.
- [ ] Run `npm run check`, `npm test`, `npm run docs:check`, and `npm run pack:dry-run`.
- [ ] Install the candidate package in a clean Cocos Creator project and validate save, reopen, assets, prefabs, and client connectivity.
- [x] Generate a preserved local ZIP using the production Windows packager; verify extracted bytes, checksums, full MIT, stdio connectivity and UI references after manual clean-directory installation/save/reopen/Creator 3.8.8 restart (2026-09-30 bounded sample; [verification](https://github.com/abelsdf/cocos-mcp-kit/blob/main/docs/verification/LOCAL_PACKAGE_INSTALL_2026-09-30.md)). This does not check off the broader prefab, installer/update/uninstall or cross-platform release acceptance above.
- [x] Check that [LICENSE](./LICENSE), attribution, and all third-party notices are included (2026-09-30 candidate-content audit; see [source record](./docs/SOURCES_AND_LICENSES.md), recheck for each final package).
- [x] Review packaged files for private paths, credentials, test artifacts, and references to upstream publication channels (2026-09-30 candidate-content audit; development/reference/verification material excluded, no upstream update source; recheck after package changes).
- [ ] Before each GitHub publication: build with `--github-prerelease` from clean tagged source, verify extracted bytes/MIT/checksums and all five re-downloaded draft assets, then publish as Pre-release (not latest). Recheck the public release and tag/commit afterward; a local manifest is not proof of publication.
