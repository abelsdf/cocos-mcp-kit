'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { reimportAsset } = require('../lib/asset-reimport');

function fixture(t, overrides = {}) {
  const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'cocos-mcp-reimport-'));
  const assets = path.join(projectPath, 'assets');
  fs.mkdirSync(assets);
  const libraryDirectory = path.join(projectPath, 'library');
  fs.mkdirSync(libraryDirectory);
  t.after(() => fs.rmSync(projectPath, { recursive: true, force: true }));
  const extension = overrides.extension || '.json';
  const importer = extension === '.png' ? 'image' : extension === '.mp3' ? 'audio-clip' : extension === '.txt' ? 'text' : 'json';
  const type = extension === '.png' ? 'cc.ImageAsset' : extension === '.mp3' ? 'cc.AudioClip' : extension === '.txt' ? 'cc.TextAsset' : 'cc.JsonAsset';
  const filePath = path.join(assets, `test${extension}`);
  const metaPath = `${filePath}.meta`;
  const libraryFile = path.join(libraryDirectory, 'imported.json');
  const url = `db://assets/test${extension}`;
  const uuid = 'reimport-test-uuid';
  const meta = { uuid, importer, userData: { test: true } };
  fs.writeFileSync(filePath, extension === '.png' ? Buffer.from([137, 80, 78, 71]) : '{}');
  fs.writeFileSync(metaPath, JSON.stringify(meta));
  fs.writeFileSync(libraryFile, '{}');
  const info = { uuid, url, file: filePath, type, importer, imported: true, subAssets: overrides.subAssets || {}, library: { '.json': libraryFile } };
  const calls = [];
  const request = async (method, value) => {
    calls.push({ method, value });
    if (method === 'query-ready') return overrides.ready !== false;
    if (method === 'query-asset-info') return value === uuid || value === url ? { ...info, ...overrides.info } : null;
    if (method === 'query-asset-meta') return { ...meta, ...overrides.metadata };
    if (method === 'reimport-asset') {
      if (overrides.onReimport) return overrides.onReimport({ filePath, metaPath, info, meta });
      const next = new Date(Date.now() + 1000);
      fs.utimesSync(libraryFile, next, next);
      return { queued: true };
    }
    throw new Error(`Unexpected request ${method}`);
  };
  return { projectPath, filePath, metaPath, libraryFile, url, uuid, calls, request };
}

test('reimport_asset calls asset-db once and verifies a settled main asset', async (t) => {
  const f = fixture(t, { extension: '.png', subAssets: { spriteFrame: { uuid: 'reimport-test-uuid@frame', type: 'cc.SpriteFrame' } } });
  const result = await reimportAsset(f.projectPath, { target: f.url, request: f.request, retries: 0, settleDelayMs: 0 });
  assert.equal(result.reimported, true);
  assert.equal(result.uuid, f.uuid);
  assert.equal(result.subAssetCount, 1);
  assert.deepEqual(result.verification, {
    sourceUnchanged: true,
    mainAndSubassetUuidsPreserved: true,
    importSettingsPreserved: true,
    imported: true,
    databaseReady: true,
    libraryRegenerated: true,
    stableAfterSettle: true,
  });
  assert.deepEqual(f.calls.filter((call) => call.method === 'reimport-asset'), [{ method: 'reimport-asset', value: f.url }]);
});

test('reimport_asset accepts the Creator audio-clip importer for MP3', async (t) => {
  const f = fixture(t, { extension: '.mp3' });
  const result = await reimportAsset(f.projectPath, { target: f.uuid, request: f.request, retries: 0, settleDelayMs: 0 });
  assert.equal(result.reimported, true);
  assert.equal(result.type, 'cc.AudioClip');
  assert.equal(result.importer, 'audio-clip');
});

test('reimport_asset rejects unsupported types before native mutation', async (t) => {
  const f = fixture(t, { info: { type: 'cc.Prefab' } });
  await assert.rejects(reimportAsset(f.projectPath, { target: f.uuid, request: f.request }), /writable, fully imported/);
  assert.equal(f.calls.some((call) => call.method === 'reimport-asset'), false);
});

