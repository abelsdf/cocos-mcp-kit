'use strict';

const fs = require('fs');
const path = require('path');
const { isPathInside, resolveProjectFilePath } = require('./path-safety');

async function safeRequest(channel, method, ...args) {
  if (!global.Editor || !Editor.Message || typeof Editor.Message.request !== 'function') {
    throw new Error('Editor.Message.request is unavailable in the Cocos extension host.');
  }
  return await Editor.Message.request(channel, method, ...args);
}

function buildAssetTargetCandidates(uuidOrPath) {
  const raw = String(uuidOrPath || '').trim().replace(/\\/g, '/');
  const candidates = [];
  const add = (value) => {
    if (value && !candidates.includes(value)) {
      candidates.push(value);
    }
  };

  add(raw);

  if (raw.startsWith('assets/')) {
    add(`db://${raw}`);
  } else if (raw.startsWith('/assets/')) {
    add(`db://${raw.slice(1)}`);
  }

  if (raw.includes('/assets/')) {
    add(`db://assets/${raw.split('/assets/').pop()}`);
  }

  if (raw.startsWith('db://assets/') && !raw.match(/\.[a-z0-9]+$/i)) {
    add(`${raw}.scene`);
    add(`${raw}.prefab`);
    add(`${raw}.ts`);
  }

  return candidates;
}

