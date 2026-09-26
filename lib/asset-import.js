'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { isDeepStrictEqual } = require('util');
const {
  MAX_COPY_BYTES,
  normalizeCopyTarget,
  subAssetIdentities,
} = require('./asset-copy');
const { normalizeExpectedSha256 } = require('./asset-save');
const { isPathInside, resolveProjectFilePath } = require('./path-safety');

const EXPECTED_BY_EXTENSION = Object.freeze({
  '.json': ['cc.JsonAsset', 'json'],
  '.txt': ['cc.TextAsset', 'text'],
  '.png': ['cc.ImageAsset', 'image'],
  '.jpg': ['cc.ImageAsset', 'image'],
  '.jpeg': ['cc.ImageAsset', 'image'],
  '.webp': ['cc.ImageAsset', 'image'],
  '.mp3': ['cc.AudioClip', 'audio-clip'],
  '.wav': ['cc.AudioClip', 'audio-clip'],
  '.ogg': ['cc.AudioClip', 'audio-clip'],
  '.m4a': ['cc.AudioClip', 'audio-clip'],
});
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

function requestAssetDb(method, ...args) {
  if (!global.Editor || !Editor.Message || typeof Editor.Message.request !== 'function') {
    throw new Error('Editor.Message.request is unavailable; import_asset requires Cocos asset-db.');
  }
  return Editor.Message.request('asset-db', method, ...args);
}

function normalizeImportSource(projectPath, source) {
  if (typeof source !== 'string' || !source.trim() || source.length > 4096 || source.includes('\0')) {
    throw new Error('source must be an explicit absolute file path of at most 4096 characters.');
  }
  const filePath = path.resolve(source);
  if (!path.isAbsolute(source) || source.startsWith('\\\\') || source.startsWith('//')) {
    throw new Error('source must be a local absolute file path.');
  }
  const extension = path.extname(filePath).toLowerCase();
  if (!EXPECTED_BY_EXTENSION[extension]) {
    throw new Error('import_asset supports only JSON, text, image, and audio source files.');
  }
  const assetsRoot = resolveProjectFilePath(projectPath, 'assets');
  if (isPathInside(assetsRoot, filePath)) {
    throw new Error('source is already inside project assets; use copy_asset or reimport_asset.');
  }
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error('source must be a regular file, not a directory or symbolic link.');
  }
  const root = path.parse(filePath).root;
  let current = root;
  for (const segment of path.relative(root, path.dirname(filePath)).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (fs.lstatSync(current).isSymbolicLink()) {
      throw new Error('source parent directories must not contain symbolic links.');
    }
  }
  if (stat.size > MAX_COPY_BYTES) throw new Error(`source exceeds the ${MAX_COPY_BYTES}-byte import_asset limit.`);
  if (fs.existsSync(`${filePath}.meta`)) {
    throw new Error('source has a .meta sidecar; import_asset does not transfer existing asset identities.');
  }
  const bytes = fs.readFileSync(filePath);
  if (extension === '.json' || extension === '.txt') {
    const text = bytes.toString('utf8');
    if (!Buffer.from(text, 'utf8').equals(bytes) || text.includes('\0')) {
      throw new Error('JSON/text source must be valid UTF-8 without NUL bytes.');
    }
    if (extension === '.json') {
      try { JSON.parse(text); } catch (error) {
        throw new Error(`JSON source is invalid: ${error.message}`, { cause: error });
      }
    }
  }
  return { filePath, extension, size: stat.size, hash: sha256(bytes) };
}

function assertSourceUnchanged(source) {
  const stat = fs.lstatSync(source.filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== source.size ||
      sha256(fs.readFileSync(source.filePath)) !== source.hash ||
      fs.existsSync(`${source.filePath}.meta`)) {
    throw new Error('source changed during import; inspect it before retrying.');
  }
}

function snapshotLibrary(projectPath, info) {
  const root = resolveProjectFilePath(projectPath, 'library');
  const files = Object.values(info.library || {});
  if (!files.length || files.length > 32) throw new Error('Imported library outputs are missing or unbounded.');
  return files.map((file) => {
    if (typeof file !== 'string' || !path.isAbsolute(file) || !isPathInside(root, file)) {
      throw new Error('Imported library output is outside the project.');
    }
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Imported library output is not a regular file.');
    return { path: path.resolve(file), size: stat.size, mtimeMs: stat.mtimeMs };
  }).sort((a, b) => a.path.localeCompare(b.path));
}