test('reimport_asset rejects a type/importer mismatch before native mutation', async (t) => {
  const f = fixture(t, { info: { type: 'cc.ImageAsset', importer: 'image' } });
  await assert.rejects(reimportAsset(f.projectPath, { target: f.url, request: f.request }), /type\/importer does not match/);
  assert.equal(f.calls.some((call) => call.method === 'reimport-asset'), false);
});

test('reimport_asset rejects modified import settings after native request without retrying it', async (t) => {
  let f;
  f = fixture(t, { onReimport: () => {
    fs.writeFileSync(f.metaPath, JSON.stringify({ uuid: f.uuid, importer: 'json', userData: { test: false } }));
    return true;
  } });
  await assert.rejects(reimportAsset(f.projectPath, { target: f.url, request: f.request, retries: 1, retryDelayMs: 0, settleDelayMs: 0 }), /verification failed: Source, import settings/);
  assert.equal(f.calls.filter((call) => call.method === 'reimport-asset').length, 1);
});

test('reimport_asset rejects changed subasset identities after reimport', async (t) => {
  const f = fixture(t, { extension: '.png', subAssets: { frame: { uuid: 'original@frame', type: 'cc.SpriteFrame' } },
    onReimport: ({ info }) => { info.subAssets = { frame: { uuid: 'different@frame', type: 'cc.SpriteFrame' } }; return true; } });
  await assert.rejects(reimportAsset(f.projectPath, { target: f.url, request: f.request, retries: 0, settleDelayMs: 0 }), /subasset identity changed/);
});

test('reimport_asset rejects a native no-op that never regenerated library files', async (t) => {
  const f = fixture(t, { onReimport: () => undefined });
  await assert.rejects(reimportAsset(f.projectPath, { target: f.url, request: f.request, retries: 0, settleDelayMs: 0 }), /library outputs have not been regenerated/);
  assert.equal(f.calls.filter((call) => call.method === 'reimport-asset').length, 1);
});

test('reimport_asset never repeats an uncertain native call', async (t) => {
  const f = fixture(t, { onReimport: () => { throw new Error('native result unknown'); } });
  await assert.rejects(reimportAsset(f.projectPath, { target: f.url, request: f.request, retries: 3, retryDelayMs: 0 }), /inspect the asset before retrying/);
  assert.equal(f.calls.filter((call) => call.method === 'reimport-asset').length, 1);
});

test('reimport_asset refuses a busy asset database before mutation', async (t) => {
  const f = fixture(t, { ready: false });
  await assert.rejects(reimportAsset(f.projectPath, { target: f.url, request: f.request }), /must be ready/);
  assert.equal(f.calls.some((call) => call.method === 'reimport-asset'), false);
});

test('reimport_asset rejects changed nested subasset importer settings', async (t) => {
  const f = fixture(t, { extension: '.png', onReimport: ({ meta }) => {
    fs.writeFileSync(f.metaPath, JSON.stringify({ ...meta, subMetas: {
      frame: { uuid: `${f.uuid}@frame`, importer: 'sprite-frame', userData: { trimType: 'changed' } },
    } }));
    return true;
  } });
  await assert.rejects(reimportAsset(f.projectPath, { target: f.url, request: f.request, retries: 0, settleDelayMs: 0 }), /import settings/);
});

test('reimport_asset rejects a symlinked source before native mutation', async (t) => {
  const f = fixture(t);
  const actual = `${f.filePath}.actual`;
  fs.renameSync(f.filePath, actual);
  try { fs.symlinkSync(actual, f.filePath); } catch (error) {
    if (error.code === 'EPERM') return;
    throw error;
  }
  await assert.rejects(reimportAsset(f.projectPath, { target: f.url, request: f.request }), /regular file/);
  assert.equal(f.calls.some((call) => call.method === 'reimport-asset'), false);
});
