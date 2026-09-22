'use strict';

const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const { isDeepStrictEqual } = require('util');
const { listAssets, queryAssetData, queryAssetInfo, queryAssetMeta } = require('./assets');
const { isPathInside, resolveProjectFilePath, resolveProjectPath } = require('./path-safety');
const { assertSerializedPrefabMetadata } = require('./prefab-metadata');
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

async function readPrefabOperationSource(projectPath, uuid, expectedUrl, sceneSource = false) {
  const type = sceneSource ? 'cc.SceneAsset' : 'cc.Prefab';
  const extension = sceneSource ? '.scene' : '.prefab';
  const info = await requestEditorMessage('asset-db', 'query-asset-info', uuid);
  if (!info || info.uuid !== uuid || info.type !== type ||
      info.invalid === true || info.readonly === true || info.isDirectory === true ||
      typeof info.url !== 'string' || !info.url.startsWith('db://assets/') || !info.url.endsWith(extension) ||
      expectedUrl && info.url !== expectedUrl) {
    throw new Error(`Prefab operations require the same writable, imported project ${extension} asset.`);
  }
  if (info.imported !== true) {
    const error = new Error('Prefab source asset must be fully imported.');
    if (info.imported === false) error.code = 'PREFAB_ASSET_IMPORTING';
    throw error;
  }
  const file = resolveProjectFilePath(projectPath, info.url.slice('db://'.length));
  if (!isPathInside(path.join(projectPath, 'assets'), file) ||
      `db://${path.relative(projectPath, file).replace(/\\/g, '/')}` !== info.url ||
      info.file && path.relative(file, resolveProjectFilePath(projectPath, info.file)) !== '' ||
      !fs.lstatSync(file).isFile() || fs.statSync(file).size > 8 * 1024 * 1024) {
    throw new Error('Prefab source must be the matching project assets file, at most 8 MiB.');
  }
  const metaFile = resolveProjectFilePath(projectPath, `${file}.meta`);
  if (!fs.lstatSync(metaFile).isFile()) throw new Error('Prefab metadata is not a regular file.');
  const meta = fs.readFileSync(metaFile, 'utf8');
  if (JSON.parse(meta).uuid !== uuid) throw new Error('Prefab metadata UUID does not match asset-db.');
  return { info, file, meta, content: fs.readFileSync(file, 'utf8') };
}

function prefabApplyStructure(objects) {
  const nodeId = node => objects[node._prefab.__id__].fileId;
  return objects.filter(entry => entry.__type__ === 'cc.Node').map(node => ({
    fileId: nodeId(node), parent: node._parent ? nodeId(objects[node._parent.__id__]) : null,
    children: (node._children || []).map(ref => nodeId(objects[ref.__id__])),
    components: (node._components || []).map(ref => {
      const component = objects[ref.__id__];
      return { type: component.__type__, fileId: objects[component.__prefab.__id__].fileId };
    }),
  })).sort((left, right) => left.fileId.localeCompare(right.fileId));
}

function normalizePrefabApplyContent(objects) {
  // Native apply may write [] where getdata-prefab returned null. Only this
  // empty linkage field is equivalent; never discard actual overrides/data.
  for (const entry of Array.isArray(objects) ? objects : []) {
    if (entry && entry.__type__ === 'cc.PrefabInfo' &&
        Array.isArray(entry.targetOverrides) && entry.targetOverrides.length === 0) entry.targetOverrides = null;
  }
  return objects;
}

async function readPrefabApplyPreview(uuid, assetName) {
  const content = await requestEditorMessage('scene', 'getdata-prefab', uuid);
  if (typeof content !== 'string' || Buffer.byteLength(content) > 8 * 1024 * 1024) {
    throw new Error('Native prefab preview must be serialized JSON of at most 8 MiB.');
  }
  const objects = JSON.parse(content);
  const metadata = assertSerializedPrefabMetadata(objects);
  // Creator keeps the source asset/root name when applying a renamed instance.
  objects[metadata.prefabIndex]._name = objects[metadata.rootIndex]._name = assetName;
  return normalizePrefabApplyContent(objects);
}

