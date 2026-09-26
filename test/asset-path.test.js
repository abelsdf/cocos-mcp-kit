'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { queryAssetPath } = require('../lib/asset-path');

function fixture(t) {
  const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'cocos-op080-'));
  const file = path.join(projectPath, 'assets', 'icon.png');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'png');
  const url = 'db://assets/icon.png';
  const child = { uuid: 'image-uuid@texture', url: `${url}/texture`,
    type: 'cc.Texture2D', imported: true, invalid: false, isSubAsset: true };
  const main = { uuid: 'image-uuid', url, file, type: 'cc.ImageAsset',
    imported: true, invalid: false, subAssets: { texture: child } };
  const state = { main, child, mappedPath: file, parentMissing: false };
  const calls = [];
  const request = async (method, target) => {
    calls.push([method, target]);
    if (method === 'query-asset-info') {
      if (target === main.uuid || target === main.url || target === file) {
        return state.parentMissing && target === main.uuid ? null : state.main;
      }
      if ([child.uuid, child.url, `${url}@texture`].includes(target)) return state.child;
      return null;
    }
    if (method === 'query-path') {
      if ([main.uuid, main.url].includes(target)) return state.mappedPath;
      if ([child.uuid, child.url].includes(target)) return `${file}@texture`;
      return '';
    }
    throw new Error(`Unexpected ${method}`);
  };
  t.after(() => {
    const resolved = path.resolve(projectPath);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) ||
        !path.basename(resolved).startsWith('cocos-op080-')) {
      throw new Error('Test cleanup target escaped its temporary directory.');
    }
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  return { projectPath, file, main, child, state, calls, request };
}

test('query_asset_path resolves a main asset from relative, URL, UUID and absolute targets', async (t) => {
  const f = fixture(t);
  for (const target of ['assets/icon.png', f.main.url, f.main.uuid, f.file]) {
    const result = await queryAssetPath(target, f);
    assert.equal(result.complete, true);
    assert.equal(result.asset.kind, 'main');
    assert.equal(result.source.path, f.file);
    assert.equal(result.source.diskKind, 'file');
    assert.equal(result.nativeMapping.isPhysicalSource, true);
  }
  assert.equal(f.calls.filter(([method]) => method === 'query-path').length, 8);
});

test('subasset mapping path is distinct from the real parent source file', async (t) => {
  const f = fixture(t);
  for (const target of [f.child.uuid, f.child.url, `${f.main.url}@texture`]) {
    const result = await queryAssetPath(target, f);
    assert.equal(result.status, 'resolved');
    assert.equal(result.asset.kind, 'subasset');
    assert.equal(result.source.uuid, f.main.uuid);
    assert.equal(result.source.path, f.file);
    assert.equal(result.nativeMapping.path, `${f.file}@texture`);
    assert.equal(result.nativeMapping.isPhysicalSource, false);
  }
});

test('missing target and invalid input are explicit without a native path lookup', async (t) => {
  const f = fixture(t);
  const result = await queryAssetPath('assets/missing.png', f);
  assert.deepEqual({ found: result.found, status: result.status, complete: result.complete },
    { found: false, status: 'not_found', complete: false });
  assert.deepEqual(f.calls, [['query-asset-info', 'db://assets/missing.png']]);
  await assert.rejects(queryAssetPath('db://assets/../escape', f), /traversal/i);
  await assert.rejects(queryAssetPath(path.join(os.tmpdir(), 'outside.png'), f), /outside.*project|inside.*assets/i);
});

test('stale UUID or parent mappings do not produce a complete path', async (t) => {
  const f = fixture(t);
  f.state.main = { ...f.main, uuid: 'replacement' };
  const stale = await queryAssetPath(f.main.uuid, f);
  assert.equal(stale.complete, false);
  assert.ok(stale.issues.includes('input_uuid_mismatch'));
  f.state.main = f.main;
  f.state.parentMissing = true;
  const child = await queryAssetPath(f.child.uuid, f);
  assert.equal(child.complete, false);
  assert.ok(child.issues.includes('parent_asset_unresolved'));
  assert.equal(child.source, null);
});

test('missing or out-of-project source files are reported, never presented as verified', async (t) => {
  const f = fixture(t);
  fs.unlinkSync(f.file);
  const missing = await queryAssetPath(f.main.url, f);
  assert.equal(missing.complete, false);
  assert.equal(missing.source.diskKind, 'missing');
  assert.equal(missing.nativeMapping.isPhysicalSource, false);
  assert.ok(missing.issues.includes('source_unavailable'));

  const outside = path.join(os.tmpdir(), 'outside-source.png');
  f.state.main = { ...f.main, file: outside };
  f.state.mappedPath = outside;
  const escaped = await queryAssetPath(f.main.url, f);
  assert.equal(escaped.complete, false);
  assert.equal(escaped.source.path, null);
  assert.ok(escaped.issues.includes('source_outside_project_assets'));
});

test('unimported records and divergent native paths remain incomplete', async (t) => {
  const f = fixture(t);
  f.state.main = { ...f.main, imported: false };
  f.state.mappedPath = path.join(f.projectPath, 'assets', 'different.png');
  const result = await queryAssetPath(f.main.url, f);
  assert.equal(result.complete, false);
  assert.ok(result.issues.includes('not_imported'));
  assert.ok(result.issues.includes('source_path_mismatch'));
});
