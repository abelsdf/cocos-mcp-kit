'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  MAX_COPY_BYTES,
  copyAsset,
  normalizeCopySourceTarget,
  normalizeCopyTarget,
  subAssetIdentities,
} = require('../lib/asset-copy');

function fixture(t, options = {}) {
  const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'cocos-mcp-copy-asset-'));
  const parentPath = path.join(projectPath, 'assets', 'McpKitValidation');
  fs.mkdirSync(parentPath, { recursive: true });
  t.after(() => fs.rmSync(projectPath, { recursive: true, force: true }));

  const extension = options.extension || '.json';
  const sourceFile = path.join(parentPath, `source${extension}`);
  const sourceUrl = `db://assets/McpKitValidation/source${extension}`;
  const sourceUuid = 'source-main-uuid';
  const targetUuid = 'target-main-uuid';
  const importer = options.importer || (extension === '.png' ? 'image' : 'json');
  const type = options.type || (extension === '.png' ? 'cc.ImageAsset' : 'cc.JsonAsset');
  const bytes = options.bytes || Buffer.from('{"copy":true}\n', 'utf8');
  const sourceSubAssets = options.sourceSubAssets || {};
  const targetSubAssets = options.targetSubAssets || {};
  const userData = options.userData || { quality: 'test' };
  fs.writeFileSync(sourceFile, bytes);
  fs.writeFileSync(`${sourceFile}.meta`, JSON.stringify({ uuid: sourceUuid, importer, userData }), 'utf8');

  const calls = [];
  let copied = false;
  let targetUrl = '';
  const request = async (method, ...args) => {
    calls.push({ method, args });
    if (method === 'query-ready') return options.ready === false ? false : true;
    if (method === 'query-asset-info') {
      const target = args[0];
      if (target === sourceUrl || target === sourceUuid) {
        return {
          uuid: sourceUuid, url: sourceUrl, source: sourceUrl, file: sourceFile,
          type: options.sourceType || type, importer, imported: options.imported === false ? false : true,
          invalid: false, readonly: options.readonly === true, isDirectory: false,
          subAssets: sourceSubAssets,
        };
      }
      if (target === targetUrl && copied) {
        return {
          uuid: targetUuid, url: targetUrl, source: targetUrl,
          file: path.join(projectPath, targetUrl.slice('db://'.length)),
          type, importer, imported: true, invalid: false, readonly: false, isDirectory: false,
          subAssets: targetSubAssets,
        };
      }
      return options.existingTarget || null;
    }
    if (method === 'query-asset-meta') {
      if (args[0] === sourceUuid) return { uuid: sourceUuid, importer, userData, ...(options.sourceMetadataExtras || {}) };
      if (args[0] === targetUuid) return { uuid: targetUuid, importer, userData: options.targetUserData || userData, ...(options.targetMetadataExtras || {}) };
      return null;
    }
    if (method === 'copy-asset') {
      if (options.copyError) throw new Error(options.copyError);
      assert.equal(args[0], sourceUrl);
      targetUrl = args[1];
      const targetFile = path.join(projectPath, targetUrl.slice('db://'.length));
      fs.writeFileSync(targetFile, options.targetBytes || bytes);
      fs.writeFileSync(`${targetFile}.meta`, JSON.stringify({ uuid: targetUuid, importer, userData }), 'utf8');
      copied = true;
      return { uuid: targetUuid, url: targetUrl };
    }
    throw new Error(`Unexpected request: ${method}`);
  };
  return { projectPath, parentPath, sourceFile, sourceUrl, sourceUuid, targetUuid, bytes, calls, request };
}

