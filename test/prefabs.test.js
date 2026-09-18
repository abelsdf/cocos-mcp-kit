'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { normalizePrefabTarget, savePrefabContent } = require('../lib/prefabs');

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
