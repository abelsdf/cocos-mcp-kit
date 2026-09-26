'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { MAX_COPY_BYTES } = require('../lib/asset-copy');
const { moveAsset, normalizeMoveTarget } = require('../lib/asset-move');

function fixture(t, options = {}) {
  const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'cocos-mcp-move-asset-'));
  const parentPath = path.join(projectPath, 'assets', 'McpKitValidation');
  fs.mkdirSync(parentPath, { recursive: true });
  t.after(() => fs.rmSync(projectPath, { recursive: true, force: true }));

  const extension = options.extension || '.json';
  const sourceFile = path.join(parentPath, `source${extension}`);
  const sourceUrl = `db://assets/McpKitValidation/source${extension}`;
  const sourceUuid = 'source-main-uuid';
  const importer = options.importer || (extension === '.png' ? 'image' : 'json');
  const type = options.type || (extension === '.png' ? 'cc.ImageAsset' : 'cc.JsonAsset');
  const bytes = options.bytes || Buffer.from('{"move":true}\n', 'utf8');
  const sourceSubAssets = options.sourceSubAssets || {};
  const targetSubAssets = options.targetSubAssets || sourceSubAssets;
  const userData = options.userData || { quality: 'test' };
  const sourceMetadata = {
    uuid: sourceUuid,
    importer,
    userData,
    ...(options.sourceMetadataExtras || {}),
  };
  fs.writeFileSync(sourceFile, bytes);
  fs.writeFileSync(`${sourceFile}.meta`, JSON.stringify({ uuid: sourceUuid, importer, userData }), 'utf8');

  const calls = [];
  let moved = false;
  let targetUrl = '';
  let targetFile = '';
  const makeInfo = (atTarget) => ({
    uuid: atTarget ? (options.targetUuid || sourceUuid) : sourceUuid,
    url: atTarget ? targetUrl : sourceUrl,
    source: atTarget ? targetUrl : sourceUrl,
    file: atTarget ? targetFile : sourceFile,
    type: atTarget ? (options.targetType || type) : (options.sourceType || type),
    importer,
    imported: options.imported === false ? false : true,
    invalid: false,
    readonly: options.readonly === true,
    isDirectory: false,
    subAssets: atTarget ? targetSubAssets : sourceSubAssets,
  });
  const performMove = () => {
    targetFile = path.join(projectPath, targetUrl.slice('db://'.length));
    fs.renameSync(sourceFile, targetFile);
    fs.renameSync(`${sourceFile}.meta`, `${targetFile}.meta`);
    if (options.targetBytes) fs.writeFileSync(targetFile, options.targetBytes);
    if (options.targetDiskMeta) fs.writeFileSync(`${targetFile}.meta`, JSON.stringify(options.targetDiskMeta), 'utf8');
    moved = true;
  };
  const request = async (method, ...args) => {
    calls.push({ method, args });
    if (method === 'query-ready') return options.ready === false ? false : true;
    if (method === 'query-asset-info') {
      const target = args[0];
      if (target === sourceUuid) return moved ? makeInfo(true) : makeInfo(false);
      if (target === sourceUrl) return moved ? null : makeInfo(false);
      if (targetUrl && target === targetUrl) return moved ? makeInfo(true) : (options.existingTarget || null);
      if (!targetUrl && typeof target === 'string' && target.includes('/moved')) return options.existingTarget || null;
      return options.existingTarget || null;
    }
    if (method === 'query-asset-meta') {
      if (args[0] !== sourceUuid && args[0] !== options.targetUuid) return null;
      return moved
        ? { ...sourceMetadata, ...(options.targetMetadataExtras || {}) }
        : sourceMetadata;
    }
    if (method === 'move-asset') {
      assert.equal(args[0], sourceUrl);
      targetUrl = args[1];
      if (options.mutateSourceBeforeMove) fs.appendFileSync(sourceFile, 'changed');
      if (options.moveError && !options.writeBeforeError) throw new Error(options.moveError);
      performMove();
      if (options.moveError) throw new Error(options.moveError);
      return { uuid: sourceUuid, url: targetUrl };
    }
    throw new Error(`Unexpected request: ${method}`);
  };
  return { projectPath, parentPath, sourceFile, sourceUrl, sourceUuid, bytes, calls, request };
}

function moveCalls(f) {
  return f.calls.filter((call) => call.method === 'move-asset');
}