test('copy target normalization requires exact project assets and supported extensions', (t) => {
  const f = fixture(t);
  assert.equal(normalizeCopySourceTarget(f.projectPath, 'assets/McpKitValidation/source.json'), f.sourceUrl);
  assert.equal(normalizeCopySourceTarget(f.projectPath, f.sourceUuid), f.sourceUuid);
  assert.equal(normalizeCopyTarget(f.projectPath, 'McpKitValidation/target.JSON').dbUrl,
    'db://assets/McpKitValidation/target.JSON');
  assert.throws(() => normalizeCopySourceTarget(f.projectPath, 'db://internal/default.json'), /project asset/);
  assert.throws(() => normalizeCopyTarget(f.projectPath, 'assets/McpKitValidation/target.prefab'), /Unsupported target/);
  assert.throws(() => normalizeCopyTarget(f.projectPath, 'assets/McpKitValidation/../target.json'), /must not contain/);
  assert.throws(() => normalizeCopyTarget(f.projectPath, 'assets/Missing/target.json'), /parent directory/);
});

test('copyAsset copies source bytes through asset-db and preserves settings with a new UUID', async (t) => {
  const f = fixture(t);
  const result = await copyAsset(f.projectPath, {
    source: f.sourceUrl,
    target: 'assets/McpKitValidation/copied.json',
    request: f.request,
    retries: 0,
    settleDelayMs: 0,
  });

  assert.equal(result.copied, true);
  assert.equal(result.method, 'asset-db:copy-asset');
  assert.equal(result.source.uuid, f.sourceUuid);
  assert.equal(result.target.uuid, f.targetUuid);
  assert.notEqual(result.source.uuid, result.target.uuid);
  assert.equal(result.source.sha256, result.target.sha256);
  assert.equal(result.byteLength, f.bytes.length);
  assert.deepEqual(result.verification, {
    sourceUnchanged: true,
    targetBytesMatch: true,
    metadataSettingsMatch: true,
    distinctMainUuid: true,
    distinctSubassetUuids: true,
    imported: true,
    databaseReady: true,
    stableAfterSettle: true,
  });
  assert.equal(f.calls.filter((call) => call.method === 'copy-asset').length, 1);
  assert.equal(fs.readFileSync(f.sourceFile).equals(f.bytes), true);
});

test('copyAsset gives imported image subassets distinct UUIDs while preserving their keys and types', async (t) => {
  const sourceSubAssets = {
    spriteFrame: { uuid: 'source-main-uuid@sprite', type: 'cc.SpriteFrame' },
    texture: { uuid: 'source-main-uuid@texture', type: 'cc.Texture2D' },
  };
  const targetSubAssets = {
    spriteFrame: { uuid: 'target-main-uuid@sprite', type: 'cc.SpriteFrame' },
    texture: { uuid: 'target-main-uuid@texture', type: 'cc.Texture2D' },
  };
  const f = fixture(t, {
    extension: '.png',
    bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]),
    sourceSubAssets,
    targetSubAssets,
    userData: { type: 'sprite-frame', redirect: 'source-main-uuid@texture', trimType: 'auto' },
    targetUserData: { type: 'sprite-frame', redirect: 'target-main-uuid@texture', trimType: 'auto' },
    sourceMetadataExtras: { displayName: 'source', id: '', name: '' },
  });
  const result = await copyAsset(f.projectPath, {
    source: f.sourceUuid,
    target: 'assets/McpKitValidation/copied.png',
    request: f.request,
    retries: 0,
    settleDelayMs: 0,
  });
  assert.equal(result.subAssetCount, 2);
  assert.deepEqual(subAssetIdentities({ subAssets: targetSubAssets }).map((item) => item.uuid), [
    'target-main-uuid@sprite',
    'target-main-uuid@texture',
  ]);
});

