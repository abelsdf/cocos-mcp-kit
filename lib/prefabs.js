'use strict';

const fs = require('fs');
const path = require('path');
const { listAssets, queryAssetData, queryAssetInfo, queryAssetMeta } = require('./assets');
const { resolveProjectPath } = require('./path-safety');
const { persistSerializedAsset } = require('./serialized-asset-persistence');

function requestEditorMessage(channel, method, ...args) {
  if (!global.Editor || !Editor.Message || typeof Editor.Message.request !== 'function') {
    throw new Error('Editor.Message.request is unavailable in the Cocos extension host.');
  }
  return Editor.Message.request(channel, method, ...args);
}

function assetUrlToPath(projectPath, url) {
  if (!url || !String(url).startsWith('db://assets/')) {
    return '';
  }
  return path.join(projectPath, String(url).slice('db://'.length));
}

function assetFilePath(projectPath, info) {
  const candidates = [
    info && info.file,
    info && info.path,
    info && info.source,
    info && info.url ? assetUrlToPath(projectPath, info.url) : '',
  ].filter(Boolean);

  for (const candidate of candidates) {
    const fullPath = path.isAbsolute(candidate)
      ? resolveProjectPath(projectPath, candidate)
      : resolveProjectPath(projectPath, candidate);
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
      return fullPath;
    }
  }
  return '';
}

function normalizePrefabTarget(projectPath, target) {
  const raw = String(target || '').trim().replace(/\\/g, '/');
  if (!raw) {
    throw new Error('target is required.');
  }

  let relative = raw;
  if (relative.startsWith('db://assets/')) {
    relative = relative.slice('db://'.length);
  } else if (relative.startsWith('/assets/')) {
    relative = relative.slice(1);
  } else if (!relative.startsWith('assets/')) {
    relative = `assets/${relative}`;
  }

  if (!relative.endsWith('.prefab')) {
    relative = `${relative}.prefab`;
  }

  const filePath = resolveProjectPath(projectPath, relative);
  const assetsRoot = path.join(projectPath, 'assets');
  const relativeToAssets = path.relative(assetsRoot, filePath);
  if (relativeToAssets.startsWith('..') || path.isAbsolute(relativeToAssets)) {
    throw new Error('target must be inside the Cocos assets directory.');
  }

  const projectRelative = path.relative(projectPath, filePath).replace(/\\/g, '/');
  return {
    filePath,
    projectRelative,
    dbUrl: `db://${projectRelative}`,
  };
}

async function savePrefabContent(projectPath, options = {}) {
  const target = normalizePrefabTarget(projectPath, options.target);
  const content = String(options.content || '');
  if (!content) {
    throw new Error('content is required.');
  }
  validatePrefabContent(target, content);

  return persistSerializedAsset(target, content, {
    kind: 'prefab',
    overwrite: options.overwrite,
    request: options.request,
    queryInfo: options.queryInfo,
    retries: options.retries,
    retryDelayMs: options.retryDelayMs,
    settleDelayMs: options.settleDelayMs,
  });
}

function validatePrefabContent(target, content) {
  const serialized = JSON.parse(content);
  const prefab = Array.isArray(serialized)
    ? serialized.find((entry) => entry && entry.__type__ === 'cc.Prefab')
    : null;
  const root = prefab && Number.isInteger(prefab.data && prefab.data.__id__)
    ? serialized[prefab.data.__id__]
    : null;
  if (!root || root.__type__ !== 'cc.Node') {
    throw new Error('content must contain a serialized cc.Prefab with a root cc.Node.');
  }
  const targetName = path.basename(target.filePath, '.prefab');
  for (const [label, name] of [['prefab asset', prefab._name], ['root node', root._name]]) {
    if (name !== targetName) {
      throw new Error(`The ${label} name must match the target filename "${targetName}" in Creator 3.8.8; asset-db does not persist prefab name changes through save-asset. Rename the target asset instead.`);
    }
  }
}

function collectUuidReferences(value, refs = [], pointer = '') {
  if (!value || typeof value !== 'object') {
    return refs;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => collectUuidReferences(item, refs, `${pointer}/${index}`));
    return refs;
  }

  for (const [key, child] of Object.entries(value)) {
    const childPointer = `${pointer}/${key}`;
    if (
      typeof child === 'string' &&
      (key.toLowerCase().includes('uuid') || key === '__uuid__' || key === 'assetUuid' || key === 'prefabUuid')
    ) {
      refs.push({ uuid: child, path: childPointer, key });
    } else {
      collectUuidReferences(child, refs, childPointer);
    }
  }
  return refs;
}

