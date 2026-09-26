'use strict';

const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { queryAssetUuid } = require('../lib/asset-uuid');

function fixture() {
  const projectPath = path.join(os.tmpdir(), 'cocos-op081-project');
  const file = path.join(projectPath, 'assets', 'icon.png');
  const url = 'db://assets/icon.png';
  const child = { uuid: 'image-uuid@texture', url: `${url}/texture`,
    type: 'cc.Texture2D', imported: true, invalid: false };
  const main = { uuid: 'image-uuid', url, type: 'cc.ImageAsset',
    imported: true, invalid: false, subAssets: { texture: child } };
  const state = { main, child, canonicalOverride: null, aliasOverride: null,
    staleMainUuid: false, parentMissing: false };
  const calls = [];
  const request = async (method, target) => {
    calls.push([method, target]);
    if (method === 'query-asset-info') {
      if ([main.uuid, main.url].includes(target)) {
        if (state.parentMissing && target === main.uuid) return null;
        if (state.staleMainUuid && target === main.uuid) return { ...state.main, uuid: 'replacement' };
        return state.main;
      }
      if ([child.uuid, child.url, `${url}@texture`].includes(target)) return state.child;
      return null;
    }
    if (method === 'query-uuid') {
      if (target === main.url) return state.canonicalOverride ?? main.uuid;
      if (target === child.url) return state.canonicalOverride ?? child.uuid;
      if (target === `${url}@texture`) return state.aliasOverride ?? child.uuid;
      return '';
    }
    throw new Error(`Unexpected ${method}`);
  };
  return { projectPath, file, main, child, state, calls, request };
}

test('query_asset_uuid resolves a main resource from URL, relative path, absolute path and UUID', async () => {
  const f = fixture();
  for (const target of [f.main.url, 'assets/icon.png', f.file, f.main.uuid]) {
    const result = await queryAssetUuid(target, f);
    assert.equal(result.status, 'resolved');
    assert.equal(result.uuid, f.main.uuid);
    assert.equal(result.asset.kind, 'main');
    assert.equal(result.parent, null);
  }
  assert.equal(f.calls.some(([method, target]) => method === 'query-uuid' && target === f.main.uuid), false);
});

test('query_asset_uuid keeps an imported subasset UUID distinct from its parent', async () => {
  const f = fixture();
  for (const target of [f.child.url, `${f.main.url}@texture`, f.child.uuid]) {
    const result = await queryAssetUuid(target, f);
    assert.equal(result.status, 'resolved');
    assert.equal(result.uuid, f.child.uuid);
    assert.equal(result.asset.kind, 'subasset');
    assert.equal(result.asset.url, f.child.url);
    assert.equal(result.parent.uuid, f.main.uuid);
  }
});

test('missing, traversal, and out-of-project targets never select a UUID', async () => {
  const f = fixture();
  const missing = await queryAssetUuid('assets/missing.png', f);
  assert.deepEqual({ status: missing.status, uuid: missing.uuid }, { status: 'not_found', uuid: null });
  assert.deepEqual(f.calls, [['query-asset-info', 'db://assets/missing.png']]);
  await assert.rejects(queryAssetUuid('assets/../escape.png', f), /traversal/i);
  await assert.rejects(queryAssetUuid('db://assets/../escape.png', f), /traversal/i);
  await assert.rejects(queryAssetUuid(path.join(os.tmpdir(), 'outside.png'), f), /outside.*project|inside.*assets/i);
  assert.equal(f.calls.length, 1);
});

test('stale native or asset-db mappings remain incomplete', async () => {
  const f = fixture();
  f.state.canonicalOverride = 'other-uuid';
  const canonical = await queryAssetUuid(f.main.url, f);
  assert.equal(canonical.uuid, null);
  assert.ok(canonical.issues.includes('canonical_uuid_mismatch'));
  f.state.canonicalOverride = null;
  f.state.aliasOverride = 'other-uuid';
  const alias = await queryAssetUuid(`${f.main.url}@texture`, f);
  assert.equal(alias.uuid, null);
  assert.ok(alias.issues.includes('input_uuid_mismatch'));
  f.state.aliasOverride = null;
  f.state.staleMainUuid = true;
  const stale = await queryAssetUuid(f.main.url, f);
  assert.equal(stale.uuid, null);
  assert.ok(stale.issues.includes('identity_lookup_mismatch'));
});

test('unimported or unlinked subassets do not return a selected UUID', async () => {
  const f = fixture();
  f.state.child = { ...f.child, imported: false };
  const unimported = await queryAssetUuid(f.child.url, f);
  assert.equal(unimported.uuid, null);
  assert.ok(unimported.issues.includes('not_imported'));
  f.state.child = f.child;
  f.state.parentMissing = true;
  const unlinked = await queryAssetUuid(f.child.uuid, f);
  assert.equal(unlinked.uuid, null);
  assert.ok(unlinked.issues.includes('parent_asset_unresolved'));
});
