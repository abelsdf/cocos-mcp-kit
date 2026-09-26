'use strict';

const fs = require('fs');
const path = require('path');
const { isPathInside, resolveProjectFilePath } = require('./path-safety');

const ASSET_INSPECTION_DEFAULTS = Object.freeze({
  maxDepth: 6,
  maxItems: 100,
  maxNodes: 1000,
  maxStringLength: 4000,
  maxCharacters: 50000,
});
const SENSITIVE_ASSET_FIELD = /^(?:password|passwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|credential|cookie)$/i;

async function safeRequest(channel, method, ...args) {
  if (!global.Editor || !Editor.Message || typeof Editor.Message.request !== 'function') {
    throw new Error('Editor.Message.request is unavailable in the Cocos extension host.');
  }
  return await Editor.Message.request(channel, method, ...args);
}

function normalizeAssetInspectionOptions(options = {}) {
  const ranges = {
    maxDepth: [1, 12],
    maxItems: [1, 500],
    maxNodes: [10, 5000],
    maxStringLength: [64, 20000],
    maxCharacters: [1000, 250000],
  };
  const normalized = {};
  for (const [key, [minimum, maximum]] of Object.entries(ranges)) {
    const value = options[key] === undefined ? ASSET_INSPECTION_DEFAULTS[key] : options[key];
    if (!Number.isInteger(value) || value < minimum || value > maximum) {
      throw new Error(`${key} must be an integer between ${minimum} and ${maximum}.`);
    }
    normalized[key] = value;
  }
  if (options.includeData !== undefined && typeof options.includeData !== 'boolean') {
    throw new Error('includeData must be a boolean.');
  }
  normalized.includeData = options.includeData === true;
  return normalized;
}

function normalizeAssetInspectionTarget(rawTarget, projectPath) {
  if (typeof rawTarget !== 'string' || !rawTarget.trim()) {
    throw new Error('Asset target is required.');
  }
  if (rawTarget.length > 4096 || rawTarget.includes('\0')) {
    throw new Error('Asset target is too long or contains an invalid character.');
  }
  const requested = rawTarget;
  const trimmed = rawTarget.trim();
  const forward = trimmed.replace(/\\/g, '/');
  let target = trimmed;
  let kind = 'uuid-or-opaque';

  if (forward.startsWith('db://')) {
    const segments = forward.slice('db://'.length).split('/');
    if (segments.some((segment) => segment === '.' || segment === '..')) {
      throw new Error('Asset db URL must not contain traversal segments.');
    }
    target = forward;
    kind = 'db-url';
  } else if (forward === 'assets' || forward.startsWith('assets/') || forward.startsWith('/assets/')) {
    target = `db://${forward.replace(/^\//, '')}`;
    kind = 'project-path';
  } else if (path.isAbsolute(trimmed) || path.win32.isAbsolute(trimmed)) {
    if (!projectPath) throw new Error('A project path is required for an absolute asset path.');
    const file = resolveProjectFilePath(projectPath, trimmed);
    const assetsRoot = resolveProjectFilePath(projectPath, 'assets');
    if (!isPathInside(assetsRoot, file)) {
      throw new Error('Absolute asset paths must resolve inside the project assets directory.');
    }
    target = `db://${path.relative(projectPath, file).replace(/\\/g, '/')}`;
    kind = 'absolute-path';
  }

  return { requested, target, kind, exact: true };
}

