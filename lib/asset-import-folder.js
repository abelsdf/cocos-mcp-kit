'use strict';

const fs = require('fs');
const path = require('path');
const { isDeepStrictEqual } = require('util');
const { MAX_COPY_BYTES, normalizeCopyTarget } = require('./asset-copy');
const { normalizeImportSource, verifyImportedAsset } = require('./asset-import');
const { isPathInside, resolveProjectFilePath } = require('./path-safety');

const MAX_FILES = 64;
const MAX_DIRECTORIES = 16;
const MAX_DEPTH = 4;
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function requestAssetDb(method, ...args) {
  if (!global.Editor || !Editor.Message || typeof Editor.Message.request !== 'function') {
    throw new Error('Editor.Message.request is unavailable; import_folder requires Cocos asset-db.');
  }
  return Editor.Message.request('asset-db', method, ...args);
}

function assertUnlinkedParents(filePath, label) {
  const root = path.parse(filePath).root;
  let current = root;
  for (const segment of path.relative(root, path.dirname(filePath)).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (fs.lstatSync(current).isSymbolicLink()) {
      throw new Error(`${label} parent directories must not contain symbolic links.`);
    }
  }
}

function scanImportFolder(projectPath, source) {
  if (typeof source !== 'string' || !source.trim() || source.length > 4096 || source.includes('\0') ||
      !path.isAbsolute(source) || source.startsWith('\\\\') || source.startsWith('//')) {
    throw new Error('source must be a local absolute directory path of at most 4096 characters.');
  }
  const root = path.resolve(source);
  const assetsRoot = resolveProjectFilePath(projectPath, 'assets');
  if (isPathInside(assetsRoot, root)) {
    throw new Error('source is already inside project assets; use project asset tools.');
  }
  const rootStat = fs.lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error('source must be a regular directory, not a file or symbolic link.');
  }
  assertUnlinkedParents(root, 'source');
  if (fs.existsSync(`${root}.meta`)) {
    throw new Error('source directory has a .meta sidecar; import_folder does not transfer existing identities.');
  }
  const directories = [''];
  const files = [];
  let totalBytes = 0;
  function walk(directory, relative, depth) {
    const entries = fs.readdirSync(directory, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));
    if (entries.length > MAX_FILES + MAX_DIRECTORIES) {
      throw new Error('source directory has too many entries.');
    }
    for (const entry of entries) {
      if (entry.name.toLowerCase().endsWith('.meta')) {
        throw new Error('source contains a .meta sidecar; import_folder does not transfer existing identities.');
      }
      const child = path.join(directory, entry.name);
      const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
      const stat = fs.lstatSync(child);
      if (stat.isSymbolicLink()) throw new Error('source contains a symbolic link.');
      if (stat.isDirectory()) {
        if (depth >= MAX_DEPTH || directories.length >= MAX_DIRECTORIES) {
          throw new Error(`source exceeds ${MAX_DIRECTORIES} directories or ${MAX_DEPTH} levels.`);
        }
        directories.push(childRelative);
        walk(child, childRelative, depth + 1);
      } else if (stat.isFile()) {
        if (files.length >= MAX_FILES) throw new Error(`source exceeds ${MAX_FILES} files.`);
        const file = normalizeImportSource(projectPath, child);
        totalBytes += file.size;
        if (totalBytes > MAX_COPY_BYTES) {
          throw new Error(`source exceeds the ${MAX_COPY_BYTES}-byte aggregate import_folder limit.`);
        }
        files.push({ ...file, relative: childRelative });
      } else {
        throw new Error('source contains a non-regular filesystem entry.');
      }
    }
  }
  walk(root, '', 0);
  if (!files.length) throw new Error('source directory must contain at least one supported file.');
  directories.sort();
  files.sort((a, b) => a.relative.localeCompare(b.relative));
  return { root, directories, files, totalBytes };
}

function normalizeFolderTarget(projectPath, target) {
  if (typeof target !== 'string' || !target.trim() || target.length > 1024 ||
      target.includes('\0') || target.includes('?') || target.includes('#')) {
    throw new Error('target must be a plain new directory path of at most 1024 characters.');
  }
  const raw = target.trim().replace(/\\/g, '/');
  let relative;
  if (raw.startsWith('db://assets/')) relative = raw.slice('db://'.length);
  else if (raw.startsWith('/assets/')) relative = raw.slice(1);
  else if (raw.startsWith('assets/')) relative = raw;
  else if (raw.startsWith('db://')) throw new Error('target must be a project assets directory.');
  else if (path.isAbsolute(raw)) relative = raw;
  else relative = `assets/${raw}`;
  if (!path.isAbsolute(relative) && relative.split('/').some((part) => part === '.' || part === '..')) {
    throw new Error('target must not contain . or .. path segments.');
  }
  const filePath = resolveProjectFilePath(projectPath, relative);
  const assetsRoot = resolveProjectFilePath(projectPath, 'assets');
  if (!isPathInside(assetsRoot, filePath) || path.resolve(filePath) === path.resolve(assetsRoot)) {
    throw new Error('target must identify a new directory inside project assets.');
  }
  if (path.basename(filePath).toLowerCase().endsWith('.meta')) {
    throw new Error('target directory name must not end in .meta.');
  }
  const parent = path.dirname(filePath);
  if (!fs.existsSync(parent) || !fs.lstatSync(parent).isDirectory()) {
    throw new Error('target parent directory must already exist inside assets.');
  }
  assertUnlinkedParents(filePath, 'target');
  if (fs.lstatSync(assetsRoot).isSymbolicLink() || fs.lstatSync(parent).isSymbolicLink()) {
    throw new Error('target parent directories must not contain symbolic links.');
  }
  const projectRelative = path.relative(projectPath, filePath).replace(/\\/g, '/');
  return { filePath, metaPath: `${filePath}.meta`, projectRelative, dbUrl: `db://${projectRelative}` };
}

