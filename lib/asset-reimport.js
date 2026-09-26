'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { isDeepStrictEqual } = require('util');
const {
  MAX_COPY_BYTES,
  SUPPORTED_COPY_EXTENSIONS,
  SUPPORTED_COPY_TYPES,
  normalizeCopySourceTarget,
  subAssetIdentities,
} = require('./asset-copy');
const { isPathInside, resolveProjectFilePath } = require('./path-safety');

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
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

function requestAssetDb(method, ...args) {
  if (!global.Editor || !Editor.Message || typeof Editor.Message.request !== 'function') {
    throw new Error('Editor.Message.request is unavailable; reimport_asset requires Cocos asset-db.');
  }
  return Editor.Message.request('asset-db', method, ...args);
}

function assertRegularAssetPath(projectPath, filePath, label) {
  const root = resolveProjectFilePath(projectPath, 'assets');
  const realRoot = fs.realpathSync(root);
  if (fs.lstatSync(root).isSymbolicLink() || !fs.lstatSync(root).isDirectory()) {
    throw new Error('Project assets must be a real directory.');
  }
  const relative = path.relative(root, filePath);
  if (!relative || relative.split(path.sep).some((part) => part === '..') || !isPathInside(root, filePath)) {
    throw new Error(`${label} must be inside project assets.`);
  }
  let current = root;
  for (const part of relative.split(path.sep).slice(0, -1)) {
    current = path.join(current, part);
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`${label} has a symbolic-link parent.`);
  }
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || !isPathInside(realRoot, fs.realpathSync(filePath))) {
    throw new Error(`${label} must be a regular file inside project assets.`);
  }
  return stat;
}

function sameIdentity(before, after) {
  return !!after && after.uuid === before.uuid && after.url === before.url &&
    after.type === before.type && after.importer === before.importer;
}

function importSettings(meta) {
  if (!meta || typeof meta !== 'object') return null;
  return {
    uuid: meta.uuid,
    importer: meta.importer,
    userData: meta.userData,
    subMetas: Object.fromEntries(Object.entries(meta.subMetas || {})
      .map(([key, value]) => [key, importSettings(value)])),
  };
}

function snapshotLibrary(projectPath, info) {
  const root = resolveProjectFilePath(projectPath, 'library');
  const paths = Object.values(info.library || {});
  if (!paths.length || paths.length > 32) throw new Error('Asset-db did not expose a bounded set of imported library files.');
  return paths.map((file) => {
    if (typeof file !== 'string' || !path.isAbsolute(file) || !isPathInside(root, file)) {
      throw new Error('Imported library file is outside this project.');
    }
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Imported library output must be a regular file.');
    return { path: path.resolve(file), mtimeMs: stat.mtimeMs, size: stat.size };
  }).sort((a, b) => a.path.localeCompare(b.path));
}

async function snapshot(projectPath, info, request) {
  if (!info || !SUPPORTED_COPY_TYPES.has(info.type) || info.imported !== true ||
      info.invalid === true || info.readonly === true || info.isDirectory === true ||
      typeof info.uuid !== 'string' || !info.uuid || info.uuid.includes('@') ||
      typeof info.url !== 'string' || !info.url.startsWith('db://assets/') ||
      (info.source && info.source !== info.url)) {
    throw new Error('reimport_asset requires a writable, fully imported JSON, text, image, or audio main asset. Scenes, prefabs, scripts, directories, and subassets are unsupported.');
  }
  const filePath = resolveProjectFilePath(projectPath, info.url.slice('db://'.length));
  const extension = path.extname(filePath).toLowerCase();
  if (!SUPPORTED_COPY_EXTENSIONS.has(extension)) {
    throw new Error('reimport_asset does not support this asset extension.');
  }
  const expected = EXPECTED_BY_EXTENSION[extension];
  if (!expected || info.type !== expected[0] || info.importer !== expected[1]) {
    throw new Error('Asset type/importer does not match its supported file extension.');
  }
  if (info.file && path.resolve(String(info.file)) !== path.resolve(filePath)) {
    throw new Error('Asset-db source file does not match the asset URL.');
  }
  const sourceStat = assertRegularAssetPath(projectPath, filePath, 'Asset source');
  const metaPath = `${filePath}.meta`;
  const metaStat = assertRegularAssetPath(projectPath, metaPath, 'Asset metadata');
  if (sourceStat.size > MAX_COPY_BYTES || metaStat.size > 1024 * 1024) {
    throw new Error('Asset source or metadata exceeds the reimport_asset size limit.');
  }
  const sourceHash = sha256(fs.readFileSync(filePath));
  const metaText = fs.readFileSync(metaPath, 'utf8');
  const diskMeta = JSON.parse(metaText);
  const metadata = await request('query-asset-meta', info.uuid);
  if (!metadata || metadata.uuid !== info.uuid || metadata.importer !== info.importer ||
      diskMeta.uuid !== info.uuid || diskMeta.importer !== info.importer) {
    throw new Error('Asset metadata UUID/importer does not match asset-db.');
  }
  return {
    info,
    filePath,
    metaPath,
    sourceHash,
    metaHash: sha256(Buffer.from(metaText)),
    metadata,
    diskMeta,
    subAssets: subAssetIdentities(info),
    library: snapshotLibrary(projectPath, info),
    byteLength: sourceStat.size,
  };
}

