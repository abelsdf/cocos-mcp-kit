'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { isDeepStrictEqual } = require('util');
const {
  MAX_ASSET_BYTES,
  SUPPORTED_ASSET_TYPES,
  normalizeAssetCreationTarget,
  validateAssetContent,
} = require('./asset-creation');
const { normalizeCopySourceTarget, subAssetIdentities } = require('./asset-copy');
const { isPathInside, resolveProjectFilePath } = require('./path-safety');

function requestAssetDb(method, ...args) {
  if (!global.Editor || !Editor.Message || typeof Editor.Message.request !== 'function') {
    throw new Error('Editor.Message.request is unavailable; asset saving requires Cocos asset-db.');
  }
  return Editor.Message.request('asset-db', method, ...args);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function normalizeExpectedSha256(value) {
  if (value === undefined || value === null || value === '') return '';
  const normalized = String(value).trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new Error('expectedSha256 must be a 64-character hexadecimal SHA-256 value.');
  }
  return normalized;
}

function validateSaveContent(target, content) {
  try {
    return validateAssetContent(target, content);
  } catch (error) {
    throw new Error(String(error.message || error).replace(/create_asset/g, 'save_asset'), { cause: error });
  }
}

function unsupportedSaveMessage(info) {
  if (info && (info.uuid || '').includes('@')) {
    return 'save_asset accepts a main asset, not an imported subasset. Save or replace the owning main asset through its specialized workflow.';
  }
  const guidance = {
    'cc.SceneAsset': 'Use save_current_scene for the active editor scene; arbitrary serialized scene replacement is not supported by save_asset.',
    'cc.Prefab': 'Use save_prefab_edit_mode for the open prefab or edit_prefab_json for the verified serialized prefab workflow.',
    'cc.AnimationClip': 'Animation clip saving is not yet implemented; OP-209 requires separate curve/event persistence verification.',
    'cc.Script': 'Edit source scripts with the script/file tools and verify compilation; save_asset does not write script source.',
    'cc.ImageAsset': 'Image replacement requires a verified import/reimport workflow and is not implemented by save_asset.',
    'cc.AudioClip': 'Audio replacement requires a verified import/reimport workflow and is not implemented by save_asset.',
  };
  if (info && info.isDirectory === true) return 'save_asset does not save directories.';
  return guidance[info && info.type] ||
    'save_asset currently supports only imported JSON and text main assets; use a type-specific workflow for this asset.';
}

function assertRealFileInsideAssets(assetsRoot, filePath, label) {
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`${label} must be a regular file and must not be a symbolic link.`);
  }
  const rootStat = fs.lstatSync(assetsRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error('The project assets directory must be a real directory.');
  }
  const realRoot = fs.realpathSync(assetsRoot);
  const realFile = fs.realpathSync(filePath);
  if (!isPathInside(realRoot, realFile) || path.resolve(realRoot) === path.resolve(realFile)) {
    throw new Error(`${label} resolves outside the project assets directory.`);
  }
  return stat;
}

function assertSaveableInfo(target, info) {
  const expected = SUPPORTED_ASSET_TYPES[target.extension];
  if (!info || !expected || info.type !== expected.type) {
    throw new Error(unsupportedSaveMessage(info));
  }
  if (info.imported !== true || info.invalid === true || info.readonly === true || info.isDirectory === true ||
      typeof info.uuid !== 'string' || !info.uuid || info.uuid.includes('@') ||
      typeof info.url !== 'string' || info.url !== target.dbUrl ||
      (info.source && info.source !== info.url) || info.importer !== expected.importer) {
    throw new Error('save_asset requires a writable, fully imported JSON or text main asset with matching UUID, URL, type, and importer.');
  }
  if (info.file && path.resolve(String(info.file)) !== path.resolve(target.filePath)) {
    throw new Error('asset-db source file does not match the requested target.');
  }
  if (subAssetIdentities(info).length) {
    throw new Error('JSON and text assets with imported subassets are not supported by save_asset.');
  }
}

