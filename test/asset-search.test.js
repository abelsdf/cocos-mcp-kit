'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  normalizeAssetSearchOptions,
  searchAssets,
} = require('../lib/assets');
const { createToolRegistry } = require('../lib/tool-registry');

function fixture(t) {
  const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'cocos-asset-search-'));
  fs.mkdirSync(path.join(projectPath, 'assets', 'A'), { recursive: true });
  fs.mkdirSync(path.join(projectPath, 'assets', 'B'), { recursive: true });
  const assets = [
    { name: 'Icon.prefab', displayName: '', uuid: 'prefab-b', url: 'db://assets/B/Icon.prefab',
      path: 'db://assets/B/Icon', type: 'cc.Prefab', importer: 'prefab', imported: true, subAssets: {} },
    { name: 'spriteFrame', displayName: 'ArrowHammer', uuid: 'image-main@frame',
      url: 'db://assets/A/ArrowHammer.png/spriteFrame', type: 'cc.SpriteFrame', importer: 'sprite-frame' },
    { name: 'Internal.prefab', uuid: 'internal', url: 'db://internal/Internal.prefab', type: 'cc.Prefab' },
    { name: 'Icon.scene', displayName: '', uuid: 'scene-icon', url: 'db://assets/A/Icon.scene',
      path: 'db://assets/A/Icon', type: 'cc.SceneAsset', importer: 'scene', imported: true, subAssets: {} },
    { name: 'ArrowHammer.png', displayName: '', uuid: 'image-main', url: 'db://assets/A/ArrowHammer.png',
      path: 'db://assets/A/ArrowHammer', type: 'cc.ImageAsset', importer: 'image', imported: true,
      subAssets: { frame: { uuid: 'image-main@frame' } } },
    { name: 'Icon.prefab', displayName: '', uuid: 'prefab-a', url: 'db://assets/A/Icon.prefab',
      path: 'db://assets/A/Icon', type: 'cc.Prefab', importer: 'prefab', imported: true, subAssets: {} },
    { name: 'Helper.ts', displayName: '', uuid: 'script', url: 'db://assets/scripts/Helper.ts',
      path: 'db://assets/scripts/Helper', type: 'cc.Script', importer: 'typescript', imported: true },
  ];
  assets.push(assets[5]);
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
  return { projectPath, assets, calls };
}

test('searchAssets defaults to project scope, deduplicates, sorts, and paginates stably', async (t) => {
  const f = fixture(t);
  const first = await searchAssets({ projectPath: f.projectPath, limit: 2 });
  assert.deepEqual(f.calls[0], { pattern: 'db://assets/**' });
  assert.equal(first.scanned, 8);
  assert.equal(first.total, 6);
  assert.equal(first.returned, 2);
  assert.equal(first.hasMore, true);
  assert.equal(first.nextOffset, 2);
  assert.equal(first.ambiguities.hasDuplicateNames, false);
  assert.deepEqual(first.ambiguities.groups, []);
  assert.deepEqual(first.assets.map((asset) => asset.url), [
    'db://assets/A/ArrowHammer.png',
    'db://assets/A/ArrowHammer.png/spriteFrame',
  ]);

  const second = await searchAssets({ projectPath: f.projectPath, offset: 2, limit: 2 });
  assert.deepEqual(second.assets.map((asset) => asset.url), [
    'db://assets/A/Icon.prefab',
    'db://assets/A/Icon.scene',
  ]);
});

test('searchAssets returns exact extensionless-name matches and duplicate candidates', async (t) => {
  const f = fixture(t);
  const result = await searchAssets({
    projectPath: f.projectPath,
    name: 'Icon',
    nameMode: 'exact',
  });
  assert.equal(result.total, 3);
  assert.deepEqual(result.assets.map((asset) => asset.uuid), ['prefab-a', 'scene-icon', 'prefab-b']);
  assert.equal(result.selection.exactNameQuery, true);
  assert.equal(result.selection.ambiguous, true);
  assert.equal(result.selection.candidateCount, 3);
  assert.deepEqual(result.selection.candidates.map((asset) => asset.uuid), ['prefab-a', 'scene-icon', 'prefab-b']);
  assert.equal(result.ambiguities.hasDuplicateNames, true);
  assert.equal(result.ambiguities.groupCount, 1);
  assert.equal(result.ambiguities.groups[0].name, 'Icon.prefab');
  assert.deepEqual(result.ambiguities.groups[0].candidates.map((asset) => asset.uuid), ['prefab-a', 'prefab-b']);
});