function boundedAssetValue(value, options = {}) {
  const limits = { ...ASSET_INSPECTION_DEFAULTS, ...options };
  const reasons = new Set();
  const seen = new WeakSet();
  let remainingNodes = limits.maxNodes;
  let remainingCharacters = limits.maxCharacters;
  let redactedCount = 0;
  let circularCount = 0;

  function mark(reason, marker) {
    reasons.add(reason);
    return marker;
  }

  function visit(input, depth, key = '') {
    if (remainingNodes-- <= 0) return mark('maxNodes', '[Truncated: maxNodes]');
    if (SENSITIVE_ASSET_FIELD.test(key)) {
      redactedCount += 1;
      return '[Redacted]';
    }
    if (typeof input === 'string') {
      const allowed = Math.max(0, Math.min(limits.maxStringLength, remainingCharacters));
      if (input.length > allowed) {
        const text = input.slice(0, allowed);
        remainingCharacters -= text.length;
        return `${text}${mark(allowed < limits.maxStringLength ? 'maxCharacters' : 'maxStringLength', '…')}`;
      }
      remainingCharacters -= input.length;
      return input;
    }
    if (input === null || typeof input === 'boolean' || typeof input === 'number') return input;
    if (typeof input === 'bigint') return String(input);
    if (input === undefined || typeof input === 'function' || typeof input === 'symbol') return null;
    if (!input || typeof input !== 'object') return String(input);
    if (seen.has(input)) {
      circularCount += 1;
      return '[Circular]';
    }
    if (depth >= limits.maxDepth) return mark('maxDepth', '[Truncated: maxDepth]');
    seen.add(input);
    try {
      if (Array.isArray(input)) {
        const output = [];
        const retained = Math.min(input.length, limits.maxItems);
        for (let index = 0; index < retained; index += 1) {
          const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
          output.push(descriptor && 'value' in descriptor ? visit(descriptor.value, depth + 1, String(index)) : null);
        }
        if (retained < input.length) {
          reasons.add('maxItems');
          output.push({ $remaining: input.length - retained });
        }
        return output;
      }
      const output = Object.create(null);
      const keys = Object.keys(input);
      const retained = Math.min(keys.length, limits.maxItems);
      for (let index = 0; index < retained; index += 1) {
        const property = keys[index];
        const descriptor = Object.getOwnPropertyDescriptor(input, property);
        if (!descriptor || !('value' in descriptor)) {
          reasons.add('accessor');
          output[property] = '[Unavailable: accessor]';
          continue;
        }
        output[property] = visit(descriptor.value, depth + 1, property);
      }
      if (retained < keys.length) {
        reasons.add('maxItems');
        output.$remaining = keys.length - retained;
      }
      return output;
    } finally {
      seen.delete(input);
    }
  }

  return {
    value: visit(value, 0),
    truncated: reasons.size > 0,
    reasons: [...reasons],
    redactedCount,
    circularCount,
    visitedNodes: limits.maxNodes - Math.max(remainingNodes, 0),
  };
}

function summarizeAssetInfo(info) {
  if (!info || typeof info !== 'object') return null;
  return {
    name: typeof info.name === 'string' ? info.name : '',
    displayName: typeof info.displayName === 'string' ? info.displayName : '',
    uuid: typeof info.uuid === 'string' ? info.uuid : '',
    url: typeof info.url === 'string' ? info.url : '',
    file: typeof info.file === 'string' ? info.file : '',
    type: typeof info.type === 'string' ? info.type : '',
    importer: typeof info.importer === 'string' ? info.importer : '',
    imported: typeof info.imported === 'boolean' ? info.imported : null,
    invalid: typeof info.invalid === 'boolean' ? info.invalid : null,
    readonly: typeof info.readonly === 'boolean' ? info.readonly : null,
    isDirectory: typeof info.isDirectory === 'boolean' ? info.isDirectory : null,
  };
}

function assetInfoContains(info, child) {
  if (!info || !info.subAssets || typeof info.subAssets !== 'object') return false;
  return Object.values(info.subAssets).some((asset) => asset && typeof asset === 'object' &&
    ((child.uuid && asset.uuid === child.uuid) || (child.url && asset.url === child.url)));
}

function parentAssetCandidates(info) {
  const candidates = [];
  const add = (value) => {
    if (typeof value === 'string' && value && value !== info.uuid && value !== info.url && !candidates.includes(value)) {
      candidates.push(value);
    }
  };
  if (typeof info.uuid === 'string' && info.uuid.includes('@')) add(info.uuid.split('@')[0]);
  if (typeof info.source === 'string' && info.source !== info.url) add(info.source);
  if (typeof info.url === 'string' && /^db:\/\/.*\.[^/]+\/.+/.test(info.url)) {
    add(info.url.slice(0, info.url.lastIndexOf('/')));
  }
  return candidates;
}

