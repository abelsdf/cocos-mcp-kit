'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { isDeepStrictEqual } = require('util');
const {
  MAX_COPY_BYTES,
  SUPPORTED_COPY_EXTENSIONS,
  SUPPORTED_COPY_TYPES,
  metadataSettingsSnapshot,
  normalizeCopySourceTarget,
  subAssetIdentities,
} = require('./asset-copy');
const { isPathInside, resolveProjectFilePath } = require('./path-safety');

function requestAssetDb(method, ...args) {
  if (!global.Editor || !Editor.Message || typeof Editor.Message.request !== 'function') {
    throw new Error('Editor.Message.request is unavailable; asset moving requires Cocos asset-db.');
  }
  return Editor.Message.request('asset-db', method, ...args);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function getAssetsRoot(projectPath) {
  const assetsRoot = resolveProjectFilePath(projectPath, 'assets');
  if (!fs.existsSync(assetsRoot) || !fs.lstatSync(assetsRoot).isDirectory() || fs.lstatSync(assetsRoot).isSymbolicLink()) {
    throw new Error('The project assets directory must exist and must not be a symbolic link.');
  }
  return assetsRoot;
}

function assertNoLinkedDirectories(assetsRoot, parentPath, label) {
  const relative = path.relative(assetsRoot, parentPath);
  let current = assetsRoot;
  for (const segment of relative ? relative.split(path.sep) : []) {
    current = path.join(current, segment);
    if (fs.lstatSync(current).isSymbolicLink()) {
      throw new Error(`${label} directories must not contain symbolic links.`);
    }
  }
}

function normalizeMoveTarget(projectPath, target) {
  const raw = String(target || '').trim().replace(/\\/g, '/');
  if (!raw) throw new Error('target is required.');
  if (raw.length > 1024 || raw.includes('\0') || raw.includes('?') || raw.includes('#')) {
    throw new Error('target must be a plain asset path of at most 1024 characters.');
  }
  if (raw.startsWith('db://') && !raw.startsWith('db://assets/')) {
    throw new Error('target db URL must be inside the Cocos assets directory.');
  }

  let relative;
  if (raw.startsWith('db://assets/')) relative = raw.slice('db://'.length);
  else if (raw.startsWith('/assets/')) relative = raw.slice(1);
  else if (raw.startsWith('assets/')) relative = raw;
  else if (path.isAbsolute(raw)) relative = raw;
  else relative = `assets/${raw}`;
  if (!path.isAbsolute(relative) && relative.split('/').some((segment) => segment === '.' || segment === '..')) {
    throw new Error('target must not contain . or .. path segments.');
  }

  const filePath = resolveProjectFilePath(projectPath, relative);
  const assetsRoot = getAssetsRoot(projectPath);
  if (!isPathInside(assetsRoot, filePath) || path.resolve(filePath) === path.resolve(assetsRoot)) {
    throw new Error('target must identify a file inside the Cocos assets directory.');
  }
  const extension = path.extname(filePath).toLowerCase();
  if (!SUPPORTED_COPY_EXTENSIONS.has(extension)) {
    throw new Error('Unsupported target extension. move_asset supports JSON, text, image, and audio assets; use specialized workflows for scenes, prefabs, scripts, metadata, and other formats.');
  }
  const parentPath = path.dirname(filePath);
  if (!fs.existsSync(parentPath) || !fs.lstatSync(parentPath).isDirectory()) {
    throw new Error('target parent directory must already exist inside assets.');
  }
  assertNoLinkedDirectories(assetsRoot, parentPath, 'target parent');
  const projectRelative = path.relative(projectPath, filePath).replace(/\\/g, '/');
  return {
    filePath,
    metaPath: `${filePath}.meta`,
    projectRelative,
    dbUrl: `db://${projectRelative}`,
    extension,
  };
}

function assetFileFromInfo(projectPath, info) {
  const filePath = info && info.file
    ? resolveProjectFilePath(projectPath, String(info.file))
    : resolveProjectFilePath(projectPath, String(info.url || '').slice('db://'.length));
  const assetsRoot = getAssetsRoot(projectPath);
  if (!isPathInside(assetsRoot, filePath) || !fs.existsSync(filePath)) {
    throw new Error('source file is missing or outside project assets.');
  }
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('source must be a regular asset file.');
  assertNoLinkedDirectories(assetsRoot, path.dirname(filePath), 'source parent');
  const expectedUrl = `db://${path.relative(projectPath, filePath).replace(/\\/g, '/')}`;
  if (expectedUrl !== info.url) throw new Error('source file path does not match its asset-db URL.');
  return { filePath, stat };
}

function assertSourceInfo(info, sourceTarget) {
  if (!info || typeof info.uuid !== 'string' || !info.uuid || typeof info.url !== 'string' ||
      !info.url.startsWith('db://assets/') || !SUPPORTED_COPY_TYPES.has(info.type) ||
      info.imported !== true || info.invalid === true || info.readonly === true || info.isDirectory === true) {
    throw new Error(`Source must be a writable imported JSON, text, image, or audio main asset: ${sourceTarget}`);
  }
  if (info.uuid.includes('@') || (info.source && info.source !== info.url)) {
    throw new Error('source must be a main asset, not an imported subasset.');
  }
}

function snapshotSource(projectPath, info, metadata) {
  const { filePath, stat } = assetFileFromInfo(projectPath, info);
  if (stat.size > MAX_COPY_BYTES) throw new Error(`source exceeds the ${MAX_COPY_BYTES}-byte move_asset limit.`);
  const metaPath = `${filePath}.meta`;
  if (!fs.existsSync(metaPath) || !fs.lstatSync(metaPath).isFile() || fs.lstatSync(metaPath).isSymbolicLink()) {
    throw new Error('source metadata file is missing or is not a regular file.');
  }
  const bytes = fs.readFileSync(filePath);
  const metaText = fs.readFileSync(metaPath, 'utf8');
  const diskMeta = JSON.parse(metaText);
  const importer = String((metadata && metadata.importer) || info.importer || diskMeta.importer || '');
  if (!importer || diskMeta.uuid !== info.uuid || diskMeta.importer !== importer ||
      !metadata || metadata.uuid !== info.uuid || metadata.importer !== importer) {
    throw new Error('source metadata UUID/importer does not match asset-db.');
  }
  return {
    filePath,
    metaPath,
    bytes,
    sourceHash: sha256(bytes),
    metaHash: sha256(metaText),
    importer,
    metadata,
    subAssets: subAssetIdentities(info),
  };
}

function assertSubassetsPreserved(sourceSubAssets, targetInfo) {
  const targetSubAssets = subAssetIdentities(targetInfo);
  if (!isDeepStrictEqual(sourceSubAssets, targetSubAssets)) {
    throw new Error('target subasset keys, types, or UUIDs differ from the source.');
  }
  return targetSubAssets;
}

async function verifySourceUnchanged(sourceInfo, sourceState, request) {
  const currentInfo = await request('query-asset-info', sourceInfo.uuid);
  const currentMeta = await request('query-asset-meta', sourceInfo.uuid);
  if (!currentInfo || currentInfo.uuid !== sourceInfo.uuid || currentInfo.url !== sourceInfo.url ||
      currentInfo.type !== sourceInfo.type || currentInfo.importer !== sourceInfo.importer ||
      currentInfo.imported !== true || !currentMeta || currentMeta.uuid !== sourceInfo.uuid ||
      currentMeta.importer !== sourceState.importer ||
      !fs.existsSync(sourceState.filePath) || !fs.existsSync(sourceState.metaPath) ||
      sha256(fs.readFileSync(sourceState.filePath)) !== sourceState.sourceHash ||
      sha256(fs.readFileSync(sourceState.metaPath, 'utf8')) !== sourceState.metaHash) {
    throw new Error('source asset changed before the move request.');
  }
}

async function verifyMovedAsset(projectPath, sourceInfo, sourceState, target, request) {
  if (fs.existsSync(sourceState.filePath) || fs.existsSync(sourceState.metaPath)) {
    throw new Error('source file or metadata still exists after the move.');
  }
  if (!fs.existsSync(target.filePath) || !fs.existsSync(target.metaPath)) {
    throw new Error('target source or metadata file is missing.');
  }
  const targetStat = fs.lstatSync(target.filePath);
  const targetMetaStat = fs.lstatSync(target.metaPath);
  if (!targetStat.isFile() || targetStat.isSymbolicLink() || !targetMetaStat.isFile() || targetMetaStat.isSymbolicLink()) {
    throw new Error('target source and metadata must be regular files.');
  }
  const targetBytes = fs.readFileSync(target.filePath);
  if (!targetBytes.equals(sourceState.bytes)) throw new Error('target source bytes differ from the original source asset.');

  const info = await request('query-asset-info', target.dbUrl);
  const byUuid = await request('query-asset-info', sourceInfo.uuid);
  const oldInfo = await request('query-asset-info', sourceInfo.url);
  const metadata = info && info.uuid ? await request('query-asset-meta', info.uuid) : null;
  const diskMeta = JSON.parse(fs.readFileSync(target.metaPath, 'utf8'));
  if (!info || info.uuid !== sourceInfo.uuid || info.url !== target.dbUrl || info.type !== sourceInfo.type ||
      info.importer !== sourceState.importer || info.imported !== true || info.invalid === true ||
      info.readonly === true || info.isDirectory === true) {
    throw new Error('target did not preserve the writable imported source identity and type.');
  }
  if (!byUuid || byUuid.uuid !== sourceInfo.uuid || byUuid.url !== target.dbUrl || oldInfo) {
    throw new Error('asset-db UUID or old/new URL mappings do not confirm the move.');
  }
  if (info.file && path.resolve(String(info.file)) !== path.resolve(target.filePath)) {
    throw new Error('target asset-db source file does not match the requested target.');
  }
  if (!metadata || metadata.uuid !== sourceInfo.uuid || metadata.importer !== sourceState.importer ||
      diskMeta.uuid !== sourceInfo.uuid || diskMeta.importer !== sourceState.importer ||
      !isDeepStrictEqual(
        metadataSettingsSnapshot(metadata, sourceInfo.uuid),
        metadataSettingsSnapshot(sourceState.metadata, sourceInfo.uuid)
      )) {
    throw new Error('target metadata UUID/importer/settings do not preserve the source asset.');
  }
  const targetSubAssets = assertSubassetsPreserved(sourceState.subAssets, info);
  if (await request('query-ready') !== true) throw new Error('asset database is not ready.');
  return { info, metadata, targetSubAssets };
}

async function moveAsset(projectPath, options = {}) {
  const request = options.request || requestAssetDb;
  const sourceTarget = normalizeCopySourceTarget(projectPath, options.source);
  const target = normalizeMoveTarget(projectPath, options.target);
  const retries = options.retries === undefined ? 12 : options.retries;
  const retryDelayMs = options.retryDelayMs === undefined ? 100 : options.retryDelayMs;
  const settleDelayMs = options.settleDelayMs === undefined ? 400 : options.settleDelayMs;
  if (!Number.isInteger(retries) || retries < 0 || retries > 100) throw new Error('retries must be an integer between 0 and 100.');
  if (await request('query-ready') !== true) throw new Error('Asset database must be ready before moving an asset.');

  const sourceInfo = await request('query-asset-info', sourceTarget);
  assertSourceInfo(sourceInfo, sourceTarget);
  const sourceMetadata = await request('query-asset-meta', sourceInfo.uuid);
  const sourceState = snapshotSource(projectPath, sourceInfo, sourceMetadata);
  const sourceExtension = path.extname(sourceState.filePath).toLowerCase();
  if (!SUPPORTED_COPY_EXTENSIONS.has(sourceExtension)) throw new Error('source extension is not supported by move_asset.');
  if (sourceExtension !== target.extension) throw new Error('target must use the same file extension as the source.');
  if (path.resolve(sourceState.filePath).toLowerCase() === path.resolve(target.filePath).toLowerCase()) {
    throw new Error('source and target must be different assets; case-only moves are not supported.');
  }
  if (fs.existsSync(target.filePath) || fs.existsSync(target.metaPath)) {
    throw new Error(`Target asset or metadata already exists: ${target.projectRelative}. move_asset never overwrites.`);
  }
  if (await request('query-asset-info', target.dbUrl)) {
    throw new Error(`Asset database already contains ${target.dbUrl}. move_asset never overwrites.`);
  }

  await verifySourceUnchanged(sourceInfo, sourceState, request);
  if (await request('query-asset-info', target.dbUrl)) {
    throw new Error(`Asset database acquired ${target.dbUrl} before the move. move_asset never overwrites.`);
  }

  let result;
  try {
    result = await request('move-asset', sourceInfo.url, target.dbUrl);
  } catch (error) {
    const uncertain = !fs.existsSync(sourceState.filePath) || !fs.existsSync(sourceState.metaPath) ||
      fs.existsSync(target.filePath) || fs.existsSync(target.metaPath);
    const note = uncertain ? ' Source or target state changed; inspect both exact paths before retrying.' : '';
    throw new Error(`asset-db:move-asset failed from ${sourceInfo.url} to ${target.dbUrl}: ${error.message}.${note}`, { cause: error });
  }

  let verificationError = 'verification did not run';
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const verified = await verifyMovedAsset(projectPath, sourceInfo, sourceState, target, request);
      await delay(settleDelayMs);
      const settled = await verifyMovedAsset(projectPath, sourceInfo, sourceState, target, request);
      if (settled.info.uuid !== verified.info.uuid) throw new Error('asset UUID changed while settling.');
      return {
        moved: true,
        overwritten: false,
        method: 'asset-db:move-asset',
        result,
        source: {
          path: path.relative(projectPath, sourceState.filePath).replace(/\\/g, '/'),
          url: sourceInfo.url,
          uuid: sourceInfo.uuid,
          type: sourceInfo.type,
          importer: sourceState.importer,
          sha256: sourceState.sourceHash,
        },
        target: {
          path: target.projectRelative,
          url: target.dbUrl,
          uuid: settled.info.uuid,
          type: settled.info.type,
          importer: settled.metadata.importer,
          sha256: sha256(fs.readFileSync(target.filePath)),
        },
        byteLength: sourceState.bytes.length,
        subAssetCount: settled.targetSubAssets.length,
        warnings: ['UUID references remain valid; string or path-based references are not discovered or rewritten.'],
        verification: {
          sourceRemoved: true,
          targetBytesMatch: true,
          identityPreserved: true,
          subassetIdentitiesPreserved: true,
          metadataSettingsMatch: true,
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
  throw new Error(`asset-db:move-asset returned for ${target.dbUrl}, but verification failed: ${verificationError}. Inspect the old and new paths before retrying; move_asset does not retry or roll back writes.`);
}

module.exports = {
  moveAsset,
  normalizeMoveTarget,
  assertSubassetsPreserved,
};
