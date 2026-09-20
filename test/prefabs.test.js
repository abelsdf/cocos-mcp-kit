'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { duplicatePrefab, editPrefabJson, inspectPrefab, normalizePrefabTarget, savePrefabContent, validatePrefabReferences } = require('../lib/prefabs');

function fixture(t) {
  const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'cocos-prefab-edit-'));
  t.after(() => fs.rmSync(projectPath, { recursive: true, force: true }));
  const sourcePath = path.join(projectPath, 'assets', 'Prefabs', 'Source.prefab');
  fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
  fs.writeFileSync(sourcePath, JSON.stringify([
    { __type__: 'cc.Prefab', _name: 'Source', data: { __id__: 1 } },
    { __type__: 'cc.Node', _name: 'Source', _active: true, _children: [{ __id__: 2 }] },
    { __type__: 'cc.Node', _name: 'Child', _active: true },
  ], null, 2));
  const sourceUrl = 'db://assets/Prefabs/Source.prefab';
  const sourceInfo = { uuid: 'source-uuid', url: sourceUrl, type: 'cc.Prefab', imported: true };
  const targetUrl = 'db://assets/Prefabs/Copy.prefab';
  const targetInfo = { uuid: 'copy-uuid', url: targetUrl, type: 'cc.Prefab', imported: true };
  const calls = [];
  const request = async (method, dbUrl, value) => {
    calls.push({ method, dbUrl });
    const targetPath = path.join(projectPath, dbUrl.slice('db://'.length));
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, value);
  };
  const queryInfo = async (target) => {
    if (target === sourceUrl) return sourceInfo;
    if (target === targetUrl) return targetInfo;
    throw new Error(`Unknown test asset: ${target}`);
  };
  return { projectPath, sourcePath, sourceUrl, sourceInfo, targetUrl, targetInfo, request, queryInfo, calls };
}

test('normalizePrefabTarget maps simple names into assets prefab paths', () => {
  const projectPath = path.resolve('/tmp/funplay-cocos-project');
  const target = normalizePrefabTarget(projectPath, 'Prefabs/SettingsPanel');

  assert.equal(target.projectRelative, 'assets/Prefabs/SettingsPanel.prefab');
  assert.equal(target.dbUrl, 'db://assets/Prefabs/SettingsPanel.prefab');
});

test('normalizePrefabTarget rejects paths outside assets', () => {
  const projectPath = path.resolve('/tmp/funplay-cocos-project');
  assert.throws(() => normalizePrefabTarget(projectPath, '../Outside'), /inside the Cocos assets directory/);
});

test('inspectPrefab reports compact structure, metadata consistency and bounded references', async (t) => {
  const f = fixture(t);
  const serialized = [
    { __type__: 'cc.Prefab', _name: 'Source', data: { __id__: 1 } },
    { __type__: 'cc.Node', _name: 'Source', _children: [{ __id__: 2 }], _components: [{ __id__: 3 }] },
    { __type__: 'cc.Node', _name: 'Child', _children: [] },
    { __type__: 'cc.Sprite', node: { __id__: 1 }, _spriteFrame: { __uuid__: 'sprite-frame' } },
    { __type__: 'cc.PrefabInfo', asset: { __uuid__: 'nested-prefab' } },
  ];
  fs.writeFileSync(f.sourcePath, JSON.stringify(serialized));
  const options = {
    queryInfo: f.queryInfo,
    queryMeta: async () => ({ uuid: 'source-uuid', importer: 'prefab' }),
    queryData: async () => assert.fail('Disk serialization should take precedence over asset-db data'),
  };
  const details = await inspectPrefab(f.projectPath, f.sourceUrl, options);
  assert.equal(details.serializedSource, 'disk');
  assert.equal(details.metadata.uuidMatchesAsset, true);
  assert.equal(details.structure.status, 'available');
  assert.equal(details.structure.rootName, 'Source');
  assert.equal(details.structure.nodeCount, 2);
  assert.equal(details.structure.componentCount, 1);
  assert.deepEqual(details.structure.componentTypes, [{ type: 'cc.Sprite', count: 1 }]);
  assert.deepEqual(details.structure.referencedPrefabUuids, ['nested-prefab']);
  assert.equal(details.referenceCount, 2);
  assert.equal(details.totalReferenceCount, 2);
  assert.equal(details.referencesTruncated, false);

  serialized[1]._custom = Array.from({ length: 501 }, (_, index) => ({ __uuid__: `ref-${index}` }));
  fs.writeFileSync(f.sourcePath, JSON.stringify(serialized));
  const bounded = await inspectPrefab(f.projectPath, f.sourceUrl, {
    queryInfo: f.queryInfo,
    queryMeta: async () => { throw new Error('metadata unavailable'); },
  });
  assert.equal(bounded.metadata.status, 'error');
  assert.equal(bounded.referenceCount, 500);
  assert.equal(bounded.totalReferenceCount, 503);
  assert.equal(bounded.referencesTruncated, true);
});

