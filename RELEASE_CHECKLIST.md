# Release checklist

- [ ] Configure and verify a project-owned repository and release channel.
- [ ] Confirm the extension name, package name, CLI name, settings filename, and client examples agree.
- [ ] Remove `private` from `package.json` only when npm publication is intended.
- [ ] Re-enable update and registry metadata only after those channels exist.
- [ ] Run `npm run check`, `npm test`, `npm run docs:check`, and `npm run pack:dry-run`.
- [ ] Install the candidate package in a clean Cocos Creator project and validate save, reopen, assets, prefabs, and client connectivity.
- [x] Generate a preserved local ZIP using the production Windows packager; verify extracted bytes, checksums, full MIT, stdio connectivity and UI references after manual clean-directory installation/save/reopen/Creator 3.8.8 restart (2026-09-30 bounded sample; [verification](https://github.com/abelsdf/cocos-mcp-kit/blob/main/docs/verification/LOCAL_PACKAGE_INSTALL_2026-09-30.md)). This does not check off the broader prefab, installer/update/uninstall or cross-platform release acceptance above.
- [x] Check that [LICENSE](./LICENSE), attribution, and all third-party notices are included (2026-09-30 candidate-content audit; see [source record](./docs/SOURCES_AND_LICENSES.md), recheck for each final package).
- [x] Review packaged files for private paths, credentials, test artifacts, and references to upstream publication channels (2026-09-30 candidate-content audit; development/reference/verification material excluded, no upstream update source; recheck after package changes).