function sourceIdentity(source) {
  return {
    directories: source.directories,
    files: source.files.map(({ relative, size, hash }) => ({ relative, size, hash })),
    totalBytes: source.totalBytes,
  };
}

function assertSourceUnchanged(projectPath, source) {
  if (!isDeepStrictEqual(sourceIdentity(scanImportFolder(projectPath, source.root)), sourceIdentity(source))) {
    throw new Error('source folder changed during import; inspect it before retrying.');
  }
}

function scanTargetStructure(target) {
  const directories = [];
  const files = [];
  const metas = [];
  let entriesSeen = 0;
  function walk(directory, relative) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      entriesSeen += 1;
      if (entriesSeen > (MAX_FILES + MAX_DIRECTORIES) * 2) {
        throw new Error('Imported target contains too many entries.');
      }
      const child = path.join(directory, entry.name);
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      const stat = fs.lstatSync(child);
      if (stat.isSymbolicLink()) throw new Error('Imported target contains a symbolic link.');
      if (stat.isDirectory()) {
        directories.push(name);
        walk(child, name);
      } else if (stat.isFile()) {
        (name.toLowerCase().endsWith('.meta') ? metas : files).push(name);
      } else {
        throw new Error('Imported target contains a non-regular filesystem entry.');
      }
    }
  }
  walk(target.filePath, '');
  return { directories: directories.sort(), files: files.sort(), metas: metas.sort() };
}

async function verifyDirectory(projectPath, target, relative, request) {
  const filePath = relative ? path.join(target.filePath, relative) : target.filePath;
  const metaPath = `${filePath}.meta`;
  const dbUrl = relative ? `${target.dbUrl}/${relative}` : target.dbUrl;
  const stat = fs.lstatSync(filePath);
  const metaStat = fs.lstatSync(metaPath);
  const assetsRoot = fs.realpathSync(resolveProjectFilePath(projectPath, 'assets'));
  if (!stat.isDirectory() || stat.isSymbolicLink() || !metaStat.isFile() || metaStat.isSymbolicLink() ||
      !isPathInside(assetsRoot, fs.realpathSync(filePath)) ||
      !isPathInside(assetsRoot, fs.realpathSync(metaPath))) {
    throw new Error(`Imported directory or metadata is invalid: ${dbUrl}`);
  }
  const info = await request('query-asset-info', dbUrl);
  if (!info || !info.uuid || info.uuid.includes('@') || info.url !== dbUrl ||
      info.importer !== 'directory' || info.type !== 'cc.Asset' || info.isDirectory !== true ||
      info.imported !== true || info.invalid === true || info.readonly === true ||
      (info.file && path.resolve(String(info.file)) !== path.resolve(filePath))) {
    throw new Error(`asset-db did not import the expected directory: ${dbUrl}`);
  }
  const metadata = await request('query-asset-meta', info.uuid);
  const diskMeta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  if (!metadata || metadata.uuid !== info.uuid || metadata.importer !== 'directory' ||
      diskMeta.uuid !== info.uuid || diskMeta.importer !== 'directory') {
    throw new Error(`Imported directory metadata does not match asset-db: ${dbUrl}`);
  }
  return { relative, url: dbUrl, uuid: info.uuid, metadata, diskMeta };
}

