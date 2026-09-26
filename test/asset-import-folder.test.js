'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { importFolder, scanImportFolder, normalizeFolderTarget } = require('../lib/asset-import-folder');

function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cocos-mcp-import-folder-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const projectPath = path.join(root, 'project');
  const assetsRoot = path.join(projectPath, 'assets');
  const libraryRoot = path.join(projectPath, 'library');
  const source = path.join(root, 'external');
  const target = 'assets/Imported';
  const targetUrl = `db://${target}`;
  const targetPath = path.join(projectPath, target);
  fs.mkdirSync(assetsRoot, { recursive: true });
  fs.mkdirSync(libraryRoot);
  fs.mkdirSync(path.join(source, 'Nested'), { recursive: true });
  fs.writeFileSync(path.join(source, 'A.json'), '{"op":75}');
  fs.writeFileSync(path.join(source, 'Nested', 'B.txt'), 'nested text');
  if (options.image) fs.writeFileSync(path.join(source, 'Nested', 'C.png'), Buffer.from([137, 80, 78, 71]));
  const calls = [];
  const infos = new Map();
  const metas = new Map();
  let altered = false;
  const createIdentity = (relative, importer, type, directory = false) => {
    const url = relative ? `${targetUrl}/${relative}` : targetUrl;
    const uuid = `imported-${relative || 'root'}`;
    const file = relative ? path.join(targetPath, relative) : targetPath;
    const meta = { uuid, importer, userData: {} };
    fs.writeFileSync(`${file}.meta`, JSON.stringify(meta));
    const library = {};
    if (!directory) {
      const output = path.join(libraryRoot, `${uuid.replace(/[\\/]/g, '-')}.json`);
      if (!options.noLibrary) fs.writeFileSync(output, '{}');
      library['.json'] = output;
    }
    const subAssets = options.image && relative === 'Nested/C.png'
      ? { texture: { uuid: `${uuid}@texture`, type: 'cc.Texture2D' } } : {};
    const info = { url, uuid, file, type, importer, imported: true, isDirectory: directory,
      subAssets, library };
    infos.set(url, info);
    metas.set(uuid, meta);
    return info;
  };
  const request = async (method, ...args) => {
    calls.push({ method, args });
    if (method === 'query-ready') {
      if (options.mutateOnReady && !altered) {
        fs.writeFileSync(path.join(source, 'A.json'), '{"op":76}');
        altered = true;
      }
      return true;
    }
    if (method === 'query-asset-info') {
      if (options.orphanedChild && args[0] === `${targetUrl}/Nested/B.txt`) return { uuid: 'stale-child' };
      return infos.get(args[0]) || null;
    }
    if (method === 'query-asset-meta') return metas.get(args[0]) || null;
    if (method === 'import-asset') {
      assert.deepEqual(args, [source, targetUrl, { overwrite: false, rename: false }]);
      if (options.nativeError) throw new Error(options.nativeError);
      if (!options.nativeNoop) {
        fs.cpSync(source, targetPath, { recursive: true });
        const rootInfo = createIdentity('', 'directory', 'cc.Asset', true);
        createIdentity('Nested', 'directory', 'cc.Asset', true);
        createIdentity('A.json', 'json', 'cc.JsonAsset');
        createIdentity('Nested/B.txt', 'text', 'cc.TextAsset');
        if (options.image) createIdentity('Nested/C.png', 'image', 'cc.ImageAsset');
        if (options.extraFile) fs.writeFileSync(path.join(targetPath, 'surprise.txt'), 'extra');
        return rootInfo;
      }
      return { url: targetUrl };
    }
    throw new Error(`Unexpected request ${method}`);
  };
  return { projectPath, source, target, targetPath, calls, request };
}

test('import_folder imports a bounded nested tree once and verifies all identities', async (t) => {
  const f = fixture(t, { image: true });
  const result = await importFolder(f.projectPath, { source: f.source, target: f.target,
    request: f.request, retries: 0, settleDelayMs: 0 });
  assert.equal(result.imported, true);
  assert.equal(result.overwritten, false);
  assert.equal(result.source.fileCount, 3);
  assert.equal(result.source.directoryCount, 2);
  assert.deepEqual(result.directories.map((item) => item.relative), ['', 'Nested']);
  assert.deepEqual(result.assets.map((item) => item.relative), ['A.json', 'Nested/B.txt', 'Nested/C.png']);
  assert.equal(result.assets.find((item) => item.relative === 'Nested/C.png').subAssetCount, 1);
  assert.equal(result.verification.stableAfterSettle, true);
  assert.equal(f.calls.filter((call) => call.method === 'import-asset').length, 1);
});

