'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  boundedAssetValue,
  inspectAsset,
  normalizeAssetInspectionTarget,
} = require('../lib/assets');
const { createToolRegistry } = require('../lib/tool-registry');

function fixture(t) {
  const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'cocos-asset-inspect-'));
  const file = path.join(projectPath, 'assets', 'icons', 'arrow.png');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'image');
  const frame = {
    name: 'spriteFrame', uuid: 'image-uuid@frame', url: 'db://assets/icons/arrow.png/spriteFrame',
    source: 'db://assets/icons/arrow.png', type: 'cc.SpriteFrame', imported: true, invalid: false,
  };
  const texture = {
    name: 'texture', uuid: 'image-uuid@texture', url: 'db://assets/icons/arrow.png/texture',
    source: 'db://assets/icons/arrow.png', type: 'cc.Texture2D', imported: true, invalid: false,
  };
  const image = {
    name: 'arrow.png', uuid: 'image-uuid', url: 'db://assets/icons/arrow.png',
    source: 'db://assets/icons/arrow.png', file, type: 'cc.ImageAsset', importer: 'image',
    imported: true, invalid: false, readonly: false, isDirectory: false,
    subAssets: { texture, spriteFrame: frame },
  };
  const meta = { uuid: 'image-uuid', importer: 'image', ver: '1.0.0',
    userData: { trimType: 'auto', generateMipmaps: false } };
  const data = { width: 64, height: 32, pixels: ['a', 'b', 'c'] };
  const calls = [];
  const state = { metadataError: false, dataError: false, directSubassetMetadata: false };
  const previous = global.Editor;
  global.Editor = { Message: { request: async (channel, method, target) => {
    assert.equal(channel, 'asset-db');
    calls.push({ method, target });
    if (method === 'query-asset-info') {
      if (target === image.uuid || target === image.url) return image;
      if (target === frame.uuid || target === frame.url) return frame;
      if (target === texture.uuid || target === texture.url) return texture;
      return null;
    }
    if (method === 'query-asset-meta') {
      if (state.metadataError) throw new Error('metadata unavailable');
      if (state.directSubassetMetadata && (target === frame.uuid || target === frame.url)) return meta;
      return target === image.uuid || target === image.url ? meta : null;
    }
    if (method === 'query-asset-data') {
      if (state.dataError) throw new Error('data unavailable');
      return target === image.uuid || target === image.url ? data : null;
    }
    throw new Error(`Unexpected request: ${method}`);
  } } };
  t.after(() => {
    if (previous === undefined) delete global.Editor;
    else global.Editor = previous;
    fs.rmSync(projectPath, { recursive: true, force: true });
  });
  return { projectPath, file, image, frame, texture, meta, data, calls, state };
}

test('exact asset targets normalize project paths without guessing extensions', (t) => {
  const f = fixture(t);
  assert.equal(normalizeAssetInspectionTarget('assets/icons/arrow.png', f.projectPath).target,
    'db://assets/icons/arrow.png');
  assert.equal(normalizeAssetInspectionTarget('/assets/icons/arrow.png', f.projectPath).target,
    'db://assets/icons/arrow.png');
  assert.equal(normalizeAssetInspectionTarget(f.file, f.projectPath).target,
    'db://assets/icons/arrow.png');
  assert.deepEqual(normalizeAssetInspectionTarget('compressed/uuid', f.projectPath), {
    requested: 'compressed/uuid', target: 'compressed/uuid', kind: 'uuid-or-opaque', exact: true,
  });
  assert.throws(() => normalizeAssetInspectionTarget(path.join(os.tmpdir(), 'outside.png'), f.projectPath),
    /outside.*project|inside.*assets/i);
  assert.throws(() => normalizeAssetInspectionTarget('db://assets/../secret', f.projectPath), /traversal/i);
});

