'use strict';

const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { queryAssetUrl } = require('../lib/asset-url');

function fixture() {
  const projectPath = path.join(os.tmpdir(), 'cocos-op082-project');
  const file = path.join(projectPath, 'assets', 'icon.png');
  const url = 'db://assets/icon.png';
  const alias = `${url}@texture`;
  const child = { uuid: 'image-uuid@texture', url: `${url}/texture`,
    type: 'cc.Texture2D', imported: true, invalid: false };
  const main = { uuid: 'image-uuid', url, type: 'cc.ImageAsset',
    imported: true, invalid: false, subAssets: { texture: child } };
  const state = { main, child, nativeUrlOverride: undefined,
    aliasUuidOverride: undefined, aliasInfoOverride: undefined,
    canonicalUuidOverride: undefined };
  const calls = [];
  const request = async (method, target) => {
    calls.push([method, target]);
    if (method === 'query-asset-info') {
      if ([main.uuid, main.url].includes(target)) return state.main;
      if ([child.uuid, child.url].includes(target)) return state.child;
      if (target === alias) return state.aliasInfoOverride === undefined ? state.child : state.aliasInfoOverride;
      return null;
    }
    if (method === 'query-uuid') {
      if (target === main.url) return state.canonicalUuidOverride ?? main.uuid;
      if (target === child.url) return state.canonicalUuidOverride ?? child.uuid;
      if (target === alias) return state.aliasUuidOverride ?? child.uuid;
      return '';
    }
    if (method === 'query-url') {
      return state.nativeUrlOverride === undefined
        ? target === child.uuid ? alias : target === main.uuid ? url : ''
        : state.nativeUrlOverride;
    }
    throw new Error(`Unexpected ${method}`);
  };
  return { projectPath, file, main, child, alias, state, calls, request };
}

test('query_asset_url resolves a main resource from UUID, URL and project paths', async () => {
  const f = fixture();
  for (const target of [f.main.uuid, f.main.url, 'assets/icon.png', f.file]) {
    const result = await queryAssetUrl(target, f);
    assert.equal(result.status, 'resolved');
    assert.equal(result.url, f.main.url);
    assert.equal(result.nativeMapping.url, f.main.url);
    assert.equal(result.nativeMapping.isCanonical, true);
  }
});

test('query_asset_url returns the canonical subasset URL after verifying a native @ alias', async () => {
  const f = fixture();
  for (const target of [f.child.uuid, f.child.url, f.alias]) {
    const result = await queryAssetUrl(target, f);
    assert.equal(result.status, 'resolved');
    assert.equal(result.url, f.child.url);
    assert.equal(result.asset.kind, 'subasset');
    assert.equal(result.parent.uuid, f.main.uuid);
    assert.equal(result.nativeMapping.url, f.alias);
    assert.equal(result.nativeMapping.isCanonical, false);
  }
});

test('missing or unsafe inputs never select a URL', async () => {
  const f = fixture();
  const missing = await queryAssetUrl('assets/missing.png', f);
  assert.deepEqual({ status: missing.status, url: missing.url },
    { status: 'not_found', url: null });
  assert.equal(f.calls.some(([method]) => method === 'query-url'), false);
  await assert.rejects(queryAssetUrl('assets/../escape.png', f), /traversal/i);
  await assert.rejects(queryAssetUrl(path.join(os.tmpdir(), 'outside.png'), f), /outside.*project|inside.*assets/i);
});

test('missing or stale native URLs are incomplete without a selected canonical URL', async () => {
  const f = fixture();
  f.state.nativeUrlOverride = '';
  const absent = await queryAssetUrl(f.main.uuid, f);
  assert.equal(absent.url, null);
  assert.ok(absent.issues.includes('native_url_unavailable'));
  f.state.nativeUrlOverride = f.alias;
  f.state.aliasUuidOverride = 'other-uuid';
  const stale = await queryAssetUrl(f.child.url, f);
  assert.equal(stale.url, null);
  assert.ok(stale.issues.includes('native_url_identity_mismatch'));
  f.state.aliasUuidOverride = undefined;
  f.state.aliasInfoOverride = { ...f.child, type: 'cc.SpriteFrame' };
  const wrongType = await queryAssetUrl(f.child.url, f);
  assert.equal(wrongType.url, null);
  assert.ok(wrongType.issues.includes('native_url_identity_mismatch'));
  f.state.nativeUrlOverride = 'db://assets/../outside.png';
  const unsafe = await queryAssetUrl(f.main.url, f);
  assert.equal(unsafe.url, null);
  assert.ok(unsafe.issues.includes('native_url_invalid'));
});

test('incomplete base UUID identity stops before native URL lookup', async () => {
  const f = fixture();
  f.state.canonicalUuidOverride = 'other-uuid';
  const result = await queryAssetUrl(f.main.url, f);
  assert.equal(result.status, 'incomplete');
  assert.equal(result.url, null);
  assert.ok(result.issues.includes('canonical_uuid_mismatch'));
  assert.equal(f.calls.some(([method]) => method === 'query-url'), false);
});