async function resolveAssetRelationship(info, maxItems) {
  const candidates = parentAssetCandidates(info);
  const errors = [];
  for (const candidate of candidates) {
    try {
      const parent = await safeRequest('asset-db', 'query-asset-info', candidate);
      if (parent && parent.uuid !== info.uuid && parent.url !== info.url &&
          (assetInfoContains(parent, info) || candidate === String(info.uuid || '').split('@')[0])) {
        const entries = parent.subAssets && typeof parent.subAssets === 'object'
          ? Object.entries(parent.subAssets).map(([key, asset]) => ({ key, ...summarizeAssetInfo(asset) })) : [];
        entries.sort((a, b) => String(a.url || a.key).localeCompare(String(b.url || b.key)) ||
          String(a.uuid || '').localeCompare(String(b.uuid || '')));
        return {
          kind: 'subasset',
          status: 'available',
          mainAsset: summarizeAssetInfo(parent),
          parentAsset: summarizeAssetInfo(parent),
          subAssets: entries.slice(0, maxItems),
          subAssetCount: entries.length,
          subAssetsTruncated: entries.length > maxItems,
        };
      }
    } catch (error) {
      errors.push(String(error && error.message || error).slice(0, 500));
    }
  }
  if (candidates.length) {
    return {
      kind: 'unresolved-subasset',
      status: errors.length ? 'error' : 'missing',
      mainAsset: null,
      parentAsset: null,
      subAssets: [],
      subAssetCount: 0,
      subAssetsTruncated: false,
      candidates,
      ...(errors.length ? { errors } : {}),
    };
  }
  const entries = info.subAssets && typeof info.subAssets === 'object'
    ? Object.entries(info.subAssets).map(([key, asset]) => ({ key, ...summarizeAssetInfo(asset) })) : [];
  entries.sort((a, b) => String(a.url || a.key).localeCompare(String(b.url || b.key)) ||
    String(a.uuid || '').localeCompare(String(b.uuid || '')));
  return {
    kind: 'main',
    status: 'available',
    mainAsset: summarizeAssetInfo(info),
    parentAsset: null,
    subAssets: entries.slice(0, maxItems),
    subAssetCount: entries.length,
    subAssetsTruncated: entries.length > maxItems,
  };
}

async function requestAssetIdentity(method, info, extraTargets = []) {
  const targets = [];
  for (const target of [info.uuid, info.url, ...extraTargets]) {
    if (typeof target === 'string' && target && !targets.includes(target)) targets.push(target);
  }
  const errors = [];
  for (const target of targets) {
    try {
      const value = await safeRequest('asset-db', method, target);
      if (value != null) {
        return { status: 'available', target, value, ...(errors.length ? { warnings: errors } : {}) };
      }
    } catch (error) {
      errors.push(`${target}: ${String(error && error.message || error).slice(0, 500)}`);
    }
  }
  if (errors.length) return { status: 'error', errors };
  return { status: 'missing' };
}

function queryStatus(query) {
  const result = { status: query.status };
  if (query.target) result.target = query.target;
  if (query.scope) result.scope = query.scope;
  if (query.errors) result.errors = query.errors;
  if (query.warnings) result.warnings = query.warnings;
  return result;
}