async function snapshotAsset(projectPath, target, info, request) {
  assertSaveableInfo(target, info);
  const assetsRoot = resolveProjectFilePath(projectPath, 'assets');
  const sourceStat = assertRealFileInsideAssets(assetsRoot, target.filePath, 'Asset source');
  const metaStat = assertRealFileInsideAssets(assetsRoot, target.metaPath, 'Asset metadata');
  if (sourceStat.size > MAX_ASSET_BYTES) {
    throw new Error(`Existing asset exceeds the ${MAX_ASSET_BYTES}-byte save_asset limit.`);
  }
  const source = fs.readFileSync(target.filePath, 'utf8');
  if (source.includes('\0')) throw new Error('Existing asset source contains NUL bytes and is not supported as UTF-8 text.');
  const metaText = fs.readFileSync(target.metaPath, 'utf8');
  const diskMetadata = JSON.parse(metaText);
  const metadata = await request('query-asset-meta', info.uuid);
  const expected = SUPPORTED_ASSET_TYPES[target.extension];
  if (!metadata || metadata.uuid !== info.uuid || metadata.importer !== expected.importer ||
      diskMetadata.uuid !== info.uuid || diskMetadata.importer !== expected.importer) {
    throw new Error('Asset metadata UUID/importer does not match asset-db. No asset was saved.');
  }
  return {
    info,
    metadata,
    diskMetadata,
    source,
    sourceHash: sha256(source),
    metaHash: sha256(metaText),
    sourceSize: sourceStat.size,
    metaSize: metaStat.size,
  };
}

function assertSameIdentity(expected, actual, label) {
  if (!actual || actual.uuid !== expected.info.uuid || actual.url !== expected.info.url ||
      actual.type !== expected.info.type || actual.importer !== expected.info.importer) {
    throw new Error(`${label} identity changed while saving. Inspect the asset before retrying.`);
  }
}

function assertSnapshotUnchanged(expected, actual) {
  assertSameIdentity(expected, actual.info, 'Asset');
  if (actual.sourceHash !== expected.sourceHash || actual.metaHash !== expected.metaHash ||
      !isDeepStrictEqual(actual.metadata, expected.metadata) ||
      !isDeepStrictEqual(actual.diskMetadata, expected.diskMetadata)) {
    throw new Error('Asset source or metadata changed during save preflight. No save was requested.');
  }
}

async function readConsistentSnapshot(projectPath, target, identity, request) {
  const byUuid = await request('query-asset-info', identity.info.uuid);
  const byUrl = await request('query-asset-info', identity.info.url);
  assertSameIdentity(identity, byUuid, 'UUID lookup');
  assertSameIdentity(identity, byUrl, 'URL lookup');
  return snapshotAsset(projectPath, target, byUuid, request);
}

async function verifySavedAsset(projectPath, target, identity, content, contentHash, request) {
  const current = await readConsistentSnapshot(projectPath, target, identity, request);
  if (current.source !== content || current.sourceHash !== contentHash) {
    throw new Error('Saved source content differs from the requested content.');
  }
  if (current.metaHash !== identity.metaHash ||
      !isDeepStrictEqual(current.metadata, identity.metadata) ||
      !isDeepStrictEqual(current.diskMetadata, identity.diskMetadata)) {
    throw new Error('Asset metadata changed while saving JSON/text content.');
  }
  if (await request('query-ready') !== true) throw new Error('Asset database is not ready.');
  return current;
}