test('move target normalization requires exact project assets and supported extensions', (t) => {
  const f = fixture(t);
  assert.equal(normalizeMoveTarget(f.projectPath, 'McpKitValidation/moved.JSON').dbUrl,
    'db://assets/McpKitValidation/moved.JSON');
  assert.throws(() => normalizeMoveTarget(f.projectPath, 'assets/McpKitValidation/moved.prefab'), /Unsupported target/);
  assert.throws(() => normalizeMoveTarget(f.projectPath, 'assets/McpKitValidation/../moved.json'), /must not contain/);
  assert.throws(() => normalizeMoveTarget(f.projectPath, 'assets/Missing/moved.json'), /parent directory/);
  assert.throws(() => normalizeMoveTarget(f.projectPath, 'db://internal/default.json'), /inside the Cocos assets/);
});

test('moveAsset moves once through asset-db and preserves bytes, metadata, and the main UUID', async (t) => {
  const f = fixture(t);
  const result = await moveAsset(f.projectPath, {
    source: f.sourceUrl,
    target: 'assets/McpKitValidation/moved.json',
    request: f.request,
    retries: 0,
    settleDelayMs: 0,
  });

  assert.equal(result.moved, true);
  assert.equal(result.method, 'asset-db:move-asset');
  assert.equal(result.source.uuid, f.sourceUuid);
  assert.equal(result.target.uuid, f.sourceUuid);
  assert.equal(result.source.sha256, result.target.sha256);
  assert.equal(result.byteLength, f.bytes.length);
  assert.deepEqual(result.verification, {
    sourceRemoved: true,
    targetBytesMatch: true,
    identityPreserved: true,
    subassetIdentitiesPreserved: true,
    metadataSettingsMatch: true,
    imported: true,
    databaseReady: true,
    stableAfterSettle: true,
  });
  assert.match(result.warnings[0], /path-based references/);
  assert.equal(moveCalls(f).length, 1);
  assert.equal(fs.existsSync(f.sourceFile), false);
  assert.equal(fs.readFileSync(path.join(f.parentPath, 'moved.json')).equals(f.bytes), true);
});

test('moveAsset preserves exact image subasset keys, types, and UUIDs', async (t) => {
  const subAssets = {
    spriteFrame: { uuid: 'source-main-uuid@sprite', type: 'cc.SpriteFrame' },
    texture: { uuid: 'source-main-uuid@texture', type: 'cc.Texture2D' },
  };
  const f = fixture(t, {
    extension: '.png',
    bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]),
    sourceSubAssets: subAssets,
    userData: { type: 'sprite-frame', redirect: 'source-main-uuid@texture', trimType: 'auto' },
    sourceMetadataExtras: { displayName: 'source', id: '', name: '' },
    targetMetadataExtras: { displayName: 'moved' },
  });
  const result = await moveAsset(f.projectPath, {
    source: f.sourceUuid,
    target: 'assets/McpKitValidation/moved.png',
    request: f.request,
    retries: 0,
    settleDelayMs: 0,
  });
  assert.equal(result.target.uuid, f.sourceUuid);
  assert.equal(result.subAssetCount, 2);
  assert.equal(result.verification.subassetIdentitiesPreserved, true);
});

test('moveAsset refuses unsupported, subasset, read-only, unimported, and oversized sources before moving', async (t) => {
  for (const options of [
    { sourceType: 'cc.Prefab' },
    { readonly: true },
    { imported: false },
  ]) {
    const f = fixture(t, options);
    await assert.rejects(
      () => moveAsset(f.projectPath, {
        source: f.sourceUrl, target: 'assets/McpKitValidation/moved.json', request: f.request,
      }),
      /Source must be a writable imported/
    );
    assert.equal(moveCalls(f).length, 0);
  }

  const subasset = fixture(t);
  const originalRequest = subasset.request;
  const request = async (method, ...args) => {
    if (method !== 'query-asset-info' || args[0] !== 'source-main-uuid@child') return originalRequest(method, ...args);
    return {
      uuid: 'source-main-uuid@child', url: subasset.sourceUrl, source: subasset.sourceUrl,
      file: subasset.sourceFile, type: 'cc.JsonAsset', importer: 'json', imported: true,
      invalid: false, readonly: false, isDirectory: false,
    };
  };
  await assert.rejects(
    () => moveAsset(subasset.projectPath, {
      source: 'source-main-uuid@child', target: 'assets/McpKitValidation/subasset.json', request,
    }),
    /main asset/
  );

  const large = fixture(t);
  fs.truncateSync(large.sourceFile, MAX_COPY_BYTES + 1);
  await assert.rejects(
    () => moveAsset(large.projectPath, {
      source: large.sourceUrl, target: 'assets/McpKitValidation/large.json', request: large.request,
    }),
    /exceeds/
  );
  assert.equal(moveCalls(subasset).length, 0);
  assert.equal(moveCalls(large).length, 0);
});

