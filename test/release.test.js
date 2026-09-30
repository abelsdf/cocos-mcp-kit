'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { PACKAGE_INCLUDES, validateLicense, validateArchivePaths } = require('../scripts/release');
const root = path.resolve(__dirname, '..');
const license = fs.readFileSync(path.join(root, 'LICENSE'), 'utf8');

test('npm and extension ZIP share explicit runtime and user-documentation includes', () => {
  const pkg = require('../package.json');
  assert.deepEqual([...PACKAGE_INCLUDES].sort(), ['package.json', ...pkg.files.map(p => p.replace(/\/$/, ''))].sort());
  for (const required of ['LICENSE', 'RELEASE_WORKFLOW.md', 'RELEASE_CHECKLIST.md', 'docs/SOURCES_AND_LICENSES.md']) assert.ok(PACKAGE_INCLUDES.includes(required));
  assert.ok(!PACKAGE_INCLUDES.includes('docs'));
  assert.ok(PACKAGE_INCLUDES.every(p => !/verification|reference|ANALYSIS|PLAN|REQUIREMENTS/.test(p)));
});

test('complete Funplay MIT text accepts LF, CRLF and surrounding notices', () => {
  for (const value of [license, license.replace(/\r?\n/g, '\r\n'), `${license}\nAdditional contributor notice.\n`]) assert.doesNotThrow(() => validateLicense(value));
});

for (const [name, value] of [
  ['missing copyright', license.replace('Copyright (c) 2026 Funplay', '')],
  ['changed copyright', license.replace('2026 Funplay', '2027 Other')],
  ['missing permission', license.replace('to use, copy, modify, merge, publish, distribute, sublicense, and/or sell', '')],
  ['missing disclaimer', license.slice(0, license.indexOf('THE SOFTWARE IS PROVIDED'))],
]) test(`license check rejects ${name}`, () => assert.throws(() => validateLicense(value), /complete Funplay MIT/));

test('archive paths reject development evidence, restricted source directories and local instructions', () => {
  for (const file of ['docs/reference/pro-tools-list.json', 'docs/verification/check.md', 'docs/PLAN.md', 'AGENTS.md', 'lib/AGENTS.md', 'lib/.env.local', 'lib/.codex/config.toml', 'lib/node_modules/a.js', 'lib/cocos-mcp-server-main/x.js', 'lib/cocos-mcp-v1.8.1-all/x.js', 'lib/payload.enc', '../escape.js']) {
    assert.throws(() => validateArchivePaths([`cocos-mcp-kit/${file}`]), /invalid paths/, file);
  }
  assert.doesNotThrow(() => validateArchivePaths(['cocos-mcp-kit/', 'cocos-mcp-kit/docs/', 'cocos-mcp-kit/lib/ui-templates.js', 'cocos-mcp-kit/docs/UI_TEMPLATES.md', 'cocos-mcp-kit/LICENSE']));
});

test('packaged documentation has no local links to excluded repository files', () => {
  const included = new Set(PACKAGE_INCLUDES);
  for (const file of PACKAGE_INCLUDES.filter(p => p.endsWith('.md'))) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
      const target = match[1];
      if (/^[a-z]+:|^#/.test(target)) continue;
      assert.ok(included.has(path.posix.normalize(path.posix.join(path.posix.dirname(file), target.split('#')[0]))), `${file}: ${target}`);
    }
  }
});

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cocos-release-check-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'scripts'));
  fs.copyFileSync(path.join(root, 'scripts/release.js'), path.join(dir, 'scripts/release.js'));
  for (const p of PACKAGE_INCLUDES) {
    const target = path.join(dir, p);
    if (['bin', 'lib', 'panel', 'i18n'].includes(p)) fs.mkdirSync(target, { recursive: true });
    else { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, 'fixture\n'); }
  }
  for (const p of ['bin/cocos-mcp-kit.js', 'panel/index.js', 'i18n/en.js', 'i18n/zh.js', 'lib/global-install.js', 'lib/server.js', 'lib/tool-registry.js']) fs.writeFileSync(path.join(dir, p), 'fixture\n');
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(require('../package.json')));
  fs.writeFileSync(path.join(dir, 'LICENSE'), license);
  fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), '## [0.1.0] - 2026-09-30\n\nFixture.\n');
  return dir;
}
function check(dir) {
  return spawnSync(process.execPath, [path.join(dir, 'scripts/release.js'), 'check'], { cwd: dir, encoding: 'utf8' });
}

test('release check passes a complete isolated package without creating release artifacts', t => {
  const dir = fixture(t), result = check(dir);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(path.join(dir, 'releases')), false);
  assert.equal(fs.existsSync(path.join(dir, '.release-tmp')), false);
});

for (const [name, mutate, error] of [
  ['truncated license', dir => fs.writeFileSync(path.join(dir, 'LICENSE'), 'MIT License'), /complete Funplay MIT/],
  ['wrong license metadata', dir => { const p = require('../package.json'); fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ ...p, license: 'ISC' })); }, /license must be MIT/],
  ['npm include drift', dir => { const p = require('../package.json'); fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ ...p, files: [...p.files, 'docs/'] })); }, /package.json files must match/],
  ['nested local instructions', dir => fs.writeFileSync(path.join(dir, 'lib/AGENTS.md'), 'local'), /invalid paths/],
  ['credential-looking content', dir => fs.writeFileSync(path.join(dir, 'lib/leak.js'), 'npm_' + 'a'.repeat(30)), /sensitive-looking content/],
  ['directory link', dir => fs.symlinkSync(path.join(dir, 'scripts'), path.join(dir, 'lib/external'), 'junction'), /links or special files/],
]) test(`release check refuses ${name} before packaging`, t => {
  const dir = fixture(t); mutate(dir); const result = check(dir);
  assert.notEqual(result.status, 0); assert.match(result.stderr, error);
  assert.equal(fs.existsSync(path.join(dir, 'releases')), false);
});