test('copyAsset refuses unsupported, subasset, read-only, missing, and oversized sources before copying', async (t) => {
  for (const options of [
    { sourceType: 'cc.Prefab' },
    { readonly: true },
    { imported: false },
  ]) {
    const f = fixture(t, options);
    await assert.rejects(
      () => copyAsset(f.projectPath, {
        source: f.sourceUrl, target: 'assets/McpKitValidation/blocked.json', request: f.request,
      }),
      /Source must be a writable imported/
    );
    assert.equal(f.calls.some((call) => call.method === 'copy-asset'), false);
  }

  const subasset = fixture(t);
  const request = async (method, ...args) => {
    if (method === 'query-ready') return true;
    if (method === 'query-asset-info') return {
      uuid: 'source-main-uuid@child', url: subasset.sourceUrl, source: subasset.sourceUrl,
      file: subasset.sourceFile, type: 'cc.JsonAsset', importer: 'json', imported: true,
      invalid: false, readonly: false, isDirectory: false,
    };
    throw new Error(`Unexpected request: ${method} ${args}`);
  };
  await assert.rejects(
    () => copyAsset(subasset.projectPath, {
      source: 'source-main-uuid@child', target: 'assets/McpKitValidation/subasset.json', request,
    }),
    /main asset/
  );

  const large = fixture(t);
  fs.truncateSync(large.sourceFile, MAX_COPY_BYTES + 1);
  await assert.rejects(
    () => copyAsset(large.projectPath, {
      source: large.sourceUrl, target: 'assets/McpKitValidation/large.json', request: large.request,
    }),
    /exceeds/
  );
});

test('copyAsset refuses extension changes and every target conflict without copying', async (t) => {
  const mismatch = fixture(t);
  await assert.rejects(
    () => copyAsset(mismatch.projectPath, {
      source: mismatch.sourceUrl, target: 'assets/McpKitValidation/copied.txt', request: mismatch.request,
    }),
    /same file extension/
  );

  const existing = fixture(t);
  fs.writeFileSync(path.join(existing.parentPath, 'copied.json'), '{}', 'utf8');
  await assert.rejects(
    () => copyAsset(existing.projectPath, {
      source: existing.sourceUrl, target: 'assets/McpKitValidation/copied.json', request: existing.request,
    }),
    /never overwrites/
  );

  const dbConflict = fixture(t, { existingTarget: { uuid: 'existing-target' } });
  await assert.rejects(
    () => copyAsset(dbConflict.projectPath, {
      source: dbConflict.sourceUrl, target: 'assets/McpKitValidation/copied.json', request: dbConflict.request,
    }),
    /already contains/
  );
  assert.equal(mismatch.calls.some((call) => call.method === 'copy-asset'), false);
  assert.equal(existing.calls.some((call) => call.method === 'copy-asset'), false);
  assert.equal(dbConflict.calls.some((call) => call.method === 'copy-asset'), false);
});

test('copyAsset fails closed for readiness, metadata mismatch, and uncertain native writes', async (t) => {
  const notReady = fixture(t, { ready: false });
  await assert.rejects(
    () => copyAsset(notReady.projectPath, {
      source: notReady.sourceUrl, target: 'assets/McpKitValidation/not-ready.json', request: notReady.request,
    }),
    /must be ready/
  );

  const settings = fixture(t, { targetUserData: { changed: true } });
  await assert.rejects(
    () => copyAsset(settings.projectPath, {
      source: settings.sourceUrl, target: 'assets/McpKitValidation/settings.json', request: settings.request,
      retries: 0, settleDelayMs: 0,
    }),
    /verification failed: target metadata UUID\/importer\/settings/
  );

  const uncertain = fixture(t, { copyError: 'native response lost' });
  const originalRequest = uncertain.request;
  const request = async (method, ...args) => {
    if (method !== 'copy-asset') return originalRequest(method, ...args);
    const targetFile = path.join(uncertain.projectPath, args[1].slice('db://'.length));
    fs.writeFileSync(targetFile, uncertain.bytes);
    throw new Error('native response lost');
  };
  await assert.rejects(
    () => copyAsset(uncertain.projectPath, {
      source: uncertain.sourceUrl, target: 'assets/McpKitValidation/uncertain.json', request,
    }),
    /Files now exist at the target; inspect them before retrying/
  );
});