test('import_folder rejects target conflicts, traversal, sidecars and unsupported files before mutation', async (t) => {
  const f = fixture(t);
  fs.mkdirSync(f.targetPath);
  await assert.rejects(importFolder(f.projectPath, { source: f.source, target: f.target, request: f.request }), /never overwrites/);
  fs.rmdirSync(f.targetPath);
  await assert.rejects(importFolder(f.projectPath, { source: f.source, target: '../Outside', request: f.request }), /\. or \.\./);
  fs.writeFileSync(path.join(f.source, 'A.json.meta'), '{}');
  await assert.rejects(importFolder(f.projectPath, { source: f.source, target: f.target, request: f.request }), /\.meta sidecar/);
  fs.rmSync(path.join(f.source, 'A.json.meta'));
  fs.writeFileSync(path.join(f.source, 'bad.prefab'), '{}');
  await assert.rejects(importFolder(f.projectPath, { source: f.source, target: f.target, request: f.request }), /supports only JSON/);
  assert.equal(f.calls.some((call) => call.method === 'import-asset'), false);
});

test('import_folder rejects orphaned child identities before native import', async (t) => {
  const f = fixture(t, { orphanedChild: true });
  await assert.rejects(importFolder(f.projectPath, { source: f.source, target: f.target,
    request: f.request }), /Asset database already contains .*Nested\/B\.txt/);
  assert.equal(f.calls.some((call) => call.method === 'import-asset'), false);
});

test('import_folder refuses a changed external tree before native import', async (t) => {
  const f = fixture(t, { mutateOnReady: true });
  await assert.rejects(importFolder(f.projectPath, { source: f.source, target: f.target,
    request: f.request }), /changed during import/);
  assert.equal(f.calls.some((call) => call.method === 'import-asset'), false);
});

test('import_folder does not retry an uncertain native result or incomplete tree', async (t) => {
  const failed = fixture(t, { nativeError: 'outcome unknown' });
  await assert.rejects(importFolder(failed.projectPath, { source: failed.source, target: failed.target,
    request: failed.request, retries: 0 }), /No second import was requested/);
  assert.equal(failed.calls.filter((call) => call.method === 'import-asset').length, 1);

  const incomplete = fixture(t, { noLibrary: true });
  await assert.rejects(importFolder(incomplete.projectPath, { source: incomplete.source,
    target: incomplete.target, request: incomplete.request, retries: 0, settleDelayMs: 0 }), /verification failed/);
  assert.equal(incomplete.calls.filter((call) => call.method === 'import-asset').length, 1);

  const extra = fixture(t, { extraFile: true });
  await assert.rejects(importFolder(extra.projectPath, { source: extra.source, target: extra.target,
    request: extra.request, retries: 0, settleDelayMs: 0 }), /structure or metadata sidecars/);
  assert.equal(extra.calls.filter((call) => call.method === 'import-asset').length, 1);
});

test('scanImportFolder enforces depth and file count bounds', (t) => {
  const deep = fixture(t);
  let directory = path.join(deep.source, 'Nested');
  for (let index = 0; index < 4; index += 1) {
    directory = path.join(directory, `D${index}`);
    fs.mkdirSync(directory);
  }
  assert.throws(() => scanImportFolder(deep.projectPath, deep.source), /levels/);

  const many = fixture(t);
  for (let index = 0; index < 63; index += 1) {
    fs.writeFileSync(path.join(many.source, `extra-${index}.txt`), 'x');
  }
  assert.throws(() => scanImportFolder(many.projectPath, many.source), /64 files/);
});

test('normalizeFolderTarget and scanImportFolder reject symbolic links', (t) => {
  const f = fixture(t);
  assert.throws(() => normalizeFolderTarget(f.projectPath, 'assets/../Outside'), /\. or \.\./);
  assert.throws(() => normalizeFolderTarget(f.projectPath, 'assets/Imported.meta'), /must not end in \.meta/);
  assert.throws(() => normalizeFolderTarget(f.projectPath, 'db://internal/example'), /project assets directory/);
  const link = path.join(f.source, 'linked.txt');
  try { fs.symlinkSync(path.join(f.source, 'Nested', 'B.txt'), link); } catch (error) {
    if (error.code === 'EPERM') return;
    throw error;
  }
  assert.throws(() => scanImportFolder(f.projectPath, f.source), /symbolic link/);
});
