'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { MAX_ASSET_BYTES } = require('../lib/asset-creation');
const { normalizeExpectedSha256, saveAsset, unsupportedSaveMessage } = require('../lib/asset-save');

function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function fixture(t, options = {}) {
  const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'cocos-mcp-save-asset-'));
  const parentPath = path.join(projectPath, 'assets', 'McpKitValidation');
  fs.mkdirSync(parentPath, { recursive: true });
  t.after(() => fs.rmSync(projectPath, { recursive: true, force: true }));

  const extension = options.extension || '.json';
  const sourceFile = path.join(parentPath, `source${extension}`);
  const sourceUrl = `db://assets/McpKitValidation/source${extension}`;
  const uuid = options.uuid || 'save-main-uuid';
  const importer = options.importer || (extension === '.txt' ? 'text' : 'json');
  const type = options.type || (extension === '.txt' ? 'cc.TextAsset' : 'cc.JsonAsset');
  const content = options.content === undefined
    ? (extension === '.txt' ? 'before text\n' : '{"before":true}\n')
    : options.content;
  const diskMetadata = options.diskMetadata || { uuid, importer, userData: { verified: true } };
  const databaseMetadata = options.databaseMetadata || { ...diskMetadata };
  fs.writeFileSync(sourceFile, content, 'utf8');
  fs.writeFileSync(`${sourceFile}.meta`, JSON.stringify(diskMetadata), 'utf8');

  const calls = [];
  const info = {
    uuid,
    url: sourceUrl,
    source: sourceUrl,
    file: sourceFile,
    type,
    importer,
    imported: options.imported !== false,
    invalid: options.invalid === true,
    readonly: options.readonly === true,
    isDirectory: options.isDirectory === true,
    subAssets: options.subAssets || {},
  };
  const request = async (method, ...args) => {
    calls.push({ method, args });
    if (method === 'query-ready') return options.ready !== false;
    if (method === 'query-asset-info') {
      if (args[0] === uuid || args[0] === sourceUrl) return { ...info };
      return null;
    }
    if (method === 'query-asset-meta') return { ...databaseMetadata };
    if (method === 'save-asset') {
      assert.equal(args[0], sourceUrl);
      if (options.saveErrorBeforeWrite) throw new Error(options.saveErrorBeforeWrite);
      fs.writeFileSync(sourceFile, options.savedContent === undefined ? args[1] : options.savedContent, 'utf8');
      if (options.savedMetadata) {
        fs.writeFileSync(`${sourceFile}.meta`, JSON.stringify(options.savedMetadata), 'utf8');
      }
      if (options.saveErrorAfterWrite) throw new Error(options.saveErrorAfterWrite);
      return { saved: true };
    }
    throw new Error(`Unexpected request: ${method}`);
  };
  return { projectPath, sourceFile, sourceUrl, uuid, info, content, calls, request };
}

function saveCalls(f) {
  return f.calls.filter((call) => call.method === 'save-asset');
}

test('saveAsset saves JSON once and verifies exact content, identity, metadata, and settled import state', async (t) => {
  const f = fixture(t);
  const content = '{"after":true,"op":"072"}\n';
  const result = await saveAsset(f.projectPath, {
    target: f.uuid,
    content,
    expectedSha256: digest(f.content),
    request: f.request,
    retries: 0,
    settleDelayMs: 0,
  });

  assert.equal(result.saved, true);
  assert.equal(result.unchanged, false);
  assert.equal(result.method, 'asset-db:save-asset');
  assert.equal(result.uuid, f.uuid);
  assert.equal(result.previousSha256, digest(f.content));
  assert.equal(result.sha256, digest(content));
  assert.deepEqual(result.verification, {
    sourceMatches: true,
    identityPreserved: true,
    metadataPreserved: true,
    imported: true,
    databaseReady: true,
    stableAfterSettle: true,
  });
  assert.equal(saveCalls(f).length, 1);
  assert.equal(fs.readFileSync(f.sourceFile, 'utf8'), content);
});

test('saveAsset supports text and returns a verified no-op without requesting a native save', async (t) => {
  const f = fixture(t, { extension: '.txt' });
  const result = await saveAsset(f.projectPath, {
    target: f.sourceUrl,
    content: f.content,
    request: f.request,
    settleDelayMs: 0,
  });

  assert.equal(result.saved, false);
  assert.equal(result.unchanged, true);
  assert.equal(result.method, 'none');
  assert.equal(result.type, 'cc.TextAsset');
  assert.equal(saveCalls(f).length, 0);
});

