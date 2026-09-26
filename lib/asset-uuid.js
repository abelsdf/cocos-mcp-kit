'use strict';

const { normalizeAssetInspectionTarget } = require('./assets');

function sameIdentity(left, right) {
  return Boolean(left && right && left.uuid && left.url && left.type &&
    left.uuid === right.uuid && left.url === right.url && left.type === right.type);
}

function defaultRequest(method, ...args) {
  if (!global.Editor || !Editor.Message || typeof Editor.Message.request !== 'function') {
    throw new Error('Editor.Message.request is unavailable; query_asset_uuid requires Cocos asset-db.');
  }
  return Editor.Message.request('asset-db', method, ...args);
}

async function queryAssetUuid(target, options = {}) {
  const input = normalizeAssetInspectionTarget(target, options.projectPath);
  const request = options.request || defaultRequest;
  const info = await request('query-asset-info', input.target);
  if (info == null) return { found: false, status: 'not_found', complete: false, input, uuid: null };
  if (typeof info.uuid !== 'string' || !info.uuid ||
      typeof info.url !== 'string' || !info.url ||
      typeof info.type !== 'string' || !info.type) {
    throw new Error('asset-db returned an incomplete asset identity.');
  }

  const issues = [];
  const byUuid = await request('query-asset-info', info.uuid);
  const byUrl = await request('query-asset-info', info.url);
  if (!sameIdentity(info, byUuid) || !sameIdentity(info, byUrl)) {
    issues.push('identity_lookup_mismatch');
  }
  if (info.imported !== true || info.invalid === true) issues.push('not_imported');

  const canonicalUuid = await request('query-uuid', info.url);
  if (canonicalUuid !== info.uuid) issues.push('canonical_uuid_mismatch');
  let inputUuid = null;
  if (input.kind === 'uuid-or-opaque') {
    if (input.target !== info.uuid) issues.push('input_uuid_mismatch');
  } else {
    inputUuid = input.target === info.url
      ? canonicalUuid : await request('query-uuid', input.target);
    if (inputUuid !== info.uuid) issues.push('input_uuid_mismatch');
  }

  const subasset = info.isSubAsset === true || info.uuid.includes('@');
  let parent = null;
  if (subasset) {
    const parentUuid = info.uuid.includes('@') ? info.uuid.split('@')[0] : '';
    const parentInfo = parentUuid ? await request('query-asset-info', parentUuid) : null;
    const linked = parentInfo && parentInfo.uuid === parentUuid &&
      typeof parentInfo.url === 'string' && parentInfo.url &&
      typeof parentInfo.type === 'string' && parentInfo.type &&
      Object.values(parentInfo.subAssets || {}).some((child) => child && child.uuid === info.uuid);
    if (!linked) {
      issues.push('parent_asset_unresolved');
    } else {
      parent = { uuid: parentInfo.uuid, url: parentInfo.url, type: parentInfo.type };
      if (parentInfo.imported !== true || parentInfo.invalid === true) issues.push('parent_not_imported');
      const parentByUrl = await request('query-asset-info', parentInfo.url);
      const parentMappedUuid = await request('query-uuid', parentInfo.url);
      if (!sameIdentity(parentInfo, parentByUrl) || parentMappedUuid !== parentInfo.uuid) {
        issues.push('parent_identity_mismatch');
      }
    }
  }

  const complete = issues.length === 0;
  return {
    found: true,
    status: complete ? 'resolved' : 'incomplete',
    complete,
    input,
    uuid: complete ? info.uuid : null,
    asset: { uuid: info.uuid, url: info.url, type: info.type,
      kind: subasset ? 'subasset' : 'main', imported: info.imported === true,
      invalid: info.invalid === true },
    parent,
    nativeMapping: { canonicalUuid: typeof canonicalUuid === 'string' ? canonicalUuid : null,
      inputUuid: typeof inputUuid === 'string' ? inputUuid : null },
    issues,
  };
}

module.exports = { queryAssetUuid };