async function applyPrefabInstance(projectPath, sceneBridge, options = {}) {
  const selectors = ['uuid', 'path', 'name'];
  for (const key of Object.keys(options)) {
    if (!selectors.includes(key)) throw new Error(`Unsupported apply selector option: ${key}`);
    if (typeof options[key] !== 'string' || !options[key].trim()) throw new Error(`${key} must be a non-empty string.`);
  }
  if (!selectors.some(key => options[key])) throw new Error('A node selector (uuid, path, or name) is required.');
  if (await requestEditorMessage('asset-db', 'query-ready') !== true ||
      await requestEditorMessage('scene', 'query-is-ready') !== true) {
    throw new Error('Asset database and scene must be ready for prefab application.');
  }
  const before = await sceneBridge.call('getPrefabApplyState', options);
  const root = before && before.nodes && before.nodes[0];
  const prefab = root && root.prefab;
  if (!root || !before.node || root.uuid !== before.node.uuid || !prefab || prefab.rootUuid !== root.uuid ||
      !prefab.assetUuid || !prefab.fileId || !prefab.instanceId) {
    throw new Error('Select an explicitly linked prefab instance root with complete identity.');
  }
  if (before.linkedAncestor !== false || before.nodes.some(node => node.nested ||
      !node.prefab || node.prefab.rootUuid !== root.uuid || node.prefab.assetUuid !== prefab.assetUuid)) {
    throw new Error('Applying nested instances, linked ancestors or changed prefab structure is not supported.');
  }
  const sceneInfo = await requestEditorMessage('asset-db', 'query-asset-info', before.sceneUuid);
  if (!sceneInfo || sceneInfo.uuid !== before.sceneUuid || sceneInfo.type !== 'cc.SceneAsset' ||
      sceneInfo.imported !== true || sceneInfo.invalid === true) {
    throw new Error('Open a saved scene before applying; unsaved scenes and prefab editing are not supported.');
  }
  const source = await readPrefabOperationSource(projectPath, prefab.assetUuid);
  const assetName = path.basename(source.file, '.prefab');
  const original = normalizePrefabApplyContent(JSON.parse(source.content));
  assertSerializedPrefabMetadata(original, { expectedName: assetName });
  const expected = await readPrefabApplyPreview(root.uuid, assetName);
  if (!isDeepStrictEqual(prefabApplyStructure(original), prefabApplyStructure(expected))) {
    throw new Error('Applying hierarchy or component structure changes is not supported; edit the prefab asset explicitly.');
  }
  const references = await validateSerializedPrefabAssetReferences(expected);
  if (!references.ok || !references.complete) throw new Error('Prefab asset reference validation failed or was incomplete. No apply was requested.');
  const rechecked = await sceneBridge.call('getPrefabApplyState', { uuid: root.uuid });
  const recheckedPreview = await readPrefabApplyPreview(root.uuid, assetName);
  const current = await readPrefabOperationSource(projectPath, prefab.assetUuid, source.info.url);
  if (!isDeepStrictEqual(before, rechecked) || !isDeepStrictEqual(expected, recheckedPreview) ||
      current.content !== source.content || current.meta !== source.meta) {
    throw new Error('Scene, instance or source prefab changed during preflight. No apply was requested.');
  }
  try {
    // In Creator 3.8.8 even a successful write can return false. Verify the data,
    // never infer success from this opaque result or retry the write automatically.
    const result = await requestEditorMessage('scene', 'apply-prefab', root.uuid);
    for (let attempt = 0; attempt <= 10; attempt += 1) {
      const saved = await readPrefabOperationSource(projectPath, prefab.assetUuid, source.info.url);
      if (saved.meta === source.meta && isDeepStrictEqual(normalizePrefabApplyContent(JSON.parse(saved.content)), expected)) {
        await new Promise(resolve => setTimeout(resolve, 400));
        const settled = await readPrefabOperationSource(projectPath, prefab.assetUuid, source.info.url);
        if (settled.meta === source.meta && isDeepStrictEqual(normalizePrefabApplyContent(JSON.parse(settled.content)), expected)) {
          const after = await sceneBridge.call('getPrefabApplyState', { uuid: root.uuid });
          if (!isDeepStrictEqual(before, after)) throw new Error('Applied instance identity, hierarchy or transforms changed unexpectedly.');
          return { applied: true, verified: true, needsSave: true, uuid: root.uuid, path: after.node.path, result,
            method: 'scene:apply-prefab', sceneUuid: before.sceneUuid, node: after.node,
            prefabUuid: prefab.assetUuid, url: source.info.url, sourceChanged: !isDeepStrictEqual(original, expected),
            nodeCount: after.nodes.length, componentCount: after.nodes.reduce((sum, node) => sum + node.components.length, 0) };
        }
      }
      if (attempt < 10) await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Source prefab writeback was not confirmed: saved content differs from the native preview.');
  } catch (error) {
    throw new Error(`${error.message} Applying may already have changed the source and other instances; inspect them before retrying. No automatic retry or rollback was attempted.`, { cause: error });
  }
}

function normalizePrefabRevertContent(objects) {
  normalizePrefabApplyContent(objects);
  for (const entry of objects) {
    if (entry.__type__ === 'cc.Node') {
      // getdata-prefab clears runtime IDs. Check live node/component UUIDs
      // separately; never remove similarly named fields from user data.
      delete entry._id;
      for (const ref of entry._components || []) delete objects[ref.__id__]._id;
    }
    if (entry.__type__ === 'cc.PrefabInfo') {
      if (entry.instance != null || entry.nestedPrefabInstanceRoots != null &&
          (!Array.isArray(entry.nestedPrefabInstanceRoots) || entry.nestedPrefabInstanceRoots.length)) {
        throw new Error('Nested prefab source structure is not supported by this operation.');
      }
      // Creator omits these empty linkage fields on an instance root preview.
      delete entry.instance;
      delete entry.nestedPrefabInstanceRoots;
      // Undo can also omit this default field on the prefab editing root.
      if (entry.targetOverrides == null) entry.targetOverrides = null;
    }
  }
  return objects;
}

function prefabRevertIdentity(state) {
  return {
    sceneUuid: state.sceneUuid, node: state.node, linkedAncestor: state.linkedAncestor,
    nodes: state.nodes.map(node => ({
      uuid: node.uuid, parentUuid: node.parentUuid, childUuids: node.childUuids,
      nested: node.nested, prefab: node.prefab, components: node.components,
    })),
    position: state.nodes[0].position, rotation: state.nodes[0].rotation,
  };
}

async function revertPrefabInstance(projectPath, sceneBridge, options = {}) {
  const selectors = ['uuid', 'path', 'name'];
  for (const key of Object.keys(options)) {
    if (!selectors.includes(key)) throw new Error(`Unsupported revert selector option: ${key}`);
    if (typeof options[key] !== 'string' || !options[key].trim()) throw new Error(`${key} must be a non-empty string.`);
  }
  if (!selectors.some(key => options[key])) throw new Error('A node selector (uuid, path, or name) is required.');
  if (await requestEditorMessage('asset-db', 'query-ready') !== true ||
      await requestEditorMessage('scene', 'query-is-ready') !== true) {
    throw new Error('Asset database and scene must be ready for prefab restoration.');
  }
  // Reuse the property-only subtree and serialization/reference preflight.
  const before = await sceneBridge.call('getPrefabApplyState', options);
  const root = before && before.nodes && before.nodes[0];
  const prefab = root && root.prefab;
  if (!root || !before.node || root.uuid !== before.node.uuid || !prefab || prefab.rootUuid !== root.uuid ||
      !prefab.assetUuid || !prefab.fileId || !prefab.instanceId) {
    throw new Error('Select an explicitly linked prefab instance root with complete identity.');
  }
  if (before.linkedAncestor !== false || before.nodes.some(node => node.nested ||
      !node.prefab || node.prefab.rootUuid !== root.uuid || node.prefab.assetUuid !== prefab.assetUuid)) {
    throw new Error('Reverting nested instances, linked ancestors or changed prefab structure is not supported.');
  }
  const sceneInfo = await requestEditorMessage('asset-db', 'query-asset-info', before.sceneUuid);
  if (!sceneInfo || sceneInfo.uuid !== before.sceneUuid || sceneInfo.type !== 'cc.SceneAsset' ||
      sceneInfo.imported !== true || sceneInfo.invalid === true) {
    throw new Error('Open a saved scene before reverting; unsaved scenes and prefab editing are not supported.');
  }
  const source = await readPrefabOperationSource(projectPath, prefab.assetUuid);
  const assetName = path.basename(source.file, '.prefab');
  const original = JSON.parse(source.content);
  const metadata = assertSerializedPrefabMetadata(original, { expectedName: assetName });
  const preview = await readPrefabApplyPreview(root.uuid, assetName);
  const previewMetadata = assertSerializedPrefabMetadata(preview);
  if (!isDeepStrictEqual(prefabApplyStructure(original), prefabApplyStructure(preview))) {
    throw new Error('Reverting hierarchy or component structure changes is not supported.');
  }
  const expected = normalizePrefabRevertContent(original);
  const initial = normalizePrefabRevertContent(preview);
  // Native restore preserves the root name (checked in the live identity),
  // position and rotation, but restores scale and all child properties.
  for (const key of ['_lpos', '_lrot', '_euler']) {
    if (Object.prototype.hasOwnProperty.call(initial[previewMetadata.rootIndex], key)) {
      expected[metadata.rootIndex][key] = initial[previewMetadata.rootIndex][key];
    } else {
      delete expected[metadata.rootIndex][key];
    }
  }
  const references = await validateSerializedPrefabAssetReferences(expected);
  if (!references.ok || !references.complete) throw new Error('Prefab asset reference validation failed or was incomplete. No restore was requested.');
  const rechecked = await sceneBridge.call('getPrefabApplyState', { uuid: root.uuid });
  const recheckedPreview = normalizePrefabRevertContent(await readPrefabApplyPreview(root.uuid, assetName));
  const current = await readPrefabOperationSource(projectPath, prefab.assetUuid, source.info.url);
  if (!isDeepStrictEqual(before, rechecked) || !isDeepStrictEqual(initial, recheckedPreview) ||
      current.content !== source.content || current.meta !== source.meta) {
    throw new Error('Scene, instance or source prefab changed during preflight. No restore was requested.');
  }
  try {
    // 3.8.8 declares {uuid} but actually accepts the root UUID string. Do not
    // probe alternate messages/arguments after a possibly mutating request.
    const result = await requestEditorMessage('scene', 'restore-prefab', root.uuid);
    if (result !== true) throw new Error('Creator did not confirm prefab restoration.');
    const verify = async () => {
      const after = await sceneBridge.call('getPrefabApplyState', { uuid: root.uuid });
      const restored = normalizePrefabRevertContent(await readPrefabApplyPreview(root.uuid, assetName));
      const retained = await readPrefabOperationSource(projectPath, prefab.assetUuid, source.info.url);
      if (retained.content !== source.content || retained.meta !== source.meta ||
          !isDeepStrictEqual(prefabRevertIdentity(before), prefabRevertIdentity(after)) ||
          !isDeepStrictEqual(restored, expected)) {
        throw new Error('Prefab restore verification failed: source, identity, placement or restored properties differ from the expected state.');
      }
      return after;
    };
    await verify();
    await new Promise(resolve => setTimeout(resolve, 400));
    const after = await verify();
    return { reverted: true, verified: true, needsSave: true, uuid: root.uuid, path: after.node.path, result,
      method: 'scene:restore-prefab', sceneUuid: before.sceneUuid, node: after.node,
      prefabUuid: prefab.assetUuid, url: source.info.url, sourceUnchanged: true, instanceChanged: !isDeepStrictEqual(initial, expected),
      nodeCount: after.nodes.length, componentCount: after.nodes.reduce((sum, node) => sum + node.components.length, 0) };
  } catch (error) {
    throw new Error(`${error.message} Restoration may already have changed the instance; inspect it before retrying. No automatic retry or rollback was attempted.`, { cause: error });
  }
}

async function readPrefabEditContext() {
  return {
    ready: await requestEditorMessage('scene', 'query-is-ready'),
    mode: await requestEditorMessage('scene', 'query-scene-mode'),
    uuid: await requestEditorMessage('scene', 'query-current-scene'),
    dirty: await requestEditorMessage('scene', 'query-dirty'),
    multi: await requestEditorMessage('scene', 'multi-is-multi-edit-mode'),
    tabs: await requestEditorMessage('scene', 'multi-scene-query'),
  };
}

function assertPrefabEditContext(context, allowDirty = false) {
  if (context.ready !== true) throw new Error('Scene must be ready before prefab operations.');
  if (!['general', 'prefab'].includes(context.mode) || typeof context.uuid !== 'string' || !context.uuid) {
    throw new Error('Unsupported editor mode or missing saved scene/asset identity.');
  }
  if (typeof context.dirty !== 'boolean' || !allowDirty && context.dirty ||
      context.multi !== false || !Array.isArray(context.tabs) || context.tabs.length !== 1 ||
      !context.tabs[0] || context.tabs[0].uuid !== context.uuid || context.tabs[0].dirty !== context.dirty ||
      typeof context.tabs[0].url !== 'string' || !context.tabs[0].url.startsWith('db://assets/') ||
      context.tabs[0].type !== (context.mode === 'prefab' ? 'prefab' : 'scene')) {
    throw new Error('Prefab operations require one matching scene/tab, no unsupported dirty or multi-scene editing state.');
  }
}

function prefabOriginSceneContent(content, uuid) {
  if (typeof content !== 'string' || Buffer.byteLength(content) > 8 * 1024 * 1024) {
    throw new Error('Scene serialization must be JSON of at most 8 MiB.');
  }
  const objects = JSON.parse(content);
  const assets = Array.isArray(objects) ? objects.filter(entry => entry && entry.__type__ === 'cc.SceneAsset') : [];
  const asset = assets[0];
  const root = asset && asset.scene && objects[asset.scene.__id__];
  if (assets.length !== 1 || !root || root.__type__ !== 'cc.Scene' || typeof root._id !== 'string' || !root._id ||
      uuid !== undefined && root._id !== uuid) {
    throw new Error('Scene serialization does not identify the saved origin scene.');
  }
  // query-scene-json omits the SceneAsset name; the cc.Scene name is retained.
  asset._name = '';
  return objects;
}

function assertPrefabEditingRoot(state, info, assetName, rootFileId) {
  const root = state && state.nodes && state.nodes[0];
  if (!root || !state.node || root.uuid !== state.node.uuid || state.node.name !== assetName || state.linkedAncestor !== false ||
      !root.prefab || root.prefab.fileId !== rootFileId || root.prefab.instanceId !== '' ||
      state.nodes.some(node => node.nested || !node.prefab || node.prefab.rootUuid !== root.uuid || node.prefab.assetUuid !== info.uuid)) {
    throw new Error('The live prefab edit root has an invalid source identity or nested instance structure.');
  }
  return root;
}

async function enterPrefabEditMode(projectPath, sceneBridge, options = {}) {
  if (Object.keys(options).some(key => key !== 'target')) throw new Error('Only the target option is supported for prefab edit entry.');
  if (typeof options.target !== 'string' || !options.target.trim()) throw new Error('A non-empty prefab target is required.');
  if (await requestEditorMessage('asset-db', 'query-ready') !== true) throw new Error('Asset database must be ready.');
  const before = await readPrefabEditContext();
  assertPrefabEditContext(before);
  let target = options.target.trim().replace(/\\/g, '/');
  if (target.startsWith('assets/')) target = `db://${target}`;
  else if (target.startsWith('/assets/')) target = `db://${target.slice(1)}`;
  else if (path.isAbsolute(target)) {
    const file = resolveProjectFilePath(projectPath, target);
    target = `db://${path.relative(projectPath, file).replace(/\\/g, '/')}`;
  }
  const info = await requestEditorMessage('asset-db', 'query-asset-info', target);
  if (!info || !info.uuid || !info.url || target !== info.uuid && target !== info.url) {
    throw new Error('Prefab target must resolve to an exact asset UUID, db URL or source file path; no extension guessing.');
  }
  if (before.mode === 'prefab' && before.uuid !== info.uuid) {
    throw new Error('Another prefab is already being edited. Exit it explicitly before entering this prefab.');
  }
  const source = await readPrefabOperationSource(projectPath, info.uuid, info.url);
  const assetName = path.basename(source.file, '.prefab');
  const objects = JSON.parse(source.content);
  const metadata = assertSerializedPrefabMetadata(objects, { expectedName: assetName });
  const rootFileId = objects[objects[metadata.rootIndex]._prefab.__id__].fileId;
  const expected = normalizePrefabRevertContent(objects);
  const references = await validateSerializedPrefabAssetReferences(expected);
  if (!references.ok || !references.complete) throw new Error('Prefab asset reference validation failed or was incomplete. No open was requested.');

  const alreadyOpen = before.mode === 'prefab';
  const origin = alreadyOpen ? null : await readPrefabOperationSource(projectPath, before.uuid, before.tabs[0].url, true);
  if (alreadyOpen && before.tabs[0].url !== source.info.url) throw new Error('Current prefab tab identity does not match the source asset.');
  const originalScene = origin ? prefabOriginSceneContent(origin.content, before.uuid) : null;
  const assertOriginContent = async () => {
    if (origin && !isDeepStrictEqual(originalScene,
      prefabOriginSceneContent(await requestEditorMessage('scene', 'query-scene-json'), before.uuid))) {
      throw new Error('Origin scene has unsaved serialized changes, even if its dirty flag is clear. Save it explicitly before switching.');
    }
  };
  const assertRetainedFiles = async () => {
    const current = await readPrefabOperationSource(projectPath, info.uuid, source.info.url);
    if (current.content !== source.content || current.meta !== source.meta) throw new Error('Source prefab changed during edit entry.');
    if (origin) {
      const retained = await readPrefabOperationSource(projectPath, before.uuid, origin.info.url, true);
      if (retained.content !== origin.content || retained.meta !== origin.meta) throw new Error('Origin scene or metadata changed during edit entry.');
    }
  };
  await assertOriginContent();
  const rechecked = await readPrefabEditContext();
  assertPrefabEditContext(rechecked);
  if (!isDeepStrictEqual(before, rechecked)) throw new Error('Editor context changed during preflight. No open was requested.');
  await assertRetainedFiles();
  await assertOriginContent();

  let requested = false;
  try {
    if (!alreadyOpen) {
      requested = true;
      await requestEditorMessage('asset-db', 'open-asset', info.uuid);
      for (let attempt = 0; ; attempt += 1) {
        const context = await readPrefabEditContext();
        if (context.ready === true && context.mode === 'prefab' && context.uuid === info.uuid) break;
        if (attempt >= 20 || context.dirty !== false || context.multi !== false ||
            !['general', 'prefab'].includes(context.mode) || ![before.uuid, info.uuid].includes(context.uuid)) {
          throw new Error('Native prefab edit mode was not confirmed or the editor context changed.');
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    const verify = async () => {
      const context = await readPrefabEditContext();
      assertPrefabEditContext(context);
      if (context.mode !== 'prefab' || context.uuid !== info.uuid || context.tabs[0].url !== source.info.url) {
        throw new Error('Active prefab editor identity does not match the requested asset.');
      }
      const state = await sceneBridge.call('getPrefabEditingState', { prefabUuid: info.uuid });
      const root = assertPrefabEditingRoot(state, info, assetName, rootFileId);
      const actual = normalizePrefabRevertContent(await readPrefabApplyPreview(root.uuid, assetName));
      if (!isDeepStrictEqual(actual, expected)) throw new Error('Prefab editor serialized content differs from the source; unsaved or unsupported properties are present.');
      await assertRetainedFiles();
      // In prefab mode this message is the retained origin, NOT the edit root.
      await assertOriginContent();
      return state;
    };
    const first = await verify();
    await new Promise(resolve => setTimeout(resolve, 400));
    const after = await verify();
    if (!isDeepStrictEqual(first, after)) throw new Error('Prefab edit root changed during verification.');
    return { entered: true, verified: true, alreadyOpen, mode: 'prefab', needsSave: false,
      method: requested ? 'asset-db:open-asset' : null, prefabUuid: info.uuid, url: source.info.url,
      sourceHash: createHash('sha256').update(source.content).digest('hex'),
      node: after.node, previousScene: origin ? { uuid: before.uuid, url: origin.info.url } : null,
      nodeCount: after.nodes.length, componentCount: after.nodes.reduce((sum, node) => sum + node.components.length, 0) };
  } catch (error) {
    if (!requested) throw error;
    throw new Error(`${error.message} The editor may already have entered prefab mode; inspect its state before retrying. No automatic retry, save, close or rollback was attempted.`, { cause: error });
  }
}

async function savePrefabEditMode(projectPath, sceneBridge, options = {}) {
  if (Object.keys(options).some(key => !['prefabUuid', 'expectedSourceHash'].includes(key))) throw new Error('Only prefabUuid and expectedSourceHash options are supported.');
  if (typeof options.prefabUuid !== 'string' || !options.prefabUuid.trim()) throw new Error('An explicit prefab asset UUID is required.');
  if (typeof options.expectedSourceHash !== 'string' || !/^[a-f0-9]{64}$/i.test(options.expectedSourceHash)) {
    throw new Error('expectedSourceHash must be the SHA-256 returned by prefab entry or the last verified save.');
  }
  const uuid = options.prefabUuid.trim();
  if (await requestEditorMessage('asset-db', 'query-ready') !== true) throw new Error('Asset database must be ready.');
  const before = await readPrefabEditContext();
  assertPrefabEditContext(before, true);
  if (before.mode !== 'prefab' || before.uuid !== uuid) throw new Error('The explicitly selected prefab must already be in native edit mode.');
  const source = await readPrefabOperationSource(projectPath, uuid, before.tabs[0].url);
  if (createHash('sha256').update(source.content).digest('hex') !== options.expectedSourceHash.toLowerCase()) {
    throw new Error('Source prefab hash changed since entry or the last save. Inspect and reconcile changes before saving; no write was requested.');
  }
  const assetName = path.basename(source.file, '.prefab');
  const original = JSON.parse(source.content);
  const metadata = assertSerializedPrefabMetadata(original, { expectedName: assetName });
  const rootFileId = original[original[metadata.rootIndex]._prefab.__id__].fileId;
  const readLive = async () => {
    const state = await sceneBridge.call('getPrefabEditingState', { prefabUuid: uuid });
    const root = assertPrefabEditingRoot(state, source.info, assetName, rootFileId);
    const content = normalizePrefabRevertContent(await readPrefabApplyPreview(root.uuid, assetName));
    return { state, content };
  };
  const initial = await readLive();
  if (!isDeepStrictEqual(prefabApplyStructure(original), prefabApplyStructure(initial.content))) {
    throw new Error('Saving hierarchy or component structure changes is not supported; only non-nested prefab properties can be saved.');
  }
  const references = await validateSerializedPrefabAssetReferences(initial.content);
  if (!references.ok || !references.complete) throw new Error('Prefab asset reference validation failed or was incomplete. No save was requested.');

  // In prefab mode this is the retained origin scene, not the editing root.
  const originContent = prefabOriginSceneContent(await requestEditorMessage('scene', 'query-scene-json'));
  const originAsset = originContent.find(entry => entry && entry.__type__ === 'cc.SceneAsset');
  const originUuid = originContent[originAsset.scene.__id__]._id;
  const origin = await readPrefabOperationSource(projectPath, originUuid, undefined, true);
  if (!isDeepStrictEqual(originContent, prefabOriginSceneContent(origin.content, originUuid))) {
    throw new Error('The retained origin scene has unsaved or unsupported content; resolve it before saving the prefab.');
  }
  const assertOriginUnchanged = async () => {
    const retained = await readPrefabOperationSource(projectPath, originUuid, origin.info.url, true);
    if (retained.content !== origin.content || retained.meta !== origin.meta ||
        !isDeepStrictEqual(originContent, prefabOriginSceneContent(await requestEditorMessage('scene', 'query-scene-json'), originUuid))) {
      throw new Error('The retained origin scene or its files changed during prefab saving.');
    }
  };
  const rechecked = await readLive();
  const context = await readPrefabEditContext();
  const current = await readPrefabOperationSource(projectPath, uuid, source.info.url);
  if (!isDeepStrictEqual(before, context) || !isDeepStrictEqual(initial, rechecked) ||
      current.content !== source.content || current.meta !== source.meta) {
    throw new Error('Prefab, editor context or source changed during preflight. No save was requested.');
  }
  await assertOriginUnchanged();
  const sourceChanged = !isDeepStrictEqual(normalizePrefabRevertContent(original), initial.content);
  const alreadySaved = !sourceChanged && !before.dirty;
  let requested = false;
  let result;
  try {
    let saved = source;
    if (!alreadySaved) {
      requested = true;
      result = await requestEditorMessage('scene', 'save-scene');
      for (let attempt = 0; ; attempt += 1) {
        let importing = false;
        try {
          saved = await readPrefabOperationSource(projectPath, uuid, source.info.url);
          if (saved.meta !== source.meta) throw new Error('Source prefab metadata changed while saving.');
        } catch (error) {
          // save-scene can return before this asset finishes reimporting, even
          // while query-ready is true. Retry only reads of the same valid asset.
          if (error.code !== 'PREFAB_ASSET_IMPORTING') throw error;
          importing = true;
        }
        const context = await readPrefabEditContext();
        assertPrefabEditContext(context, true);
        if (context.mode !== 'prefab' || context.uuid !== uuid || context.tabs[0].url !== source.info.url) {
          throw new Error('Active prefab edit identity changed while saving.');
        }
        if (!importing && !context.dirty && isDeepStrictEqual(normalizePrefabRevertContent(JSON.parse(saved.content)), initial.content)) break;
        if (attempt >= 10) throw new Error('Prefab save did not settle to the expected source content and clean edit state.');
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    const verify = async () => {
      const context = await readPrefabEditContext();
      assertPrefabEditContext(context);
      if (context.mode !== 'prefab' || context.uuid !== uuid || context.tabs[0].url !== source.info.url) {
        throw new Error('Active prefab edit identity changed during verification.');
      }
      const retained = await readPrefabOperationSource(projectPath, uuid, source.info.url);
      if (retained.content !== saved.content || retained.meta !== source.meta ||
          !isDeepStrictEqual(normalizePrefabRevertContent(JSON.parse(retained.content)), initial.content) ||
          !isDeepStrictEqual(initial, await readLive())) {
        throw new Error('Prefab save verification failed: source, live content or editing identity changed unexpectedly.');
      }
      await assertOriginUnchanged();
    };
    await verify();
    await new Promise(resolve => setTimeout(resolve, 400));
    await verify();
    return { saved: true, verified: true, alreadySaved, sourceChanged, mode: 'prefab', needsSave: false,
      method: requested ? 'scene:save-scene' : null, result, prefabUuid: uuid, url: source.info.url,
      sourceHash: createHash('sha256').update(saved.content).digest('hex'), node: initial.state.node,
      path: initial.state.node.path,
      previousScene: { uuid: originUuid, url: origin.info.url },
      nodeCount: initial.state.nodes.length, componentCount: initial.state.nodes.reduce((sum, node) => sum + node.components.length, 0) };
  } catch (error) {
    if (!requested) throw error;
    throw new Error(`${error.message} Saving may already have changed the source and other instances; inspect them before retrying. No automatic retry, exit, rollback or origin scene save was attempted.`, { cause: error });
  }
}

async function exitPrefabEditMode(projectPath, sceneBridge, options = {}) {
  if (Object.keys(options).some(key => !['prefabUuid', 'returnSceneUuid'].includes(key))) throw new Error('Only prefabUuid and returnSceneUuid options are supported.');
  for (const key of ['prefabUuid', 'returnSceneUuid']) {
    if (typeof options[key] !== 'string' || !options[key].trim()) throw new Error(`${key} must be an explicit non-empty asset UUID.`);
  }
  const uuid = options.prefabUuid.trim();
  const sceneUuid = options.returnSceneUuid.trim();
  if (await requestEditorMessage('asset-db', 'query-ready') !== true) throw new Error('Asset database must be ready.');
  const before = await readPrefabEditContext();
  const alreadyExited = before.mode === 'general';
  assertPrefabEditContext(before, alreadyExited);
  if (before.uuid !== (alreadyExited ? sceneUuid : uuid)) {
    throw new Error('The active prefab or already-restored scene must match the explicitly selected asset UUID.');
  }
  const source = await readPrefabOperationSource(projectPath, uuid, alreadyExited ? undefined : before.tabs[0].url);
  const assetName = path.basename(source.file, '.prefab');
  const objects = JSON.parse(source.content);
  const metadata = assertSerializedPrefabMetadata(objects, { expectedName: assetName });
  const rootFileId = objects[objects[metadata.rootIndex]._prefab.__id__].fileId;
  const expected = normalizePrefabRevertContent(objects);
  const references = await validateSerializedPrefabAssetReferences(expected);
  if (!references.ok || !references.complete) throw new Error('Prefab asset reference validation failed or was incomplete. No close was requested.');
  const origin = await readPrefabOperationSource(projectPath, sceneUuid, alreadyExited ? before.tabs[0].url : undefined, true);
  const expectedOrigin = prefabOriginSceneContent(origin.content, sceneUuid);
  const assertOriginContent = async () => {
    if (!isDeepStrictEqual(expectedOrigin, prefabOriginSceneContent(await requestEditorMessage('scene', 'query-scene-json'), sceneUuid))) {
      throw new Error('The return scene has unsaved or unexpected serialized content. Resolve it explicitly before exiting.');
    }
  };
  const assertRetainedFiles = async () => {
    const current = await readPrefabOperationSource(projectPath, uuid, source.info.url);
    const retained = await readPrefabOperationSource(projectPath, sceneUuid, origin.info.url, true);
    if (current.content !== source.content || current.meta !== source.meta || retained.content !== origin.content || retained.meta !== origin.meta) {
      throw new Error('Source prefab or return scene files changed during prefab exit.');
    }
  };
  const readLive = async () => {
    const state = await sceneBridge.call('getPrefabEditingState', { prefabUuid: uuid });
    const root = assertPrefabEditingRoot(state, source.info, assetName, rootFileId);
    if (!isDeepStrictEqual(expected, normalizePrefabRevertContent(await readPrefabApplyPreview(root.uuid, assetName)))) {
      throw new Error('Prefab editor has unsaved or unsupported serialized changes, even if dirty is false. Save or resolve them explicitly before exiting.');
    }
    return state;
  };
  await assertOriginContent();
  const initial = alreadyExited ? null : await readLive();
  if (!alreadyExited && !isDeepStrictEqual(initial, await readLive())) throw new Error('Prefab editing identity changed during exit preflight.');
  if (!isDeepStrictEqual(before, await readPrefabEditContext())) throw new Error('Editor context changed during exit preflight. No close was requested.');
  await assertRetainedFiles();
  await assertOriginContent();
  let requested = false;
  let result;
  try {
    if (!alreadyExited) {
      requested = true;
      result = await requestEditorMessage('scene', 'close-scene');
      for (let attempt = 0; ; attempt += 1) {
        const context = await readPrefabEditContext();
        if (context.ready === true && context.mode === 'general' && context.uuid === sceneUuid) break;
        if (attempt >= 20 || context.multi !== false || !['prefab', 'general'].includes(context.mode) ||
            context.uuid !== (context.mode === 'prefab' ? uuid : sceneUuid) || context.mode === 'prefab' && context.dirty !== false) {
          throw new Error('Native prefab exit did not restore the expected scene or the editor context changed.');
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    const verify = async () => {
      const context = await readPrefabEditContext();
      // Native close can mark the restored scene dirty after saved prefab
      // updates, while its serialization is unchanged. Never clear it here.
      assertPrefabEditContext(context, true);
      if (context.mode !== 'general' || context.uuid !== sceneUuid || context.tabs[0].url !== origin.info.url) {
        throw new Error('Prefab exit did not restore the explicitly selected origin scene.');
      }
      await assertRetainedFiles();
      await assertOriginContent();
      return context;
    };
    await verify();
    await new Promise(resolve => setTimeout(resolve, 400));
    const after = await verify();
    return { exited: true, verified: true, alreadyExited, mode: 'general', needsSave: after.dirty,
      method: requested ? 'scene:close-scene' : null, result, prefabUuid: uuid, url: source.info.url,
      sourceUnchanged: true, sceneUuid, sceneUrl: origin.info.url };
  } catch (error) {
    if (!requested) throw error;
    throw new Error(`${error.message} The editor may already have exited prefab mode; inspect its state before retrying. No automatic retry, save, discard, reopen or rollback was attempted.`, { cause: error });
  }
}

async function unlinkPrefabInstance(sceneBridge, options = {}) {
  const selectors = ['uuid', 'path', 'name'];
  for (const key of Object.keys(options)) {
    if (!selectors.includes(key)) throw new Error(`Unsupported unlink selector option: ${key}`);
    if (typeof options[key] !== 'string' || !options[key].trim()) throw new Error(`${key} must be a non-empty string.`);
  }
  if (!selectors.some(key => options[key])) throw new Error('A node selector (uuid, path, or name) is required.');
  if (await requestEditorMessage('asset-db', 'query-ready') !== true ||
      await requestEditorMessage('scene', 'query-is-ready') !== true) {
    throw new Error('Asset database and scene must be ready for prefab unlinking.');
  }
  const before = await sceneBridge.call('getPrefabUnlinkState', options);
  const root = before && before.nodes && before.nodes[0];
  const prefab = root && root.prefab;
  if (!root || !before.node || root.uuid !== before.node.uuid || !prefab ||
      prefab.rootUuid !== root.uuid || !prefab.assetUuid || !prefab.fileId || !prefab.instanceId) {
    throw new Error('Target must be a linked prefab instance root with complete identity. Select the root explicitly.');
  }
  if (before.linkedAncestor !== false) {
    throw new Error('Unlinking inside a linked ancestor is not supported. Select an independent, non-nested instance.');
  }
  if (before.nodes.some(node => node.nested || node.prefab && node.prefab.rootUuid !== root.uuid)) {
    throw new Error('Unlinking a hierarchy containing nested or inconsistent prefab links is not supported: Creator 3.8.8 can lose cross-instance component references after saving. No unlink was requested.');
  }
  const sceneInfo = await requestEditorMessage('asset-db', 'query-asset-info', before.sceneUuid);
  if (!sceneInfo || sceneInfo.uuid !== before.sceneUuid || sceneInfo.type !== 'cc.SceneAsset' ||
      sceneInfo.imported !== true || sceneInfo.invalid === true) {
    throw new Error('Open a saved scene before unlinking; unsaved scenes and prefab editing are not supported.');
  }
  const rechecked = await sceneBridge.call('getPrefabUnlinkState', { uuid: root.uuid });
  if (JSON.stringify(rechecked) !== JSON.stringify(before)) {
    throw new Error('Scene or prefab instance changed before unlinking. No unlink was requested.');
  }
  const expected = {
    ...before,
    nodes: before.nodes.map(node => ({
      ...node, prefab: null, components: node.components.map(component => ({ ...component, prefab: null })),
    })),
  };
  try {
    const result = await requestEditorMessage('scene', 'unlink-prefab', root.uuid);
    if (result !== true) throw new Error('Creator did not confirm prefab unlinking.');
    const after = await sceneBridge.call('getPrefabUnlinkState', { uuid: root.uuid });
    if (JSON.stringify(after) !== JSON.stringify(expected)) {
      throw new Error('Prefab unlink verification failed: links, hierarchy, transforms or component identities differ from the expected state.');
    }
    return {
      unlinked: true, verified: true, needsSave: true, method: 'scene:unlink-prefab',
      sceneUuid: before.sceneUuid, node: after.node, prefabUuid: prefab.assetUuid,
      nodeCount: after.nodes.length,
      componentCount: after.nodes.reduce((sum, node) => sum + node.components.length, 0),
    };
  } catch (error) {
    throw new Error(`${error.message} Unlinking may already have occurred; inspect the hierarchy before retrying. No automatic retry or relink was attempted.`, { cause: error });
  }
}

module.exports = {
  applyPrefabInstance,
  duplicatePrefab,
  editPrefabJson,
  enterPrefabEditMode,
  exitPrefabEditMode,
  inspectPrefab,
  normalizePrefabTarget,
  revertPrefabInstance,
  savePrefabEditMode,
  savePrefabContent,
  unlinkPrefabInstance,
  validateSerializedPrefabAssetReferences,
  validatePrefabReferences,
};