test('saveAsset validates optimistic SHA-256 conflicts and replacement content before mutation', async (t) => {
  const conflict = fixture(t);
  await assert.rejects(
    () => saveAsset(conflict.projectPath, {
      target: conflict.sourceUrl,
      content: '{"after":true}',
      expectedSha256: '0'.repeat(64),
      request: conflict.request,
    }),
    /SHA-256 conflict.*No save was requested/
  );
  assert.equal(saveCalls(conflict).length, 0);

  assert.throws(() => normalizeExpectedSha256('not-a-hash'), /64-character hexadecimal/);
  const invalid = fixture(t);
  await assert.rejects(
    () => saveAsset(invalid.projectPath, {
      target: invalid.uuid, content: '{broken', request: invalid.request,
    }),
    /not valid JSON/
  );
  assert.equal(saveCalls(invalid).length, 0);

  const oversized = fixture(t, { extension: '.txt' });
  await assert.rejects(
    () => saveAsset(oversized.projectPath, {
      target: oversized.uuid, content: 'a'.repeat(MAX_ASSET_BYTES + 1), request: oversized.request,
    }),
    /exceeds/
  );
  assert.equal(saveCalls(oversized).length, 0);
});

test('saveAsset gives type-specific guidance and rejects subassets, directories, and unsupported resources', async (t) => {
  const cases = [
    { type: 'cc.SceneAsset', message: /save_current_scene/ },
    { type: 'cc.Prefab', message: /save_prefab_edit_mode/ },
    { type: 'cc.AnimationClip', message: /OP-209/ },
    { type: 'cc.Script', message: /script\/file tools/ },
    { type: 'cc.ImageAsset', message: /import\/reimport/ },
    { type: 'cc.AudioClip', message: /import\/reimport/ },
  ];
  for (const item of cases) {
    const f = fixture(t, { type: item.type });
    await assert.rejects(
      () => saveAsset(f.projectPath, { target: f.uuid, content: '{}', request: f.request }),
      item.message
    );
    assert.equal(saveCalls(f).length, 0);
  }

  const subasset = fixture(t, { uuid: 'save-main-uuid@child' });
  await assert.rejects(
    () => saveAsset(subasset.projectPath, { target: subasset.uuid, content: '{}', request: subasset.request }),
    /main asset/
  );
  const directory = fixture(t, { isDirectory: true });
  await assert.rejects(
    () => saveAsset(directory.projectPath, { target: directory.uuid, content: '{}', request: directory.request }),
    /does not save directories/
  );
  assert.match(unsupportedSaveMessage({ type: 'cc.Material' }), /type-specific workflow/);
});

test('saveAsset rejects untrusted identity, metadata, import state, and oversized existing sources', async (t) => {
  for (const options of [{ readonly: true }, { imported: false }, { invalid: true }, {
    diskMetadata: { uuid: 'wrong-uuid', importer: 'json' },
  }]) {
    const f = fixture(t, options);
    await assert.rejects(
      () => saveAsset(f.projectPath, { target: f.uuid, content: '{"after":true}', request: f.request }),
      /writable, fully imported|metadata UUID\/importer/
    );
    assert.equal(saveCalls(f).length, 0);
  }

  const large = fixture(t, { extension: '.txt', content: '' });
  fs.truncateSync(large.sourceFile, MAX_ASSET_BYTES + 1);
  await assert.rejects(
    () => saveAsset(large.projectPath, {
      target: large.uuid, content: 'small', request: large.request,
    }),
    /Existing asset exceeds/
  );
  assert.equal(saveCalls(large).length, 0);
});

test('saveAsset detects source races during preflight and does not request a save', async (t) => {
  const f = fixture(t);
  let uuidQueries = 0;
  const request = async (method, ...args) => {
    const result = await f.request(method, ...args);
    if (method === 'query-asset-info' && args[0] === f.uuid && ++uuidQueries === 2) {
      fs.appendFileSync(f.sourceFile, 'changed-before-save');
    }
    return result;
  };
  await assert.rejects(
    () => saveAsset(f.projectPath, {
      target: f.uuid, content: '{"after":true}', request,
    }),
    /changed during save preflight.*No save was requested/
  );
  assert.equal(saveCalls(f).length, 0);
});

test('saveAsset never repeats an uncertain native save or a failed post-save verification', async (t) => {
  const native = fixture(t, { saveErrorAfterWrite: 'native response lost' });
  await assert.rejects(
    () => saveAsset(native.projectPath, {
      target: native.uuid, content: '{"after":true}', request: native.request,
    }),
    /source may already have changed; inspect.*before retrying/
  );
  assert.equal(saveCalls(native).length, 1);

  const mismatch = fixture(t, { savedContent: '{"wrong":true}' });
  await assert.rejects(
    () => saveAsset(mismatch.projectPath, {
      target: mismatch.uuid,
      content: '{"after":true}',
      request: mismatch.request,
      retries: 0,
      settleDelayMs: 0,
    }),
    /verification failed: Saved source content differs.*No second save was requested/
  );
  assert.equal(saveCalls(mismatch).length, 1);
});