async function requestFirst(method, uuidOrPath) {
  const candidates = buildAssetTargetCandidates(uuidOrPath);
  let lastError = null;

  for (const candidate of candidates) {
    try {
      const result = await safeRequest('asset-db', method, candidate);
      if (result != null) {
        return result;
      }
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError) {
    throw lastError;
  }
  return null;
}

async function listAssets(options = {}) {
  const payload = {};
  if (options.pattern) {
    payload.pattern = options.pattern;
  }
  if (options.ccType) {
    payload.ccType = options.ccType;
  }
  const result = await safeRequest('asset-db', 'query-assets', payload);
  return Array.isArray(result) ? result : [];
}

async function queryAssetInfo(uuidOrPath) {
  if (!uuidOrPath) {
    throw new Error('Asset uuid or path is required.');
  }

  const direct = await requestFirst('query-asset-info', uuidOrPath);
  if (direct) {
    return direct;
  }

  const url = await queryAssetUrl(uuidOrPath).catch(() => null);
  if (url) {
    const fromUrl = await safeRequest('asset-db', 'query-asset-info', url);
    if (fromUrl) {
      return fromUrl;
    }
  }

  throw new Error(`Asset not found: ${uuidOrPath}`);
}

async function queryAssetMeta(uuidOrPath) {
  if (!uuidOrPath) {
    throw new Error('Asset uuid or path is required.');
  }

  const direct = await requestFirst('query-asset-meta', uuidOrPath);
  if (direct) {
    return direct;
  }

  const info = await queryAssetInfo(uuidOrPath);
  return await safeRequest('asset-db', 'query-asset-meta', info.uuid || info.url || uuidOrPath);
}

async function queryAssetData(uuidOrPath) {
  if (!uuidOrPath) {
    throw new Error('Asset uuid or path is required.');
  }

  const direct = await requestFirst('query-asset-data', uuidOrPath);
  if (direct) {
    return direct;
  }

  const info = await queryAssetInfo(uuidOrPath);
  return await safeRequest('asset-db', 'query-asset-data', info.uuid || info.url || uuidOrPath);
}

async function queryAssetUrl(uuidOrPath) {
  if (!uuidOrPath) {
    throw new Error('Asset uuid or path is required.');
  }
  const result = await requestFirst('query-url', uuidOrPath);
  if (result) {
    return result;
  }
  throw new Error(`Asset URL not found: ${uuidOrPath}`);
}

async function openAsset(uuidOrPath) {
  const info = await queryAssetInfo(uuidOrPath);
  await safeRequest('asset-db', 'open-asset', info.uuid || uuidOrPath);
  return info;
}

function assertDeletablePrefab(projectPath, info) {
  if (!projectPath) throw new Error('A project path is required to delete a prefab.');
  if (!info || info.type !== 'cc.Prefab' || info.imported !== true || info.invalid === true ||
      info.readonly === true || info.isDirectory === true || typeof info.uuid !== 'string' || !info.uuid ||
      typeof info.url !== 'string' || !info.url.startsWith('db://assets/') || !info.url.endsWith('.prefab')) {
    throw new Error('Deletion requires a writable, fully imported project .prefab asset with a UUID.');
  }
  const file = resolveProjectFilePath(projectPath, info.url.slice('db://'.length));
  if (!isPathInside(path.join(projectPath, 'assets'), file) ||
      `db://${path.relative(projectPath, file).replace(/\\/g, '/')}` !== info.url ||
      (info.file && path.relative(file, resolveProjectFilePath(projectPath, info.file)) !== '') ||
      !fs.lstatSync(file).isFile()) {
    throw new Error('Prefab URL and source file must identify the same file inside project assets.');
  }
  const metaFile = resolveProjectFilePath(projectPath, `${file}.meta`);
  if (!fs.lstatSync(metaFile).isFile() || JSON.parse(fs.readFileSync(metaFile, 'utf8')).uuid !== info.uuid) {
    throw new Error('Prefab metadata UUID does not match asset-db. No asset was deleted.');
  }
  return file;
}

function fileAbsent(file) {
  try {
    fs.lstatSync(file);
    return false;
  } catch (error) {
    if (error.code === 'ENOENT') return true;
    throw error;
  }
}

async function deletePrefabAsset(info, options) {
  const { uuid, url } = info;
  const file = assertDeletablePrefab(options.projectPath, info);
  if (await safeRequest('asset-db', 'query-ready') !== true ||
      await safeRequest('scene', 'query-is-ready') !== true) {
    throw new Error('Asset database and scene must be ready for prefab deletion reference checks.');
  }
  const assetUsers = await safeRequest('asset-db', 'query-asset-users', uuid, 'all');
  const sceneNodes = await safeRequest('scene', 'query-nodes-by-asset-uuid', uuid);
  for (const [label, refs] of [['asset users', assetUsers], ['scene nodes', sceneNodes]]) {
    if (!Array.isArray(refs) || refs.some((ref) => typeof ref !== 'string' || !ref)) {
      throw new Error(`Prefab reference query returned invalid ${label}. No asset was deleted.`);
    }
  }
  if (assetUsers.length || sceneNodes.length) {
    throw new Error(`Prefab is still referenced: ${assetUsers.length} asset/script user(s) [${assetUsers.slice(0, 20).join(', ')}]; ` +
      `${sceneNodes.length} active-scene node(s) [${sceneNodes.slice(0, 20).join(', ')}]. ` +
      'Remove references and save their assets, or leave prefab editing, before retrying. No asset was deleted.');
  }

  // Reference queries can take time; never delete a replacement at the same URL.
  for (const target of [uuid, url]) {
    const current = await safeRequest('asset-db', 'query-asset-info', target);
    if (!current || current.uuid !== uuid || current.url !== url) {
      throw new Error('Prefab identity changed during deletion preflight. No asset was deleted.');
    }
    assertDeletablePrefab(options.projectPath, current);
  }
  await safeRequest('asset-db', 'delete-asset', uuid);

  const retries = options.retries === undefined ? 10 : options.retries;
  const retryDelayMs = options.retryDelayMs === undefined ? 100 : options.retryDelayMs;
  let verification;
  try {
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const uuidInfo = await safeRequest('asset-db', 'query-asset-info', uuid);
      const urlInfo = await safeRequest('asset-db', 'query-asset-info', url);
      const mappedUrl = await safeRequest('asset-db', 'query-url', uuid);
      const mappedUuid = await safeRequest('asset-db', 'query-uuid', url);
      verification = {
        uuidInfoAbsent: uuidInfo === null,
        urlInfoAbsent: urlInfo === null,
        uuidToUrlAbsent: mappedUrl === null || mappedUrl === '',
        urlToUuidAbsent: mappedUuid === null || mappedUuid === '',
        fileAbsent: fileAbsent(file),
        metaAbsent: fileAbsent(`${file}.meta`),
      };
      if (Object.values(verification).every(Boolean)) {
        return { deleted: true, uuid, url, method: 'asset-db:delete-asset',
          referencePreflight: { assetUserCount: 0, sceneNodeCount: 0 }, verification };
      }
      if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  } catch (error) {
    throw new Error(`Prefab deletion not confirmed: ${error.message}. Deletion may already have occurred; inspect asset-db and disk before retrying.`, { cause: error });
  }
  const incomplete = Object.keys(verification).filter((key) => !verification[key]);
  throw new Error(`Prefab deletion not confirmed (${incomplete.join(', ')}). Inspect asset-db and disk before retrying; deletion was requested only once.`);
}

async function deleteAsset(uuidOrPath, options = {}) {
  if (typeof uuidOrPath !== 'string' || !uuidOrPath.trim()) throw new Error('Asset uuid or path is required.');
  let target = uuidOrPath.trim().replace(/\\/g, '/');
  if (target.startsWith('assets/')) target = `db://${target}`;
  else if (target.startsWith('/assets/')) target = `db://${target.slice(1)}`;
  // Destructive lookups must not use the extension-guessing read helpers.
  const info = await safeRequest('asset-db', 'query-asset-info', target);
  if (!info || !info.uuid || !info.url) throw new Error(`Asset not found: ${target}`);
  if (info.type === 'cc.Prefab' || /\.prefab$/i.test(info.url) || /\.prefab$/i.test(target)) {
    if (target !== info.uuid && target !== info.url &&
        !(path.isAbsolute(target) && info.file && path.relative(target, info.file) === '')) {
      throw new Error('Prefab target must be an exact UUID, db URL, or source file path.');
    }
    return await deletePrefabAsset(info, options);
  }

  await safeRequest('asset-db', 'delete-asset', info.url);
  return { deleted: true, url: info.url };
}

function selectAsset(uuid) {
  if (!global.Editor || !Editor.Selection || typeof Editor.Selection.select !== 'function') {
    throw new Error('Editor.Selection.select is unavailable in this Cocos environment.');
  }

  Editor.Selection.clear('asset');
  Editor.Selection.select('asset', uuid);
  return { selected: true, uuid };
}

function selectNode(uuid) {
  if (!global.Editor || !Editor.Selection || typeof Editor.Selection.select !== 'function') {
    throw new Error('Editor.Selection.select is unavailable in this Cocos environment.');
  }

  Editor.Selection.clear('node');
  Editor.Selection.select('node', uuid);
  return { selected: true, uuid };
}

function clearSelection(type) {
  if (!global.Editor || !Editor.Selection || typeof Editor.Selection.clear !== 'function') {
    throw new Error('Editor.Selection.clear is unavailable in this Cocos environment.');
  }

  const normalized = String(type || 'all').trim().toLowerCase();
  if (normalized === 'asset' || normalized === 'node') {
    Editor.Selection.clear(normalized);
    return { cleared: true, type: normalized };
  }

  Editor.Selection.clear('asset');
  Editor.Selection.clear('node');
  return { cleared: true, type: 'all' };
}

function getCurrentSelection() {
  if (!global.Editor || !Editor.Selection || typeof Editor.Selection.getSelected !== 'function') {
    throw new Error('Editor.Selection API is unavailable in this Cocos environment.');
  }

  return {
    asset: Editor.Selection.getSelected('asset') || '',
    node: Editor.Selection.getSelected('node') || '',
    type: typeof Editor.Selection.getLastSelectedType === 'function' ? Editor.Selection.getLastSelectedType() : '',
  };
}

module.exports = {
  clearSelection,
  deleteAsset,
  getCurrentSelection,
  listAssets,
  openAsset,
  queryAssetData,
  queryAssetInfo,
  queryAssetMeta,
  queryAssetUrl,
  selectAsset,
  selectNode,
};
