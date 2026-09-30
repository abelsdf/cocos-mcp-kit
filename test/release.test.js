'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
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
function check(dir, args = []) {
  return spawnSync(process.execPath, [path.join(dir, 'scripts/release.js'), 'check', ...args], { cwd: dir, encoding: 'utf8' });
}

function git(dir, ...args) {
  const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function taggedFixture(t) {
  const dir = fixture(t);
  fs.writeFileSync(path.join(dir, '.gitignore'), 'releases/\n.release-tmp/\n');
  fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), '## [Unreleased]\n\n- Future work.\n\n## [0.1.0] - 2026-09-30\n\n- Tagged release notes.\n');
  git(dir, 'init');
  git(dir, 'config', 'user.name', 'Release test');
  git(dir, 'config', 'user.email', 'release-test@example.invalid');
  git(dir, 'remote', 'add', 'origin', 'git@github.com:abelsdf/cocos-mcp-kit.git');
  git(dir, 'add', '.');
  git(dir, 'commit', '-m', 'fixture');
  git(dir, 'tag', '-a', 'v0.1.0', '-m', 'fixture pre-release');
  return dir;
}

for (const [name, mutate, error] of [
  ['missing tag', dir => git(dir, 'tag', '-d', 'v0.1.0'), /Git tag v0.1.0 does not exist/],
  ['dirty source', dir => fs.appendFileSync(path.join(dir, 'README.md'), 'changed\n'), /clean working tree/],
  ['tag on another commit', dir => { fs.appendFileSync(path.join(dir, 'README.md'), 'changed\n'); git(dir, 'add', '.'); git(dir, 'commit', '-m', 'later'); }, /must point to HEAD/],
  ['wrong publication repository', dir => git(dir, 'remote', 'set-url', 'origin', 'https://github.com/example/other.git'), /origin to be abelsdf\/cocos-mcp-kit/],
]) test(`GitHub pre-release refuses ${name} before creating artifacts`, t => {
  const dir = taggedFixture(t); mutate(dir);
  const result = check(dir, ['--github-prerelease']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, error);
  assert.equal(fs.existsSync(path.join(dir, 'releases')), false);
});

test('GitHub pre-release refuses a non-Git source directory', t => {
  const dir = fixture(t), result = check(dir, ['--github-prerelease']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Git checkout with a source commit/);
  assert.equal(fs.existsSync(path.join(dir, 'releases')), false);
});

test('GitHub pre-release package records the owned repository and exact clean annotated tag', t => {
  const dir = taggedFixture(t);
  const result = spawnSync(process.execPath, [path.join(dir, 'scripts/release.js'), 'package', '--github-prerelease'], { cwd: dir, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const output = /Release package ready: (.+)/.exec(result.stdout);
  assert.ok(output, result.stdout);
  const releaseDir = path.resolve(dir, output[1].trim());
  const manifest = JSON.parse(fs.readFileSync(path.join(releaseDir, 'release-manifest.json')));
  assert.equal(manifest.distribution, 'github-prerelease');
  assert.equal(manifest.repository.url, 'https://github.com/abelsdf/cocos-mcp-kit');
  assert.deepEqual(manifest.git, { tag: 'v0.1.0', commit: git(dir, 'rev-parse', 'HEAD'), dirty: false });
  assert.equal(manifest.notes, 'Tagged release notes.');
  assert.equal(manifest.artifacts.extensionZip.githubDownloadUrl, 'https://github.com/abelsdf/cocos-mcp-kit/releases/download/v0.1.0/CocosMcpKit.v0.1.0.zip');
  const notes = fs.readFileSync(path.join(releaseDir, 'RELEASE_NOTES.md'), 'utf8');
  assert.match(notes, /Pre-release/);
  assert.match(notes, /Tagged release notes/);
  assert.doesNotMatch(notes, /Future work|local candidate|No public publication/);
  assert.match(notes, /automatic updates remain disabled/);
  assert.match(fs.readFileSync(path.join(releaseDir, 'README.md'), 'utf8'), /clean, tagged source commit/);
  for (const line of fs.readFileSync(path.join(releaseDir, 'SHA256SUMS.txt'), 'utf8').trim().split(/\r?\n/)) {
    const [sum, name] = line.split('  ');
    assert.equal(hash(path.join(releaseDir, name)), sum);
  }
  assert.equal(git(dir, 'status', '--porcelain'), '');
});

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

const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const files = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)]);
function packageCandidate(dir, env = process.env) {
  return spawnSync(process.execPath, [path.join(dir, 'scripts/release.js'), 'package'], { cwd: dir, encoding: 'utf8', env });
}