test('searchAssets combines directory, type, case, and subasset filters', async (t) => {
  const f = fixture(t);
  const directory = await searchAssets({
    projectPath: f.projectPath,
    directory: path.join(f.projectPath, 'assets', 'A'),
    ccType: 'cc.Prefab',
  });
  assert.equal(f.calls[0].pattern, 'db://assets/A/**');
  assert.equal(f.calls[0].ccType, 'cc.Prefab');
  assert.deepEqual(directory.assets.map((asset) => asset.uuid), ['prefab-a']);

  const withoutSubassets = await searchAssets({
    projectPath: f.projectPath,
    name: 'arrow',
    includeSubassets: false,
  });
  assert.deepEqual(withoutSubassets.assets.map((asset) => asset.uuid), ['image-main']);

  const caseSensitive = await searchAssets({
    projectPath: f.projectPath,
    name: 'icon',
    nameMode: 'exact',
    caseSensitive: true,
  });
  assert.equal(caseSensitive.total, 0);
});

test('searchAssets can include explicitly requested internal assets', async (t) => {
  const f = fixture(t);
  const result = await searchAssets({ projectPath: f.projectPath, scope: 'all', name: 'Internal' });
  assert.deepEqual(f.calls[0], {});
  assert.deepEqual(result.assets.map((asset) => asset.uuid), ['internal']);
});

test('asset search rejects invalid bounds, modes, flags, and directories before querying', async (t) => {
  const f = fixture(t);
  const invalid = [
    { limit: 0 }, { limit: 201 }, { offset: -1 }, { scope: 'internal' }, { nameMode: 'regex' },
    { caseSensitive: 'yes' }, { includeSubassets: 1 }, { name: ' ' }, { ccType: '' },
    { directory: 'db://internal' }, { directory: '../outside' },
  ];
  for (const options of invalid) {
    await assert.rejects(searchAssets({ projectPath: f.projectPath, ...options }), /must|inside|outside/i);
  }
  assert.equal(f.calls.length, 0);
  assert.throws(() => normalizeAssetSearchOptions({ pattern: 'x'.repeat(4097) }), /at most 4096/i);
});

test('list_assets registry exposes search controls and returns the bounded catalog', async (t) => {
  const f = fixture(t);
  const registry = createToolRegistry({
    getRuntimeContext: () => ({ projectPath: f.projectPath, config: { toolProfile: 'core' } }),
    interactionLog: { add() {} }, runtimeLog: { add() {}, list: () => [], clear() {} },
    sceneBridge: { call: async () => assert.fail('Scene bridge is not used for asset search') },
  });
  const tool = registry.listTools().find((candidate) => candidate.name === 'list_assets');
  assert.equal(tool.inputSchema.properties.nameMode.enum.includes('exact'), true);
  assert.equal(tool.inputSchema.properties.limit.maximum, 200);
  const { value } = await registry.callToolDetailed('list_assets', {
    name: 'Icon', nameMode: 'exact', ccType: 'cc.Prefab', limit: 1,
  });
  assert.equal(value.ok, true);
  assert.equal(value.data.total, 2);
  assert.equal(value.data.returned, 1);
  assert.equal(value.data.hasMore, true);
  assert.equal(value.data.nextOffset, 1);
  assert.equal(value.data.selection.ambiguous, true);
  assert.equal(value.data.selection.candidateCount, 2);
  assert.equal(value.data.ambiguities.hasDuplicateNames, true);
});
