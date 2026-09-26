'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  MAX_ASSET_BYTES,
  createAsset,
  normalizeAssetCreationTarget,
  validateAssetContent,
} = require('../lib/asset-creation');

function fixture(t, options = {}) {
  const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'cocos-mcp-create-asset-'));
  const parentPath = path.join(projectPath, 'assets', 'McpKitValidation');
  fs.mkdirSync(parentPath, { recursive: true });
  t.after(() => fs.rmSync(projectPath, { recursive: true, force: true }));

  const calls = [];
  let created = false;
  const uuid = 'created-json-uuid';
  const request = async (method, ...args) => {
    calls.push({ method, args });
    if (method === 'query-ready') return options.ready === false ? false : true;
    if (method === 'query-asset-info') {
      if (options.existingInfo) return options.existingInfo;
      if (!created) return null;
      return {
        uuid,
        url: args[0],
        type: options.type || 'cc.JsonAsset',
        imported: options.imported === false ? false : true,
        invalid: false,
        readonly: false,
        isDirectory: false,
        file: path.join(projectPath, args[0].slice('db://'.length)),
      };
    }
    if (method === 'query-asset-meta') {
      return { uuid, importer: options.importer || 'json' };
    }
    if (method === 'create-asset') {
      if (options.createError) throw new Error(options.createError);
      const filePath = path.join(projectPath, args[0].slice('db://'.length));
      fs.writeFileSync(filePath, args[1], 'utf8');
      fs.writeFileSync(`${filePath}.meta`, JSON.stringify({
        uuid,
        importer: options.diskImporter || options.importer || 'json',
      }), 'utf8');
      created = true;
      return { imported: true };
    }
    throw new Error(`Unexpected request: ${method}`);
  };
  return { projectPath, parentPath, calls, request, uuid };
}

test('normalizeAssetCreationTarget accepts exact project asset paths and only safe initial formats', (t) => {
  const f = fixture(t);
  const target = normalizeAssetCreationTarget(f.projectPath, 'db://assets/McpKitValidation/sample.JSON');
  assert.equal(target.projectRelative, 'assets/McpKitValidation/sample.JSON');
  assert.equal(target.dbUrl, 'db://assets/McpKitValidation/sample.JSON');
  assert.equal(target.expectedType, 'cc.JsonAsset');
  assert.equal(target.expectedImporter, 'json');

  assert.throws(
    () => normalizeAssetCreationTarget(f.projectPath, 'assets/McpKitValidation/sample.prefab'),
    /only \.json and \.txt/
  );
  assert.throws(
    () => normalizeAssetCreationTarget(f.projectPath, 'assets/McpKitValidation/../escape.json'),
    /must not contain/
  );
  assert.throws(
    () => normalizeAssetCreationTarget(f.projectPath, 'assets/Missing/sample.json'),
    /parent directory must already exist/
  );
});

test('validateAssetContent bounds text and requires valid JSON', (t) => {
  const f = fixture(t);
  const jsonTarget = normalizeAssetCreationTarget(f.projectPath, 'assets/McpKitValidation/sample.json');
  const textTarget = normalizeAssetCreationTarget(f.projectPath, 'assets/McpKitValidation/sample.txt');
  assert.equal(validateAssetContent(jsonTarget, '{"ok":true}').byteLength, 11);
  assert.equal(validateAssetContent(textTarget, '').byteLength, 0);
  assert.throws(() => validateAssetContent(jsonTarget, '{broken'), /not valid JSON/);
  assert.throws(() => validateAssetContent(textTarget, 'a\0b'), /NUL bytes/);
  assert.throws(() => validateAssetContent(textTarget, 'a'.repeat(MAX_ASSET_BYTES + 1)), /exceeds/);
});

