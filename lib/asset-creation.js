'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { isPathInside, resolveProjectFilePath } = require('./path-safety');

const MAX_ASSET_BYTES = 1024 * 1024;
const SUPPORTED_ASSET_TYPES = Object.freeze({
  '.json': Object.freeze({ importer: 'json', type: 'cc.JsonAsset' }),
  '.txt': Object.freeze({ importer: 'text', type: 'cc.TextAsset' }),
});

function requestAssetDb(method, ...args) {
  if (!global.Editor || !Editor.Message || typeof Editor.Message.request !== 'function') {
    throw new Error('Editor.Message.request is unavailable; asset creation requires Cocos asset-db.');
  }
  return Editor.Message.request('asset-db', method, ...args);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function sha256(content) {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

function assertNoLinkedDirectories(assetsRoot, parentPath) {
  const relative = path.relative(assetsRoot, parentPath);
  let current = assetsRoot;
  for (const segment of relative ? relative.split(path.sep) : []) {
    current = path.join(current, segment);
    if (fs.lstatSync(current).isSymbolicLink()) {
      throw new Error('target parent directories must not contain symbolic links.');
    }
  }
}

function normalizeAssetCreationTarget(projectPath, target) {
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
  const assetsRoot = resolveProjectFilePath(projectPath, 'assets');
  if (!fs.existsSync(assetsRoot) || !fs.lstatSync(assetsRoot).isDirectory() || fs.lstatSync(assetsRoot).isSymbolicLink()) {
    throw new Error('The project assets directory must exist and must not be a symbolic link.');
  }
  if (!isPathInside(assetsRoot, filePath) || path.resolve(filePath) === path.resolve(assetsRoot)) {
    throw new Error('target must identify a file inside the Cocos assets directory.');
  }

  const extension = path.extname(filePath).toLowerCase();
  const expected = SUPPORTED_ASSET_TYPES[extension];
  if (!expected) {
    throw new Error('Unsupported asset extension. create_asset currently accepts only .json and .txt; use specialized scene, prefab, script, or binary asset workflows for other formats.');
  }

  const parentPath = path.dirname(filePath);
  if (!fs.existsSync(parentPath) || !fs.lstatSync(parentPath).isDirectory()) {
    throw new Error('target parent directory must already exist inside assets.');
  }
  assertNoLinkedDirectories(assetsRoot, parentPath);

  const projectRelative = path.relative(projectPath, filePath).replace(/\\/g, '/');
  return {
    filePath,
    metaPath: `${filePath}.meta`,
    parentPath,
    projectRelative,
    dbUrl: `db://${projectRelative}`,
    extension,
    expectedImporter: expected.importer,
    expectedType: expected.type,
  };
}

function validateAssetContent(target, content) {
  if (typeof content !== 'string') throw new Error('content must be a string.');
  if (content.includes('\0')) throw new Error('content must be UTF-8 text and must not contain NUL bytes.');
  const byteLength = Buffer.byteLength(content, 'utf8');
  if (byteLength > MAX_ASSET_BYTES) {
    throw new Error(`content exceeds the ${MAX_ASSET_BYTES}-byte create_asset limit.`);
  }
  if (target.extension === '.json') {
    try {
      JSON.parse(content);
    } catch (error) {
      throw new Error(`content is not valid JSON: ${error.message}`);
    }
  }
  return { byteLength, hash: sha256(content) };
}

function readVerifiedFiles(target, content, expectedHash) {
  const sourceStat = fs.lstatSync(target.filePath);
  const metaStat = fs.lstatSync(target.metaPath);
  if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) throw new Error('source is not a regular file.');
  if (!metaStat.isFile() || metaStat.isSymbolicLink()) throw new Error('metadata is not a regular file.');

  const saved = fs.readFileSync(target.filePath, 'utf8');
  if (saved !== content || sha256(saved) !== expectedHash) throw new Error('saved source content differs from the requested content.');
  const diskMeta = JSON.parse(fs.readFileSync(target.metaPath, 'utf8'));
  return { diskMeta, sourceStat, metaStat };
}

function assertImportedIdentity(target, info, metadata, diskMeta) {
  if (!info || typeof info.uuid !== 'string' || !info.uuid || info.url !== target.dbUrl ||
      info.type !== target.expectedType || info.imported !== true || info.invalid === true ||
      info.readonly === true || info.isDirectory === true) {
    throw new Error(`asset-db did not return a writable imported ${target.expectedType} with the expected URL.`);
  }
  if (info.file && path.resolve(String(info.file)) !== path.resolve(target.filePath)) {
    throw new Error('asset-db source file does not match the requested target.');
  }
  if (!diskMeta || diskMeta.uuid !== info.uuid || diskMeta.importer !== target.expectedImporter) {
    throw new Error('disk metadata UUID/importer does not match asset-db.');
  }
  if (!metadata || metadata.uuid !== info.uuid || metadata.importer !== target.expectedImporter) {
    throw new Error('asset-db metadata UUID/importer does not match the imported asset.');
  }
}

async function verifyCreatedAsset(target, content, expectedHash, request) {
  const files = readVerifiedFiles(target, content, expectedHash);
  const info = await request('query-asset-info', target.dbUrl);
  const metadata = info && info.uuid ? await request('query-asset-meta', info.uuid) : null;
  assertImportedIdentity(target, info, metadata, files.diskMeta);
  if (await request('query-ready') !== true) throw new Error('asset database is not ready.');
  return { ...files, info, metadata };
}

async function createAsset(projectPath, options = {}) {
  const target = normalizeAssetCreationTarget(projectPath, options.target);
  const content = options.content;
  const contentState = validateAssetContent(target, content);
  const request = options.request || requestAssetDb;
  const retries = options.retries === undefined ? 12 : options.retries;
  const retryDelayMs = options.retryDelayMs === undefined ? 100 : options.retryDelayMs;
  const settleDelayMs = options.settleDelayMs === undefined ? 400 : options.settleDelayMs;
  if (!Number.isInteger(retries) || retries < 0 || retries > 100) throw new Error('retries must be an integer between 0 and 100.');

  if (fs.existsSync(target.filePath) || fs.existsSync(target.metaPath)) {
    throw new Error(`Target asset or metadata already exists: ${target.projectRelative}. create_asset never overwrites.`);
  }
  if (await request('query-ready') !== true) throw new Error('Asset database must be ready before creating an asset.');
  const existing = await request('query-asset-info', target.dbUrl);
  if (existing) throw new Error(`Asset database already contains ${target.dbUrl}. create_asset never overwrites.`);

  let result;
  try {
    result = await request('create-asset', target.dbUrl, content);
  } catch (error) {
    const note = fs.existsSync(target.filePath) || fs.existsSync(target.metaPath)
      ? ' Files now exist at the target; inspect them before retrying.'
      : '';
    throw new Error(`asset-db:create-asset failed for ${target.dbUrl}: ${error.message}.${note}`, { cause: error });
  }

  let verificationError = 'verification did not run';
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const verified = await verifyCreatedAsset(target, content, contentState.hash, request);
      await delay(settleDelayMs);
      const settled = await verifyCreatedAsset(target, content, contentState.hash, request);
      if (settled.info.uuid !== verified.info.uuid) throw new Error('asset UUID changed while settling.');
      return {
        created: true,
        overwritten: false,
        method: 'asset-db:create-asset',
        result,
        dbUrl: target.dbUrl,
        path: target.projectRelative,
        uuid: settled.info.uuid,
        type: settled.info.type,
        importer: settled.metadata.importer,
        byteLength: contentState.byteLength,
        sha256: contentState.hash,
        verification: {
          sourceMatches: true,
          metadataMatches: true,
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

  throw new Error(`asset-db:create-asset returned for ${target.dbUrl}, but verification failed: ${verificationError}. The asset may already exist; inspect it before retrying.`);
}

module.exports = {
  MAX_ASSET_BYTES,
  SUPPORTED_ASSET_TYPES,
  createAsset,
  normalizeAssetCreationTarget,
  validateAssetContent,
};