test('inspectPrefab rejects a non-prefab asset before reading serialized content', async (t) => {
  const f = fixture(t);
  await assert.rejects(() => inspectPrefab(f.projectPath, f.sourceUrl, {
    queryInfo: async () => ({ ...f.sourceInfo, type: 'cc.SceneAsset' }),
  }), /target must be a cc.Prefab/);
});

test('validatePrefabReferences checks a missing reference beyond the old 500-entry display bound', async (t) => {
  const f = fixture(t);
  const serialized = JSON.parse(fs.readFileSync(f.sourcePath, 'utf8'));
  serialized[1]._assetRefs = Array.from({ length: 501 }, (_, index) => ({ __uuid__: `asset-${index}` }));
  fs.writeFileSync(f.sourcePath, JSON.stringify(serialized));
  const checked = [];
  const result = await validatePrefabReferences(f.projectPath, {
    target: f.sourceUrl,
    queryInfo: async (uuid) => {
      if (uuid === f.sourceUrl) return f.sourceInfo;
      checked.push(uuid);
      if (uuid === 'asset-500') throw new Error(`Asset not found: ${uuid}`);
      return { uuid, url: `db://assets/${uuid}`, type: 'cc.SpriteFrame' };
    },
    queryMeta: async () => ({ uuid: f.sourceInfo.uuid }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.complete, true);
  assert.equal(result.missingCount, 1);
  assert.equal(result.prefabs[0].totalReferenceCount, 501);
  assert.equal(result.prefabs[0].checkedCount, 501);
  assert.equal(result.prefabs[0].missing[0].uuid, 'asset-500');
  assert.equal(checked.length, 501);
});

test('validatePrefabReferences marks bounded scans and transient lookup failures incomplete', async (t) => {
  const f = fixture(t);
  const serialized = JSON.parse(fs.readFileSync(f.sourcePath, 'utf8'));
  serialized[1]._assetRefs = ['first', 'second', 'third'].map((uuid) => ({ __uuid__: uuid }));
  fs.writeFileSync(f.sourcePath, JSON.stringify(serialized));
  const queryInfo = async (uuid) => {
    if (uuid === f.sourceUrl) return f.sourceInfo;
    if (uuid === 'second') throw new Error('asset-db temporarily unavailable');
    return { uuid, url: `db://assets/${uuid}`, type: 'cc.SpriteFrame' };
  };
  const bounded = await validatePrefabReferences(f.projectPath, {
    target: f.sourceUrl, queryInfo, maxReferences: 1,
  });
  assert.equal(bounded.ok, false);
  assert.equal(bounded.complete, false);
  assert.equal(bounded.prefabs[0].referencesTruncated, true);
  assert.equal(bounded.prefabs[0].checkedCount, 1);
  const lookupFailure = await validatePrefabReferences(f.projectPath, { target: f.sourceUrl, queryInfo });
  assert.equal(lookupFailure.missingCount, 0);
  assert.equal(lookupFailure.complete, false);
  assert.equal(lookupFailure.prefabs[0].lookupErrorCount, 1);
  await assert.rejects(() => validatePrefabReferences(f.projectPath, {
    target: f.sourceUrl, maxReferences: 0,
  }), /maxReferences 1–5000/);
});

test('validatePrefabReferences distinguishes declared nested assets from broken component links', async (t) => {
  const f = fixture(t);
  fs.writeFileSync(f.sourcePath, JSON.stringify([
    { __type__: 'cc.Prefab', _name: 'Source', data: { __id__: 1 } },
    { __type__: 'cc.Node', _name: 'Source', _components: [{ __id__: 2 }, { __id__: 99 }] },
    { __type__: 'cc.Sprite', node: { __id__: 1 } },
    { __type__: 'cc.PrefabInfo', asset: { __uuid__: 'nested-prefab' } },
  ]));
  const result = await validatePrefabReferences(f.projectPath, {
    target: f.sourceUrl,
    queryInfo: async (uuid) => uuid === f.sourceUrl ? f.sourceInfo :
      { uuid, url: `db://assets/${uuid}.prefab`, type: 'cc.Prefab' },
  });
  assert.equal(result.complete, true);
  assert.equal(result.ok, false);
  assert.equal(result.prefabs[0].componentIssueCount, 1);
  assert.equal(result.prefabs[0].componentIssues[0].code, 'missing_component_entry');
  assert.deepEqual(result.prefabs[0].nestedPrefabReferences, [
    { uuid: 'nested-prefab', status: 'found', type: 'cc.Prefab', code: undefined },
  ]);
  assert.equal(result.prefabs[0].componentTypeRegistrationChecked, false);
});

test('validatePrefabReferences rejects a declared nested asset of the wrong type', async (t) => {
  const f = fixture(t);
  fs.writeFileSync(f.sourcePath, JSON.stringify([
    { __type__: 'cc.Prefab', _name: 'Source', data: { __id__: 1 } },
    { __type__: 'cc.Node', _name: 'Source', _components: [{ __id__: 2 }] },
    { __type__: 'cc.Sprite', node: { __id__: 9 } },
    { __type__: 'cc.PrefabInfo', asset: { __uuid__: 'image-asset' } },
  ]));
  const result = await validatePrefabReferences(f.projectPath, {
    target: f.sourceUrl,
    queryInfo: async (uuid) => uuid === f.sourceUrl ? f.sourceInfo :
      { uuid, url: `db://assets/${uuid}.png`, type: 'cc.ImageAsset' },
  });
  assert.equal(result.complete, true);
  assert.equal(result.ok, false);
  assert.equal(result.prefabs[0].missingCount, 0);
  assert.equal(result.prefabs[0].componentIssues[0].code, 'component_owner_mismatch');
  assert.equal(result.prefabs[0].nestedIssueCount, 1);
  assert.equal(result.prefabs[0].nestedPrefabReferences[0].code, 'nested_asset_not_prefab');
});

test('validatePrefabReferences reports truncated prefab asset enumeration', async (t) => {
  const f = fixture(t);
  const result = await validatePrefabReferences(f.projectPath, {
    limit: 1,
    listAssets: async () => [f.sourceInfo, { uuid: 'another', url: 'db://assets/another.prefab' }],
    queryInfo: f.queryInfo,
  });
  assert.equal(result.prefabCount, 1);
  assert.equal(result.assetListTruncated, true);
  assert.equal(result.complete, false);
  assert.equal(result.ok, false);
});

test('savePrefabContent requires asset-db and verifies the imported prefab', async (t) => {
  const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'funplay-cocos-prefab-save-'));
  t.after(() => fs.rmSync(projectPath, { recursive: true, force: true }));
  fs.mkdirSync(path.join(projectPath, 'assets'), { recursive: true });

  const content = '[{"__type__":"cc.Prefab","_name":"TestPrefab","data":{"__id__":1}},{"__type__":"cc.Node","_name":"TestPrefab"}]';
  const targetPath = path.join(projectPath, 'assets', 'Generated', 'TestPrefab.prefab');
  await assert.rejects(
    () => savePrefabContent(projectPath, { target: 'Generated/TestPrefab', content }),
    /require Cocos asset-db persistence/
  );
  assert.equal(fs.existsSync(targetPath), false);

  const result = await savePrefabContent(projectPath, {
    target: 'Generated/TestPrefab',
    content,
    request: async (method, dbUrl, value) => {
      assert.equal(method, 'create-asset');
      assert.equal(dbUrl, 'db://assets/Generated/TestPrefab.prefab');
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, `${value}\n`);
    },
    queryInfo: async (dbUrl) => ({ uuid: 'prefab-uuid', url: dbUrl, type: 'cc.Prefab', imported: true }),
  });

  assert.equal(result.created, true);
  assert.equal(result.path, 'assets/Generated/TestPrefab.prefab');
  assert.equal(result.dbUrl, 'db://assets/Generated/TestPrefab.prefab');
  assert.equal(result.fileExists, true);
  assert.equal(result.method, 'asset-db:create-asset');
  assert.equal(
    fs.readFileSync(targetPath, 'utf8').trim(),
    content
  );
});

