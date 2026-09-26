'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { refreshAsset } = require('../lib/asset-refresh');

function fixture(t, options = {}) {
  const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'cocos-mcp-refresh-'));
  const assets = path.join(projectPath, 'assets');
  const library = path.join(projectPath, 'library');
  fs.mkdirSync(assets);
  fs.mkdirSync(library);
  t.after(() => fs.rmSync(projectPath, { recursive: true, force: true }));
  const extension = options.extension || '.json';
  const importer = extension === '.png' ? 'image' : extension === '.mp3' ? 'audio-clip' : extension === '.txt' ? 'text' : 'json';
  const type = extension === '.png' ? 'cc.ImageAsset' : extension === '.mp3' ? 'cc.AudioClip' : extension === '.txt' ? 'cc.TextAsset' : 'cc.JsonAsset';
  const filePath = path.join(assets, `sample${extension}`);
  const metaPath = `${filePath}.meta`;
  const libraryFile = path.join(library, 'imported.json');
  const url = `db://assets/sample${extension}`;
  const uuid = 'refresh-test-uuid';
  const meta = { uuid, importer, userData: { quality: 'normal' }, subMetas: {} };
  const info = { uuid, url, file: filePath, type, importer, imported: true,
    subAssets: options.subAssets || {}, library: { '.json': libraryFile } };
  fs.writeFileSync(filePath, extension === '.png' ? Buffer.from([137, 80, 78, 71]) : '{}');
  if (options.imported !== false) {
    fs.writeFileSync(metaPath, JSON.stringify(meta));
    fs.writeFileSync(libraryFile, '{}');
  }
  const calls = [];
  let imported = options.imported !== false;
  const request = async (method, arg) => {
    calls.push({ method, arg });
    if (method === 'query-ready') return options.ready !== false;
    if (method === 'query-asset-info') return imported && (arg === uuid || arg === url) ? { ...info, ...options.info } : null;
    if (method === 'query-asset-meta') return { ...meta, ...options.metadata };
    if (method === 'refresh-asset') {
      const result = options.onRefresh ? options.onRefresh({ filePath, metaPath, info, meta }) : { queued: true };
      if (!imported) {
        imported = true;
        fs.writeFileSync(metaPath, JSON.stringify(meta));
        fs.writeFileSync(libraryFile, '{}');
      }
      return result;
    }
    throw new Error(`Unexpected asset-db method ${method}`);
  };
  return { projectPath, filePath, metaPath, libraryFile, url, uuid, info, meta, calls, request };
}

test('refresh_asset verifies an existing image and preserves subasset identities', async (t) => {
  const f = fixture(t, { extension: '.png', subAssets: {
    frame: { uuid: 'refresh-test-uuid@frame', type: 'cc.SpriteFrame' },
  } });
  const result = await refreshAsset(f.projectPath, { target: f.url, request: f.request, retries: 0, settleDelayMs: 0 });
  assert.equal(result.refreshed, true);
  assert.equal(result.uuid, f.uuid);
  assert.equal(result.subAssetCount, 1);
  assert.equal(result.newlyImported, false);
  assert.equal(result.verification.stableAfterSettle, true);
  assert.deepEqual(f.calls.filter((call) => call.method === 'refresh-asset'), [{ method: 'refresh-asset', arg: f.url }]);
});

test('refresh_asset recognizes a new file imported by the refresh', async (t) => {
  const f = fixture(t, { imported: false });
  const result = await refreshAsset(f.projectPath, { target: f.url, request: f.request, retries: 0, settleDelayMs: 0 });
  assert.equal(result.newlyImported, true);
  assert.equal(result.importer, 'json');
  assert.equal(result.verification.mainAndSubassetUuidsPreserved, false);
  assert.equal(fs.existsSync(f.metaPath), true);
});