async function inspectAsset(target, options = {}) {
  const limits = normalizeAssetInspectionOptions(options);
  const normalizedTarget = normalizeAssetInspectionTarget(target, options.projectPath);
  const info = await safeRequest('asset-db', 'query-asset-info', normalizedTarget.target);
  if (info == null) throw new Error(`Asset not found: ${normalizedTarget.target}`);
  if (!info || typeof info !== 'object' || typeof info.url !== 'string' || !info.url) {
    throw new Error('Asset information was malformed or missing its canonical URL.');
  }

  const relationship = await resolveAssetRelationship(info, limits.maxItems);
  const parentTargets = relationship.parentAsset
    ? [relationship.parentAsset.uuid, relationship.parentAsset.url] : [];
  const metadataQuery = await requestAssetIdentity('query-asset-meta', info, parentTargets);
  if (metadataQuery.status === 'available') {
    const metadataUuid = metadataQuery.value && typeof metadataQuery.value.uuid === 'string'
      ? metadataQuery.value.uuid : '';
    const matchesResolvedMainAsset = relationship.kind === 'subasset' && relationship.mainAsset &&
      metadataUuid && metadataUuid === relationship.mainAsset.uuid && metadataUuid !== info.uuid;
    metadataQuery.scope = matchesResolvedMainAsset || (parentTargets.includes(metadataQuery.target) &&
      metadataQuery.target !== info.uuid && metadataQuery.target !== info.url) ? 'main_asset' : 'asset';
  }
  const dataQuery = limits.includeData
    ? await requestAssetIdentity('query-asset-data', info)
    : { status: 'not_requested' };
  const infoSnapshot = boundedAssetValue(info, limits);
  const metaSnapshot = metadataQuery.status === 'available'
    ? boundedAssetValue(metadataQuery.value, limits) : null;
  const dataSnapshot = dataQuery.status === 'available'
    ? boundedAssetValue(dataQuery.value, limits) : null;
  const truncation = {
    info: { truncated: infoSnapshot.truncated, reasons: infoSnapshot.reasons },
    meta: metaSnapshot ? { truncated: metaSnapshot.truncated, reasons: metaSnapshot.reasons } : null,
    data: dataSnapshot ? { truncated: dataSnapshot.truncated, reasons: dataSnapshot.reasons } : null,
    relationship: relationship.subAssetsTruncated ? { truncated: true, reasons: ['maxItems'] } : { truncated: false, reasons: [] },
  };
  const truncated = Object.values(truncation).some((item) => item && item.truncated);
  const complete = relationship.status === 'available' && metadataQuery.status === 'available' &&
    (dataQuery.status === 'not_requested' || dataQuery.status === 'available') && !truncated;

  return {
    target: normalizedTarget,
    identity: {
      ...summarizeAssetInfo(info),
      kind: relationship.kind,
      metadataUuid: metadataQuery.status === 'available' && typeof metadataQuery.value.uuid === 'string'
        ? metadataQuery.value.uuid : '',
      metadataMatchesAsset: metadataQuery.status === 'available' && metadataQuery.value.uuid === info.uuid,
      metadataMatchesMainAsset: metadataQuery.status === 'available' && relationship.mainAsset
        ? metadataQuery.value.uuid === relationship.mainAsset.uuid : null,
    },
    relationship,
    queries: {
      info: { status: 'available', target: normalizedTarget.target },
      metadata: queryStatus(metadataQuery),
      data: queryStatus(dataQuery),
    },
    limits: {
      maxDepth: limits.maxDepth,
      maxItems: limits.maxItems,
      maxNodes: limits.maxNodes,
      maxStringLength: limits.maxStringLength,
      maxCharacters: limits.maxCharacters,
    },
    complete,
    truncated,
    truncation,
    info: infoSnapshot.value,
    meta: metaSnapshot ? metaSnapshot.value : null,
    data: dataSnapshot ? dataSnapshot.value : null,
  };
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

function normalizeAssetSearchDirectory(rawDirectory, projectPath) {
  if (rawDirectory === undefined) return '';
  if (typeof rawDirectory !== 'string' || !rawDirectory.trim()) {
    throw new Error('directory must be a non-empty project asset path.');
  }
  const normalized = normalizeAssetInspectionTarget(rawDirectory, projectPath).target.replace(/\/$/, '');
  if (normalized !== 'db://assets' && !normalized.startsWith('db://assets/')) {
    throw new Error('directory must resolve inside db://assets.');
  }
  return normalized;
}

function normalizeAssetSearchOptions(options = {}) {
  const normalized = {
    scope: options.scope === undefined ? 'project' : options.scope,
    nameMode: options.nameMode === undefined ? 'contains' : options.nameMode,
    caseSensitive: options.caseSensitive === true,
    includeSubassets: options.includeSubassets !== false,
    offset: options.offset === undefined ? 0 : options.offset,
    limit: options.limit === undefined ? 50 : options.limit,
  };
  if (!['project', 'all'].includes(normalized.scope)) {
    throw new Error('scope must be "project" or "all".');
  }
  if (!['contains', 'prefix', 'exact'].includes(normalized.nameMode)) {
    throw new Error('nameMode must be "contains", "prefix", or "exact".');
  }
  for (const key of ['caseSensitive', 'includeSubassets']) {
    if (options[key] !== undefined && typeof options[key] !== 'boolean') {
      throw new Error(`${key} must be a boolean.`);
    }
  }
  if (!Number.isInteger(normalized.offset) || normalized.offset < 0 || normalized.offset > 1000000) {
    throw new Error('offset must be an integer between 0 and 1000000.');
  }
  if (!Number.isInteger(normalized.limit) || normalized.limit < 1 || normalized.limit > 200) {
    throw new Error('limit must be an integer between 1 and 200.');
  }
  for (const [key, maximum] of [['pattern', 4096], ['ccType', 256], ['name', 256]]) {
    if (options[key] !== undefined) {
      if (typeof options[key] !== 'string' || !options[key].trim() || options[key].length > maximum || options[key].includes('\0')) {
        throw new Error(`${key} must be a non-empty string of at most ${maximum} characters.`);
      }
      normalized[key] = options[key].trim().replace(/\\/g, '/');
    }
  }
  normalized.directory = normalizeAssetSearchDirectory(options.directory, options.projectPath);
  return normalized;
}

function compareAssetSearchEntries(left, right) {
  const leftKey = `${String(left.url || '')}\0${String(left.uuid || '')}`;
  const rightKey = `${String(right.url || '')}\0${String(right.uuid || '')}`;
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

function isAssetSubasset(asset) {
  return typeof asset.uuid === 'string' && asset.uuid.includes('@');
}

function summarizeAssetSearchEntry(asset) {
  const summary = summarizeAssetInfo(asset);
  return {
    ...summary,
    path: typeof asset.path === 'string' ? asset.path : '',
    source: typeof asset.source === 'string' ? asset.source : '',
    isSubasset: isAssetSubasset(asset),
    mainUuid: isAssetSubasset(asset) ? asset.uuid.split('@')[0] : (summary ? summary.uuid : ''),
    subAssetCount: asset.subAssets && typeof asset.subAssets === 'object'
      ? Object.keys(asset.subAssets).length : 0,
  };
}

function assetMatchesName(asset, name, mode, caseSensitive) {
  if (!name) return true;
  const normalize = (value) => caseSensitive ? value : value.toLowerCase();
  const needle = normalize(name);
  const urlName = typeof asset.url === 'string' ? asset.url.slice(asset.url.lastIndexOf('/') + 1) : '';
  const withoutExtension = urlName.replace(/\.[^./]+$/, '');
  const values = [asset.name, asset.displayName, urlName, withoutExtension]
    .filter((value) => typeof value === 'string' && value)
    .map(normalize);
  if (mode === 'exact') return values.some((value) => value === needle);
  if (mode === 'prefix') return values.some((value) => value.startsWith(needle));
  return values.some((value) => value.includes(needle));
}

function buildAssetNameAmbiguities(assets, caseSensitive) {
  const groups = new Map();
  for (const asset of assets) {
    if (typeof asset.name !== 'string' || !asset.name) continue;
    const key = caseSensitive ? asset.name : asset.name.toLowerCase();
    if (!groups.has(key)) groups.set(key, { name: asset.name, assets: [] });
    groups.get(key).assets.push(asset);
  }
  const duplicates = [...groups.values()].filter((group) => group.assets.length > 1)
    .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  const retained = duplicates.slice(0, 20).map((group) => ({
    name: group.name,
    count: group.assets.length,
    candidates: group.assets.slice(0, 20).map((asset) => ({
      uuid: asset.uuid,
      url: asset.url,
      type: asset.type,
      isSubasset: asset.isSubasset,
      mainUuid: asset.mainUuid,
    })),
    candidatesTruncated: group.assets.length > 20,
  }));
  return {
    hasDuplicateNames: duplicates.length > 0,
    groupCount: duplicates.length,
    groups: retained,
    groupsTruncated: duplicates.length > retained.length,
  };
}

async function searchAssets(options = {}) {
  const normalized = normalizeAssetSearchOptions(options);
  const payload = {};
  if (normalized.pattern) payload.pattern = normalized.pattern;
  else if (normalized.directory) payload.pattern = `${normalized.directory}/**`;
  else if (normalized.scope === 'project') payload.pattern = 'db://assets/**';
  if (normalized.ccType) payload.ccType = normalized.ccType;

  const queried = await listAssets(payload);
  const seen = new Set();
  const matches = queried.filter((asset) => {
    if (!asset || typeof asset !== 'object') return false;
    if (normalized.scope === 'project' &&
        (typeof asset.url !== 'string' || !asset.url.startsWith('db://assets/'))) return false;
    if (normalized.directory && asset.url !== normalized.directory &&
        !asset.url.startsWith(`${normalized.directory}/`)) return false;
    if (normalized.ccType && asset.type !== normalized.ccType) return false;
    if (!normalized.includeSubassets && isAssetSubasset(asset)) return false;
    if (!assetMatchesName(asset, normalized.name, normalized.nameMode, normalized.caseSensitive)) return false;
    const identity = `${String(asset.uuid || '')}\0${String(asset.url || '')}`;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  }).map(summarizeAssetSearchEntry).sort(compareAssetSearchEntries);

  const assets = matches.slice(normalized.offset, normalized.offset + normalized.limit);
  const nextOffset = normalized.offset + assets.length;
  const exactNameCandidates = normalized.name && normalized.nameMode === 'exact' ? matches : [];
  return {
    query: {
      scope: normalized.scope,
      pattern: normalized.pattern || null,
      assetDbPattern: payload.pattern || null,
      ccType: normalized.ccType || null,
      name: normalized.name || null,
      nameMode: normalized.nameMode,
      caseSensitive: normalized.caseSensitive,
      directory: normalized.directory || null,
      includeSubassets: normalized.includeSubassets,
    },
    scanned: queried.length,
    count: matches.length,
    total: matches.length,
    offset: normalized.offset,
    limit: normalized.limit,
    returned: assets.length,
    hasMore: nextOffset < matches.length,
    nextOffset: nextOffset < matches.length ? nextOffset : null,
    complete: true,
    selection: {
      exactNameQuery: exactNameCandidates.length > 0 || Boolean(normalized.name && normalized.nameMode === 'exact'),
      ambiguous: exactNameCandidates.length > 1,
      candidateCount: exactNameCandidates.length,
      candidates: exactNameCandidates.slice(0, 20).map((asset) => ({
        name: asset.name,
        uuid: asset.uuid,
        url: asset.url,
        type: asset.type,
        isSubasset: asset.isSubasset,
        mainUuid: asset.mainUuid,
      })),
      candidatesTruncated: exactNameCandidates.length > 20,
    },
    ambiguities: normalized.name
      ? buildAssetNameAmbiguities(matches, normalized.caseSensitive)
      : { hasDuplicateNames: false, groupCount: 0, groups: [], groupsTruncated: false },
    assets,
  };
}

function normalizeAssetNameLookup(name, options = {}) {
  if (typeof name !== 'string' || !name.trim() || name.length > 256 || name.includes('\0')) {
    throw new Error('name must be a non-empty string of at most 256 characters.');
  }
  const maxCandidates = options.maxCandidates === undefined ? 50 : options.maxCandidates;
  if (!Number.isInteger(maxCandidates) || maxCandidates < 1 || maxCandidates > 200) {
    throw new Error('maxCandidates must be an integer between 1 and 200.');
  }
  return { name: name.trim(), maxCandidates };
}

async function findAssetByName(name, options = {}) {
  const lookup = normalizeAssetNameLookup(name, options);
  const search = await searchAssets({
    ...options,
    name: lookup.name,
    nameMode: 'exact',
    offset: 0,
    limit: lookup.maxCandidates,
  });
  const status = search.total === 0 ? 'not_found' : search.total === 1 ? 'unique' : 'ambiguous';
  const candidates = search.assets;
  const selected = status === 'unique' ? { ...candidates[0] } : null;

  return {
    query: {
      name: lookup.name,
      match: 'exact',
      ccType: search.query.ccType,
      directory: search.query.directory,
      caseSensitive: search.query.caseSensitive,
      includeSubassets: search.query.includeSubassets,
      scope: search.query.scope,
      maxCandidates: lookup.maxCandidates,
    },
    status,
    found: status !== 'not_found',
    resolved: status === 'unique',
    candidateCount: search.total,
    returned: candidates.length,
    candidatesTruncated: search.total > candidates.length,
    selected,
    candidates,
    guidance: status === 'unique'
      ? 'Use selected.uuid or selected.url as the exact asset target.'
      : status === 'ambiguous'
        ? 'Do not choose arbitrarily. Narrow the lookup with ccType, directory, includeSubassets, or caseSensitive.'
        : 'No exact asset name matched the requested filters. Use list_assets for broader contains or prefix search.',
    complete: search.complete,
  };
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
  ASSET_INSPECTION_DEFAULTS,
  boundedAssetValue,
  clearSelection,
  deleteAsset,
  findAssetByName,
  getCurrentSelection,
  inspectAsset,
  listAssets,
  normalizeAssetInspectionOptions,
  normalizeAssetInspectionTarget,
  normalizeAssetNameLookup,
  normalizeAssetSearchOptions,
  openAsset,
  queryAssetData,
  queryAssetInfo,
  queryAssetMeta,
  queryAssetUrl,
  searchAssets,
  selectAsset,
  selectNode,
};
