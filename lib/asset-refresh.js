'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { isDeepStrictEqual } = require('util');
const { MAX_COPY_BYTES, normalizeCopyTarget, subAssetIdentities } = require('./asset-copy');
const { isPathInside, resolveProjectFilePath } = require('./path-safety');

const EXPECTED = Object.freeze({
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
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

function requestAssetDb(method, ...args) {
  if (!global.Editor || !Editor.Message || typeof Editor.Message.request !== 'function') {
    throw new Error('Editor.Message.request is unavailable; refresh_asset requires Cocos asset-db.');
  }
  return Editor.Message.request('asset-db', method, ...args);
}

function regularFile(filePath, assetsRoot, label) {
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() ||
      !isPathInside(fs.realpathSync(assetsRoot), fs.realpathSync(filePath))) {
    throw new Error(`${label} must be a regular file inside project assets.`);
  }
  return stat;
}

function sourceSnapshot(target, assetsRoot) {
  const stat = regularFile(target.filePath, assetsRoot, 'Refresh source');
  if (stat.size > MAX_COPY_BYTES) throw new Error('Refresh source exceeds the 64 MiB limit.');
  const bytes = fs.readFileSync(target.filePath);
  if (target.extension === '.json' || target.extension === '.txt') {
    const text = bytes.toString('utf8');
    if (!Buffer.from(text, 'utf8').equals(bytes) || text.includes('\0')) {
      throw new Error('JSON/text refresh source must be valid UTF-8 without NUL bytes.');
    }
    if (target.extension === '.json') JSON.parse(text);
  }
  return { sha256: sha256(bytes), byteLength: stat.size };
}

function settings(meta) {
  if (!meta || typeof meta !== 'object') return null;
  return {
    uuid: meta.uuid,
    importer: meta.importer,
    userData: meta.userData,
    subMetas: Object.fromEntries(Object.entries(meta.subMetas || {})
      .map(([key, value]) => [key, settings(value)])),
  };
}

function librarySnapshot(projectPath, info) {
  const libraryRoot = resolveProjectFilePath(projectPath, 'library');
  const outputs = Object.values(info.library || {});
  if (!outputs.length || outputs.length > 32) {
    throw new Error('Asset-db did not expose a bounded set of imported library files.');
  }
  return outputs.map((file) => {
    if (typeof file !== 'string' || !path.isAbsolute(file) || !isPathInside(libraryRoot, file)) {
      throw new Error('Imported library output is outside this project.');
    }
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() ||
        !isPathInside(fs.realpathSync(libraryRoot), fs.realpathSync(file))) {
      throw new Error('Imported library output must be a regular file.');
    }
    return { path: path.resolve(file), mtimeMs: stat.mtimeMs, size: stat.size };
  }).sort((a, b) => a.path.localeCompare(b.path));
}

async function importedSnapshot(projectPath, target, assetsRoot, source, request) {
  const info = await request('query-asset-info', target.dbUrl);
  const expected = EXPECTED[target.extension];
  if (!info || !info.uuid || info.uuid.includes('@') || info.url !== target.dbUrl ||
      info.type !== expected[0] || info.importer !== expected[1] ||
      info.imported !== true || info.invalid === true || info.readonly === true ||
      info.isDirectory === true || (info.source && info.source !== info.url) ||
      (info.file && path.resolve(String(info.file)) !== path.resolve(target.filePath))) {
    throw new Error('Asset-db has not imported the expected writable main asset.');
  }
  const byUuid = await request('query-asset-info', info.uuid);
  if (!byUuid || byUuid.url !== info.url || byUuid.type !== info.type ||
      byUuid.importer !== info.importer || byUuid.uuid !== info.uuid) {
    throw new Error('Asset UUID and URL lookups disagree.');
  }
  const currentSource = sourceSnapshot(target, assetsRoot);
  if (!isDeepStrictEqual(currentSource, source)) {
    throw new Error('Refresh source changed during the request; inspect it before retrying.');
  }
  const metaStat = regularFile(target.metaPath, assetsRoot, 'Refresh metadata');
  if (metaStat.size > 1024 * 1024) throw new Error('Refresh metadata exceeds the 1 MiB limit.');
  const diskMeta = JSON.parse(fs.readFileSync(target.metaPath, 'utf8'));
  const metadata = await request('query-asset-meta', info.uuid);
  if (!metadata || diskMeta.uuid !== info.uuid || metadata.uuid !== info.uuid ||
      diskMeta.importer !== info.importer || metadata.importer !== info.importer) {
    throw new Error('Refresh metadata UUID/importer does not match asset-db.');
  }
  const subAssets = subAssetIdentities(info);
  if (new Set(subAssets.map((item) => item.uuid)).size !== subAssets.length ||
      subAssets.some((item) => !item.uuid || !item.type || item.uuid === info.uuid)) {
    throw new Error('Imported subasset identities are incomplete or duplicated.');
  }
  const library = librarySnapshot(projectPath, info);
  if (await request('query-ready') !== true) throw new Error('Asset database is still busy.');
  return { info, diskMeta, metadata, subAssets, library };
}