test('createAsset uses asset-db once and verifies stable source, metadata, UUID, type, and importer', async (t) => {
  const f = fixture(t);
  const content = '{"kind":"op-068","enabled":true}\n';
  const result = await createAsset(f.projectPath, {
    target: 'assets/McpKitValidation/op-068.json',
    content,
    request: f.request,
    retries: 0,
    settleDelayMs: 0,
  });

  assert.equal(result.created, true);
  assert.equal(result.overwritten, false);
  assert.equal(result.method, 'asset-db:create-asset');
  assert.equal(result.uuid, f.uuid);
  assert.equal(result.type, 'cc.JsonAsset');
  assert.equal(result.importer, 'json');
  assert.deepEqual(result.verification, {
    sourceMatches: true,
    metadataMatches: true,
    imported: true,
    databaseReady: true,
    stableAfterSettle: true,
  });
  assert.equal(f.calls.filter((call) => call.method === 'create-asset').length, 1);
  assert.equal(fs.readFileSync(path.join(f.parentPath, 'op-068.json'), 'utf8'), content);
});

test('createAsset refuses source, metadata, and asset-db identity conflicts without writing', async (t) => {
  const source = fixture(t);
  fs.writeFileSync(path.join(source.parentPath, 'existing.json'), '{}', 'utf8');
  await assert.rejects(
    () => createAsset(source.projectPath, {
      target: 'assets/McpKitValidation/existing.json', content: '{}', request: source.request,
    }),
    /never overwrites/
  );
  assert.equal(source.calls.length, 0);

  const meta = fixture(t);
  fs.writeFileSync(path.join(meta.parentPath, 'metadata.json.meta'), '{}', 'utf8');
  await assert.rejects(
    () => createAsset(meta.projectPath, {
      target: 'assets/McpKitValidation/metadata.json', content: '{}', request: meta.request,
    }),
    /never overwrites/
  );
  assert.equal(meta.calls.length, 0);

  const database = fixture(t, { existingInfo: { uuid: 'existing', url: 'db://assets/McpKitValidation/db.json' } });
  await assert.rejects(
    () => createAsset(database.projectPath, {
      target: 'assets/McpKitValidation/db.json', content: '{}', request: database.request,
    }),
    /already contains/
  );
  assert.equal(database.calls.some((call) => call.method === 'create-asset'), false);
});

test('createAsset fails closed when asset-db is not ready or import identity cannot be verified', async (t) => {
  const notReady = fixture(t, { ready: false });
  await assert.rejects(
    () => createAsset(notReady.projectPath, {
      target: 'assets/McpKitValidation/not-ready.json', content: '{}', request: notReady.request,
    }),
    /must be ready/
  );
  assert.equal(notReady.calls.some((call) => call.method === 'create-asset'), false);

  const wrongImporter = fixture(t, { importer: 'unknown' });
  await assert.rejects(
    () => createAsset(wrongImporter.projectPath, {
      target: 'assets/McpKitValidation/wrong.json', content: '{}', request: wrongImporter.request,
      retries: 0, settleDelayMs: 0,
    }),
    /verification failed: disk metadata UUID\/importer does not match/
  );
  assert.equal(fs.existsSync(path.join(wrongImporter.parentPath, 'wrong.json')), true);
});

test('createAsset reports uncertain files after an asset-db error instead of retrying or overwriting', async (t) => {
  const f = fixture(t);
  const request = async (method, ...args) => {
    if (method === 'query-ready') return true;
    if (method === 'query-asset-info') return null;
    if (method === 'create-asset') {
      const filePath = path.join(f.projectPath, args[0].slice('db://'.length));
      fs.writeFileSync(filePath, args[1], 'utf8');
      throw new Error('native response lost');
    }
    throw new Error(`Unexpected request: ${method}`);
  };
  await assert.rejects(
    () => createAsset(f.projectPath, {
      target: 'assets/McpKitValidation/uncertain.json', content: '{}', request,
    }),
    /Files now exist at the target; inspect them before retrying/
  );
  assert.equal(fs.existsSync(path.join(f.parentPath, 'uncertain.json')), true);
});