test('savePrefabContent rejects names that Creator would normalize to the target filename', async (t) => {
  const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'cocos-prefab-names-'));
  t.after(() => fs.rmSync(projectPath, { recursive: true, force: true }));
  fs.mkdirSync(path.join(projectPath, 'assets'), { recursive: true });
  const content = JSON.stringify([
    { __type__: 'cc.Prefab', _name: 'RequestedName', data: { __id__: 1 } },
    { __type__: 'cc.Node', _name: 'RequestedName' },
  ]);
  await assert.rejects(
    () => savePrefabContent(projectPath, { target: 'Generated/ActualName', content }),
    /prefab asset name must match the target filename "ActualName"/
  );
  assert.equal(fs.existsSync(path.join(projectPath, 'assets', 'Generated', 'ActualName.prefab')), false);
});

test('duplicatePrefab creates an imported asset with a new UUID and preserved child hierarchy', async (t) => {
  const f = fixture(t);
  const result = await duplicatePrefab(f.projectPath, {
    source: f.sourceUrl,
    target: 'Prefabs/Copy',
    request: f.request,
    queryInfo: f.queryInfo,
    settleDelayMs: 0,
  });
  assert.equal(result.method, 'asset-db:create-asset');
  assert.equal(result.info.uuid, 'copy-uuid');
  assert.deepEqual(f.calls, [{ method: 'create-asset', dbUrl: f.targetUrl }]);
  const copied = JSON.parse(fs.readFileSync(path.join(f.projectPath, 'assets', 'Prefabs', 'Copy.prefab')));
  assert.equal(copied[0]._name, 'Copy');
  assert.equal(copied[1]._name, 'Copy');
  assert.deepEqual(copied[1]._children, [{ __id__: 2 }]);
  assert.equal(copied[2]._name, 'Child');
  assert.equal(fs.existsSync(path.join(f.projectPath, 'assets', 'Prefabs', 'Copy.prefab.meta')), false);
  assert.equal(JSON.parse(fs.readFileSync(f.sourcePath))[1]._name, 'Source');
});