function getByJsonPath(target, jsonPath) {
  const segments = String(jsonPath || '')
    .replace(/^\//, '')
    .split(/[/.]/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  let current = target;
  for (const segment of segments) {
    if (current == null) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

function setByJsonPath(target, jsonPath, value) {
  const segments = String(jsonPath || '')
    .replace(/^\//, '')
    .split(/[/.]/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (!segments.length) {
    throw new Error('jsonPath is required.');
  }
  let current = target;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    if (current[segment] == null || typeof current[segment] !== 'object') {
      throw new Error(`jsonPath does not exist at ${segments.slice(0, index + 1).join('/')}.`);
    }
    current = current[segment];
  }
  if (current == null || typeof current !== 'object') {
    throw new Error('jsonPath parent must be an object or array.');
  }
  current[segments[segments.length - 1]] = value;
}

async function inspectPrefab(projectPath, target) {
  const info = await queryAssetInfo(target);
  const meta = await queryAssetMeta(target).catch(() => null);
  const data = await queryAssetData(target).catch(() => null);
  const filePath = assetFilePath(projectPath, info);
  const content = filePath ? fs.readFileSync(filePath, 'utf8') : '';
  const parsed = content ? JSON.parse(content) : data;
  const references = collectUuidReferences(parsed).slice(0, 500);

  return {
    info,
    meta,
    filePath: filePath ? path.relative(projectPath, filePath).replace(/\\/g, '/') : '',
    referenceCount: references.length,
    references,
  };
}

async function validatePrefabReferences(projectPath, options = {}) {
  const targets = options.target
    ? [options.target]
    : (await listAssets({ pattern: options.pattern || 'db://assets/**', ccType: 'cc.Prefab' }))
        .slice(0, Number.isFinite(options.limit) ? Math.max(1, Math.min(200, options.limit)) : 50)
        .map((asset) => asset.uuid || asset.url)
        .filter(Boolean);
  const prefabs = [];

  for (const target of targets) {
    const prefab = await inspectPrefab(projectPath, target);
    const checked = [];
    const missing = [];
    for (const ref of prefab.references) {
      try {
        const info = await queryAssetInfo(ref.uuid);
        checked.push({ ...ref, exists: true, asset: { uuid: info.uuid, url: info.url, type: info.type } });
      } catch (error) {
        missing.push({ ...ref, exists: false, error: error.message });
      }
    }
    prefabs.push({
      target,
      filePath: prefab.filePath,
      referenceCount: prefab.referenceCount,
      checkedCount: checked.length + missing.length,
      missingCount: missing.length,
      missing,
    });
  }

  const missingCount = prefabs.reduce((sum, prefab) => sum + prefab.missingCount, 0);
  return {
    ok: missingCount === 0,
    prefabCount: prefabs.length,
    missingCount,
    prefabs,
  };
}

async function duplicatePrefab(projectPath, options = {}) {
  const source = String(options.source || '').trim();
  const target = String(options.target || '').trim();
  if (!source || !target) {
    throw new Error('source and target are required.');
  }

  const queryInfo = options.queryInfo || queryAssetInfo;
  const info = await queryInfo(source);
  if (!info || info.type !== 'cc.Prefab' || !info.uuid || info.imported !== true || !String(info.url || '').startsWith('db://assets/')) {
    throw new Error(`Source must be an imported cc.Prefab under assets: ${source}`);
  }
  const sourcePath = assetFilePath(projectPath, info);
  if (!sourcePath) {
    throw new Error(`Prefab source file was not found: ${source}`);
  }
  if (path.resolve(sourcePath).toLowerCase() !== path.resolve(assetUrlToPath(projectPath, info.url)).toLowerCase()) {
    throw new Error(`Prefab source path does not match asset-db URL: ${info.url}`);
  }

  const normalizedTarget = normalizePrefabTarget(projectPath, target);
  if (path.resolve(sourcePath).toLowerCase() === path.resolve(normalizedTarget.filePath).toLowerCase()) {
    throw new Error('Source and target prefab must be different assets.');
  }
  const copied = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  const sourceAsset = Array.isArray(copied) ? copied.find((entry) => entry && entry.__type__ === 'cc.Prefab') : null;
  const root = sourceAsset && Number.isInteger(sourceAsset.data && sourceAsset.data.__id__)
    ? copied[sourceAsset.data.__id__] : null;
  if (!root || root.__type__ !== 'cc.Node') {
    throw new Error(`Source is not a serialized prefab with a root node: ${source}`);
  }
  const targetName = path.basename(normalizedTarget.filePath, '.prefab');
  sourceAsset._name = targetName;
  root._name = targetName;
  const saved = await savePrefabContent(projectPath, {
    target: normalizedTarget.dbUrl,
    content: JSON.stringify(copied, null, 2) + '\n',
    overwrite: options.overwrite,
    request: options.request,
    queryInfo,
    retries: options.retries,
    retryDelayMs: options.retryDelayMs,
    settleDelayMs: options.settleDelayMs,
  });
  if (saved.info.uuid === info.uuid) {
    throw new Error(`Duplicated prefab has the source UUID ${info.uuid}; inspect ${normalizedTarget.dbUrl} before retrying.`);
  }
  return {
    duplicated: true,
    source: path.relative(projectPath, sourcePath).replace(/\\/g, '/'),
    target: saved.path,
    method: saved.method,
    info: saved.info,
    saveAttempts: saved.saveAttempts,
  };
}

async function editPrefabJson(projectPath, options = {}) {
  const target = String(options.target || '').trim();
  if (!target) {
    throw new Error('target is required.');
  }
  const queryInfo = options.queryInfo || queryAssetInfo;
  const info = await queryInfo(target);
  if (!info || info.type !== 'cc.Prefab' || !info.uuid || info.imported !== true || !String(info.url || '').startsWith('db://assets/')) {
    throw new Error(`Target must be an imported cc.Prefab under assets: ${target}`);
  }
  const filePath = assetFilePath(projectPath, info);
  if (!filePath) {
    throw new Error(`Prefab file was not found: ${target}`);
  }

  const original = fs.readFileSync(filePath, 'utf8');
  let updated = original;
  if (options.search !== undefined) {
    const search = String(options.search);
    if (!search) {
      throw new Error('search must not be empty.');
    }
    if (!original.includes(search)) {
      throw new Error('search text was not found in prefab file.');
    }
    updated = options.replaceAll
      ? original.split(search).join(String(options.replace || ''))
      : original.replace(search, String(options.replace || ''));
  } else {
    const json = JSON.parse(original);
    const value = JSON.parse(String(options.valueJson || 'null'));
    setByJsonPath(json, options.jsonPath, value);
    updated = JSON.stringify(json, null, 2) + '\n';
  }

  const normalizedTarget = normalizePrefabTarget(projectPath, info.url);
  if (path.resolve(filePath).toLowerCase() !== path.resolve(normalizedTarget.filePath).toLowerCase()) {
    throw new Error(`Prefab asset path does not match asset-db URL: ${info.url}`);
  }
  validatePrefabContent(normalizedTarget, updated);
  if (updated === original) {
    return { edited: false, path: normalizedTarget.projectRelative, reason: 'content unchanged' };
  }
  if (options.createBackup) {
    fs.writeFileSync(`${filePath}.bak`, original, 'utf8');
  }
  const saved = await savePrefabContent(projectPath, {
    target: normalizedTarget.dbUrl,
    content: updated,
    overwrite: true,
    request: options.request,
    queryInfo,
    retries: options.retries,
    retryDelayMs: options.retryDelayMs,
    settleDelayMs: options.settleDelayMs,
  });
  if (saved.info.uuid !== info.uuid) {
    throw new Error(`Edited prefab UUID changed from ${info.uuid} to ${saved.info.uuid}; inspect ${normalizedTarget.dbUrl} before retrying.`);
  }
  return {
    edited: true,
    path: saved.path,
    method: saved.method,
    saveAttempts: saved.saveAttempts,
    info: saved.info,
    backupPath: options.createBackup ? `${saved.path}.bak` : undefined,
    oldValue: options.jsonPath ? getByJsonPath(JSON.parse(original), options.jsonPath) : undefined,
    validation: await (options.validateReferences || validatePrefabReferences)(projectPath, { target: saved.dbUrl }),
  };
}

async function applyPrefabInstance(nodeUuid) {
  const uuid = String(nodeUuid || '').trim();
  if (!uuid) {
    throw new Error('node uuid is required.');
  }
  const result = await requestEditorMessage('scene', 'apply-prefab', uuid);
  return { applied: true, uuid, result };
}

async function revertPrefabInstance(nodeUuid) {
  const uuid = String(nodeUuid || '').trim();
  if (!uuid) {
    throw new Error('node uuid is required.');
  }
  const candidates = ['revert-prefab', 'restore-prefab'];
  let lastError = null;
  for (const method of candidates) {
    try {
      const result = await requestEditorMessage('scene', method, uuid);
      return { reverted: true, uuid, method, result };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('No prefab revert editor message was available.');
}

module.exports = {
  applyPrefabInstance,
  duplicatePrefab,
  editPrefabJson,
  inspectPrefab,
  normalizePrefabTarget,
  revertPrefabInstance,
  savePrefabContent,
  validatePrefabReferences,
};
