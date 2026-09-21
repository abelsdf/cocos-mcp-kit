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

async function validateSerializedPrefabAssetReferences(serialized, options = {}) {
  const objects = typeof serialized === 'string' ? JSON.parse(serialized) : serialized;
  if (!Array.isArray(objects)) throw new Error('Serialized prefab content must be an object array.');
  const maxReferences = options.maxReferences === undefined ? 5000 : options.maxReferences;
  if (!Number.isInteger(maxReferences) || maxReferences < 1 || maxReferences > 5000) {
    throw new Error('maxReferences must be an integer from 1 to 5000.');
  }
  const references = collectUuidReferences(objects)
    .filter((ref) => /^(?:__uuid__|assetUuid|prefabUuid|sceneUuid)$/i.test(ref.key));
  const checked = references.slice(0, maxReferences);
  const queryInfo = options.queryInfo || queryAssetInfo;
  const results = new Map();
  const uuids = Array.from(new Set(checked.map((ref) => ref.uuid)));
  for (let index = 0; index < uuids.length; index += 8) {
    const batch = uuids.slice(index, index + 8);
    const values = await Promise.all(batch.map(async (uuid) => {
      try {
        const info = await queryInfo(uuid);
        return info && info.uuid ? { status: 'found', info } : { status: 'missing', error: 'Asset not found.' };
      } catch (error) {
        return /^Asset not found:/i.test(error.message)
          ? { status: 'missing', error: error.message }
          : { status: 'error', error: error.message };
      }
    }));
    batch.forEach((uuid, position) => results.set(uuid, values[position]));
  }
  const missing = [];
  const lookupErrors = [];
  for (const ref of checked) {
    const result = results.get(ref.uuid);
    if (result.status === 'missing') missing.push({ ...ref, error: result.error });
    else if (result.status === 'error') lookupErrors.push({ ...ref, error: result.error });
  }
  const nestedUuids = new Set(objects
    .filter((entry) => entry && entry.__type__ === 'cc.PrefabInfo')
    .map((entry) => entry.asset && entry.asset.__uuid__)
    .filter((uuid) => typeof uuid === 'string' && uuid));
  const nestedIssues = [];
  for (const uuid of nestedUuids) {
    const result = results.get(uuid);
    if (result && result.status === 'found' && result.info.type !== 'cc.Prefab') {
      nestedIssues.push({ uuid, code: 'nested_asset_not_prefab', type: result.info.type });
    }
  }
  return {
    ok: references.length === checked.length && missing.length === 0 && lookupErrors.length === 0 && nestedIssues.length === 0,
    complete: references.length === checked.length,
    referenceCount: checked.length,
    totalReferenceCount: references.length,
    referencesTruncated: references.length > checked.length,
    uniqueAssetCount: results.size,
    missingCount: missing.length,
    missing: missing.slice(0, 50),
    lookupErrorCount: lookupErrors.length,
    lookupErrors: lookupErrors.slice(0, 50),
    nestedIssues,
  };
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

function summarizePrefabStructure(parsed) {
  if (!Array.isArray(parsed)) return { status: 'unavailable' };
  const prefab = parsed.find((entry) => entry && entry.__type__ === 'cc.Prefab');
  const rootIndex = prefab && prefab.data && prefab.data.__id__;
  const root = Number.isInteger(rootIndex) ? parsed[rootIndex] : null;
  if (!root || root.__type__ !== 'cc.Node') {
    return { status: 'invalid', reason: 'Serialized cc.Prefab root cc.Node was not found.' };
  }
  const nodes = parsed.filter((entry) => entry && entry.__type__ === 'cc.Node');
  const components = parsed.filter((entry) => entry && typeof entry.__type__ === 'string' &&
    ((entry.node && Number.isInteger(entry.node.__id__)) ||
      (entry._node && Number.isInteger(entry._node.__id__))));
  const counts = new Map();
  for (const component of components) {
    counts.set(component.__type__, (counts.get(component.__type__) || 0) + 1);
  }
  const componentTypes = Array.from(counts, ([type, count]) => ({ type, count }))
    .sort((a, b) => a.type.localeCompare(b.type));
  const prefabInfos = parsed.filter((entry) => entry && entry.__type__ === 'cc.PrefabInfo');
  const referencedPrefabUuids = Array.from(new Set(prefabInfos
    .map((entry) => entry.asset && entry.asset.__uuid__)
    .filter((uuid) => typeof uuid === 'string' && uuid)));
  return {
    status: 'available',
    prefabAssetName: prefab._name || '',
    rootName: root._name || '',
    rootChildCount: Array.isArray(root._children) ? root._children.length : 0,
    nodeCount: nodes.length,
    componentCount: components.length,
    componentTypes: componentTypes.slice(0, 32),
    componentTypesTruncated: componentTypes.length > 32,
    prefabInfoCount: prefabInfos.length,
    referencedPrefabUuids: referencedPrefabUuids.slice(0, 50),
    referencedPrefabUuidsTruncated: referencedPrefabUuids.length > 50,
    serializedEntryCount: parsed.length,
  };
}

async function inspectPrefab(projectPath, target, options = {}) {
  const info = await (options.queryInfo || queryAssetInfo)(target);
  if (!info || info.type !== 'cc.Prefab' || !info.uuid || !String(info.url || '').startsWith('db://assets/')) {
    throw new Error('target must be a cc.Prefab asset under assets with a UUID.');
  }
  let meta = null;
  let metadataError = '';
  try {
    meta = await (options.queryMeta || queryAssetMeta)(target);
  } catch (error) {
    metadataError = error.message;
  }
  const filePath = assetFilePath(projectPath, info);
  const content = filePath ? fs.readFileSync(filePath, 'utf8') : '';
  let data = null;
  if (!content) {
    try { data = await (options.queryData || queryAssetData)(target); } catch (_) { /* Report unavailable below. */ }
  }
  const parsed = content ? JSON.parse(content) : data;
  const allReferences = collectUuidReferences(parsed);
  const references = allReferences.slice(0, 500);

  return {
    info,
    meta,
    filePath: filePath ? path.relative(projectPath, filePath).replace(/\\/g, '/') : '',
    serializedSource: content ? 'disk' : data ? 'asset-db' : 'unavailable',
    metadata: meta ? {
      status: 'available',
      uuid: typeof meta.uuid === 'string' ? meta.uuid : '',
      importer: typeof meta.importer === 'string' ? meta.importer : '',
      uuidMatchesAsset: typeof meta.uuid === 'string' ? meta.uuid === info.uuid : null,
    } : { status: metadataError ? 'error' : 'missing', error: metadataError || undefined },
    structure: summarizePrefabStructure(parsed),
    referenceCount: references.length,
    totalReferenceCount: allReferences.length,
    referencesTruncated: allReferences.length > references.length,
    references,
  };
}

async function validatePrefabReferences(projectPath, options = {}) {
  const limit = options.limit === undefined ? 50 : options.limit;
  const maxReferences = options.maxReferences === undefined ? 2000 : options.maxReferences;
  const maxIssues = options.maxIssues === undefined ? 50 : options.maxIssues;
  if (!Number.isInteger(limit) || limit < 1 || limit > 200 ||
      !Number.isInteger(maxReferences) || maxReferences < 1 || maxReferences > 5000 ||
      !Number.isInteger(maxIssues) || maxIssues < 1 || maxIssues > 100) {
    throw new Error('limit must be 1–200, maxReferences 1–5000, and maxIssues 1–100 (integers).');
  }
  const assets = options.target ? null : await (options.listAssets || listAssets)({
    pattern: options.pattern || 'db://assets/**', ccType: 'cc.Prefab',
  });
  const assetListTruncated = Boolean(assets && assets.length > limit);
  const targets = options.target ? [options.target] : assets.slice(0, limit)
    .map((asset) => asset.uuid || asset.url).filter(Boolean);
  const prefabs = [];
  const queryInfo = options.queryInfo || queryAssetInfo;
  const assetCache = new Map();
  const lookup = async (uuid) => {
    if (!assetCache.has(uuid)) {
      assetCache.set(uuid, Promise.resolve().then(() => queryInfo(uuid)).then(
        (info) => info && info.uuid ? { status: 'found', info } : { status: 'missing', error: 'Asset not found.' },
        (error) => /^Asset not found:/i.test(error.message)
          ? { status: 'missing', error: error.message }
          : { status: 'error', error: error.message }
      ));
    }
    return assetCache.get(uuid);
  };

  for (const target of targets) {
    try {
      const prefab = await inspectPrefab(projectPath, target, options);
      const serialized = prefab.filePath
        ? JSON.parse(fs.readFileSync(resolveProjectPath(projectPath, prefab.filePath), 'utf8'))
        : await (options.queryData || queryAssetData)(target);
      if (!Array.isArray(serialized) || prefab.structure.status !== 'available') {
        throw new Error('Prefab serialization is unavailable or has no valid root node.');
      }
      // Only explicit asset-reference fields count; node IDs and prefab fileIds are not asset UUIDs.
      const references = collectUuidReferences(serialized)
        .filter((ref) => /^(?:__uuid__|assetUuid|prefabUuid|sceneUuid)$/i.test(ref.key));
      const checkedReferences = references.slice(0, maxReferences);
      const results = new Map();
      const uuids = Array.from(new Set(checkedReferences.map((ref) => ref.uuid)));
      for (let index = 0; index < uuids.length; index += 8) {
        const batch = uuids.slice(index, index + 8);
        const values = await Promise.all(batch.map((uuid) => lookup(uuid)));
        batch.forEach((uuid, position) => results.set(uuid, values[position]));
      }
      const missing = [];
      const lookupErrors = [];
      let missingCount = 0;
      let lookupErrorCount = 0;
      for (const ref of checkedReferences) {
        const result = results.get(ref.uuid);
        if (result.status === 'missing') {
          missingCount += 1;
          if (missing.length < maxIssues) missing.push({ ...ref, exists: false, error: result.error });
        } else if (result.status === 'error') {
          lookupErrorCount += 1;
          if (lookupErrors.length < maxIssues) lookupErrors.push({ ...ref, error: result.error });
        }
      }
      const componentIssues = [];
      let componentIssueCount = 0;
      for (let nodeIndex = 0; nodeIndex < serialized.length; nodeIndex += 1) {
        const node = serialized[nodeIndex];
        if (!node || node.__type__ !== 'cc.Node' || !Array.isArray(node._components)) continue;
        node._components.forEach((pointer, position) => {
          const componentIndex = pointer && pointer.__id__;
          const component = Number.isInteger(componentIndex) ? serialized[componentIndex] : null;
          const owner = component && (component.node || component._node);
          let code = '';
          if (!component || typeof component.__type__ !== 'string') code = 'missing_component_entry';
          else if (/^cc\.Missing(?:Script|Component)$/.test(component.__type__)) code = 'missing_component_placeholder';
          else if (owner && owner.__id__ !== nodeIndex) code = 'component_owner_mismatch';
          if (code) {
            componentIssueCount += 1;
            if (componentIssues.length < maxIssues) componentIssues.push({ nodeIndex, componentIndex, position, code });
          }
        });
      }
      const nestedUuids = Array.from(new Set(serialized
        .filter((entry) => entry && entry.__type__ === 'cc.PrefabInfo')
        .map((entry) => entry.asset && entry.asset.__uuid__)
        .filter((uuid) => typeof uuid === 'string' && uuid)));
      const nestedPrefabReferences = [];
      let nestedIssueCount = 0;
      for (const uuid of nestedUuids.slice(0, 50)) {
        const result = await lookup(uuid);
        const code = uuid === prefab.info.uuid ? 'self_reference'
          : result.status === 'missing' ? 'missing_nested_prefab'
            : result.status === 'found' && result.info.type !== 'cc.Prefab' ? 'nested_asset_not_prefab' : '';
        if (code) nestedIssueCount += 1;
        nestedPrefabReferences.push({ uuid, status: result.status, type: result.info && result.info.type, code: code || undefined });
      }
      const referencesTruncated = references.length > checkedReferences.length;
      const nestedReferencesTruncated = nestedUuids.length > nestedPrefabReferences.length;
      const complete = !referencesTruncated && !nestedReferencesTruncated && lookupErrorCount === 0 &&
        nestedPrefabReferences.every((item) => item.status !== 'error');
      prefabs.push({
        target,
        filePath: prefab.filePath,
        serializedSource: prefab.serializedSource,
        referenceCount: checkedReferences.length,
        totalReferenceCount: references.length,
        referencesTruncated,
        checkedCount: checkedReferences.length,
        uniqueAssetCount: uuids.length,
        missingCount,
        missing,
        missingTruncated: missingCount > missing.length,
        lookupErrorCount,
        lookupErrors,
        lookupErrorsTruncated: lookupErrorCount > lookupErrors.length,
        componentIssueCount,
        componentIssues,
        componentIssuesTruncated: componentIssueCount > componentIssues.length,
        componentTypeRegistrationChecked: false,
        nestedPrefabReferences,
        nestedReferencesTruncated,
        nestedIssueCount,
        complete,
        ok: complete && missingCount === 0 && componentIssueCount === 0 && nestedIssueCount === 0,
      });
    } catch (error) {
      prefabs.push({ target, ok: false, complete: false, error: error.message, missingCount: 0 });
    }
  }

  const missingCount = prefabs.reduce((sum, prefab) => sum + prefab.missingCount, 0);
  const complete = !assetListTruncated && prefabs.every((prefab) => prefab.complete);
  return {
    ok: complete && prefabs.every((prefab) => prefab.ok),
    complete,
    prefabCount: prefabs.length,
    assetListTruncated,
    missingCount,
    limitations: ['Only explicit serialized asset UUID fields are checked; runtime dynamic loads and component class registration are not verified.'],
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
  validateSerializedPrefabAssetReferences,
  validatePrefabReferences,
};