async function verifyFolder(projectPath, source, target, request) {
  assertSourceUnchanged(projectPath, source);
  const structure = scanTargetStructure(target);
  const expected = {
    directories: source.directories.filter(Boolean).slice().sort(),
    files: source.files.map((file) => file.relative).sort(),
    metas: [
      ...source.directories.filter(Boolean).map((directory) => `${directory}.meta`),
      ...source.files.map((file) => `${file.relative}.meta`),
    ].sort(),
  };
  if (!isDeepStrictEqual(structure, expected)) {
    throw new Error('Imported folder structure or metadata sidecars do not match the external source.');
  }
  const directories = [];
  const assets = [];
  for (const relative of source.directories) {
    directories.push(await verifyDirectory(projectPath, target, relative, request));
  }
  for (const file of source.files) {
    const childTarget = normalizeCopyTarget(projectPath, path.join(target.projectRelative, file.relative));
    const verified = await verifyImportedAsset(projectPath, file, childTarget, request);
    assets.push({ relative: file.relative, url: childTarget.dbUrl, uuid: verified.info.uuid,
      type: verified.info.type, importer: verified.info.importer,
      subAssets: verified.subAssets, metadata: verified.metadata, diskMeta: verified.diskMeta,
      library: verified.library });
  }
  const identities = [...directories.map((item) => item.uuid),
    ...assets.flatMap((item) => [item.uuid, ...item.subAssets.map((sub) => sub.uuid)])];
  if (new Set(identities).size !== identities.length) {
    throw new Error('Imported folder contains duplicate main, directory, or subasset UUIDs.');
  }
  if (await request('query-ready') !== true) throw new Error('Asset database is not ready.');
  return { structure, directories, assets };
}

async function importFolder(projectPath, options = {}) {
  const request = options.request || requestAssetDb;
  const retries = options.retries === undefined ? 30 : options.retries;
  const retryDelayMs = options.retryDelayMs === undefined ? 250 : options.retryDelayMs;
  const settleDelayMs = options.settleDelayMs === undefined ? 400 : options.settleDelayMs;
  if (!Number.isInteger(retries) || retries < 0 || retries > 100 ||
      !Number.isInteger(retryDelayMs) || retryDelayMs < 0 || retryDelayMs > 10000 ||
      !Number.isInteger(settleDelayMs) || settleDelayMs < 0 || settleDelayMs > 10000) {
    throw new Error('Invalid bounded import polling options.');
  }
  const source = scanImportFolder(projectPath, options.source);
  const target = normalizeFolderTarget(projectPath, options.target);
  const childUrls = [
    ...source.directories.filter(Boolean),
    ...source.files.map((file) => file.relative),
  ].map((relative) => `${target.dbUrl}/${relative}`);
  async function assertNoDatabaseConflict() {
    for (const url of [target.dbUrl, ...childUrls]) {
      if (await request('query-asset-info', url)) {
        throw new Error(`Asset database already contains ${url}. import_folder never overwrites.`);
      }
    }
  }
  if (fs.existsSync(target.filePath) || fs.existsSync(target.metaPath)) {
    throw new Error(`Target directory or metadata already exists: ${target.projectRelative}. import_folder never overwrites.`);
  }
  if (await request('query-ready') !== true) throw new Error('Asset database must be ready before import.');
  await assertNoDatabaseConflict();
  assertSourceUnchanged(projectPath, source);
  if (fs.existsSync(target.filePath) || fs.existsSync(target.metaPath)) {
    throw new Error('Target appeared during import preflight. No import was requested.');
  }
  await assertNoDatabaseConflict();
  let result;
  try {
    result = await request('import-asset', source.root, target.dbUrl, { overwrite: false, rename: false });
  } catch (error) {
    const note = fs.existsSync(target.filePath) || fs.existsSync(target.metaPath)
      ? ' Target files now exist; inspect them before retrying.' : '';
    throw new Error(`asset-db:import-asset failed for ${target.dbUrl}: ${error.message}.${note} No second import was requested.`, { cause: error });
  }
  let verificationError = 'verification did not run';
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const verified = await verifyFolder(projectPath, source, target, request);
      await delay(settleDelayMs);
      const settled = await verifyFolder(projectPath, source, target, request);
      if (!isDeepStrictEqual(verified, settled)) {
        throw new Error('Imported folder identities, metadata, or library outputs have not settled.');
      }
      return {
        imported: true,
        overwritten: false,
        method: 'asset-db:import-asset',
        result,
        source: { path: source.root, fileCount: source.files.length,
          directoryCount: source.directories.length, byteLength: source.totalBytes },
        target: { path: target.projectRelative, url: target.dbUrl, uuid: settled.directories[0].uuid },
        directories: settled.directories.map(({ relative, url, uuid }) => ({ relative, url, uuid })),
        assets: settled.assets.map(({ relative, url, uuid, type, importer, subAssets }) =>
          ({ relative, url, uuid, type, importer, subAssetCount: subAssets.length })),
        verification: { sourceUnchanged: true, exactStructure: true, targetBytesMatch: true,
          metadataMatches: true, uniqueIdentities: true, libraryAvailable: true,
          databaseReady: true, stableAfterSettle: true },
      };
    } catch (error) {
      verificationError = error.message;
      if (attempt < retries) await delay(retryDelayMs);
    }
  }
  throw new Error(`asset-db:import-asset returned for ${target.dbUrl}, but folder verification failed: ${verificationError}. Inspect the target before retrying; no second import was requested.`);
}

module.exports = { importFolder, scanImportFolder, normalizeFolderTarget };
