'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { checkAssetReady, normalizeTarget } = require('../lib/asset-readiness');

function clock() {
  let time = 0;
  return { now: () => time, sleep: async (ms) => { time += ms; } };
}

const ASSET = { uuid: 'asset-123', url: 'db://assets/example.png',
  type: 'cc.ImageAsset', importer: 'image', imported: true, invalid: false };

test('asset readiness needs two stable database and identity observations', async () => {
  const calls = [];
  const result = await checkAssetReady({
    target: 'assets/example.png', waitMs: 100, pollMs: 10, ...clock(),
    request: async (method, target) => {
      calls.push([method, target]);
      return method === 'query-ready' ? true : ASSET;
    },
  });
  assert.equal(result.ready, true);
  assert.equal(result.scope, 'asset_db_record');
  assert.equal(result.attempts, 2);
  assert.equal(result.asset.uuid, ASSET.uuid);
  assert.equal(calls.filter(([method]) => method === 'query-asset-info').length, 6);
});

test('database busy becomes ready only after two consecutive true reads', async () => {
  let readyCalls = 0;
  const result = await checkAssetReady({ waitMs: 100, pollMs: 10, ...clock(),
    request: async (method) => {
      assert.equal(method, 'query-ready');
      readyCalls += 1;
      return readyCalls !== 1;
    },
  });
  assert.equal(result.ready, true);
  assert.equal(result.attempts, 3);
  assert.equal(result.scope, 'asset_db_query');
});

test('missing and importing assets never report ready after bounded waiting', async () => {
  for (const [info, expected] of [[null, 'missing'],
    [{ ...ASSET, imported: false }, 'importing']]) {
    const result = await checkAssetReady({ target: ASSET.uuid, waitMs: 20, pollMs: 10,
      ...clock(), request: async (method) => method === 'query-ready' ? true : info });
    assert.equal(result.ready, false);
    assert.equal(result.status, expected);
    assert.equal(result.timedOut, true);
    assert.equal(result.attempts, 3);
  }
});

test('identity mismatch and a ready-to-busy transition are not completion', async () => {
  const mismatch = await checkAssetReady({ target: ASSET.uuid, waitMs: 0,
    request: async (method) => method === 'query-ready' ? true : { ...ASSET, uuid: 'other' } });
  assert.equal(mismatch.status, 'identity_mismatch');
  assert.equal(mismatch.ready, false);

  let readyCalls = 0;
  const busy = await checkAssetReady({ target: ASSET.uuid, waitMs: 0,
    request: async (method) => method === 'query-ready'
      ? (++readyCalls === 1) : ASSET });
  assert.equal(busy.status, 'database_busy');
  assert.equal(busy.ready, false);
});

test('one-shot observation and changed identities are unconfirmed', async () => {
  const once = await checkAssetReady({ waitMs: 0,
    request: async () => true });
  assert.equal(once.ready, false);
  assert.equal(once.status, 'unconfirmed');

  let index = 0;
  const changed = await checkAssetReady({ target: ASSET.uuid, waitMs: 20, pollMs: 10,
    ...clock(), request: async (method, target) => {
      if (method === 'query-ready') return true;
      if (target === ASSET.uuid) index += 1;
      return { ...ASSET, type: index % 2 ? 'cc.ImageAsset' : 'cc.Texture2D' };
    } });
  assert.equal(changed.ready, false);
});

test('readiness rejects invalid targets and polling bounds before querying', async () => {
  for (const target of ['../assets/x', 'C:/project/assets/x', 'db://assets/../x',
    'db://other/x', 'db://assets/', 'file:///x', '', null]) {
    assert.throws(() => normalizeTarget(target));
  }
  for (const options of [{ waitMs: -1 }, { waitMs: 10001 },
    { waitMs: 10, pollMs: 0 }, { pollMs: 2001 }]) {
    await assert.rejects(checkAssetReady(options));
  }
});

test('native query failures remain explicit errors', async () => {
  await assert.rejects(checkAssetReady({ waitMs: 0,
    request: async () => { throw new Error('IPC closed'); } }), /IPC closed/);
});

test('a hung native query is bounded and cannot report ready', async () => {
  const result = await checkAssetReady({ waitMs: 0,
    request: () => new Promise(() => {}) });
  assert.equal(result.ready, false);
  assert.equal(result.status, 'query_timeout');
  assert.equal(result.timedOut, true);
});