test('production packaging preserves earlier artifacts and extracts exactly the staged bytes', t => {
  const dir = fixture(t), oldDir = path.join(dir, 'releases/0.1.0');
  fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), '## [Unreleased]\n\n- New current work.\n\nUpstream history notice.\n\n## [0.1.0] - 2026-09-30\n\nHistorical notes.\n');
  fs.mkdirSync(oldDir, { recursive: true });
  fs.writeFileSync(path.join(oldDir, 'previous.zip'), 'preserve me');
  fs.mkdirSync(path.join(dir, '.release-tmp'));
  fs.writeFileSync(path.join(dir, '.release-tmp/previous.txt'), 'preserve staging');
  const preserved = {};
  for (let i = 0; i < 2; i++) {
    const result = packageCandidate(dir);
    assert.equal(result.status, 0, result.stderr);
    const output = /Release package ready: (.+)/.exec(result.stdout);
    assert.ok(output, result.stdout);
    const releaseDir = path.resolve(dir, output[1].trim());
    assert.equal(path.dirname(releaseDir), oldDir);
    const manifest = JSON.parse(fs.readFileSync(path.join(releaseDir, 'release-manifest.json')));
    assert.equal(manifest.distribution, 'local-candidate');
    assert.equal(manifest.notes, 'New current work.');
    assert.equal(manifest.repository, null);
    assert.equal(manifest.git.tag, null);
    assert.equal(manifest.artifacts.extensionZip.githubDownloadUrl, null);
    assert.equal(manifest.artifacts.extensionZip.sha256, hash(path.join(releaseDir, manifest.artifacts.extensionZip.file)));
    for (const line of fs.readFileSync(path.join(releaseDir, 'SHA256SUMS.txt'), 'utf8').trim().split(/\r?\n/)) {
      const [sum, name] = line.split('  ');
      assert.equal(hash(path.join(releaseDir, name)), sum);
    }
    const notes = fs.readFileSync(path.join(releaseDir, 'RELEASE_NOTES.md'), 'utf8');
    assert.match(notes, /No public publication/);
    assert.match(notes, /New current work/);
    assert.doesNotMatch(notes, /Historical notes/);
    const unpack = path.join(dir, `unpack-${i}`);
    fs.mkdirSync(unpack);
    const archive = path.join(releaseDir, manifest.artifacts.extensionZip.file);
    const extract = process.platform === 'win32'
      ? spawnSync('tar.exe', ['-xf', archive, '-C', unpack], { encoding: 'utf8' })
      : spawnSync('unzip', ['-q', archive, '-d', unpack], { encoding: 'utf8' });
    assert.equal(extract.status, 0, extract.stderr);
    const extracted = files(path.join(unpack, 'cocos-mcp-kit'));
    assert.equal(extracted.length, manifest.artifacts.extensionZip.fileCount);
    for (const p of extracted) assert.equal(hash(p), hash(path.join(dir, path.relative(path.join(unpack, 'cocos-mcp-kit'), p))));
    validateLicense(fs.readFileSync(path.join(unpack, 'cocos-mcp-kit/LICENSE'), 'utf8'));
    for (const [p, sum] of Object.entries(preserved)) assert.equal(hash(p), sum);
    for (const p of files(releaseDir)) preserved[p] = hash(p);
  }
  assert.equal(fs.readFileSync(path.join(oldDir, 'previous.zip'), 'utf8'), 'preserve me');
  assert.deepEqual(fs.readdirSync(path.join(dir, '.release-tmp')), ['previous.txt']);
});

test('missing archive tools refuse packaging without touching earlier artifacts', t => {
  const dir = fixture(t), releaseDir = path.join(dir, 'releases/0.1.0');
  fs.mkdirSync(releaseDir, { recursive: true });
  fs.writeFileSync(path.join(releaseDir, 'previous.zip'), 'preserve me');
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.toLowerCase() === 'path') env[key] = path.join(dir, 'empty-path');
  const result = packageCandidate(dir, env);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Required command/);
  assert.deepEqual(fs.readdirSync(releaseDir), ['previous.zip']);
  assert.equal(fs.existsSync(path.join(dir, '.release-tmp')), false);
});

for (const [name, response, error] of [
  ['missing packaged file', { status: 0, stdout: 'cocos-mcp-kit/LICENSE\n' }, /listing does not match/],
  ['unsafe archived path', { status: 0, stdout: 'cocos-mcp-kit/../escape.js\n' }, /invalid paths/],
  ['inspection failure', { status: 1, stderr: 'controlled listing failure' }, /controlled listing failure/],
]) test(`production packaging refuses ${name} instead of skipping inspection`, t => {
  const dir = fixture(t), preload = path.join(dir, 'preload.js');
  fs.writeFileSync(preload, `const cp=require('node:child_process'), original=cp.spawnSync;cp.spawnSync=(name,args,opts)=>args.includes('-tf')||args.includes('-Z1')?${JSON.stringify(response)}:original(name,args,opts);`);
  const result = spawnSync(process.execPath, ['--require', preload, path.join(dir, 'scripts/release.js'), 'package'], { cwd: dir, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, error);
  assert.match(result.stderr, /Incomplete candidate retained/);
  assert.equal(files(path.join(dir, 'releases')).some(p => p.endsWith('release-manifest.json')), false);
  assert.deepEqual(fs.readdirSync(path.join(dir, '.release-tmp')), []);
});