async function saveAsset(projectPath, options = {}) {
  const request = options.request || requestAssetDb;
  const retries = options.retries === undefined ? 12 : options.retries;
  const retryDelayMs = options.retryDelayMs === undefined ? 100 : options.retryDelayMs;
  const settleDelayMs = options.settleDelayMs === undefined ? 400 : options.settleDelayMs;
  if (!Number.isInteger(retries) || retries < 0 || retries > 100) {
    throw new Error('retries must be an integer between 0 and 100.');
  }
  for (const [label, value] of [['retryDelayMs', retryDelayMs], ['settleDelayMs', settleDelayMs]]) {
    if (!Number.isInteger(value) || value < 0 || value > 10000) {
      throw new Error(`${label} must be an integer between 0 and 10000.`);
    }
  }
  const expectedSha256 = normalizeExpectedSha256(options.expectedSha256);
  const lookup = normalizeCopySourceTarget(projectPath, options.target);
  if (await request('query-ready') !== true) throw new Error('Asset database must be ready before saving an asset.');
  const info = await request('query-asset-info', lookup);
  if (!info || !info.uuid || !info.url) throw new Error(`Asset not found: ${lookup}`);
  if (info.isDirectory === true || String(info.uuid).includes('@') ||
      !Object.values(SUPPORTED_ASSET_TYPES).some((expected) => expected.type === info.type)) {
    throw new Error(unsupportedSaveMessage(info));
  }
  const target = normalizeAssetCreationTarget(projectPath, info.url);
  const contentState = validateSaveContent(target, options.content);
  const initial = await snapshotAsset(projectPath, target, info, request);
  if (expectedSha256 && initial.sourceHash !== expectedSha256) {
    throw new Error(`Asset source SHA-256 conflict: expected ${expectedSha256}, current ${initial.sourceHash}. No save was requested.`);
  }

  const beforeWrite = await readConsistentSnapshot(projectPath, target, initial, request);
  assertSnapshotUnchanged(initial, beforeWrite);
  if (beforeWrite.sourceHash === contentState.hash && beforeWrite.source === options.content) {
    await delay(settleDelayMs);
    const settled = await readConsistentSnapshot(projectPath, target, initial, request);
    assertSnapshotUnchanged(initial, settled);
    if (await request('query-ready') !== true) throw new Error('Asset database is not ready.');
    return {
      saved: false,
      unchanged: true,
      method: 'none',
      result: null,
      dbUrl: target.dbUrl,
      path: target.projectRelative,
      uuid: settled.info.uuid,
      type: settled.info.type,
      importer: settled.info.importer,
      previousSha256: initial.sourceHash,
      sha256: contentState.hash,
      byteLength: contentState.byteLength,
      verification: {
        sourceMatches: true,
        identityPreserved: true,
        metadataPreserved: true,
        imported: true,
        databaseReady: true,
        stableAfterSettle: true,
      },
    };
  }

  let result;
  try {
    result = await request('save-asset', target.dbUrl, options.content);
  } catch (error) {
    throw new Error(`asset-db:save-asset failed for ${target.dbUrl}: ${error.message}. The source may already have changed; inspect its content, UUID, and metadata before retrying.`, { cause: error });
  }

  let verificationError = 'verification did not run';
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      await verifySavedAsset(projectPath, target, initial, options.content, contentState.hash, request);
      await delay(settleDelayMs);
      const settled = await verifySavedAsset(projectPath, target, initial, options.content, contentState.hash, request);
      return {
        saved: true,
        unchanged: false,
        method: 'asset-db:save-asset',
        result,
        dbUrl: target.dbUrl,
        path: target.projectRelative,
        uuid: settled.info.uuid,
        type: settled.info.type,
        importer: settled.info.importer,
        previousSha256: initial.sourceHash,
        sha256: contentState.hash,
        byteLength: contentState.byteLength,
        verification: {
          sourceMatches: true,
          identityPreserved: true,
          metadataPreserved: true,
          imported: true,
          databaseReady: true,
          stableAfterSettle: true,
        },
      };
    } catch (error) {
      verificationError = error.message;
      if (attempt < retries) await delay(retryDelayMs);
    }
  }
  throw new Error(`asset-db:save-asset returned for ${target.dbUrl}, but verification failed: ${verificationError}. The source may already have changed; inspect it before retrying. No second save was requested.`);
}

module.exports = {
  normalizeExpectedSha256,
  saveAsset,
  unsupportedSaveMessage,
  validateSaveContent,
};