async function refreshAsset(projectPath, options = {}) {
  const request = options.request || requestAssetDb;
  const retries = options.retries === undefined ? 20 : options.retries;
  const retryDelayMs = options.retryDelayMs === undefined ? 150 : options.retryDelayMs;
  const settleDelayMs = options.settleDelayMs === undefined ? 400 : options.settleDelayMs;
  if (!Number.isInteger(retries) || retries < 0 || retries > 100 ||
      !Number.isInteger(retryDelayMs) || retryDelayMs < 0 || retryDelayMs > 10000 ||
      !Number.isInteger(settleDelayMs) || settleDelayMs < 0 || settleDelayMs > 10000) {
    throw new Error('Invalid bounded refresh polling options.');
  }
  const target = normalizeCopyTarget(projectPath, options.target, 'refresh_asset');
  const assetsRoot = resolveProjectFilePath(projectPath, 'assets');
  const source = sourceSnapshot(target, assetsRoot);
  if (await request('query-ready') !== true) throw new Error('Asset database must be ready before refresh.');
  const priorInfo = await request('query-asset-info', target.dbUrl);
  let before = null;
  if (priorInfo) {
    before = await importedSnapshot(projectPath, target, assetsRoot, source, request);
  } else if (fs.existsSync(target.metaPath)) {
    throw new Error('Refresh target has orphaned metadata but no asset-db identity; inspect it before refreshing.');
  }
  if (await request('query-ready') !== true) throw new Error('Asset database became busy before refresh.');
  if (!isDeepStrictEqual(sourceSnapshot(target, assetsRoot), source)) {
    throw new Error('Refresh source changed during preflight. No refresh was requested.');
  }

  let result;
  try {
    result = await request('refresh-asset', target.dbUrl);
  } catch (error) {
    throw new Error(`asset-db:refresh-asset failed for ${target.dbUrl}: ${error.message}. The refresh may already have run; inspect the asset before retrying.`, { cause: error });
  }
  let verificationError = 'verification did not run';
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const verified = await importedSnapshot(projectPath, target, assetsRoot, source, request);
      if (before && (verified.info.uuid !== before.info.uuid ||
          !isDeepStrictEqual(verified.subAssets, before.subAssets) ||
          !isDeepStrictEqual(settings(verified.diskMeta), settings(before.diskMeta)) ||
          !isDeepStrictEqual(settings(verified.metadata), settings(before.metadata)))) {
        throw new Error('Existing main/subasset UUIDs or importer settings changed during refresh.');
      }
      await delay(settleDelayMs);
      const settled = await importedSnapshot(projectPath, target, assetsRoot, source, request);
      if (settled.info.uuid !== verified.info.uuid ||
          !isDeepStrictEqual(settled.diskMeta, verified.diskMeta) ||
          !isDeepStrictEqual(settled.metadata, verified.metadata) ||
          !isDeepStrictEqual(settled.subAssets, verified.subAssets) ||
          !isDeepStrictEqual(settled.library, verified.library)) {
        throw new Error('Refresh metadata, subassets, or library outputs have not settled.');
      }
      return {
        refreshed: true,
        method: 'asset-db:refresh-asset',
        result,
        path: target.projectRelative,
        dbUrl: target.dbUrl,
        uuid: settled.info.uuid,
        type: settled.info.type,
        importer: settled.info.importer,
        newlyImported: !before,
        sha256: source.sha256,
        byteLength: source.byteLength,
        subAssetCount: settled.subAssets.length,
        verification: {
          sourceUnchanged: true,
          mainAndSubassetUuidsPreserved: !!before,
          importerSettingsPreserved: !!before,
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
  throw new Error(`asset-db:refresh-asset returned for ${target.dbUrl}, but verification failed: ${verificationError}. Inspect the asset before retrying; no second refresh was requested.`);
}

module.exports = { refreshAsset };
