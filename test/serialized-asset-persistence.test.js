'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { persistSerializedAsset } = require('../lib/serialized-asset-persistence');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cocos-asset-persistence-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return {
    filePath: path.join(root, 'assets', 'Generated.prefab'),
    projectRelative: 'assets/Generated.prefab',
    dbUrl: 'db://assets/Generated.prefab',
  };
}

test('asset-db rejection after a partial file write is still an error', async (t) => {
  const target = fixture(t);
  await assert.rejects(
    () => persistSerializedAsset(target, '[{"new":true}]', {
      kind: 'prefab',
      request: async () => {
        fs.writeFileSync(target.filePath, '[{"partial":true}]');
        throw new Error('import failed');
      },
    }),
    /create-asset failed.*import failed.*inspect it in Creator/
  );
  assert.equal(fs.readFileSync(target.filePath, 'utf8'), '[{"partial":true}]');
});

test('a successful save-asset response cannot mask unchanged disk content', async (t) => {
  const target = fixture(t);
  fs.mkdirSync(path.dirname(target.filePath), { recursive: true });
  fs.writeFileSync(target.filePath, '[{"old":true}]');
  let calls = 0;
  await assert.rejects(
    () => persistSerializedAsset(target, '[{"new":true}]', {
      kind: 'prefab', overwrite: true, retries: 0,
      request: async (method) => {
        assert.equal(method, 'save-asset');
        calls += 1;
        return true;
      },
      queryInfo: async () => ({ uuid: 'prefab-uuid', url: target.dbUrl, type: 'cc.Prefab', imported: true }),
    }),
    /saved content differs/
  );
  assert.equal(calls, 2);
  assert.equal(fs.readFileSync(target.filePath, 'utf8'), '[{"old":true}]');
});

test('save-asset retries one verified no-op and reports the retry', async (t) => {
  const target = fixture(t);
  fs.mkdirSync(path.dirname(target.filePath), { recursive: true });
  fs.writeFileSync(target.filePath, '[{"old":true}]');
  let calls = 0;
  const result = await persistSerializedAsset(target, '[{"new":true}]', {
    kind: 'prefab', overwrite: true, retries: 0, retryDelayMs: 0,
    request: async () => {
      calls += 1;
      if (calls === 2) fs.writeFileSync(target.filePath, '[{"new":true}]');
    },
    queryInfo: async () => ({ uuid: 'prefab-uuid', url: target.dbUrl, type: 'cc.Prefab', imported: true }),
  });
  assert.equal(calls, 2);
  assert.equal(result.saveAttempts, 2);
  assert.equal(result.overwritten, true);
});

test('a transient matching file does not count as a persisted overwrite', async (t) => {
  const target = fixture(t);
  fs.mkdirSync(path.dirname(target.filePath), { recursive: true });
  fs.writeFileSync(target.filePath, '[{"old":true}]');
  let calls = 0;
  await assert.rejects(
    () => persistSerializedAsset(target, '[{"new":true}]', {
      kind: 'prefab', overwrite: true, retries: 0, retryDelayMs: 0, settleDelayMs: 30,
      request: async () => {
        calls += 1;
        fs.writeFileSync(target.filePath, '[{"new":true}]');
        setTimeout(() => fs.writeFileSync(target.filePath, '[{"old":true}]'), 5);
      },
      queryInfo: async () => ({ uuid: 'prefab-uuid', url: target.dbUrl, type: 'cc.Prefab', imported: true }),
    }),
    /changed after asset-db initially reported success/
  );
  assert.equal(calls, 2);
  assert.equal(fs.readFileSync(target.filePath, 'utf8'), '[{"old":true}]');
});

test('a written asset without an imported UUID is not reported as persisted', async (t) => {
  const target = fixture(t);
  await assert.rejects(
    () => persistSerializedAsset(target, '[{"new":true}]', {
      kind: 'prefab', retries: 0,
      request: async () => fs.writeFileSync(target.filePath, '[{"new":true}]'),
      queryInfo: async () => null,
    }),
    /matching, fully imported asset/
  );
});

test('an asset still pending import is not reported as persisted', async (t) => {
  const target = fixture(t);
  await assert.rejects(
    () => persistSerializedAsset(target, '[{"new":true}]', {
      kind: 'prefab', retries: 0,
      request: async () => fs.writeFileSync(target.filePath, '[{"new":true}]'),
      queryInfo: async () => ({ uuid: 'prefab-uuid', url: target.dbUrl, type: 'cc.Prefab', imported: false }),
    }),
    /fully imported asset/
  );
});