async function verifyImportedAsset(projectPath, source, target, request) {
  assertSourceUnchanged(source);
  const assetsRoot = resolveProjectFilePath(projectPath, 'assets');
  const fileStat = fs.lstatSync(target.filePath);
  const metaStat = fs.lstatSync(target.metaPath);
  if (!fileStat.isFile() || fileStat.isSymbolicLink() || !metaStat.isFile() || metaStat.isSymbolicLink() ||
      !isPathInside(fs.realpathSync(assetsRoot), fs.realpathSync(target.filePath)) ||
      !isPathInside(fs.realpathSync(assetsRoot), fs.realpathSync(target.metaPath))) {
    throw new Error('Imported source or metadata is not a regular file inside project assets.');
  }
  if (fileStat.size !== source.size || sha256(fs.readFileSync(target.filePath)) !== source.hash) {
    throw new Error('Imported source bytes do not match the external source.');
  }
  const info = await request('query-asset-info', target.dbUrl);
  const expected = EXPECTED_BY_EXTENSION[target.extension];
  if (!info || !info.uuid || info.uuid.includes('@') || info.url !== target.dbUrl ||
      info.type !== expected[0] || info.importer !== expected[1] ||
      info.imported !== true || info.invalid === true || info.readonly === true || info.isDirectory === true ||
      (info.source && info.source !== info.url) ||
      (info.file && path.resolve(String(info.file)) !== path.resolve(target.filePath))) {
    throw new Error('asset-db did not import the expected writable main asset identity.');
  }
  const metadata = await request('query-asset-meta', info.uuid);
  const diskMeta = JSON.parse(fs.readFileSync(target.metaPath, 'utf8'));
  if (!metadata || metadata.uuid !== info.uuid || metadata.importer !== expected[1] ||
      diskMeta.uuid !== info.uuid || diskMeta.importer !== expected[1]) {
    throw new Error('Imported metadata UUID/importer does not match asset-db.');
  }
  const subAssets = subAssetIdentities(info);
  if (new Set(subAssets.map((item) => item.uuid)).size !== subAssets.length ||
      subAssets.some((item) => !item.uuid || item.uuid === info.uuid || !item.type)) {
    throw new Error('Imported subasset identities are incomplete or duplicated.');
  }
  const library = snapshotLibrary(projectPath, info);
  if (await request('query-ready') !== true) throw new Error('Asset database is not ready.');
  return { info, metadata, diskMeta, subAssets, library };
}

async function importAsset(projectPath, options = {}) {
  const request = options.request || requestAssetDb;
  const retries = options.retries === undefined ? 30 : options.retries;
  const retryDelayMs = options.retryDelayMs === undefined ? 250 : options.retryDelayMs;
  const settleDelayMs = options.settleDelayMs === undefined ? 400 : options.settleDelayMs;
  if (!Number.isInteger(retries) || retries < 0 || retries > 100 ||
      !Number.isInteger(retryDelayMs) || retryDelayMs < 0 || retryDelayMs > 10000 ||
      !Number.isInteger(settleDelayMs) || settleDelayMs < 0 || settleDelayMs > 10000) {
    throw new Error('Invalid bounded import polling options.');
  }
  const expectedSha256 = normalizeExpectedSha256(options.expectedSha256);
  const source = normalizeImportSource(projectPath, options.source);
  const target = normalizeCopyTarget(projectPath, options.target);
  if (target.extension !== source.extension) throw new Error('target must use the same extension as source.');
  if (expectedSha256 && source.hash !== expectedSha256) {
    throw new Error(`Source SHA-256 conflict: expected ${expectedSha256}, current ${source.hash}. No import was requested.`);
  }
  if (fs.existsSync(target.filePath) || fs.existsSync(target.metaPath)) {
    throw new Error(`Target asset or metadata already exists: ${target.projectRelative}. import_asset never overwrites.`);
  }
  if (await request('query-ready') !== true) throw new Error('Asset database must be ready before import.');
  if (await request('query-asset-info', target.dbUrl)) {
    throw new Error(`Asset database already contains ${target.dbUrl}. import_asset never overwrites.`);
  }
  assertSourceUnchanged(source);
  if (fs.existsSync(target.filePath) || fs.existsSync(target.metaPath) ||
      await request('query-asset-info', target.dbUrl)) {
    throw new Error('Target appeared during import preflight. No import was requested.');
  }

  let result;
  try {
    result = await request('import-asset', source.filePath, target.dbUrl, { overwrite: false, rename: false });
  } catch (error) {
    const note = fs.existsSync(target.filePath) || fs.existsSync(target.metaPath)
      ? ' Target files now exist; inspect them before retrying.' : '';
    throw new Error(`asset-db:import-asset failed for ${target.dbUrl}: ${error.message}.${note} No second import was requested.`, { cause: error });
  }
  let verificationError = 'verification did not run';
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const verified = await verifyImportedAsset(projectPath, source, target, request);
      await delay(settleDelayMs);
      const settled = await verifyImportedAsset(projectPath, source, target, request);
      if (verified.info.uuid !== settled.info.uuid ||
          !isDeepStrictEqual(verified.metadata, settled.metadata) ||
          !isDeepStrictEqual(verified.diskMeta, settled.diskMeta) ||
          !isDeepStrictEqual(verified.subAssets, settled.subAssets) ||
          !isDeepStrictEqual(verified.library, settled.library)) {
        throw new Error('Imported identity, metadata, subassets, or library outputs have not settled.');
      }
      return {
        imported: true,
        overwritten: false,
        method: 'asset-db:import-asset',
        result,
        source: { path: source.filePath, sha256: source.hash, byteLength: source.size },
        target: {
          path: target.projectRelative,
          url: target.dbUrl,
          uuid: settled.info.uuid,
          type: settled.info.type,
          importer: settled.info.importer,
        },
        subAssetCount: settled.subAssets.length,
        verification: {
          sourceUnchanged: true,
          targetBytesMatch: true,
          metadataMatches: true,
          imported: true,
          databaseReady: true,
          libraryAvailable: true,
          stableAfterSettle: true,
        },
      };
    } catch (error) {
      verificationError = error.message;
      if (attempt < retries) await delay(retryDelayMs);
    }
  }
  throw new Error(`asset-db:import-asset returned for ${target.dbUrl}, but verification failed: ${verificationError}. Inspect the target before retrying; no second import was requested.`);
}

module.exports = { importAsset, normalizeImportSource, verifyImportedAsset };
