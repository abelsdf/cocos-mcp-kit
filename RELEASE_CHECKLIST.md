# Release checklist

- [ ] Configure and verify a project-owned repository and release channel.
- [ ] Confirm the extension name, package name, CLI name, settings filename, and client examples agree.
- [ ] Remove `private` from `package.json` only when npm publication is intended.
- [ ] Re-enable update and registry metadata only after those channels exist.
- [ ] Run `npm run check`, `npm test`, `npm run docs:check`, and `npm run pack:dry-run`.
- [ ] Install the candidate package in a clean Cocos Creator project and validate save, reopen, assets, prefabs, and client connectivity.
- [ ] Check that [LICENSE](./LICENSE), attribution, and all third-party notices are included.
- [ ] Review packaged files for private paths, credentials, test artifacts, and references to upstream publication channels.