test('duplicatePrefab rejects same target and asset-db failure without direct file fallback', async (t) => {
  const f = fixture(t);
  await assert.rejects(
    () => duplicatePrefab(f.projectPath, { source: f.sourceUrl, target: 'Prefabs/Source', overwrite: true, queryInfo: f.queryInfo }),
    /different assets/
  );
  await assert.rejects(
    () => duplicatePrefab(f.projectPath, {
      source: f.sourceUrl,
      target: 'Prefabs/Copy',
      queryInfo: f.queryInfo,
      request: async () => { throw new Error('import rejected'); },
    }),
    /import rejected/
  );
  assert.equal(fs.existsSync(path.join(f.projectPath, 'assets', 'Prefabs', 'Copy.prefab')), false);
});

test('editPrefabJson saves through asset-db, keeps UUID, backs up original, and validates references', async (t) => {
  const f = fixture(t);
  const original = fs.readFileSync(f.sourcePath, 'utf8');
  const validationCalls = [];
  const result = await editPrefabJson(f.projectPath, {
    target: f.sourceUrl,
    jsonPath: '/1/_active',
    valueJson: 'false',
    createBackup: true,
    request: f.request,
    queryInfo: f.queryInfo,
    validateReferences: async (projectPath, options) => {
      validationCalls.push({ projectPath, options });
      return { ok: true, missingCount: 0 };
    },
    settleDelayMs: 0,
  });
  assert.equal(result.method, 'asset-db:save-asset');
  assert.equal(result.info.uuid, 'source-uuid');
  assert.equal(result.oldValue, true);
  assert.equal(result.validation.ok, true);
  assert.deepEqual(f.calls, [{ method: 'save-asset', dbUrl: f.sourceUrl }]);
  assert.deepEqual(validationCalls, [{ projectPath: f.projectPath, options: { target: f.sourceUrl } }]);
  assert.equal(JSON.parse(fs.readFileSync(f.sourcePath, 'utf8'))[1]._active, false);
  assert.equal(fs.readFileSync(`${f.sourcePath}.bak`, 'utf8'), original);
});

test('editPrefabJson rejects malformed changes before writing and retains original on save failure', async (t) => {
  const f = fixture(t);
  const original = fs.readFileSync(f.sourcePath, 'utf8');
  await assert.rejects(
    () => editPrefabJson(f.projectPath, { target: f.sourceUrl, jsonPath: '/1/missing/child', valueJson: '1', queryInfo: f.queryInfo }),
    /jsonPath does not exist/
  );
  await assert.rejects(
    () => editPrefabJson(f.projectPath, { target: f.sourceUrl, jsonPath: '/0/_name', valueJson: '"Wrong"', queryInfo: f.queryInfo }),
    /must match the target filename/
  );
  await assert.rejects(
    () => editPrefabJson(f.projectPath, {
      target: f.sourceUrl,
      jsonPath: '/1/_active',
      valueJson: 'false',
      queryInfo: f.queryInfo,
      request: async () => { throw new Error('save rejected'); },
    }),
    /save rejected/
  );
  assert.equal(fs.readFileSync(f.sourcePath, 'utf8'), original);
  assert.equal(fs.existsSync(`${f.sourcePath}.bak`), false);
});