test('moveAsset refuses extension, same-path, filesystem, metadata, and asset-db conflicts before moving', async (t) => {
  const mismatch = fixture(t);
  await assert.rejects(
    () => moveAsset(mismatch.projectPath, {
      source: mismatch.sourceUrl, target: 'assets/McpKitValidation/moved.txt', request: mismatch.request,
    }),
    /same file extension/
  );

  const same = fixture(t);
  await assert.rejects(
    () => moveAsset(same.projectPath, {
      source: same.sourceUrl, target: 'assets/McpKitValidation/SOURCE.json', request: same.request,
    }),
    /case-only moves are not supported/
  );

  const existing = fixture(t);
  fs.writeFileSync(path.join(existing.parentPath, 'moved.json'), '{}', 'utf8');
  await assert.rejects(
    () => moveAsset(existing.projectPath, {
      source: existing.sourceUrl, target: 'assets/McpKitValidation/moved.json', request: existing.request,
    }),
    /never overwrites/
  );

  const metadata = fixture(t);
  fs.writeFileSync(path.join(metadata.parentPath, 'moved.json.meta'), '{}', 'utf8');
  await assert.rejects(
    () => moveAsset(metadata.projectPath, {
      source: metadata.sourceUrl, target: 'assets/McpKitValidation/moved.json', request: metadata.request,
    }),
    /never overwrites/
  );

  const dbConflict = fixture(t, { existingTarget: { uuid: 'existing-target' } });
  await assert.rejects(
    () => moveAsset(dbConflict.projectPath, {
      source: dbConflict.sourceUrl, target: 'assets/McpKitValidation/moved.json', request: dbConflict.request,
    }),
    /already contains/
  );
  for (const f of [mismatch, same, existing, metadata, dbConflict]) assert.equal(moveCalls(f).length, 0);
});

test('moveAsset fails closed when readiness, source stability, moved identity, subassets, or settings cannot be proved', async (t) => {
  const notReady = fixture(t, { ready: false });
  await assert.rejects(
    () => moveAsset(notReady.projectPath, {
      source: notReady.sourceUrl, target: 'assets/McpKitValidation/moved.json', request: notReady.request,
    }),
    /must be ready/
  );

  const changed = fixture(t);
  let infoQueries = 0;
  const changedRequest = async (method, ...args) => {
    const result = await changed.request(method, ...args);
    if (method === 'query-asset-info' && args[0] === changed.sourceUuid && ++infoQueries === 1) {
      fs.appendFileSync(changed.sourceFile, 'changed');
    }
    return result;
  };
  await assert.rejects(
    () => moveAsset(changed.projectPath, {
      source: changed.sourceUrl, target: 'assets/McpKitValidation/moved.json', request: changedRequest,
    }),
    /changed before the move request/
  );

  const identity = fixture(t, { targetUuid: 'replacement-uuid' });
  await assert.rejects(
    () => moveAsset(identity.projectPath, {
      source: identity.sourceUrl, target: 'assets/McpKitValidation/moved.json', request: identity.request,
      retries: 0, settleDelayMs: 0,
    }),
    /verification failed: target did not preserve/
  );

  const subassets = fixture(t, {
    sourceSubAssets: { sprite: { uuid: 'source-main-uuid@sprite', type: 'cc.SpriteFrame' } },
    targetSubAssets: { sprite: { uuid: 'changed@sprite', type: 'cc.SpriteFrame' } },
  });
  await assert.rejects(
    () => moveAsset(subassets.projectPath, {
      source: subassets.sourceUrl, target: 'assets/McpKitValidation/moved.json', request: subassets.request,
      retries: 0, settleDelayMs: 0,
    }),
    /verification failed: target subasset/
  );

  const settings = fixture(t, { targetMetadataExtras: { userData: { changed: true } } });
  await assert.rejects(
    () => moveAsset(settings.projectPath, {
      source: settings.sourceUrl, target: 'assets/McpKitValidation/moved.json', request: settings.request,
      retries: 0, settleDelayMs: 0,
    }),
    /verification failed: target metadata UUID\/importer\/settings/
  );

  assert.equal(moveCalls(notReady).length, 0);
  assert.equal(moveCalls(changed).length, 0);
  assert.equal(moveCalls(identity).length, 1);
  assert.equal(moveCalls(subassets).length, 1);
  assert.equal(moveCalls(settings).length, 1);
});

test('moveAsset never retries an uncertain native move and tells callers to inspect both paths', async (t) => {
  const f = fixture(t, { moveError: 'native response lost', writeBeforeError: true });
  await assert.rejects(
    () => moveAsset(f.projectPath, {
      source: f.sourceUrl,
      target: 'assets/McpKitValidation/moved.json',
      request: f.request,
    }),
    /state changed; inspect both exact paths before retrying/
  );
  assert.equal(moveCalls(f).length, 1);
  assert.equal(fs.existsSync(f.sourceFile), false);
  assert.equal(fs.existsSync(path.join(f.parentPath, 'moved.json')), true);
});
