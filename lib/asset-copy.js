'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { isDeepStrictEqual } = require('util');
const { isPathInside, resolveProjectFilePath } = require('./path-safety');

const MAX_COPY_BYTES = 64 * 1024 * 1024;
const SUPPORTED_COPY_TYPES = new Set(['cc.JsonAsset', 'cc.TextAsset', 'cc.ImageAsset', 'cc.AudioClip']);
const SUPPORTED_COPY_EXTENSIONS = new Set([
  '.json', '.txt',
  '.png', '.jpg', '.jpeg', '.webp',
  '.mp3', '.wav', '.ogg', '.m4a',
]);

function requestAssetDb(method, ...args) {
  if (!global.Editor || !Editor.Message || typeof Editor.Message.request !== 'function') {
    throw new Error('Editor.Message.request is unavailable; asset copying requires Cocos asset-db.');
  }
  return Editor.Message.request('asset-db', method, ...args);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
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

function getAssetsRoot(projectPath) {
  const assetsRoot = resolveProjectFilePath(projectPath, 'assets');
  if (!fs.existsSync(assetsRoot) || !fs.lstatSync(assetsRoot).isDirectory() || fs.lstatSync(assetsRoot).isSymbolicLink()) {
    throw new Error('The project assets directory must exist and must not be a symbolic link.');
  }
  return assetsRoot;
}

function normalizeCopySourceTarget(projectPath, source) {
  const raw = String(source || '').trim().replace(/\\/g, '/');
  if (!raw) throw new Error('source is required.');
  if (raw.length > 1024 || raw.includes('\0') || raw.includes('?') || raw.includes('#')) {
    throw new Error('source must be an exact asset UUID or plain path of at most 1024 characters.');
  }

  const assetsRoot = getAssetsRoot(projectPath);
  if (path.isAbsolute(raw)) {
    const filePath = resolveProjectFilePath(projectPath, raw);
    if (!isPathInside(assetsRoot, filePath) || path.resolve(filePath) === path.resolve(assetsRoot)) {
      throw new Error('source path must identify a file inside the Cocos assets directory.');
    }
    return `db://${path.relative(projectPath, filePath).replace(/\\/g, '/')}`;
  }
  if (raw.startsWith('db://assets/')) return raw;
  if (raw.startsWith('/assets/')) return `db://${raw.slice(1)}`;
  if (raw.startsWith('assets/')) return `db://${raw}`;
  if (raw.startsWith('db://')) throw new Error('source must be a project asset, not an internal asset.');
  if (raw.includes('/') || raw.includes('\\')) throw new Error('source paths must start with assets/ or db://assets/.');
  return raw;
}

function normalizeCopyTarget(projectPath, target) {
  const raw = String(target || '').trim().replace(/\\/g, '/');
  if (!raw) throw new Error('target is required.');
  if (raw.length > 1024 || raw.includes('\0') || raw.includes('?') || raw.includes('#')) {
    throw new Error('target must be a plain asset path of at most 1024 characters.');
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
    throw new Error('Unsupported target extension. copy_asset supports JSON, text, image, and audio assets; use specialized workflows for scenes, prefabs, scripts, metadata, and other formats.');
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

function subAssetIdentities(info) {
  return Object.entries(info && info.subAssets && typeof info.subAssets === 'object' ? info.subAssets : {})
    .map(([key, value]) => ({
      key,
      uuid: value && typeof value === 'object' ? String(value.uuid || '') : String(value || ''),
      type: value && typeof value === 'object' ? String(value.type || '') : '',
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

function metadataSettingsSnapshot(value, mainUuid) {
  if (typeof value === 'string') {
    return mainUuid ? value.split(mainUuid).join('$ASSET_UUID') : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => metadataSettingsSnapshot(item, mainUuid));
  }
  if (!value || typeof value !== 'object') return value;
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    // Creator derives imported subasset display names from the destination
    // filename. They are expected to change even when importer settings do not.
    if (key === 'displayName') continue;
    // query-asset-meta can materialize empty root identity fields on an older
    // source while omitting them from a newly copied target.
    if ((key === 'id' || key === 'name') && item === '') continue;
    result[key] = metadataSettingsSnapshot(item, mainUuid);
  }
  return result;
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
  if (stat.size > MAX_COPY_BYTES) throw new Error(`source exceeds the ${MAX_COPY_BYTES}-byte copy_asset limit.`);
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

function assertSubassetsCopied(sourceSubAssets, targetInfo) {
  const targetSubAssets = subAssetIdentities(targetInfo);
  if (!isDeepStrictEqual(sourceSubAssets.map((item) => item.key), targetSubAssets.map((item) => item.key)) ||
      !isDeepStrictEqual(sourceSubAssets.map((item) => item.type), targetSubAssets.map((item) => item.type))) {
    throw new Error('target subasset keys/types differ from the source.');
  }
  for (let index = 0; index < sourceSubAssets.length; index += 1) {
    const source = sourceSubAssets[index];
    const target = targetSubAssets[index];
    if (!target.uuid || target.uuid === source.uuid) throw new Error('target subassets did not receive distinct UUIDs.');
  }
  return targetSubAssets;
}

async function verifyCopiedAsset(projectPath, sourceInfo, sourceState, target, request) {
  if (!fs.existsSync(target.filePath) || !fs.existsSync(target.metaPath)) throw new Error('target source or metadata file is missing.');
  const targetStat = fs.lstatSync(target.filePath);
  const targetMetaStat = fs.lstatSync(target.metaPath);
  if (!targetStat.isFile() || targetStat.isSymbolicLink() || !targetMetaStat.isFile() || targetMetaStat.isSymbolicLink()) {
    throw new Error('target source and metadata must be regular files.');
  }
  const targetBytes = fs.readFileSync(target.filePath);
  if (!targetBytes.equals(sourceState.bytes)) throw new Error('target source bytes differ from the source asset.');

  const info = await request('query-asset-info', target.dbUrl);
  const metadata = info && info.uuid ? await request('query-asset-meta', info.uuid) : null;
  const diskMeta = JSON.parse(fs.readFileSync(target.metaPath, 'utf8'));
  if (!info || !info.uuid || info.uuid === sourceInfo.uuid || info.url !== target.dbUrl || info.type !== sourceInfo.type ||
      info.importer !== sourceState.importer || info.imported !== true || info.invalid === true ||
      info.readonly === true || info.isDirectory === true) {
    throw new Error('target is not a distinct, writable, fully imported copy of the source type.');
  }
  if (info.file && path.resolve(String(info.file)) !== path.resolve(target.filePath)) {
    throw new Error('target asset-db source file does not match the requested target.');
  }
  if (!metadata || metadata.uuid !== info.uuid || metadata.importer !== sourceState.importer ||
      diskMeta.uuid !== info.uuid || diskMeta.importer !== sourceState.importer ||
      !isDeepStrictEqual(
        metadataSettingsSnapshot(metadata, info.uuid),
        metadataSettingsSnapshot(sourceState.metadata, sourceInfo.uuid)
      )) {
    throw new Error('target metadata UUID/importer/settings do not match the copied asset.');
  }
  const targetSubAssets = assertSubassetsCopied(sourceState.subAssets, info);

  const currentSourceInfo = await request('query-asset-info', sourceInfo.uuid);
  const currentSourceMeta = await request('query-asset-meta', sourceInfo.uuid);
  if (!currentSourceInfo || currentSourceInfo.uuid !== sourceInfo.uuid || currentSourceInfo.url !== sourceInfo.url ||
      currentSourceInfo.type !== sourceInfo.type || currentSourceInfo.importer !== sourceInfo.importer ||
      currentSourceInfo.imported !== true || !currentSourceMeta || currentSourceMeta.uuid !== sourceInfo.uuid ||
      currentSourceMeta.importer !== sourceState.importer ||
      sha256(fs.readFileSync(sourceState.filePath)) !== sourceState.sourceHash ||
      sha256(fs.readFileSync(sourceState.metaPath, 'utf8')) !== sourceState.metaHash) {
    throw new Error('source asset or metadata changed during copy verification.');
  }
  if (await request('query-ready') !== true) throw new Error('asset database is not ready.');
  return { info, metadata, targetSubAssets };
}

async function copyAsset(projectPath, options = {}) {
  const request = options.request || requestAssetDb;
  const sourceTarget = normalizeCopySourceTarget(projectPath, options.source);
  const target = normalizeCopyTarget(projectPath, options.target);
  const retries = options.retries === undefined ? 12 : options.retries;
  const retryDelayMs = options.retryDelayMs === undefined ? 100 : options.retryDelayMs;
  const settleDelayMs = options.settleDelayMs === undefined ? 400 : options.settleDelayMs;
  if (!Number.isInteger(retries) || retries < 0 || retries > 100) throw new Error('retries must be an integer between 0 and 100.');
  if (await request('query-ready') !== true) throw new Error('Asset database must be ready before copying an asset.');

  const sourceInfo = await request('query-asset-info', sourceTarget);
  assertSourceInfo(sourceInfo, sourceTarget);
  const sourceMetadata = await request('query-asset-meta', sourceInfo.uuid);
  const sourceState = snapshotSource(projectPath, sourceInfo, sourceMetadata);
  const sourceExtension = path.extname(sourceState.filePath).toLowerCase();
  if (!SUPPORTED_COPY_EXTENSIONS.has(sourceExtension)) throw new Error('source extension is not supported by copy_asset.');
  if (sourceExtension !== target.extension) throw new Error('target must use the same file extension as the source.');
  if (path.resolve(sourceState.filePath).toLowerCase() === path.resolve(target.filePath).toLowerCase()) {
    throw new Error('source and target must be different assets.');
  }
  if (fs.existsSync(target.filePath) || fs.existsSync(target.metaPath)) {
    throw new Error(`Target asset or metadata already exists: ${target.projectRelative}. copy_asset never overwrites.`);
  }
  if (await request('query-asset-info', target.dbUrl)) {
    throw new Error(`Asset database already contains ${target.dbUrl}. copy_asset never overwrites.`);
  }

  let result;
  try {
    result = await request('copy-asset', sourceInfo.url, target.dbUrl);
  } catch (error) {
    const note = fs.existsSync(target.filePath) || fs.existsSync(target.metaPath)
      ? ' Files now exist at the target; inspect them before retrying.'
      : '';
    throw new Error(`asset-db:copy-asset failed from ${sourceInfo.url} to ${target.dbUrl}: ${error.message}.${note}`, { cause: error });
  }

  let verificationError = 'verification did not run';
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const verified = await verifyCopiedAsset(projectPath, sourceInfo, sourceState, target, request);
      await delay(settleDelayMs);
      const settled = await verifyCopiedAsset(projectPath, sourceInfo, sourceState, target, request);
      if (settled.info.uuid !== verified.info.uuid) throw new Error('target UUID changed while settling.');
      return {
        copied: true,
        overwritten: false,
        method: 'asset-db:copy-asset',
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
        verification: {
          sourceUnchanged: true,
          targetBytesMatch: true,
          metadataSettingsMatch: true,
          distinctMainUuid: true,
          distinctSubassetUuids: true,
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
  throw new Error(`asset-db:copy-asset returned for ${target.dbUrl}, but verification failed: ${verificationError}. The target may already exist; inspect it before retrying.`);
}

module.exports = {
  MAX_COPY_BYTES,
  SUPPORTED_COPY_EXTENSIONS,
  SUPPORTED_COPY_TYPES,
  copyAsset,
  normalizeCopySourceTarget,
  normalizeCopyTarget,
  metadataSettingsSnapshot,
  subAssetIdentities,
};