async function readConsistent(projectPath, before, request) {
  const byUuid = await request('query-asset-info', before.info.uuid);
  const byUrl = await request('query-asset-info', before.info.url);
  if (!sameIdentity(before.info, byUuid) || !sameIdentity(before.info, byUrl)) {
    throw new Error('Asset UUID/URL/type/importer identity changed during reimport.');
  }
  return snapshot(projectPath, byUuid, request);
}

function assertPreserved(before, after, { allowGeneratedMetadata = false } = {}) {
  if (after.sourceHash !== before.sourceHash ||
      !isDeepStrictEqual(after.subAssets, before.subAssets) ||
      !isDeepStrictEqual(importSettings(after.metadata), importSettings(before.metadata)) ||
      !isDeepStrictEqual(importSettings(after.diskMeta), importSettings(before.diskMeta))) {
    throw new Error('Source, import settings, or subasset identity changed during reimport.');
  }
  if (!allowGeneratedMetadata && (after.metaHash !== before.metaHash ||
      !isDeepStrictEqual(after.metadata, before.metadata) ||
      !isDeepStrictEqual(after.library, before.library))) {
    throw new Error('Asset metadata changed before reimport was requested.');
  }
  if (after.info.imported !== true || after.info.invalid === true) {
    throw new Error('Asset is not fully imported.');
  }
}

async function reimportAsset(projectPath, options = {}) {
  const request = options.request || requestAssetDb;
  const retries = options.retries === undefined ? 20 : options.retries;
  const retryDelayMs = options.retryDelayMs === undefined ? 150 : options.retryDelayMs;
  const settleDelayMs = options.settleDelayMs === undefined ? 400 : options.settleDelayMs;
  if (!Number.isInteger(retries) || retries < 0 || retries > 100 ||
      !Number.isInteger(retryDelayMs) || retryDelayMs < 0 || retryDelayMs > 10000 ||
      !Number.isInteger(settleDelayMs) || settleDelayMs < 0 || settleDelayMs > 10000) {
    throw new Error('Invalid bounded reimport polling options.');
  }
  const lookup = normalizeCopySourceTarget(projectPath, options.target);
  if (await request('query-ready') !== true) throw new Error('Asset database must be ready before reimport.');
  const info = await request('query-asset-info', lookup);
  const before = await snapshot(projectPath, info, request);
  const preflight = await readConsistent(projectPath, before, request);
  assertPreserved(before, preflight);
  if (await request('query-ready') !== true) throw new Error('Asset database became busy before reimport.');

  let result;
  try {
    result = await request('reimport-asset', before.info.url);
  } catch (error) {
    throw new Error(`asset-db:reimport-asset failed for ${before.info.url}: ${error.message}. The import may already have run; inspect the asset before retrying.`, { cause: error });
  }
  let verificationError = 'verification did not run';
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      if (await request('query-ready') !== true) throw new Error('Asset database is busy.');
      const verified = await readConsistent(projectPath, before, request);
      assertPreserved(before, verified, { allowGeneratedMetadata: true });
      if (!isDeepStrictEqual(before.library.map(({ path }) => path), verified.library.map(({ path }) => path)) ||
          !verified.library.some((file, index) => file.mtimeMs > before.library[index].mtimeMs)) {
        throw new Error('Imported library outputs have not been regenerated.');
      }
      await delay(settleDelayMs);
      if (await request('query-ready') !== true) throw new Error('Asset database is busy after settling.');
      const settled = await readConsistent(projectPath, before, request);
      assertPreserved(before, settled, { allowGeneratedMetadata: true });
      if (settled.metaHash !== verified.metaHash || !isDeepStrictEqual(settled.metadata, verified.metadata)) {
        throw new Error('Asset metadata has not settled.');
      }
      if (!isDeepStrictEqual(settled.library, verified.library)) throw new Error('Imported library outputs have not settled.');
      return {
        reimported: true,
        method: 'asset-db:reimport-asset',
        result,
        path: path.relative(projectPath, before.filePath).replace(/\\/g, '/'),
        dbUrl: before.info.url,
        uuid: before.info.uuid,
        type: before.info.type,
        importer: before.info.importer,
        sha256: before.sourceHash,
        byteLength: before.byteLength,
        subAssetCount: settled.subAssets.length,
        verification: {
          sourceUnchanged: true,
          mainAndSubassetUuidsPreserved: true,
          importSettingsPreserved: true,
          imported: true,
          databaseReady: true,
          libraryRegenerated: true,
          stableAfterSettle: true,
        },
      };
    } catch (error) {
      verificationError = error.message;
      if (attempt < retries) await delay(retryDelayMs);
    }
  }
  throw new Error(`asset-db:reimport-asset returned for ${before.info.url}, but verification failed: ${verificationError}. Inspect the asset before retrying; no second reimport was requested.`);
}

module.exports = { reimportAsset };