test('inspectAsset reports a bounded main asset and optional serialized data', async (t) => {
  const f = fixture(t);
  const result = await inspectAsset('assets/icons/arrow.png', { projectPath: f.projectPath, includeData: true });
  assert.equal(result.target.target, f.image.url);
  assert.equal(result.identity.uuid, f.image.uuid);
  assert.equal(result.identity.kind, 'main');
  assert.equal(result.identity.metadataMatchesAsset, true);
  assert.equal(result.relationship.subAssetCount, 2);
  assert.deepEqual(result.relationship.subAssets.map((asset) => asset.uuid).sort(),
    [f.frame.uuid, f.texture.uuid].sort());
  assert.equal(result.queries.metadata.status, 'available');
  assert.equal(result.queries.metadata.scope, 'asset');
  assert.equal(result.queries.data.status, 'available');
  assert.deepEqual(JSON.parse(JSON.stringify(result.data)), f.data);
  assert.equal(result.details.status, 'available');
  assert.equal(result.details.target.kind, 'main');
  assert.equal(result.details.target.scope, 'project');
  assert.equal(result.details.source.uuid, f.image.uuid);
  assert.equal(result.details.source.file.projectRelativePath, 'assets/icons/arrow.png');
  assert.equal(result.details.source.file.status, 'available');
  assert.equal(result.details.source.file.kind, 'file');
  assert.equal(result.details.source.file.sizeBytes, 5);
  assert.equal(result.details.import.status, 'ready');
  assert.equal(result.details.import.sourceImporter, 'image');
  assert.equal(result.details.metadata.version, '1.0.0');
  assert.deepEqual(result.details.metadata.userDataKeys, ['generateMipmaps', 'trimType']);
  assert.equal(result.complete, true);
  assert.equal(result.truncated, false);
});

test('inspectAsset identifies a SpriteFrame subasset and main-asset metadata', async (t) => {
  const f = fixture(t);
  const result = await inspectAsset(f.frame.uuid, { projectPath: f.projectPath });
  assert.equal(result.identity.kind, 'subasset');
  assert.equal(result.identity.uuid, f.frame.uuid);
  assert.equal(result.relationship.mainAsset.uuid, f.image.uuid);
  assert.equal(result.relationship.parentAsset.url, f.image.url);
  assert.equal(result.queries.metadata.status, 'available');
  assert.equal(result.queries.metadata.scope, 'main_asset');
  assert.equal(result.identity.metadataMatchesAsset, false);
  assert.equal(result.identity.metadataMatchesMainAsset, true);
  assert.equal(result.queries.data.status, 'not_requested');
  assert.equal(result.data, null);
  assert.equal(result.details.target.kind, 'subasset');
  assert.equal(result.details.target.importer, '');
  assert.equal(result.details.source.uuid, f.image.uuid);
  assert.equal(result.details.source.importer, 'image');
  assert.equal(result.details.source.file.path, f.file);
  assert.equal(result.details.metadata.scope, 'main_asset');
  assert.equal(result.details.metadata.matchesTarget, false);
  assert.equal(result.details.metadata.matchesSource, true);
  assert.equal(result.details.relationship.subAssetKey, 'spriteFrame');
  assert.equal(result.complete, true);
});

test('inspectAsset labels direct subasset metadata by its returned main UUID', async (t) => {
  const f = fixture(t);
  f.state.directSubassetMetadata = true;
  const result = await inspectAsset(f.frame.uuid, { projectPath: f.projectPath });
  assert.equal(result.queries.metadata.target, f.frame.uuid);
  assert.equal(result.queries.metadata.scope, 'main_asset');
  assert.equal(result.identity.metadataMatchesAsset, false);
  assert.equal(result.identity.metadataMatchesMainAsset, true);
});

test('inspectAsset exposes query errors and never reports an incomplete read as complete', async (t) => {
  const f = fixture(t);
  f.state.metadataError = true;
  f.state.dataError = true;
  const result = await inspectAsset(f.image.uuid, { projectPath: f.projectPath, includeData: true });
  assert.equal(result.queries.metadata.status, 'error');
  assert.match(result.queries.metadata.errors[0], /metadata unavailable/);
  assert.equal(result.queries.data.status, 'error');
  assert.match(result.queries.data.errors[0], /data unavailable/);
  assert.equal(result.meta, null);
  assert.equal(result.data, null);
  assert.equal(result.details.status, 'incomplete');
  assert.equal(result.details.complete, false);
  assert.equal(result.complete, false);
});

