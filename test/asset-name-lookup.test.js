'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  findAssetByName,
  normalizeAssetNameLookup,
} = require('../lib/assets');
const { createToolRegistry } = require('../lib/tool-registry');

function fixture(t) {
  const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'cocos-asset-name-'));
  fs.mkdirSync(path.join(projectPath, 'assets', 'A'), { recursive: true });
  fs.mkdirSync(path.join(projectPath, 'assets', 'B'), { recursive: true });
  const assets = [
    { name: 'Icon.prefab', uuid: 'prefab-b', url: 'db://assets/B/Icon.prefab',
      type: 'cc.Prefab', importer: 'prefab', imported: true, subAssets: {} },
    { name: 'Icon.scene', uuid: 'scene-icon', url: 'db://assets/A/Icon.scene',
      type: 'cc.SceneAsset', importer: 'scene', imported: true, subAssets: {} },
    { name: 'Icon.prefab', uuid: 'prefab-a', url: 'db://assets/A/Icon.prefab',
      type: 'cc.Prefab', importer: 'prefab', imported: true, subAssets: {} },
    { name: 'ArrowHammer.png', uuid: 'image-main', url: 'db://assets/A/ArrowHammer.png',
      type: 'cc.ImageAsset', importer: 'image', imported: true,
      subAssets: { frame: { uuid: 'image-main@frame' } } },
    { name: 'spriteFrame', displayName: 'ArrowHammer', uuid: 'image-main@frame',
      url: 'db://assets/A/ArrowHammer.png/spriteFrame', type: 'cc.SpriteFrame', importer: 'sprite-frame' },
    { name: 'Camera.prefab', uuid: 'internal-camera', url: 'db://internal/Camera.prefab',
      type: 'cc.Prefab', importer: 'prefab', imported: true },
  ];
  const calls = [];
  const previous = global.Editor;
  global.Editor = { Message: { request: async (channel, method, payload) => {
    assert.equal(channel, 'asset-db');
    assert.equal(method, 'query-assets');
    calls.push(payload);
    return assets;
  } } };
  t.after(() => {
    if (previous === undefined) delete global.Editor;
    else global.Editor = previous;
    fs.rmSync(projectPath, { recursive: true, force: true });
  });
  return { projectPath, calls };
}

test('findAssetByName resolves one filtered exact asset and exposes its stable identity', async (t) => {
  const f = fixture(t);
  const result = await findAssetByName('Icon', {
    projectPath: f.projectPath,
    directory: 'assets/A',
    ccType: 'cc.Prefab',
  });
  assert.deepEqual(f.calls[0], { pattern: 'db://assets/A/**', ccType: 'cc.Prefab' });
  assert.equal(result.status, 'unique');
  assert.equal(result.found, true);
  assert.equal(result.resolved, true);
  assert.equal(result.candidateCount, 1);
  assert.equal(result.selected.uuid, 'prefab-a');
  assert.deepEqual(result.candidates, [result.selected]);
  assert.notEqual(result.candidates[0], result.selected);
});

test('findAssetByName refuses to select among ambiguous exact matches', async (t) => {
  const f = fixture(t);
  const result = await findAssetByName('Icon', {
    projectPath: f.projectPath,
    maxCandidates: 2,
  });
  assert.equal(result.status, 'ambiguous');
  assert.equal(result.resolved, false);
  assert.equal(result.selected, null);
  assert.equal(result.candidateCount, 3);
  assert.equal(result.returned, 2);
  assert.equal(result.candidatesTruncated, true);
  assert.deepEqual(result.candidates.map((asset) => asset.uuid), ['prefab-a', 'scene-icon']);
  assert.match(result.guidance, /Do not choose arbitrarily/);
});

test('findAssetByName reports not_found without fabricating a target', async (t) => {
  const f = fixture(t);
  const result = await findAssetByName('Missing', { projectPath: f.projectPath });
  assert.equal(result.status, 'not_found');
  assert.equal(result.found, false);
  assert.equal(result.resolved, false);
  assert.equal(result.selected, null);
  assert.equal(result.candidateCount, 0);
  assert.deepEqual(result.candidates, []);
});

test('findAssetByName uses subasset, case, and scope filters to make identity explicit', async (t) => {
  const f = fixture(t);
  const ambiguous = await findAssetByName('ArrowHammer', { projectPath: f.projectPath });
  assert.equal(ambiguous.status, 'ambiguous');
  assert.deepEqual(ambiguous.candidates.map((asset) => asset.uuid), ['image-main', 'image-main@frame']);

  const mainOnly = await findAssetByName('ArrowHammer', {
    projectPath: f.projectPath,
    includeSubassets: false,
  });
  assert.equal(mainOnly.status, 'unique');
  assert.equal(mainOnly.selected.uuid, 'image-main');

  const wrongCase = await findAssetByName('icon', {
    projectPath: f.projectPath,
    caseSensitive: true,
  });
  assert.equal(wrongCase.status, 'not_found');

  const internal = await findAssetByName('Camera', {
    projectPath: f.projectPath,
    scope: 'all',
  });
  assert.equal(internal.status, 'unique');
  assert.equal(internal.selected.uuid, 'internal-camera');
});

test('asset name lookup validates its bounds before querying asset-db', async (t) => {
  const f = fixture(t);
  assert.throws(() => normalizeAssetNameLookup('', {}), /name must/i);
  assert.throws(() => normalizeAssetNameLookup('Icon', { maxCandidates: 0 }), /maxCandidates/i);
  assert.throws(() => normalizeAssetNameLookup('Icon', { maxCandidates: 201 }), /maxCandidates/i);
  await assert.rejects(findAssetByName('Icon', {
    projectPath: f.projectPath,
    directory: '../outside',
  }), /inside|outside/i);
  assert.equal(f.calls.length, 0);
});

test('find_asset_by_name registry exposes a focused exact-name resolver', async (t) => {
  const f = fixture(t);
  const registry = createToolRegistry({
    getRuntimeContext: () => ({ projectPath: f.projectPath, config: { toolProfile: 'core' } }),
    interactionLog: { add() {} }, runtimeLog: { add() {}, list: () => [], clear() {} },
    sceneBridge: { call: async () => assert.fail('Scene bridge is not used for asset lookup') },
  });
  const tool = registry.listTools().find((candidate) => candidate.name === 'find_asset_by_name');
  assert.deepEqual(tool.inputSchema.required, ['name']);
  assert.equal(tool.inputSchema.properties.maxCandidates.maximum, 200);
  assert.equal(Object.hasOwn(tool.inputSchema.properties, 'nameMode'), false);
  const { value } = await registry.callToolDetailed('find_asset_by_name', {
    name: 'Icon', ccType: 'cc.Prefab', directory: 'assets/A',
  });
  assert.equal(value.ok, true);
  assert.equal(value.data.status, 'unique');
  assert.equal(value.data.selected.uuid, 'prefab-a');
});