test('refresh_asset observes generated image subassets for a newly discovered file', async (t) => {
  const f = fixture(t, { imported: false, extension: '.png', subAssets: {
    frame: { uuid: 'refresh-test-uuid@frame', type: 'cc.SpriteFrame' },
  } });
  const result = await refreshAsset(f.projectPath, { target: f.url, request: f.request, retries: 0, settleDelayMs: 0 });
  assert.equal(result.newlyImported, true);
  assert.equal(result.subAssetCount, 1);
  assert.equal(result.type, 'cc.ImageAsset');
});

test('refresh_asset supports the Creator audio-clip importer', async (t) => {
  const f = fixture(t, { extension: '.mp3' });
  const result = await refreshAsset(f.projectPath, { target: f.url, request: f.request, retries: 0, settleDelayMs: 0 });
  assert.equal(result.type, 'cc.AudioClip');
  assert.equal(result.importer, 'audio-clip');
});

test('refresh_asset rejects directories, unsupported files, and traversal before native mutation', async (t) => {
  const f = fixture(t);
  await assert.rejects(refreshAsset(f.projectPath, { target: 'assets', request: f.request }), (error) =>
    /refresh_asset supports/.test(error.message) && !/copy_asset/.test(error.message));
  await assert.rejects(refreshAsset(f.projectPath, { target: 'assets/no.scene', request: f.request }), (error) =>
    /refresh_asset supports/.test(error.message) && !/copy_asset/.test(error.message));
  await assert.rejects(refreshAsset(f.projectPath, { target: '../other.json', request: f.request }), /must not contain/);
  assert.equal(f.calls.some((call) => call.method === 'refresh-asset'), false);
});

test('refresh_asset refuses an orphaned sidecar or mismatched imported type before refresh', async (t) => {
  const orphan = fixture(t, { imported: false });
  fs.writeFileSync(orphan.metaPath, JSON.stringify(orphan.meta));
  await assert.rejects(refreshAsset(orphan.projectPath, { target: orphan.url, request: orphan.request }), /orphaned metadata/);
  const wrong = fixture(t, { info: { type: 'cc.Prefab' } });
  await assert.rejects(refreshAsset(wrong.projectPath, { target: wrong.url, request: wrong.request }), /expected writable main asset/);
  assert.equal(orphan.calls.some((call) => call.method === 'refresh-asset'), false);
  assert.equal(wrong.calls.some((call) => call.method === 'refresh-asset'), false);
});

test('refresh_asset reports changed source and uncertain native results without retrying', async (t) => {
  let f;
  f = fixture(t, { onRefresh: () => { fs.writeFileSync(f.filePath, '{"changed":true}'); return true; } });
  await assert.rejects(refreshAsset(f.projectPath, { target: f.url, request: f.request,
    retries: 1, retryDelayMs: 0, settleDelayMs: 0 }), /verification failed: Refresh source changed/);
  assert.equal(f.calls.filter((call) => call.method === 'refresh-asset').length, 1);

  const uncertain = fixture(t, { onRefresh: () => { throw new Error('response lost'); } });
  await assert.rejects(refreshAsset(uncertain.projectPath, { target: uncertain.url, request: uncertain.request }), /inspect the asset before retrying/);
  assert.equal(uncertain.calls.filter((call) => call.method === 'refresh-asset').length, 1);
});

test('refresh_asset rejects an unstable subasset UUID or importer setting', async (t) => {
  const f = fixture(t, { extension: '.png', subAssets: { frame: { uuid: 'refresh-test-uuid@frame', type: 'cc.SpriteFrame' } },
    onRefresh: ({ info }) => { info.subAssets = { frame: { uuid: 'other@frame', type: 'cc.SpriteFrame' } }; return true; } });
  await assert.rejects(refreshAsset(f.projectPath, { target: f.url, request: f.request,
    retries: 0, settleDelayMs: 0 }), /subasset UUIDs or importer settings changed/);
  assert.equal(f.calls.filter((call) => call.method === 'refresh-asset').length, 1);
});

test('refresh_asset rejects busy database before native mutation', async (t) => {
  const f = fixture(t, { ready: false });
  await assert.rejects(refreshAsset(f.projectPath, { target: f.url, request: f.request }), /must be ready/);
  assert.equal(f.calls.some((call) => call.method === 'refresh-asset'), false);
});
