'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { importAsset, normalizeImportSource } = require('../lib/asset-import');

const digest = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cocos-mcp-import-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const projectPath = path.join(root, 'project');
  const sourceDirectory = path.join(root, 'external');
  const assetsDirectory = path.join(projectPath, 'assets');
  const libraryDirectory = path.join(projectPath, 'library');
  fs.mkdirSync(sourceDirectory);
  fs.mkdirSync(assetsDirectory, { recursive: true });
  fs.mkdirSync(libraryDirectory);
  const extension = options.extension || '.json';
  const source = path.join(sourceDirectory, `origin${extension}`);
  const target = `assets/imported${extension}`;
  const targetUrl = `db://${target}`;
  const targetFile = path.join(projectPath, target);
  const importer = extension === '.png' ? 'image' : extension === '.mp3' ? 'audio-clip' : extension === '.txt' ? 'text' : 'json';
  const type = extension === '.png' ? 'cc.ImageAsset' : extension === '.mp3' ? 'cc.AudioClip' : extension === '.txt' ? 'cc.TextAsset' : 'cc.JsonAsset';
  const bytes = options.bytes || (extension === '.json' ? Buffer.from('{"op":74}') : Buffer.from('test content'));
  fs.writeFileSync(source, bytes);
  const uuid = 'new-import-uuid';
  const libraryFile = path.join(libraryDirectory, 'new-import-uuid.json');
  const metadata = { uuid, importer, userData: { test: true } };
  const subAssets = options.subAssets || {};
  let info = null;
  const calls = [];
  const request = async (method, ...args) => {
    calls.push({ method, args });
    if (method === 'query-ready') return options.ready !== false;
    if (method === 'query-asset-info') return args[0] === targetUrl ? info : null;
    if (method === 'query-asset-meta') return { ...metadata };
    if (method === 'import-asset') {
      assert.deepEqual(args, [source, targetUrl, { overwrite: false, rename: false }]);
      if (options.nativeError) throw new Error(options.nativeError);
      if (!options.nativeNoop) {
        fs.writeFileSync(targetFile, options.writtenBytes || fs.readFileSync(source));
        fs.writeFileSync(`${targetFile}.meta`, JSON.stringify(metadata));
        if (!options.noLibrary) fs.writeFileSync(libraryFile, '{}');
        info = { uuid, url: targetUrl, file: targetFile, type, importer, imported: true,
          subAssets, library: { '.json': libraryFile } };
      }
      return { url: targetUrl, uuid };
    }
    throw new Error(`Unexpected request ${method}`);
  };
  return { projectPath, source, target, targetUrl, targetFile, uuid, bytes, calls, request };
}

test('import_asset imports JSON once and verifies exact source, target identity, metadata and library', async (t) => {
  const f = fixture(t);
  const result = await importAsset(f.projectPath, { source: f.source, target: f.target,
    expectedSha256: digest(f.bytes), request: f.request, retries: 0, settleDelayMs: 0 });
  assert.equal(result.imported, true);
  assert.equal(result.overwritten, false);
  assert.equal(result.target.uuid, f.uuid);
  assert.equal(result.target.type, 'cc.JsonAsset');
  assert.equal(result.source.sha256, digest(f.bytes));
  assert.deepEqual(result.verification, {
    sourceUnchanged: true,
    targetBytesMatch: true,
    metadataMatches: true,
    imported: true,
    databaseReady: true,
    libraryAvailable: true,
    stableAfterSettle: true,
  });
  assert.equal(f.calls.filter((call) => call.method === 'import-asset').length, 1);
  assert.deepEqual(fs.readFileSync(f.targetFile), f.bytes);
});

test('import_asset accepts image subassets and Creator audio-clip importer', async (t) => {
  const image = fixture(t, { extension: '.png', subAssets: { texture: { uuid: 'new-import-uuid@texture', type: 'cc.Texture2D' } } });
  const imageResult = await importAsset(image.projectPath, { source: image.source, target: image.target,
    request: image.request, retries: 0, settleDelayMs: 0 });
  assert.equal(imageResult.target.importer, 'image');
  assert.equal(imageResult.subAssetCount, 1);
  const audio = fixture(t, { extension: '.mp3' });
  const audioResult = await importAsset(audio.projectPath, { source: audio.source, target: audio.target,
    request: audio.request, retries: 0, settleDelayMs: 0 });
  assert.equal(audioResult.target.importer, 'audio-clip');
});

test('import_asset refuses existing target and stale source SHA before native call', async (t) => {
  const f = fixture(t);
  fs.writeFileSync(f.targetFile, 'existing');
  await assert.rejects(importAsset(f.projectPath, { source: f.source, target: f.target, request: f.request }), /never overwrites/);
  fs.rmSync(f.targetFile);
  await assert.rejects(importAsset(f.projectPath, { source: f.source, target: f.target,
    expectedSha256: '0'.repeat(64), request: f.request }), /SHA-256 conflict/);
  assert.equal(f.calls.some((call) => call.method === 'import-asset'), false);
});

test('import_asset refuses unsupported paths, sidecar metadata, and malformed JSON', async (t) => {
  const f = fixture(t);
  await assert.rejects(importAsset(f.projectPath, { source: f.targetFile, target: f.target, request: f.request }), /inside project assets|ENOENT/);
  fs.writeFileSync(`${f.source}.meta`, '{}');
  await assert.rejects(importAsset(f.projectPath, { source: f.source, target: f.target, request: f.request }), /\.meta sidecar/);
  fs.rmSync(`${f.source}.meta`);
  fs.writeFileSync(f.source, '{bad');
  await assert.rejects(importAsset(f.projectPath, { source: f.source, target: f.target, request: f.request }), /JSON source is invalid/);
  assert.equal(f.calls.some((call) => call.method === 'import-asset'), false);
});

test('import_asset never retries an uncertain native error or an incomplete import', async (t) => {
  const errorCase = fixture(t, { nativeError: 'outcome unknown' });
  await assert.rejects(importAsset(errorCase.projectPath, { source: errorCase.source,
    target: errorCase.target, request: errorCase.request, retries: 1, retryDelayMs: 0 }), /No second import was requested/);
  assert.equal(errorCase.calls.filter((call) => call.method === 'import-asset').length, 1);

  const incomplete = fixture(t, { noLibrary: true });
  await assert.rejects(importAsset(incomplete.projectPath, { source: incomplete.source,
    target: incomplete.target, request: incomplete.request, retries: 0, settleDelayMs: 0 }), /verification failed/);
  assert.equal(incomplete.calls.filter((call) => call.method === 'import-asset').length, 1);
});

test('normalizeImportSource rejects a symbolic-link file', (t) => {
  const f = fixture(t);
  const link = path.join(path.dirname(f.source), 'link.json');
  try { fs.symlinkSync(f.source, link); } catch (error) {
    if (error.code === 'EPERM') return;
    throw error;
  }
  assert.throws(() => normalizeImportSource(f.projectPath, link), /regular file/);
});