test('inspectAsset reports a missing source file without treating details as complete', async (t) => {
  const f = fixture(t);
  fs.rmSync(f.file);
  const result = await inspectAsset(f.image.uuid, { projectPath: f.projectPath });
  assert.equal(result.details.source.file.status, 'missing');
  assert.equal(result.details.source.file.exists, false);
  assert.equal(result.details.status, 'incomplete');
  assert.equal(result.details.complete, false);
  assert.equal(result.complete, false);
});

test('inspectAsset queries an extensionless target exactly once and reports not found', async (t) => {
  const f = fixture(t);
  await assert.rejects(inspectAsset('db://assets/icons/arrow', { projectPath: f.projectPath }),
    /not found/i);
  assert.deepEqual(f.calls, [{ method: 'query-asset-info', target: 'db://assets/icons/arrow' }]);
});

test('bounded asset snapshots report limits, avoid getters, and redact credential fields', () => {
  let getterCalls = 0;
  const value = { long: 'x'.repeat(100), password: 'hidden', values: [1, 2, 3] };
  Object.defineProperty(value, 'dangerous', { enumerable: true, get() { getterCalls += 1; return 'no'; } });
  const result = boundedAssetValue(value, {
    maxDepth: 4, maxItems: 3, maxNodes: 100, maxStringLength: 64, maxCharacters: 1000,
  });
  assert.equal(getterCalls, 0);
  assert.equal(result.value.password, '[Redacted]');
  assert.equal(result.value.dangerous, undefined);
  assert.equal(result.value.long.length, 65);
  assert.equal(result.truncated, true);
  assert.ok(result.reasons.includes('maxStringLength'));
  assert.ok(result.reasons.includes('maxItems'));
  assert.equal(result.redactedCount, 1);
});

test('inspectAsset validates every explicit output bound', async (t) => {
  const f = fixture(t);
  for (const options of [
    { maxDepth: 0 }, { maxItems: 0 }, { maxNodes: 9 }, { maxStringLength: 63 },
    { maxCharacters: 999 }, { includeData: 'yes' },
  ]) {
    await assert.rejects(inspectAsset(f.image.uuid, { projectPath: f.projectPath, ...options }),
      /must be/i);
  }
  assert.equal(f.calls.length, 0);
});

test('inspect_asset registry exposes bounded controls and preserves the structured result', async (t) => {
  const f = fixture(t);
  const registry = createToolRegistry({
    getRuntimeContext: () => ({ projectPath: f.projectPath, config: { toolProfile: 'core' } }),
    interactionLog: { add() {} }, runtimeLog: { add() {}, list: () => [], clear() {} },
    sceneBridge: { call: async () => assert.fail('Scene bridge is not used for asset inspection') },
  });
  const tool = registry.listTools().find((candidate) => candidate.name === 'inspect_asset');
  assert.equal(tool.inputSchema.properties.maxDepth.maximum, 12);
  assert.equal(tool.inputSchema.properties.maxItems.maximum, 500);
  const { value } = await registry.callToolDetailed('inspect_asset', {
    target: f.frame.uuid, maxItems: 1,
  });
  assert.equal(value.ok, true);
  assert.equal(value.data.identity.kind, 'subasset');
  assert.equal(value.data.relationship.subAssets.length, 1);
  assert.equal(value.data.relationship.subAssetsTruncated, true);
  assert.equal(value.data.details.metadata.userDataKeyCount, 2);
  assert.equal(value.data.details.metadata.userDataKeys.length, 1);
  assert.equal(value.data.details.metadata.userDataKeysTruncated, true);
  assert.equal(value.data.truncated, true);
});
